// @ts-check
import { readdir, readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/web";

/** @param {import("@libsql/client").Client} client @param {string} [directory] */
export async function migrate(client, directory = "migrations") {
	await client.execute(
		"CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
	);
	const names = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();

	for (const name of names) {
		// oxlint-disable-next-line no-await-in-loop -- Apply numbered migrations in order.
		await applyMigration(client, directory, name);
	}
}

/** @param {import("@libsql/client").Client} client @param {string} directory @param {string} name */
async function applyMigration(client, directory, name) {
	const sql = await readFile(`${directory}/${name}`, "utf8");
	const tx = await client.transaction("write");

	try {
		const applied = await tx.execute({
			sql: "SELECT name FROM schema_migrations WHERE name=?",
			args: [name],
		});

		if (applied.rows.length === 0) {
			await tx.executeMultiple(sql);
			await tx.execute({
				sql: "INSERT INTO schema_migrations VALUES(?,?)",
				args: [name, Date.now()],
			});
		}

		await tx.commit();
	} catch (error) {
		await tx.rollback();
		throw error;
	} finally {
		tx.close();
	}
}

async function main() {
	if (process.argv[2] !== "--remote") throw new Error("Use db:migrate:local or db:migrate:remote");
	const config = parseEnv(await readFile(".env.turso", "utf8"));
	const url = config.TURSO_DATABASE_URL;
	const authToken = config.TURSO_AUTH_TOKEN;

	if (!url || !authToken) {
		throw new Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env.turso");
	}

	const client = createClient({ url, authToken });

	try {
		await migrate(client);
		console.log("Turso migrations applied");
	} finally {
		client.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
