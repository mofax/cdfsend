// @ts-check
import { transaction } from "../storage/db.js";

/** @type {import("../types.js").AppMiddleware} */
export async function snapshot(c, next) {
	// Snapshot before authorization; every write must guard against concurrent revocation.
	c.set("transaction", await transaction(c.env));
	await next();
}
