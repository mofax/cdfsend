// @ts-check
import { fail } from "../../lib/http.js";
import { statement } from "../../storage/db.js";
import { requireManagement } from "../../security/access.js";
import { readBody } from "../../storage/bodies.js";

/** @param {import("../../types.js").EmailRow} row */
export function emailResponse(row) {
	const metadata = JSON.parse(row.metadata);
	const processingDeadline = Date.now() - 5 * 60_000;
	const staleProcessing = row.status === "processing" && row.created_at < processingDeadline;
	const status = staleProcessing ? "uncertain" : row.status;
	const completed = status === "sent" || status === "failed";
	const lastEvent = completed ? status : "queued";
	const error = row.error ? JSON.parse(row.error) : null;
	return Object.assign({}, metadata, {
		id: row.id,
		object: "email",
		created_at: new Date(row.created_at).toISOString(),
		message_id: row.message_id ?? "",
		last_event: lastEvent,
		cdfsend: { status, error },
	});
}

/** @param {import("../../types.js").AppBindings} env @param {import("../../types.js").Actor} actor @param {string} id */
export async function getEmail(env, actor, id) {
	requireManagementForRead(actor);
	const row = /** @type {import("../../types.js").EmailRow|null} */ (
		await statement(
			env,
			"SELECT * FROM emails WHERE org_id=? AND id=? AND expires_at>?",
			actor.orgId,
			id,
			Date.now(),
		).first()
	);
	if (!row) fail(404, "not_found", "Email not found or retention expired");
	const body = await readBody(env, row.id, row.body_chunks);
	return Object.assign(emailResponse(row), body);
}

/** Members may read through a dashboard session; sending keys never may. @param {import("../../types.js").Actor} actor */
export function requireManagementForRead(actor) {
	if (!actor.userId) requireManagement(actor);
}
