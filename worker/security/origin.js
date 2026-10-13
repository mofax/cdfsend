// @ts-check
import { fail } from "../lib/http.js";

// Add exact production dashboard origins here. No wildcards or environment overrides.
const allowedOrigins = new Set([
	"http://localhost:5173",
	"http://localhost:5174",
	"https://cdfsend.boodboard.com",
]);

/** @param {Request} request */
export function requireOrigin(request) {
	const origin = request.headers.get("Origin") ?? "";
	const requestOrigin = new URL(request.url).origin;
	const crossSite = request.headers.get("Sec-Fetch-Site") === "cross-site";
	const allowed = allowedOrigins.has(origin);

	if (!allowed || origin !== requestOrigin || crossSite) {
		fail(403, "restricted_api_key", "Origin not allowed");
	}

	return { origin, rpId: new URL(origin).hostname };
}

/** @param {import("../types.js").Ceremony} ceremony @param {{origin: string}} site */
export function requireCeremonyOrigin(ceremony, site) {
	if (ceremony.origin !== site.origin) {
		fail(403, "validation_error", "Passkey ceremony origin changed");
	}
}
