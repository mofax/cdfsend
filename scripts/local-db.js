// @ts-check
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";

async function availablePort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve(undefined));
	});
	const address = server.address();

	if (!address || typeof address === "string") {
		throw new Error("Could not allocate local database port");
	}

	await new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve(undefined))),
	);
	return address.port;
}

/** @param {string} directory */
export async function startDatabase(directory) {
	await mkdir(directory, { recursive: true });
	const port = await availablePort();
	const url = `http://127.0.0.1:${port}`;
	const child = spawn(
		"sqld",
		["--no-welcome", "--http-listen-addr", `127.0.0.1:${port}`, "-d", directory],
		{
			stdio: ["ignore", "ignore", "pipe"],
			env: Object.assign({}, process.env, { RUST_LOG: "error" }),
		},
	);
	let failure = "";
	child.stderr.on("data", (data) => {
		failure += data.toString();
	});
	child.on("error", (error) => {
		failure = error.message;
	});
	const stopped = new Promise((resolve) => child.once("close", resolve));

	const stop = async () => {
		child.kill("SIGTERM");
		await stopped;
	};

	try {
		await waitForDatabase(url, child, () => failure);
		return { url, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}

/** @param {string} url @param {import("node:child_process").ChildProcess} child @param {() => string} failure */
async function waitForDatabase(url, child, failure) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (failure() || child.exitCode !== null) {
			throw new Error(`Local libSQL server failed: ${failure()}`);
		}

		try {
			// oxlint-disable-next-line no-await-in-loop -- Poll readiness sequentially.
			const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(500) });
			if (response.ok) return;
		} catch {
			// The process has not bound its HTTP port yet.
		}

		// oxlint-disable-next-line no-await-in-loop -- Delay the next readiness probe.
		await setTimeout(100);
	}

	throw new Error("Local libSQL server did not become ready");
}
