// @ts-check
import { fail } from "../lib/http.js";

/** @param {import("../types.js").AppBindings} env @param {string} sql @param {...(string|number|null)} values */
export function statement(env, sql, ...values) {
	return env.DB.prepare(sql).bind(...values);
}

/** @param {import("../types.js").AppBindings} env */
export async function transaction(env) {
	const row = await env.DB.prepare("SELECT value FROM revision WHERE id=1").first("value");
	if (typeof row !== "number") fail(503, "application_error", "Apply database migrations first");
	return {
		env,
		version: row,
		writes: /** @type {import("./turso.js").PreparedStatement[]} */ ([]),
	};
}

/** @param {import("../types.js").Transaction} tx @param {string} sql @param {...(string|number|null)} values */
export function write(tx, sql, ...values) {
	tx.writes.push(statement(tx.env, sql, ...values));
}

/** @param {import("../types.js").Transaction} tx */
export async function commit(tx) {
	try {
		await tx.env.DB.batch([
			statement(
				tx.env,
				"UPDATE revision SET value=CASE WHEN value=? THEN value+1 ELSE -1 END WHERE id=1",
				tx.version,
			),
			...tx.writes,
		]);
	} catch (error) {
		if (error instanceof Error && error.message.includes("CHECK constraint")) {
			fail(409, "conflict", "Concurrent change; refresh and try again");
		}

		throw error;
	}
}

/** @param {import("../types.js").Transaction} tx @param {import("../types.js").Actor} actor @param {string} action @param {string} target */
export function audit(tx, actor, action, target) {
	write(
		tx,
		"INSERT INTO audit(org_id,actor_id,action,target_id,created_at) VALUES(?,?,?,?,?)",
		actor.orgId,
		actor.credentialId,
		action,
		target,
		Date.now(),
	);
}
