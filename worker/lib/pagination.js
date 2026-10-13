// @ts-check
import { fail, parse } from "./http.js";
import { id, label } from "../../shared/schema.js";
import { statement } from "../storage/db.js";

const tables = {
	domains: "id,name,org_id,created_at",
	api_keys: "id,name,prefix,permission,domain_id,created_at",
	emails: "*",
};

/** @param {URL} url */
function paginationParameters(url) {
	const requestedLimit = url.searchParams.get("limit") ?? 20;
	const limit = Number(requestedLimit);

	if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
		fail(422, "validation_error", "limit must be 1–100");
	}

	const after = url.searchParams.get("after");
	const before = url.searchParams.get("before");
	if (after && before) fail(422, "validation_error", "Use after or before, not both");
	const direction = before ? "ASC" : "DESC";
	return {
		limit,
		cursor: after ?? before,
		before: Boolean(before),
		direction,
	};
}

/** @param {string} orgId @param {keyof typeof tables} table @param {URL} url */
function basePredicate(orgId, table, url) {
	const values = /** @type {(string|number|null)[]} */ ([orgId]);
	let predicate = "org_id=?";

	if (table === "emails") {
		predicate += " AND expires_at>?";
		values.push(Date.now());
		const filter = url.searchParams.get("status");

		if (filter) {
			parse(label, filter);
			predicate += " AND status=?";
			values.push(filter);
		}
	}

	return { values, predicate };
}

/** @param {import("../types.js").AppBindings} env @param {string} orgId @param {keyof typeof tables} table @param {ReturnType<typeof paginationParameters>} options */
async function cursorPredicate(env, orgId, table, options) {
	if (!options.cursor) return { sql: "", values: /** @type {(string|number|null)[]} */ ([]) };
	const cursorId = parse(id, options.cursor);
	const row = /** @type {{created_at:number}|null} */ (
		await statement(
			env,
			`SELECT created_at FROM ${table} WHERE org_id=? AND id=?`,
			orgId,
			cursorId,
		).first()
	);
	if (!row) fail(422, "validation_error", "Invalid cursor");
	const operator = options.before ? ">" : "<";
	return { sql: ` AND (created_at,id) ${operator} (?,?)`, values: [row.created_at, cursorId] };
}

/** @param {import("../types.js").AppBindings} env @param {string} orgId @param {keyof typeof tables} table @param {URL} url */
export async function listPage(env, orgId, table, url) {
	const options = paginationParameters(url);
	const base = basePredicate(orgId, table, url);
	const cursor = await cursorPredicate(env, orgId, table, options);
	const predicate = base.predicate + cursor.sql;
	const fetchLimit = options.limit + 1;
	const values = base.values.concat(cursor.values, fetchLimit);
	const direction = options.direction;
	const result = await statement(
		env,
		`SELECT ${tables[table]} FROM ${table} WHERE ${predicate} ORDER BY created_at ${direction},id ${direction} LIMIT ?`,
		...values,
	).all();
	const rows = result.results.slice(0, options.limit);
	if (options.before) rows.reverse();
	return { object: "list", has_more: result.results.length > options.limit, data: rows };
}
