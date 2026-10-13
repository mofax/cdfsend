// @ts-check
import { Hono } from "hono";
import { MAX_MANAGEMENT_REQUEST } from "../../../shared/schema.js";
import { fail, json, readJson } from "../../lib/http.js";
import { authRateLimit } from "../../security/access.js";
import { transaction } from "../../storage/db.js";
import * as auth from "../../services/auth.js";

/** @type {import("hono").Hono<import("../../types.js").AppEnv>} */
const routes = new Hono();

routes.get("/status", (c) => {
	if (c.req.method !== "GET") fail(405, "validation_error", "POST required");
	return auth.authStatus(c.env).then(json);
});
routes.use("*", async (c, next) => {
	if (c.req.method !== "POST") fail(405, "validation_error", "POST required");
	await authRateLimit(c.req.raw, c.env);
	await next();
});
routes.post("/logout", (c) => auth.logout(c.req.raw, c.env));
routes.use("*", async (c, next) => {
	c.set("authBody", await readJson(c.req.raw, MAX_MANAGEMENT_REQUEST));
	await next();
});
routes.post("/register/options", async (c) =>
	json(await auth.beginRegistration(c.req.raw, c.env, c.get("authBody"))),
);
routes.post("/login/options", async (c) =>
	json(await auth.beginAuthentication(c.req.raw, c.env, c.get("authBody"))),
);
routes.post("/invitation", async (c) =>
	json(await auth.inspectInvitation(c.env, c.get("authBody"))),
);
routes.post("/register/verify", async (c) =>
	auth.finishRegistration(c.req.raw, await transaction(c.env), c.get("authBody")),
);
routes.post("/login/verify", async (c) =>
	auth.finishAuthentication(c.req.raw, await transaction(c.env), c.get("authBody")),
);
routes.all("*", () => fail(404, "not_found", "Endpoint not found"));

export default routes;
