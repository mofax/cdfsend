// @ts-check
import { readFile } from "node:fs/promises";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

const url = process.env.CDFSEND_DATABASE_URL;

if (!url || new URL(url).hostname !== "127.0.0.1") {
	throw new Error("Run bun run test:worker with an isolated local database");
}

const schema = await readFile("migrations/0001_initial.sql", "utf8");
const tables = Array.from(schema.matchAll(/CREATE TABLE (\w+)/g), (match) => match[1]).reverse();
const drops = tables.map((table) => `DROP TABLE IF EXISTS ${table};`).join("\n");
export default defineConfig({
	plugins: [
		cloudflareTest({
			remoteBindings: false,
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				bindings: {
					TURSO_DATABASE_URL: url,
					TURSO_AUTH_TOKEN: "",
					TEST_RESET_SQL: `PRAGMA foreign_keys=OFF;\n${drops}\n${schema}`,
				},
			},
		}),
	],
	test: { include: ["tests/worker/**/*.test.js"], testTimeout: 30_000 },
});
