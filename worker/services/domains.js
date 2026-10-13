// @ts-check
import { createDomain } from "../../shared/schema.js";
import { fail, parse } from "../lib/http.js";
import { statement, write, audit } from "../storage/db.js";
import { requireManagement } from "../security/access.js";

/** @param {import("../types.js").Domain} row */
export function domainResponse(row) {
	return {
		object: "domain",
		id: row.id,
		name: row.name,
		created_at: new Date(row.created_at).toISOString(),
		status: "not_started",
		region: "us-east-1",
		records: [],
		open_tracking: false,
		click_tracking: false,
		capabilities: { sending: "enabled", receiving: "disabled" },
		cdfsend: { registration: "registered", readiness: "unknown", configuration: "cloudflare" },
	};
}

/** @param {import("../types.js").AppBindings} env @param {import("../types.js").Actor} actor @param {string} id */
export async function getDomain(env, actor, id) {
	const row = /** @type {import("../types.js").Domain|null} */ (
		await statement(env, "SELECT * FROM domains WHERE org_id=? AND id=?", actor.orgId, id).first()
	);
	if (!row) fail(404, "not_found", "Domain not found");
	return row;
}

/** @param {import("../types.js").Transaction} tx @param {import("../types.js").Actor} actor @param {unknown} raw */
export async function addDomain(tx, actor, raw) {
	requireManagement(actor);
	const input = parse(createDomain, raw);
	const exists = await statement(
		tx.env,
		"SELECT id FROM domains WHERE org_id=? AND name=?",
		actor.orgId,
		input.name,
	).first();
	if (exists) fail(409, "conflict", "Domain already registered in this organization");
	const row = {
		id: crypto.randomUUID(),
		org_id: actor.orgId,
		name: input.name,
		created_at: Date.now(),
	};
	write(
		tx,
		"INSERT INTO domains(id,org_id,name,created_at) VALUES(?,?,?,?)",
		row.id,
		row.org_id,
		row.name,
		row.created_at,
	);
	audit(tx, actor, "domain.add", row.id);
	return domainResponse(row);
}

/** @param {import("../types.js").Transaction} tx @param {import("../types.js").Actor} actor @param {string} id */
export async function removeDomain(tx, actor, id) {
	requireManagement(actor);
	await getDomain(tx.env, actor, id);
	write(tx, "DELETE FROM api_keys WHERE org_id=? AND domain_id=?", actor.orgId, id);
	write(tx, "DELETE FROM domains WHERE org_id=? AND id=?", actor.orgId, id);
	audit(tx, actor, "domain.remove", id);
	return { object: "domain", id, deleted: true };
}
