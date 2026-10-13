// @ts-check
import { canonicalJson, hash } from "../../security/crypto.js";
import { fail, json } from "../../lib/http.js";
import { statement } from "../../storage/db.js";
import { log } from "../../lib/log.js";

/** @param {Request} request @param {import("../../types.js").AppBindings} env @param {import("../../types.js").Actor} actor @param {unknown} raw */
export async function claim(request, env, actor, raw) {
	const key = request.headers.get("Idempotency-Key");
	if (!key) return { scope: null, replay: null };

	if (key.length > 256 || /[^\x21-\x7e]/.test(key)) {
		fail(422, "validation_error", "Idempotency-Key must be 1–256 printable non-space characters");
	}

	const route = new URL(request.url).pathname;
	const scope = await hash(`${actor.orgId}:${actor.credentialId}:${route}:${key}`);
	const fingerprint = await hash(canonicalJson(raw));
	const now = Date.now();
	const expiresAt = now + 24 * 3600_000;
	const row = await statement(
		env,
		"INSERT INTO idempotency(scope,fingerprint,state,created_at,expires_at) VALUES(?,?,'processing',?,?) ON CONFLICT(scope) DO UPDATE SET fingerprint=excluded.fingerprint,state='processing',response=NULL,status_code=NULL,created_at=excluded.created_at,expires_at=excluded.expires_at WHERE idempotency.expires_at<=? RETURNING scope",
		scope,
		fingerprint,
		now,
		expiresAt,
		now,
	).first();
	if (row) return { scope, replay: null };
	const previous = /** @type {import("../../types.js").Idempotency|null} */ (
		await statement(env, "SELECT * FROM idempotency WHERE scope=?", scope).first()
	);
	if (!previous) fail(409, "conflict", "Idempotency state changed; retry");

	if (previous.fingerprint !== fingerprint) {
		fail(409, "invalid_idempotent_request", "Idempotency key used with a different payload");
	}

	if (previous.state !== "complete") {
		fail(
			409,
			"concurrent_idempotent_requests",
			"Request is processing or its outcome is uncertain; do not resend with a new key",
		);
	}

	const storedResponse = previous.response ?? "null";
	const statusCode = previous.status_code ?? 500;
	const replay = json(JSON.parse(storedResponse), statusCode, {
		"X-Cdfsend-Replay": "true",
	});
	log("info", "idempotency_replay", { org_id: actor.orgId, status_code: statusCode });
	return { scope, replay };
}

/** @param {import("../../types.js").AppBindings} env @param {string|null} scope @param {Response} response */
export async function complete(env, scope, response) {
	if (!scope) return response;
	const body = await response.clone().text();
	await statement(
		env,
		"UPDATE idempotency SET state='complete',response=?,status_code=? WHERE scope=?",
		body,
		response.status,
		scope,
	).run();
	return response;
}
