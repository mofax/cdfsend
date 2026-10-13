// @ts-check
import { createKey } from "../../shared/schema.js";
import { fail, parse } from "../lib/http.js";
import { hash, randomToken } from "../security/crypto.js";
import { requireManagement } from "../security/access.js";
import { statement, write, audit } from "../storage/db.js";
import { getDomain } from "./domains.js";

/** @param {import("../types.js").Transaction} tx @param {import("../types.js").Actor} actor @param {unknown} raw */
export async function addKey(tx, actor, raw) {
	requireManagement(actor);
	const input = parse(createKey, raw);
	if (input.domain_id) await getDomain(tx.env, actor, input.domain_id);
	const token = randomToken("cdf_");
	const id = crypto.randomUUID();
	const tokenHash = await hash(token);
	const domainId = input.domain_id ?? null;
	write(
		tx,
		"INSERT INTO api_keys(id,org_id,name,hash,prefix,permission,domain_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
		id,
		actor.orgId,
		input.name,
		tokenHash,
		token.slice(0, 12),
		input.permission,
		domainId,
		Date.now(),
	);
	audit(tx, actor, "key.create", id);
	return { id, token };
}

/** @param {import("../types.js").Transaction} tx @param {import("../types.js").Actor} actor @param {string} id */
export async function removeKey(tx, actor, id) {
	requireManagement(actor);
	const row = await statement(
		tx.env,
		"SELECT id FROM api_keys WHERE org_id=? AND id=?",
		actor.orgId,
		id,
	).first();
	if (!row) fail(404, "not_found", "API key not found");
	write(tx, "DELETE FROM api_keys WHERE org_id=? AND id=?", actor.orgId, id);
	audit(tx, actor, "key.remove", id);
	return { id, deleted: true };
}
