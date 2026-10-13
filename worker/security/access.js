// @ts-check
import { fail } from "../lib/http.js";
import { hash } from "./crypto.js";
import { statement } from "../storage/db.js";

export const SESSION_COOKIE = "__Host-cdfsend";

/** @param {Request} request */
export function sessionToken(request) {
	const cookies = request.headers.get("Cookie") ?? "";
	const match = /(?:^|;\s*)__Host-cdfsend=([A-Za-z0-9_-]{43})(?:;|$)/.exec(cookies);
	return match?.[1] ?? null;
}

/** @param {Request} request @param {import("../types.js").AppBindings} env */
export async function requireSession(request, env) {
	const token = sessionToken(request);
	if (!token) fail(401, "missing_api_key", "Sign in to continue");
	const sessionHash = await hash(token);
	const session = /** @type {import("../types.js").Session|null} */ (
		await statement(
			env,
			"SELECT * FROM sessions WHERE hash=? AND expires_at>?",
			sessionHash,
			Date.now(),
		).first()
	);
	if (!session) fail(401, "invalid_api_key", "Session expired; sign in again");
	const user = /** @type {import("../types.js").User|null} */ (
		await statement(env, "SELECT * FROM users WHERE id=?", session.user_id).first()
	);
	if (!user) fail(401, "invalid_api_key", "Account unavailable");
	return { user, session, sessionHash };
}

/** @param {Request} request @param {import("../types.js").AppBindings} env @param {string} orgId @returns {Promise<import("../types.js").Actor>} */
export async function sessionActor(request, env, orgId) {
	const current = await requireSession(request, env);
	const membership = /** @type {{role: "owner"|"admin"|"member"}|null} */ (
		await statement(
			env,
			"SELECT role FROM memberships WHERE org_id=? AND user_id=?",
			orgId,
			current.user.id,
		).first()
	);
	if (!membership) fail(404, "not_found", "Organization not found");
	return {
		orgId,
		userId: current.user.id,
		role: membership.role,
		credentialId: current.user.id,
		domainId: null,
		permission: "full_access",
		authAt: current.session.auth_at,
		isOperator: Boolean(current.user.is_operator),
	};
}

/** @param {Request} request @param {import("../types.js").AppBindings} env @returns {Promise<import("../types.js").Actor>} */
export async function keyActor(request, env) {
	const authorization = request.headers.get("Authorization") ?? "";
	const match = /^Bearer (cdf_[A-Za-z0-9_-]{43})$/.exec(authorization);
	if (!match) fail(401, "missing_api_key", "A cdfsend Bearer API key is required");
	const keyHash = await hash(match[1]);
	const key = /** @type {import("../types.js").ApiKey|null} */ (
		await statement(env, "SELECT * FROM api_keys WHERE hash=?", keyHash).first()
	);
	if (!key) fail(401, "invalid_api_key", "API key invalid or revoked");
	return {
		orgId: key.org_id,
		userId: null,
		role: "admin",
		credentialId: key.id,
		domainId: key.domain_id,
		permission: key.permission,
		authAt: 0,
		isOperator: false,
	};
}

/** @param {import("../types.js").Actor} actor */
export function requireManagement(actor) {
	if (actor.role === "member" || actor.permission !== "full_access") {
		fail(403, "restricted_api_key", "Management access required");
	}
}

/** @param {{auth_at: number}|import("../types.js").Actor} actor */
export function requireRecent(actor) {
	const hasSessionTimestamp = "auth_at" in actor;
	const authenticatedAt = hasSessionTimestamp ? actor.auth_at : actor.authAt;
	const authenticationDeadline = Date.now() - 5 * 60_000;

	if (authenticatedAt < authenticationDeadline) {
		fail(403, "reauthentication_required", "Verify your passkey again to continue");
	}
}

/** @param {import("../types.js").AppBindings} env @param {string} key @param {number} limit @param {number} [amount] */
export async function rateLimit(env, key, limit, amount = 1) {
	const elapsedMinutes = Date.now() / 60_000;
	const window = Math.floor(elapsedMinutes);
	const counterKey = `${key}:${window}`;
	const expires = (window + 2) * 60_000;
	const count = await statement(
		env,
		"INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+excluded.count RETURNING count",
		counterKey,
		amount,
		expires,
	).first("count");

	if (Number(count) > limit) {
		fail(429, "rate_limit_exceeded", "Rate limit exceeded; retry after one minute");
	}
}

/** @param {string} value @param {number} fallback */
export function configuredLimit(value, fallback) {
	const limit = Number(value);
	const validLimit = Number.isSafeInteger(limit) && limit > 0;
	return validLimit ? limit : fallback;
}

/** @param {Request} request @param {import("../types.js").AppBindings} env */
export async function authRateLimit(request, env) {
	const clientAddress = request.headers.get("CF-Connecting-IP") ?? "local";
	const clientHash = await hash(clientAddress);
	await rateLimit(env, `auth:${clientHash}`, configuredLimit(env.AUTH_RATE_LIMIT, 30));
}

/** @param {string} token */
export function sessionCookie(token) {
	return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`;
}
