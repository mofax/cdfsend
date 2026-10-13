// @ts-check
import { describe, it, expect, vi } from "vitest";
import { normalizeEmail, parseAddress } from "../../worker/services/email/normalize.js";
import { canonicalJson } from "../../worker/security/crypto.js";
import { MAX_MESSAGE } from "../../shared/schema.js";
import { readJson } from "../../worker/lib/http.js";

const message = {
	from: "Acme <hello@EXAMPLE.com>",
	to: "Ada <ada@example.net>",
	subject: "Welcome",
	html: "<h1>Hello</h1>",
};

describe("email translation", () => {
	it("accepts empty optional CC/BCC lists", () => {
		expect(normalizeEmail(Object.assign({}, message, { cc: [], bcc: [] })).builder.cc).toEqual([]);
	});
	it("normalizes names/domains and maps reply-to, CC/BCC and inline attachments", () => {
		const result = normalizeEmail(
			Object.assign({}, message, {
				cc: ["cc@example.net"],
				bcc: "bcc@example.net",
				reply_to: ["help@example.com"],
				attachments: [{ filename: "logo.png", content: "aGVsbG8=", content_id: "logo" }],
			}),
		);
		expect(result.domain).toBe("example.com");
		expect(result.builder.from).toEqual({ name: "Acme", email: "hello@example.com" });
		expect(result.builder.replyTo).toEqual({ name: "", email: "help@example.com" });
		expect(result.builder.attachments?.[0]).toMatchObject({
			type: "image/png",
			disposition: "inline",
			contentId: "logo",
		});
		expect(result.metadata.attachments[0]).not.toHaveProperty("content");
	});
	it("accepts SDK Buffer JSON and infers a conservative MIME type", () => {
		const result = normalizeEmail(
			Object.assign({}, message, {
				attachments: [{ filename: "data.bin", content: { type: "Buffer", data: [0, 1, 255] } }],
			}),
		);
		expect(result.builder.attachments?.[0]).toMatchObject({
			content: "AAH/",
			type: "application/octet-stream",
		});
	});
	it.each([
		{ reply_to: ["a@example.net", "b@example.net"] },
		{ scheduled_at: "2027-01-01" },
		{ template: { id: "welcome" } },
		{ headers: { "X-Test": "injected\r\nBcc: thief@example.net" } },
		{ headers: { "Message-ID": "custom" } },
		{ attachments: [{ filename: "report.pdf", path: "https://example.com/file" }] },
		{ attachments: [{ filename: "file", content: "not base64!" }] },
	])("rejects unsupported options and malformed message fields: %j", (options) => {
		expect(() => normalizeEmail(Object.assign({}, message, options))).toThrow();
	});
	it("counts recipients across TO, CC and BCC", () => {
		const recipients = Array.from({ length: 50 }, (_, index) => `user${index}@example.net`);
		expect(() =>
			normalizeEmail(Object.assign({}, message, { to: recipients, cc: "extra@example.net" })),
		).toThrow("50 combined");
	});
	it("bounds encoded message size before calling Cloudflare", () => {
		expect(() =>
			normalizeEmail(Object.assign({}, message, { html: "x".repeat(MAX_MESSAGE) })),
		).toThrow("5 MiB");
	});
	it("rejects address/header injection", () => {
		expect(() => parseAddress("Hello\r\nBcc: theft <hello@example.com>")).toThrow();
		expect(() => parseAddress("a@invalid")).toThrow();
	});
});

describe("transport bounds and fingerprints", () => {
	it("fingerprints semantically identical object order consistently", () => {
		expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
			canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
		);
		expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
	});
	it("rejects accumulated oversized streams even without Content-Length", async () => {
		const request = new Request("https://cdfsend.test/emails", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "x".repeat(100),
		});
		await expect(readJson(request, 10)).rejects.toMatchObject({ statusCode: 413 });
	});
	it("cancels multi-chunk request streams when the accumulated size exceeds the limit", async () => {
		const cancelled = vi.fn();
		const chunk = new TextEncoder().encode("123456");
		const body = new ReadableStream({
			pull(controller) {
				controller.enqueue(chunk);
			},
			cancel: cancelled,
		});
		// Node requires duplex for streamed request bodies; Workers' RequestInit omits it.
		/** @type {RequestInit & {duplex:"half"}} */
		const options = {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
			duplex: "half",
		};
		const request = new Request("https://cdfsend.test/emails", options);
		await expect(readJson(request, 10)).rejects.toMatchObject({ statusCode: 413 });
		expect(cancelled).toHaveBeenCalledOnce();
		expect(body.locked).toBe(false);
	});
	it("returns a useful error for invalid JSON", async () => {
		const request = new Request("https://cdfsend.test/emails", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{",
		});
		await expect(readJson(request)).rejects.toMatchObject({ statusCode: 400 });
	});
});
