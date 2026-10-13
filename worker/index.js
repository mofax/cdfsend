// @ts-check
import { withDatabase } from "./storage/turso.js";
import app from "./app.js";
import { cleanup } from "./storage/cleanup.js";

/** @satisfies {ExportedHandler<Env>} */
const worker = {
	/** @param {Request} request @param {Env} env */
	fetch(request, env) {
		return app.fetch(request, withDatabase(env));
	},
	/** @param {ScheduledController} _controller @param {Env} env */
	async scheduled(_controller, env) {
		await cleanup(withDatabase(env));
	},
};

export default worker;
