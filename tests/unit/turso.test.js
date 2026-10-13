// @ts-check
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@libsql/client/web";
import { startDatabase } from "../../scripts/local-db.js";
import { migrate } from "../../scripts/migrate.js";
import { Database } from "../../worker/storage/turso.js";

let directory = "";
/** @type {Awaited<ReturnType<typeof startDatabase>>} */
let server;
/** @type {import("@libsql/client").Client} */
let client;
/** @type {Database} */
let database;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "cdfsend-turso-test-"));
	server = await startDatabase(join(directory, "database"));
	client = createClient({ url: server.url });
	database = new Database({ TURSO_DATABASE_URL: server.url, TURSO_AUTH_TOKEN: "" });
	await migrate(client);
});

afterEach(async () => {
	client?.close();
	await server?.stop();
	if (directory) await rm(directory, { recursive: true, force: true });
});

describe("Turso storage and schema migrations", () => {
	it("initializes an empty database and skips applied migrations on rerun", async () => {
		await migrate(client);
		await client.execute("INSERT INTO organizations VALUES('preserved','Preserved',1)");
		await migrate(client);
		expect(await database.prepare("SELECT value FROM revision").first("value")).toBe(0);
		expect(await database.prepare("SELECT name FROM organizations").first("name")).toBe(
			"Preserved",
		);
		expect((await database.prepare("SELECT name FROM schema_migrations").all()).results).toEqual([
			{ name: "0001_initial.sql" },
		]);
		expect(await database.prepare("SELECT id FROM users").first()).toBeNull();
	});

	it("rolls back both schema changes and the migration record on failure", async () => {
		const migration = join(directory, "0002_failure.sql");
		await writeFile(
			migration,
			"CREATE TABLE must_rollback (id INTEGER); INSERT INTO missing_table VALUES(1);",
		);
		await expect(migrate(client, directory)).rejects.toThrow();
		expect(
			await database.prepare("SELECT name FROM sqlite_schema WHERE name='must_rollback'").first(),
		).toBeNull();
		expect(
			await database
				.prepare("SELECT name FROM schema_migrations WHERE name='0002_failure.sql'")
				.first(),
		).toBeNull();
		await writeFile(migration, "CREATE TABLE must_rollback (id INTEGER);");
		await migrate(client, directory);
		expect(
			await database
				.prepare("SELECT name FROM schema_migrations WHERE name='0002_failure.sql'")
				.first("name"),
		).toBe("0002_failure.sql");
	});

	it("preserves bound values, plain row shapes, RETURNING, and affected-row counts", async () => {
		const result = await database
			.prepare("INSERT INTO settings VALUES(?,?) RETURNING key,value")
			.bind("quote'", "🙂")
			.run();
		expect(result).toEqual({ results: [{ key: "quote'", value: "🙂" }], meta: { changes: 1 } });
		expect(
			await database
				.prepare("SELECT value FROM settings WHERE key=?")
				.bind("quote'")
				.first("value"),
		).toBe("🙂");
		await expect(
			database.prepare("INSERT INTO memberships VALUES('missing','missing','owner')").run(),
		).rejects.toThrow();
	});

	it("rolls back earlier writes when any batch statement fails", async () => {
		await expect(
			database.batch([
				database.prepare("INSERT INTO settings VALUES('rolled-back','1')"),
				database.prepare("INSERT INTO revision VALUES(2,-1)"),
			]),
		).rejects.toThrow();
		expect(
			await database.prepare("SELECT value FROM settings WHERE key='rolled-back'").first(),
		).toBeNull();
	});
});
