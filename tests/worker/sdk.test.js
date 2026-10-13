// @ts-check
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { env as bindings } from "cloudflare:workers";
import { createScheduledController } from "cloudflare:test";
import { createClient } from "@libsql/client/web";
import { withDatabase } from "../../worker/storage/turso.js";
import app from "../../worker/app.js";
import worker from "../../worker/index.js";
import { Resend } from "resend";
import { hash, randomToken } from "../../worker/security/crypto.js";
import { cleanup } from "../../worker/storage/cleanup.js";
import { transaction, commit } from "../../worker/storage/db.js";
import { removeMember } from "../../worker/services/organizations.js";
import { MAX_MESSAGE } from "../../shared/schema.js";

const env = withDatabase(bindings);
const localOrigin = "http://localhost:5173";
const orgA = "00000000-0000-4000-8000-000000000001";
const orgB = "00000000-0000-4000-8000-000000000002";
const owner = "00000000-0000-4000-8000-000000000003";
const domainA = "00000000-0000-4000-8000-000000000004";
const domainB = "00000000-0000-4000-8000-000000000005";
const message = {
	from: "Acme <hello@example.com>",
	to: "ada@example.net",
	subject: "Welcome",
	html: "<h1>Hello</h1>",
	text: "Hello",
};
/** @type {import("../../worker/types.js").AppBindings} */
let testEnv;
let provider = vi.fn(async (_message) => ({ messageId: "provider-id" }));
let full = new Resend("cdf_placeholder");
let other = new Resend("cdf_placeholder");
let sending = new Resend("cdf_placeholder");
let fullToken = "";
let sendingToken = "";

/** @param {string} organization @param {string} permission @param {string|null} [domain] */
async function seedKey(organization, permission, domain = null) {
	const token = randomToken("cdf_");
	await env.DB.prepare(
		"INSERT INTO api_keys(id,org_id,name,hash,prefix,permission,domain_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
	)
		.bind(
			crypto.randomUUID(),
			organization,
			"Test",
			await hash(token),
			token.slice(0, 12),
			permission,
			domain,
			Date.now(),
		)
		.run();
	return token;
}

/** @param {string} path @param {string} [method] @param {unknown} [body] @param {Record<string,string>} [headers] @param {string} [origin] */
function request(path, method = "GET", body, headers = {}, origin = localOrigin) {
	const init = /** @type {RequestInit} */ ({
		method,
		headers: Object.assign({ "Content-Type": "application/json" }, headers),
	});
	if (body !== undefined) init.body = JSON.stringify(body);
	return app.fetch(new Request(`${origin}${path}`, init), testEnv);
}

beforeEach(async () => {
	const client = createClient({ url: bindings.TURSO_DATABASE_URL });

	try {
		await client.executeMultiple(bindings.TEST_RESET_SQL);
	} finally {
		client.close();
	}

	await env.DB.batch([
		env.DB.prepare("INSERT INTO organizations VALUES(?,?,?)").bind(orgA, "Acme", Date.now()),
		env.DB.prepare("INSERT INTO organizations VALUES(?,?,?)").bind(orgB, "Beta", Date.now()),
		env.DB.prepare("INSERT INTO users VALUES(?,?,?,?)").bind(owner, "owner", 1, Date.now()),
		env.DB.prepare("INSERT INTO memberships VALUES(?,?,'owner')").bind(orgA, owner),
		env.DB.prepare("INSERT INTO domains VALUES(?,?,?,?)").bind(
			domainA,
			orgA,
			"example.com",
			Date.now(),
		),
		env.DB.prepare("INSERT INTO domains VALUES(?,?,?,?)").bind(
			domainB,
			orgB,
			"example.com",
			Date.now(),
		),
	]);
	provider = vi.fn(async (_message) => ({ messageId: "provider-id" }));
	testEnv = Object.assign({}, env, { EMAIL: { send: provider } });
	fullToken = await seedKey(orgA, "full_access");
	sendingToken = await seedKey(orgA, "sending_access", domainA);
	full = new Resend(fullToken, { baseUrl: "https://cdfsend.test" });
	sending = new Resend(sendingToken, { baseUrl: "https://cdfsend.test" });
	other = new Resend(await seedKey(orgB, "full_access"), { baseUrl: "https://cdfsend.test" });
	const nativeFetch = globalThis.fetch;

	/** @type {typeof fetch} */
	const bridge = async (input, init) => {
		const request = new Request(input, init);
		if (new URL(request.url).hostname === "cdfsend.test") return app.fetch(request, testEnv);
		return nativeFetch(request);
	};

	vi.stubGlobal("fetch", bridge);
});
afterEach(() => vi.unstubAllGlobals());

it("initializes Turso for the exported fetch and scheduled handlers", async () => {
	const response = await worker.fetch(new Request(`${localOrigin}/api/auth/status`), bindings);
	expect(await response.json()).toEqual({ bootstrapped: false });
	const now = Date.now();
	const expiredAt = now - 1;
	await env.DB.prepare("INSERT INTO sessions VALUES('expired',?,?,?)")
		.bind(owner, now, expiredAt)
		.run();
	await worker.scheduled(createScheduledController(), bindings);
	expect(await env.DB.prepare("SELECT hash FROM sessions WHERE hash='expired'").first()).toBeNull();
});

/** @param {number} [authAt] */
async function dashboardSession(authAt = Date.now()) {
	const token = randomToken();
	const expiresAt = Date.now() + 60_000;
	await env.DB.prepare("INSERT INTO sessions(hash,user_id,auth_at,expires_at) VALUES(?,?,?,?)")
		.bind(await hash(token), owner, authAt, expiresAt)
		.run();
	return { Origin: localOrigin, Cookie: `__Host-cdfsend=${token}` };
}

describe("backend failure logging", () => {
	afterEach(() => vi.restoreAllMocks());

	it("logs request failures with a registered route, not private URL or exception data", async () => {
		const output = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(testEnv.DB, "prepare").mockImplementation(() => {
			throw new Error("private database query and token");
		});
		const response = await request(`/api/orgs/${orgA}/emails/private-recipient?token=secret`);
		expect(response.status).toBe(500);
		expect(output).toHaveBeenCalledOnce();
		const entry = JSON.parse(output.mock.calls[0][0]);
		expect(entry).toMatchObject({ level: "error", event: "internal_error", method: "GET" });
		expect(entry.route).toContain("/api/");
		expect(output.mock.calls[0][0]).not.toMatch(/private|secret|token/);
	});
	it("logs provider rejection once and replays without another failure or private data", async () => {
		const errors = vi.spyOn(console, "log").mockImplementation(() => {});
		const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		provider.mockRejectedValue(
			Object.assign(new Error("private provider text"), {
				code: "E_SENDER_NOT_VERIFIED",
			}),
		);
		await full.emails.send(message, { idempotencyKey: "private-key" });
		await full.emails.send(message, { idempotencyKey: "private-key" });
		expect(errors).toHaveBeenCalledOnce();
		expect(JSON.parse(errors.mock.calls[0][0])).toMatchObject({
			event: "email_provider_failed",
			status: "failed",
			status_code: 403,
		});
		expect(warnings).toHaveBeenCalledOnce();
		expect(JSON.parse(warnings.mock.calls[0][0])).toMatchObject({
			event: "email_send_completed",
			sent: 0,
			failed: 1,
		});
		expect(info).toHaveBeenCalledOnce();
		expect(JSON.parse(info.mock.calls[0][0])).toMatchObject({ event: "idempotency_replay" });
		const logs = JSON.stringify([errors.mock.calls, warnings.mock.calls, info.mock.calls]);
		expect(logs).not.toMatch(/private|example\.com|example\.net|Welcome|Hello/);
		expect(logs).not.toContain(fullToken);
		expect(provider).toHaveBeenCalledTimes(1);
	});

	it.each([true, false])(
		"logs history persistence failure after provider acceptance=%s",
		async (accepted) => {
			const errors = vi.spyOn(console, "log").mockImplementation(() => {});
			vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.spyOn(console, "info").mockImplementation(() => {});
			await env.DB.prepare(
				"CREATE TRIGGER reject_history BEFORE UPDATE ON emails BEGIN SELECT RAISE(ABORT,'private persistence details'); END",
			).run();

			if (!accepted) {
				provider.mockRejectedValue(
					Object.assign(new Error("private provider details"), {
						code: "E_SENDER_NOT_VERIFIED",
					}),
				);
			}

			const result = await full.emails.send(message, { idempotencyKey: "history-failure" });
			expect(result.error).not.toBeNull();
			await full.emails.send(message, { idempotencyKey: "history-failure" });
			expect(provider).toHaveBeenCalledOnce();
			const entries = errors.mock.calls.map((call) => JSON.parse(call[0]));
			expect(entries.filter((entry) => entry.event === "email_history_update_failed")).toEqual([
				expect.objectContaining({ provider_accepted: accepted, status: "uncertain" }),
			]);
			expect(JSON.stringify(entries)).not.toContain("private");
		},
	);

	it("emits one aggregate warning for permissive validation and stays quiet on successful reads", async () => {
		const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		await full.batch.send([message, Object.assign({}, message, { from: "bad" })], {
			batchValidation: "permissive",
		});
		expect(warnings).toHaveBeenCalledOnce();
		expect(JSON.parse(warnings.mock.calls[0][0])).toMatchObject({
			event: "email_send_completed",
			sent: 1,
			validation_rejected: 1,
		});
		await request("/health");
		await full.emails.list();
		expect(info).not.toHaveBeenCalled();
	});

	it("logs cleanup failures and rethrows for retry without leaking Turso text", async () => {
		const errors = vi.spyOn(console, "log").mockImplementation(() => {});
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		vi.spyOn(testEnv.DB, "batch").mockRejectedValueOnce(new Error("private query"));
		await expect(cleanup(testEnv)).rejects.toThrow("private query");
		expect(errors).toHaveBeenCalledOnce();
		expect(JSON.parse(errors.mock.calls[0][0])).toEqual({
			level: "error",
			event: "retention_cleanup_failed",
			error_type: "Error",
		});
		expect(info).not.toHaveBeenCalled();
		await cleanup(testEnv);
		expect(info).toHaveBeenCalledOnce();
	});
});

describe("Hono routing and middleware boundaries", () => {
	it("secures health, API errors, and immutable asset responses", async () => {
		const assets = vi.fn(async () => Response.redirect(`${localOrigin}/login`));
		testEnv = Object.assign({}, testEnv, { ASSETS: { fetch: assets } });
		const responses = await Promise.all([
			request("/health"),
			request("/emails"),
			request("/dashboard"),
		]);
		expect(responses.map((response) => response.status)).toEqual([200, 401, 302]);
		expect(await responses[0].json()).toEqual({ name: "cdfsend", status: "ok" });

		for (const response of responses) {
			expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
			expect(response.headers.get("X-Frame-Options")).toBe("DENY");
			expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
		}

		expect(responses[1].headers.get("Cache-Control")).toBe("no-store");
		expect(await responses[1].json()).toMatchObject({ name: "missing_api_key", statusCode: 401 });
		expect(assets).toHaveBeenCalledTimes(1);
	});
	it("keeps API namespaces out of the SPA and unsupported SDK operations authenticated", async () => {
		const assets = vi.fn(
			async () => new Response("synthetic dashboard", { headers: { "Content-Type": "text/html" } }),
		);
		testEnv = Object.assign({}, testEnv, { ASSETS: { fetch: assets } });

		const paths = [
			"/contacts",
			"/domains/id/verify",
			"/emails/id/attachments",
			"/api-keys/id/extra",
		];
		const responses = await Promise.all(
			paths.map(async (path) =>
				Promise.all([
					request(path),
					request(path, "GET", undefined, { Authorization: `Bearer ${fullToken}` }),
				]),
			),
		);

		for (const [anonymous, authorized] of responses) {
			expect(anonymous.status).toBe(401);
			expect(authorized.status).toBe(501);
		}

		expect((await request("/api/unknown")).status).toBe(404);
		expect((await request("/api/auth")).status).toBe(404);
		expect((await request("/api/instance")).status).toBe(404);
		expect(assets).not.toHaveBeenCalled();
		const spa = await request("/api");
		expect(await spa.text()).toBe("synthetic dashboard");
		expect(spa.headers.get("Cache-Control")).toBe("no-store");
	});
	it("does not accept API keys on dashboard routes or session cookies on SDK routes", async () => {
		const headers = await dashboardSession();
		expect(
			(await request("/api/me", "GET", undefined, { Authorization: `Bearer ${fullToken}` })).status,
		).toBe(401);
		expect((await request("/domains", "GET", undefined, headers)).status).toBe(401);
		expect((await request("/api/me", "GET", undefined, headers)).status).toBe(200);
	});
	it("checks origins before authentication, body parsing, and route fallbacks", async () => {
		const paths = ["/api/auth/logout", "/api/orgs/unknown/domains", "/api/unknown"];
		const responses = await Promise.all(
			paths.map((path) => request(path, "POST", undefined, { Origin: "https://attacker.test" })),
		);
		expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);

		expect(provider).not.toHaveBeenCalled();
	});
	it("retains auth method errors and allows logout without a JSON body", async () => {
		expect((await request("/api/auth/login/options")).status).toBe(405);
		const headers = await dashboardSession();
		const response = await request("/api/auth/logout", "POST", undefined, headers);
		expect(response.status).toBe(200);
		expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
		expect((await request("/api/me", "GET", undefined, headers)).status).toBe(401);
	});
	it("requires recent authentication for management but not dashboard sending", async () => {
		const authAt = Date.now() - 6 * 60_000;
		const headers = await dashboardSession(authAt);
		expect((await request(`/api/orgs/${orgA}/domains`, "GET", undefined, headers)).status).toBe(
			200,
		);
		const mutation = await request(
			`/api/orgs/${orgA}/domains`,
			"POST",
			{ name: "fresh.example" },
			headers,
		);
		expect(mutation.status).toBe(403);
		expect(await mutation.json()).toMatchObject({ name: "reauthentication_required" });
		const sent = await request(`/api/orgs/${orgA}/emails`, "POST", message, headers);
		expect(sent.status).toBe(200);
		expect(provider).toHaveBeenCalledTimes(1);
	});
	it("does not share request actors across concurrent SDK and dashboard requests", async () => {
		const headers = await dashboardSession();
		const [a, b, dashboard, inaccessible] = await Promise.all([
			full.domains.list(),
			other.domains.list(),
			request(`/api/orgs/${orgA}/domains`, "GET", undefined, headers),
			request(`/api/orgs/${orgB}/domains`, "GET", undefined, headers),
		]);
		expect(a.data?.data.map((domain) => domain.id)).toEqual([domainA]);
		expect(b.data?.data.map((domain) => domain.id)).toEqual([domainB]);
		expect(
			(await dashboard.json()).data.map((/** @type {{id:string}} */ domain) => domain.id),
		).toEqual([domainA]);
		expect(inaccessible.status).toBe(404);
	});
	it("charges management once per call and leaves sending on its own counter", async () => {
		testEnv.KEY_RATE_LIMIT = "1";
		const headers = { Authorization: `Bearer ${fullToken}` };
		expect((await full.emails.send(message)).error).toBeNull();
		expect((await request("/domains", "GET", undefined, headers)).status).toBe(200);
		const limited = await request("/domains", "GET", undefined, headers);
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("60");
		expect(limited.headers.get("X-Frame-Options")).toBe("DENY");
	});
	it("retains SDK slash normalization without relaxing dashboard paths", async () => {
		const headers = { Authorization: `Bearer ${fullToken}` };
		expect((await request("/domains///", "GET", undefined, headers)).status).toBe(200);
		const batch = await request("/emails//batch/", "POST", [message], headers);
		expect(batch.status).toBe(200);
		expect((await batch.json()).data).toHaveLength(1);
		const dashboardHeaders = await dashboardSession();
		expect(
			(await request(`/api/orgs/${orgA}/domains/`, "GET", undefined, dashboardHeaders)).status,
		).toBe(404);
	});
	it("retains bounded JSON transport validation before sending", async () => {
		const headers = { Authorization: `Bearer ${fullToken}`, "Content-Type": "text/plain" };
		expect((await request("/emails", "POST", message, headers)).status).toBe(415);
		const malformed = await worker.fetch(
			new Request(`${localOrigin}/emails`, {
				method: "POST",
				headers: { Authorization: `Bearer ${fullToken}`, "Content-Type": "application/json" },
				body: "{invalid",
			}),
			testEnv,
		);
		expect(malformed.status).toBe(400);
		expect(await malformed.json()).toMatchObject({
			name: "validation_error",
			message: "Invalid JSON",
		});
		expect(provider).not.toHaveBeenCalled();
	});
	it("does not turn SDK HEAD requests into authorized GET operations", async () => {
		const response = await request("/emails", "HEAD", undefined, {
			Authorization: `Bearer ${fullToken}`,
		});
		expect(response.status).toBe(501);
		expect(await response.text()).toBe("");
	});
});

describe("official Resend SDK contract", () => {
	it("sends, retrieves and lists actual SDK payloads, retaining bodies but not attachment bytes", async () => {
		const result = await full.emails.send(
			Object.assign({}, message, {
				replyTo: "help@example.com",
				cc: ["cc@example.net"],
				attachments: [{ filename: "hello.txt", content: Buffer.from("hello") }],
			}),
		);
		expect(result.error).toBeNull();
		expect(result.data?.id).toMatch(/^[a-f0-9-]{36}$/);
		const emailId = result.data?.id ?? "";
		const received = await full.emails.get(emailId);
		expect(received.data).toMatchObject({
			html: message.html,
			text: message.text,
			message_id: "provider-id",
			last_event: "sent",
			reply_to: ["help@example.com"],
		});
		const stored = await env.DB.prepare("SELECT content FROM email_body_chunks").all();
		expect(stored.results).toHaveLength(1);
		expect(stored.results[0].content).toBe(
			JSON.stringify({ html: message.html, text: message.text }),
		);
		const listed = await full.emails.list();
		expect(listed.data?.data).toHaveLength(1);
		expect(listed.data?.data[0]).not.toHaveProperty("html");
		expect(provider.mock.calls[0][0]).toMatchObject({
			replyTo: { email: "help@example.com" },
			attachments: [{ content: "aGVsbG8=" }],
		});
	});
	it("round-trips bodies near the 5 MiB message limit without oversized Turso rows", async () => {
		const bodyLength = MAX_MESSAGE - 4096;
		const html = "x".repeat(bodyLength);
		const sent = await full.emails.send(Object.assign({}, message, { html }));
		expect(sent.error).toBeNull();
		const emailId = sent.data?.id ?? "";
		const received = await full.emails.get(emailId);
		expect(received.error).toBeNull();
		expect(received.data?.html).toBe(html);
		const stored = await env.DB.prepare(
			"SELECT COUNT(*) AS count,MAX(length(CAST(content AS BLOB))) AS largest FROM email_body_chunks",
		).first();
		expect(stored?.count).toBeGreaterThan(1);
		expect(stored?.largest).toBeLessThan(2_000_000);
	});
	it("preserves Unicode at chunk boundaries and missing HTML/text variants", async () => {
		const prefixLength = 256 * 1024 - 10;
		const prefix = "文".repeat(prefixLength);
		const html = `${prefix}🚀\u0000"\\${"文".repeat(500_000)}`;
		const sent = await full.emails.send(Object.assign({}, message, { html, text: undefined }));
		expect(sent.error).toBeNull();
		const emailId = sent.data?.id ?? "";
		const received = await full.emails.get(emailId);
		expect(received.error).toBeNull();
		expect(received.data).toMatchObject({ html, text: null });
		const textOnly = await full.emails.send(Object.assign({}, message, { html: undefined }));
		const textOnlyId = textOnly.data?.id ?? "";
		expect((await full.emails.get(textOnlyId)).data).toMatchObject({
			html: null,
			text: message.text,
		});
	});
	it("reports unavailable history instead of returning partial body content", async () => {
		const html = "x".repeat(800_000);
		const sent = await full.emails.send(Object.assign({}, message, { html }));
		const emailId = sent.data?.id ?? "";
		await env.DB.prepare("DELETE FROM email_body_chunks WHERE email_id=? AND position=1")
			.bind(emailId)
			.run();
		expect((await full.emails.get(emailId)).error?.statusCode).toBe(503);
		expect((await other.emails.get(emailId)).error?.statusCode).toBe(404);
	});
	it("isolates email history, domains and API keys between organizations with the same domain", async () => {
		const sent = await full.emails.send(message);
		const emailId = sent.data?.id ?? "";
		expect((await other.emails.get(emailId)).error?.statusCode).toBe(404);
		expect((await other.emails.list()).data?.data).toHaveLength(0);
		expect((await other.domains.get(domainA)).error?.statusCode).toBe(404);
		expect((await other.domains.list()).data?.data.map((domain) => domain.id)).toEqual([domainB]);
		expect((await other.emails.send(message)).error).toBeNull();
	});
	it("supports local domain and API-key lifecycle with the SDK", async () => {
		const added = await full.domains.create({ name: "mail.example.com" });
		expect(added.data).toMatchObject({
			name: "mail.example.com",
			status: "not_started",
			records: [],
		});
		const key = await full.apiKeys.create({
			name: "Scoped",
			permission: "sending_access",
			domain_id: added.data?.id,
		});
		expect(key.data?.token).toMatch(/^cdf_/);
		const listed = await full.apiKeys.list();
		expect(listed.data?.data.some((item) => item.id === key.data?.id)).toBe(true);
		const createdToken = key.data?.token ?? "missing";
		const keyId = key.data?.id ?? "";
		const domainId = added.data?.id ?? "";
		expect(JSON.stringify(listed.data)).not.toContain(createdToken);
		expect((await full.apiKeys.remove(keyId)).error).toBeNull();
		expect((await full.domains.remove(domainId)).error).toBeNull();
	});
	it("revokes domain-scoped keys when a local domain is removed, without affecting another org", async () => {
		expect((await full.domains.remove(domainA)).error).toBeNull();
		expect((await sending.emails.send(message)).error?.statusCode).toBe(401);
		expect((await other.emails.send(message)).error).toBeNull();
	});
	it("restricts sending keys and their exact sender domain", async () => {
		expect((await sending.emails.send(message)).error).toBeNull();
		expect((await sending.emails.list()).error?.statusCode).toBe(403);
		expect((await sending.apiKeys.create({ name: "Escalation" })).error?.statusCode).toBe(403);
		await full.domains.create({ name: "other.example.com" });
		expect(
			(await sending.emails.send(Object.assign({}, message, { from: "hello@other.example.com" })))
				.error?.statusCode,
		).toBe(403);
	});
	it("returns explicit errors for features and fields it cannot implement", async () => {
		expect((await full.domains.verify(domainA)).error?.statusCode).toBe(501);
		expect(
			(await full.emails.send(Object.assign({}, message, { scheduledAt: "2027-01-01T00:00:00Z" })))
				.error?.statusCode,
		).toBe(422);
		expect(
			(await full.domains.create({ name: "tracking.example.com", openTracking: true })).error
				?.statusCode,
		).toBe(422);
		expect(provider).not.toHaveBeenCalled();
	});
	it("uses stable cursor pagination with organization-local cursors", async () => {
		await full.emails.send(Object.assign({}, message, { subject: "One" }));
		await full.emails.send(Object.assign({}, message, { subject: "Two" }));
		const first = await full.emails.list({ limit: 1 });
		expect(first.data?.has_more).toBe(true);
		const second = await full.emails.list({ limit: 1, after: first.data?.data[0].id });
		expect(second.data?.data[0].subject).toBe("One");
		expect((await other.emails.list({ after: first.data?.data[0].id })).error?.statusCode).toBe(
			422,
		);
	});
});

describe("idempotency and send failure boundaries", () => {
	it("replays without a second send and rejects payload conflicts", async () => {
		const one = await full.emails.send(message, { idempotencyKey: "welcome" });
		const replay = await full.emails.send(message, { idempotencyKey: "welcome" });
		expect(replay.data).toEqual(one.data);
		expect(replay.headers?.["x-cdfsend-replay"]).toBe("true");
		expect(
			(
				await full.emails.send(Object.assign({}, message, { subject: "Changed" }), {
					idempotencyKey: "welcome",
				})
			).error?.statusCode,
		).toBe(409);
		expect(provider).toHaveBeenCalledTimes(1);
	});
	it("blocks a concurrent duplicate while the binding is still sending", async () => {
		let release = () => {};

		let arrived = () => {};

		const gate = new Promise((resolve) => {
			release = () => resolve({ messageId: "provider-id" });
		});
		const started = new Promise((resolve) => {
			arrived = () => resolve(undefined);
		});
		provider.mockImplementation(async () => {
			arrived();
			return /** @type {Promise<{messageId:string}>} */ (gate);
		});
		const first = full.emails.send(message, { idempotencyKey: "concurrent" });
		await started;
		const duplicate = await full.emails.send(message, { idempotencyKey: "concurrent" });
		expect(duplicate.error?.statusCode).toBe(409);
		release();
		expect((await first).error).toBeNull();
		expect(provider).toHaveBeenCalledTimes(1);
	});
	it("returns provider failure immediately and replays it without resending", async () => {
		provider.mockRejectedValue(
			Object.assign(new Error("private provider details"), { code: "E_SENDER_NOT_VERIFIED" }),
		);
		const result = await sending.emails.send(message, { idempotencyKey: "bad-domain" });
		expect(result.error?.statusCode).toBe(403);
		expect(result.error?.message).not.toContain("private");
		await sending.emails.send(message, { idempotencyKey: "bad-domain" });
		expect(provider).toHaveBeenCalledTimes(1);
		expect(await env.DB.prepare("SELECT status FROM emails").first("status")).toBe("failed");
	});
	it("records ambiguous binding errors as uncertain and never retries automatically", async () => {
		provider.mockRejectedValue(new Error("Disconnected"));
		expect(
			(await full.emails.send(message, { idempotencyKey: "uncertain" })).error?.statusCode,
		).toBe(502);
		await full.emails.send(message, { idempotencyKey: "uncertain" });
		expect(await env.DB.prepare("SELECT status FROM emails").first("status")).toBe("uncertain");
		expect(provider).toHaveBeenCalledTimes(1);
	});
	it("strictly validates a whole batch before any binding call", async () => {
		const result = await full.batch.send([message, Object.assign({}, message, { from: "bad" })]);
		expect(result.error?.statusCode).toBe(422);
		expect(provider).not.toHaveBeenCalled();
	});
	it("supports permissive batch validation and tracks partial provider failures", async () => {
		const permissive = await full.batch.send(
			[message, Object.assign({}, message, { from: "bad" })],
			{ batchValidation: "permissive" },
		);
		expect(permissive.data?.data).toHaveLength(1);
		expect(permissive.data?.errors).toHaveLength(1);
		provider.mockRejectedValueOnce(
			Object.assign(new Error("Limited"), { code: "E_RATE_LIMIT_EXCEEDED" }),
		);
		const partial = await full.batch.send([message, message], { idempotencyKey: "partial" });
		expect(partial.error?.statusCode).toBe(429);
		const calls = provider.mock.calls.length;
		await full.batch.send([message, message], { idempotencyKey: "partial" });
		expect(provider).toHaveBeenCalledTimes(calls);
		expect(
			(await env.DB.prepare("SELECT status FROM emails").all()).results
				.map((row) => row.status)
				.sort(),
		).toEqual(["failed", "sent", "sent"]);
	});
	it("bounds batch sending to four concurrent binding calls and preserves result order", async () => {
		let active = 0;
		let peak = 0;
		provider.mockImplementation(async (builder) => {
			active++;
			peak = Math.max(peak, active);
			await Promise.resolve();
			active--;
			return { messageId: `provider-${builder.subject}` };
		});
		const messages = Array.from({ length: 9 }, (_, index) =>
			Object.assign({}, message, { subject: `Batch ${index}` }),
		);
		const result = await full.batch.send(messages);
		expect(result.error).toBeNull();
		expect(peak).toBe(4);
		expect(provider).toHaveBeenCalledTimes(9);
		const sent = result.data?.data ?? [];
		const received = await Promise.all(sent.map((email) => full.emails.get(email.id)));
		expect(received.map((email) => email.data?.subject)).toEqual(
			messages.map((email) => email.subject),
		);
		expect(received.map((email) => email.data?.message_id)).toEqual(
			messages.map((email) => `provider-${email.subject}`),
		);
	});
	it("enforces configured key rates before additional sends", async () => {
		testEnv.KEY_RATE_LIMIT = "1";
		expect((await sending.emails.send(message)).error).toBeNull();
		expect((await sending.emails.send(message)).error?.statusCode).toBe(429);
		expect(provider).toHaveBeenCalledTimes(1);
	});
});

describe("retention and administrative boundaries", () => {
	it("rejects expired invitations and passkey ceremonies", async () => {
		const token = randomToken();
		const expiredAt = Date.now() - 1;
		await env.DB.prepare(
			"INSERT INTO invitations(id,token_hash,handle,org_id,role,purpose,expires_at,created_at) VALUES(?,?,?,?,'member','invite',?,?)",
		)
			.bind(crypto.randomUUID(), await hash(token), "invitee", orgA, expiredAt, Date.now())
			.run();
		const headers = { Origin: localOrigin };
		expect(
			(await request("/api/auth/register/options", "POST", { purpose: "invite", token }, headers))
				.status,
		).toBe(404);
		const ceremony = crypto.randomUUID();
		await env.DB.prepare(
			"INSERT INTO challenges(id,challenge,purpose,user_id,origin,expires_at) VALUES(?,?,'authenticate',?,?,?)",
		)
			.bind(ceremony, randomToken(), owner, localOrigin, expiredAt)
			.run();
		expect(
			(
				await request(
					"/api/auth/login/verify",
					"POST",
					{ ceremonyId: ceremony, credential: {} },
					headers,
				)
			).status,
		).toBe(403);
	});
	it("does not send after an authorization-dependent persistence conflict", async () => {
		// Advance the authorization snapshot immediately before the atomic history commit.
		const originalBatch = testEnv.DB.batch.bind(testEnv.DB);
		const batch = vi.spyOn(testEnv.DB, "batch").mockImplementation(async (statements) => {
			await env.DB.prepare("UPDATE revision SET value=value+1 WHERE id=1").run();
			return originalBatch(statements);
		});

		try {
			expect((await full.emails.send(message)).error?.statusCode).toBe(409);
			expect(provider).not.toHaveBeenCalled();
			expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM emails").first("count")).toBe(0);
			expect(
				await env.DB.prepare("SELECT COUNT(*) AS count FROM email_body_chunks").first("count"),
			).toBe(0);
		} finally {
			batch.mockRestore();
		}
	});
	it("rolls back every batch email and body if a chunk write fails, before sending", async () => {
		await env.DB.prepare(
			"CREATE TRIGGER reject_chunk BEFORE INSERT ON email_body_chunks WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'Synthetic chunk failure'); END",
		).run();
		const html = "x".repeat(800_000);
		const result = await full.batch.send([message, Object.assign({}, message, { html })]);
		expect(result.error?.statusCode).toBe(500);
		expect(provider).not.toHaveBeenCalled();
		expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM emails").first("count")).toBe(0);
		expect(
			await env.DB.prepare("SELECT COUNT(*) AS count FROM email_body_chunks").first("count"),
		).toBe(0);
	});
	it("never resends a provider-accepted message whose history update fails", async () => {
		const originalPrepare = testEnv.DB.prepare.bind(testEnv.DB);
		const prepare = vi.spyOn(testEnv.DB, "prepare").mockImplementation((sql) => {
			if (sql.startsWith("UPDATE emails SET status='sent'")) {
				throw new Error("Database unavailable");
			}

			return originalPrepare(sql);
		});

		try {
			expect(
				(await full.emails.send(message, { idempotencyKey: "persist-failed" })).error?.statusCode,
			).toBe(502);
			await full.emails.send(message, { idempotencyKey: "persist-failed" });
			expect(provider).toHaveBeenCalledTimes(1);
			expect(await env.DB.prepare("SELECT status FROM emails").first("status")).toBe("processing");
		} finally {
			prepare.mockRestore();
		}
	});
	it("expires Turso metadata and body chunks, not just browser visibility", async () => {
		const result = await full.emails.send(message);
		const expiredAt = Date.now() - 1;
		const emailId = result.data?.id ?? "";
		await env.DB.prepare("UPDATE emails SET expires_at=?").bind(expiredAt).run();
		expect((await full.emails.get(emailId)).error?.statusCode).toBe(404);
		await cleanup(testEnv);
		expect(await env.DB.prepare("SELECT COUNT(*) FROM emails").first("COUNT(*)")).toBe(0);
		expect(
			await env.DB.prepare("SELECT COUNT(*) AS count FROM email_body_chunks").first("count"),
		).toBe(0);
	});
	it("keeps cleanup retryable and leaves unexpired bodies untouched", async () => {
		const sent = await full.emails.send(message);
		const active = await other.emails.send(message);
		const emailId = sent.data?.id ?? "";
		const expiredAt = Date.now() - 1;
		await env.DB.prepare("UPDATE emails SET expires_at=? WHERE id=?")
			.bind(expiredAt, emailId)
			.run();
		await env.DB.prepare(
			"CREATE TRIGGER reject_cleanup BEFORE DELETE ON email_body_chunks BEGIN SELECT RAISE(ABORT,'Synthetic cleanup failure'); END",
		).run();
		await expect(cleanup(testEnv)).rejects.toThrow();
		expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM emails").first("count")).toBe(2);
		expect(
			await env.DB.prepare("SELECT COUNT(*) AS count FROM email_body_chunks").first("count"),
		).toBe(2);
		await env.DB.prepare("DROP TRIGGER reject_cleanup").run();
		await cleanup(testEnv);
		expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM emails").first("count")).toBe(1);
		expect(
			await env.DB.prepare("SELECT COUNT(*) AS count FROM email_body_chunks").first("count"),
		).toBe(1);
		const activeId = active.data?.id ?? "";
		expect((await other.emails.get(activeId)).data?.html).toBe(message.html);
	});
	it("preserves the last owner and rejects stale authorization transactions", async () => {
		const actor = /** @type {import("../../worker/types.js").Actor} */ ({
			orgId: orgA,
			userId: owner,
			role: "owner",
			credentialId: owner,
			domainId: null,
			permission: "full_access",
			authAt: Date.now(),
			isOperator: true,
		});
		await expect(removeMember(await transaction(testEnv), actor, owner)).rejects.toMatchObject({
			statusCode: 409,
		});
		const stale = await transaction(testEnv);
		await commit(await transaction(testEnv));
		await expect(commit(stale)).rejects.toMatchObject({ statusCode: 409 });
	});
	it("lets an existing instance owner without memberships create their own organization directly", async () => {
		await env.DB.prepare("DELETE FROM memberships WHERE user_id=?").bind(owner).run();
		const token = randomToken();
		const expiresAt = Date.now() + 60_000;
		await env.DB.prepare("INSERT INTO sessions(hash,user_id,auth_at,expires_at) VALUES(?,?,?,?)")
			.bind(await hash(token), owner, Date.now(), expiresAt)
			.run();
		const headers = { Origin: localOrigin, Cookie: `__Host-cdfsend=${token}` };
		const created = await request(
			"/api/instance/organizations",
			"POST",
			{ name: "Mine", handle: "owner" },
			headers,
		);
		expect(created.status).toBe(200);
		const result = await created.json();
		expect(result.invitation).toBeNull();
		const current = await (await request("/api/me", "GET", undefined, headers)).json();
		expect(current.organizations).toEqual([
			expect.objectContaining({ id: result.id, name: "Mine", role: "owner" }),
		]);
		const domain = await request(
			`/api/orgs/${result.id}/domains`,
			"POST",
			{ name: "owned.example" },
			headers,
		);
		expect(domain.status).toBe(200);
	});
	it("still requires an invitation when creating an organization for another account", async () => {
		const token = randomToken();
		const expiresAt = Date.now() + 60_000;
		await env.DB.prepare("INSERT INTO sessions(hash,user_id,auth_at,expires_at) VALUES(?,?,?,?)")
			.bind(await hash(token), owner, Date.now(), expiresAt)
			.run();
		const headers = { Origin: localOrigin, Cookie: `__Host-cdfsend=${token}` };
		const created = await request(
			"/api/instance/organizations",
			"POST",
			{ name: "Invited", handle: "someone-else" },
			headers,
		);
		expect(created.status).toBe(200);
		const result = await created.json();
		expect(result.invitation.url).toContain("#invite=");
		expect(
			await env.DB.prepare("SELECT COUNT(*) AS count FROM memberships WHERE org_id=?")
				.bind(result.id)
				.first("count"),
		).toBe(0);
		const access = await request(`/api/orgs/${result.id}/domains`, "GET", undefined, headers);
		expect(access.status).toBe(404);
	});
	it("rejects cross-origin dashboard mutations", async () => {
		const result = await request(
			"/api/auth/register/options",
			"POST",
			{},
			{ Origin: "https://attacker.test" },
		);
		expect(result.status).toBe(403);
	});
	it("derives options from allowed browser origins and prevents ceremony origin switching", async () => {
		const secondOrigin = "http://localhost:5174";
		const options = await request(
			"/api/auth/register/options",
			"POST",
			{ purpose: "bootstrap", handle: "new-owner" },
			{ Origin: secondOrigin },
			secondOrigin,
		);
		expect(options.status).toBe(200);
		const body = await options.json();
		expect(body.options.rp.id).toBe("localhost");
		expect(
			await env.DB.prepare("SELECT origin FROM challenges WHERE id=?")
				.bind(body.ceremonyId)
				.first("origin"),
		).toBe(secondOrigin);
		const switched = await request(
			"/api/auth/register/verify",
			"POST",
			{ ceremonyId: body.ceremonyId, credential: {} },
			{ Origin: localOrigin },
		);
		expect(switched.status).toBe(403);
		expect((await switched.json()).message).toBe("Passkey ceremony origin changed");
		expect(
			await env.DB.prepare("SELECT id FROM challenges WHERE id=?").bind(body.ceremonyId).first(),
		).toBeNull();
		const login = await request(
			"/api/auth/login/options",
			"POST",
			{ handle: "owner" },
			{ Origin: localOrigin },
		);
		expect(login.status).toBe(200);
		const loginBody = await login.json();
		expect(loginBody.options.rpId).toBe("localhost");
		const changedLogin = await request(
			"/api/auth/login/verify",
			"POST",
			{ ceremonyId: loginBody.ceremonyId, credential: {} },
			{ Origin: secondOrigin },
			secondOrigin,
		);
		expect(changedLogin.status).toBe(403);
		expect((await changedLogin.json()).message).toBe("Passkey ceremony origin changed");
	});
	it("allows secret-free first-run registration without reserving ownership and burns invalid ceremonies", async () => {
		const headers = { Origin: localOrigin };
		expect(await (await request("/api/auth/status")).json()).toEqual({ bootstrapped: false });
		const options = await request(
			"/api/auth/register/options",
			"POST",
			{
				purpose: "bootstrap",
				handle: "new-owner",
			},
			headers,
		);
		expect(options.status).toBe(200);
		expect(
			(
				await request(
					"/api/auth/register/options",
					"POST",
					{ purpose: "bootstrap", handle: "another-owner" },
					headers,
				)
			).status,
		).toBe(200);
		const body = await options.json();
		const invalid = { ceremonyId: body.ceremonyId, credential: {} };
		expect((await request("/api/auth/register/verify", "POST", invalid, headers)).status).toBe(403);
		const replay = await request("/api/auth/register/verify", "POST", invalid, headers);
		expect(replay.status).toBe(403);
		expect((await replay.json()).message).toContain("already used");
		expect(
			await env.DB.prepare("SELECT value FROM settings WHERE key='bootstrapped'").first(),
		).toBeNull();
	});
	it("keeps first-run registration closed after setup is complete", async () => {
		await env.DB.prepare("INSERT INTO settings(key,value) VALUES('bootstrapped','1')").run();
		expect(await (await request("/api/auth/status")).json()).toEqual({ bootstrapped: true });
		const response = await request(
			"/api/auth/register/options",
			"POST",
			{ purpose: "bootstrap", handle: "another-owner" },
			{ Origin: localOrigin },
		);
		expect(response.status).toBe(403);
		expect(
			await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE is_operator=1").first(
				"count",
			),
		).toBe(1);
	});
});
