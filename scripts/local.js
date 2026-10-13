// @ts-check
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client/web";
import { startDatabase } from "./local-db.js";
import { migrate } from "./migrate.js";

const mode = process.argv[2];
const temporary = mode === "worker-tests" || mode === "e2e";
const directory = temporary ? await mkdtemp(join(tmpdir(), "cdfsend-turso-")) : ".wrangler/turso";
const database = await startDatabase(directory);
const client = createClient({ url: database.url });

try {
	await migrate(client);
	client.close();
	if (mode !== "migrate") process.exitCode = await run(database.url);
} finally {
	client.close();
	await database.stop();
	if (temporary) await rm(directory, { recursive: true, force: true });
}

/** @param {string} url */
async function run(url) {
	const commands = {
		dev: ["vite", "--host", "localhost"],
		offline: ["vite", "--host", "localhost", "--mode", "e2e"],
		e2e: ["vite", "--host", "localhost", "--mode", "e2e"],
		preview: [
			"wrangler",
			"dev",
			"--config",
			"dist/worker/wrangler.json",
			"--ip",
			"localhost",
			"--port",
			"5173",
			"--var",
			`TURSO_DATABASE_URL:${url}`,
			"--var",
			"TURSO_AUTH_TOKEN:",
		],
		"worker-tests": ["vitest", "run", "--config", "vitest.worker.config.js"],
	};
	const args = commands[/** @type {keyof typeof commands} */ (mode)];
	if (!args) throw new Error("Unknown local command");
	const logPath = process.env.WRANGLER_LOG_PATH ?? join(tmpdir(), "cdfsend-wrangler-logs");
	const child = spawn("bun", ["run", ...args], {
		stdio: "inherit",
		env: Object.assign({}, process.env, {
			CDFSEND_DATABASE_URL: url,
			TURSO_AUTH_TOKEN: "",
			WRANGLER_LOG_PATH: logPath,
		}),
	});

	const terminate = () => {
		child.kill("SIGTERM");
	};

	process.on("SIGINT", terminate);
	process.on("SIGTERM", terminate);

	try {
		return await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code) => {
				const exitCode = code ?? 1;
				resolve(exitCode);
			});
		});
	} finally {
		process.off("SIGINT", terminate);
		process.off("SIGTERM", terminate);
	}
}
