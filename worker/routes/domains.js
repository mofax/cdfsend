// @ts-check
import { MAX_MANAGEMENT_REQUEST } from "../../shared/schema.js";
import { json, readJson } from "../lib/http.js";
import { listPage } from "../lib/pagination.js";
import { commit } from "../storage/db.js";
import { addDomain, removeDomain, getDomain, domainResponse } from "../services/domains.js";

/** @param {import("../types.js").AppContext} c */
export async function listDomains(c) {
	const page = await listPage(c.env, c.get("actor").orgId, "domains", new URL(c.req.url));
	return json(
		Object.assign(page, {
			data: page.data.map((row) =>
				domainResponse(/** @type {import("../types.js").Domain} */ (row)),
			),
		}),
	);
}

/** @param {import("../types.js").AppContext<"/:id">} c */
export async function retrieveDomain(c) {
	return json(domainResponse(await getDomain(c.env, c.get("actor"), c.req.param("id"))));
}

/** @param {import("../types.js").AppContext} c */
export async function createDomain(c) {
	const tx = c.get("transaction");
	const result = await addDomain(
		tx,
		c.get("actor"),
		await readJson(c.req.raw, MAX_MANAGEMENT_REQUEST),
	);
	await commit(tx);
	return json(result);
}

/** @param {import("../types.js").AppContext<"/:id">} c */
export async function deleteDomain(c) {
	const tx = c.get("transaction");
	const result = await removeDomain(tx, c.get("actor"), c.req.param("id"));
	await commit(tx);
	return json(result);
}
