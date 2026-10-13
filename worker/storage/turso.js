// @ts-check
import { createClient } from "@libsql/client/web";

/** @typedef {string|number|null} SqlValue */
/** @typedef {Record<string, import("@libsql/client").Value>} Row */
/** @typedef {{results: Row[], meta: {changes: number}}} QueryResult */
/** @typedef {Pick<Env, "TURSO_DATABASE_URL"|"TURSO_AUTH_TOKEN">} DatabaseConfig */

export class Database {
	/** @param {DatabaseConfig} config */
	constructor(config) {
		this.config = config;
	}
	/** @param {string} sql */
	prepare(sql) {
		return new PreparedStatement(this, sql, []);
	}
	/** @param {PreparedStatement[]} statements */
	async batch(statements) {
		const client = this.client();

		try {
			const results = await client.batch(statements.map(toStatement), "write");
			return results.map(queryResult);
		} finally {
			client.close();
		}
	}
	client() {
		const url = this.config.TURSO_DATABASE_URL;
		const authToken = this.config.TURSO_AUTH_TOKEN;
		if (!url) throw new Error("TURSO_DATABASE_URL is required");
		const hostname = new URL(url).hostname;
		const local = hostname === "127.0.0.1" || hostname === "localhost";
		if (!local && !authToken) throw new Error("TURSO_AUTH_TOKEN is required");
		return createClient({ url, authToken, intMode: "number" });
	}
	/** @param {PreparedStatement} statement */
	async execute(statement) {
		const client = this.client();

		try {
			return queryResult(await client.execute(toStatement(statement)));
		} finally {
			client.close();
		}
	}
}

export class PreparedStatement {
	/** @param {Database} database @param {string} sql @param {SqlValue[]} args */
	constructor(database, sql, args) {
		this.database = database;
		this.sql = sql;
		this.args = args;
	}
	/** @param {...SqlValue} args */
	bind(...args) {
		return new PreparedStatement(this.database, this.sql, args);
	}
	all() {
		return this.database.execute(this);
	}
	run() {
		return this.database.execute(this);
	}
	/** @overload @returns {Promise<Row|null>} */
	/** @overload @param {string} column @returns {Promise<import("@libsql/client").Value|null>} */
	/** @param {string} [column] */
	async first(column) {
		const result = await this.all();
		const row = result.results[0];
		if (!row) return null;
		if (column !== undefined) return row[column] ?? null;
		return row;
	}
}

/** @param {PreparedStatement} statement */
function toStatement(statement) {
	return { sql: statement.sql, args: statement.args };
}

/** @param {import("@libsql/client").ResultSet} result @returns {QueryResult} */
function queryResult(result) {
	const results = result.rows.map((row) => {
		const entries = result.columns.map((column) => [column, row[column]]);
		return Object.fromEntries(entries);
	});
	return { results, meta: { changes: result.rowsAffected } };
}

/** @param {Env} env @returns {import("../types.js").AppBindings} */
export function withDatabase(env) {
	return Object.assign({}, env, { DB: new Database(env) });
}
