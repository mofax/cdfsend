// @ts-check
import { MAX_MANAGEMENT_REQUEST } from "../../shared/schema.js";
import { json, readJson } from "../lib/http.js";
import { listPage } from "../lib/pagination.js";
import { commit } from "../storage/db.js";
import { addKey, removeKey } from "../services/keys.js";

/** @param {import("../types.js").AppContext} c */
export async function listKeys(c) {
	return json(await listPage(c.env, c.get("actor").orgId, "api_keys", new URL(c.req.url)));
}

/** @param {import("../types.js").AppContext} c */
export async function createKey(c) {
	const tx = c.get("transaction");
	const result = await addKey(
		tx,
		c.get("actor"),
		await readJson(c.req.raw, MAX_MANAGEMENT_REQUEST),
	);
	await commit(tx);
	return json(result);
}

/** @param {import("../types.js").AppContext<"/:id">} c */
export async function deleteKey(c) {
	const tx = c.get("transaction");
	const result = await removeKey(tx, c.get("actor"), c.req.param("id"));
	await commit(tx);
	return json(result);
}
