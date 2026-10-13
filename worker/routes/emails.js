// @ts-check
import { json, readJson } from "../lib/http.js";
import { listPage } from "../lib/pagination.js";
import { emailResponse, getEmail } from "../services/email/history.js";
import { send } from "../services/email/send.js";

/** @param {import("../types.js").AppContext} c */
export async function listEmails(c) {
	const page = await listPage(c.env, c.get("actor").orgId, "emails", new URL(c.req.url));
	return json(
		Object.assign(page, {
			data: page.data.map((row) =>
				emailResponse(/** @type {import("../types.js").EmailRow} */ (row)),
			),
		}),
	);
}

/** @param {import("../types.js").AppContext<"/:id">} c */
export async function retrieveEmail(c) {
	return json(await getEmail(c.env, c.get("actor"), c.req.param("id")));
}

/** @param {import("../types.js").AppContext} c */
export async function sendEmail(c) {
	return send(c.req.raw, c.get("transaction"), c.get("actor"), await readJson(c.req.raw));
}

/** @param {import("../types.js").AppContext} c */
export async function sendBatch(c) {
	return send(c.req.raw, c.get("transaction"), c.get("actor"), await readJson(c.req.raw), true);
}
