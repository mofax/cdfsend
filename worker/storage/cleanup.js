// @ts-check
import { statement } from "./db.js";
import { log, logError } from "../lib/log.js";

/** @param {import("../types.js").AppBindings} env */
export async function cleanup(env) {
	try {
		await runCleanup(env);
	} catch (error) {
		logError("retention_cleanup_failed", error);
		throw error;
	}
}

/** @param {import("../types.js").AppBindings} env */
async function runCleanup(env) {
	const now = Date.now();
	const processingDeadline = now - 5 * 60_000;
	const auditDeadline = now - 30 * 86400_000;

	const results = await env.DB.batch([
		// Foreign-key cascading removes body chunks in the same transaction.
		statement(
			env,
			"DELETE FROM emails WHERE id IN (SELECT id FROM emails WHERE expires_at<=? ORDER BY expires_at LIMIT 500)",
			now,
		),
		statement(
			env,
			"UPDATE emails SET status='uncertain' WHERE status='processing' AND created_at<?",
			processingDeadline,
		),
		statement(env, "DELETE FROM sessions WHERE expires_at<=?", now),
		statement(env, "DELETE FROM challenges WHERE expires_at<=?", now),
		statement(env, "DELETE FROM invitations WHERE expires_at<=?", now),
		statement(env, "DELETE FROM idempotency WHERE expires_at<=?", now),
		statement(env, "DELETE FROM rate_limits WHERE expires_at<=?", now),
		statement(env, "DELETE FROM audit WHERE created_at<?", auditDeadline),
	]);
	const uncertain = results[1].meta.changes;
	log("info", "retention_cleanup", { deleted: results[0].meta.changes, uncertain });

	if (uncertain > 0) {
		log("warn", "stale_email_attempts", { uncertain });
	}
}
