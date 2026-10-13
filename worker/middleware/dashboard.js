// @ts-check
import { fail } from "../lib/http.js";
import { sessionActor, requireRecent } from "../security/access.js";
import { requireOrigin } from "../security/origin.js";
import { requireOperator } from "../services/organizations.js";

/** @type {import("../types.js").AppMiddleware} */
export async function dashboardOrigin(c, next) {
	if (c.req.method !== "GET") requireOrigin(c.req.raw);
	await next();
}

/** @type {import("../types.js").AppMiddleware} */
export async function operator(c, next) {
	await requireOperator(c.req.raw, c.env);
	if (c.req.method === "HEAD") fail(404, "not_found", "Endpoint not found");
	await next();
}

/** @param {import("../types.js").AppContext<"/:orgId/:resource/:id?">} c @param {import("hono").Next} next */
export async function organizationActor(c, next) {
	c.set("actor", await sessionActor(c.req.raw, c.env, c.req.param("orgId")));
	await next();
}

/** @type {import("../types.js").AppMiddleware} */
export async function recentMutation(c, next) {
	if (c.req.method !== "GET") {
		requireRecent(c.get("actor"));
		if (c.req.method === "HEAD") fail(405, "validation_error", "Operation not supported");
	}

	await next();
}
