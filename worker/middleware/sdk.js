// @ts-check
import { fail } from "../lib/http.js";
import { keyActor, requireManagement, configuredLimit, rateLimit } from "../security/access.js";

/** @type {import("../types.js").AppMiddleware} */
export async function apiKey(c, next) {
	c.set("actor", await keyActor(c.req.raw, c.env));
	await next();
}

/** @type {import("../types.js").AppMiddleware} */
export async function management(c, next) {
	const actor = c.get("actor");
	requireManagement(actor);
	await rateLimit(c.env, `api:${actor.credentialId}`, configuredLimit(c.env.KEY_RATE_LIMIT, 60));

	// Hono dispatches HEAD through GET routes; keep SDK operations GET-only.
	if (c.req.method === "HEAD") unsupportedFeature();
	await next();
}

export function unsupportedFeature() {
	return fail(501, "validation_error", "This Resend feature is not supported by cdfsend v1");
}
