// @ts-check
import { Hono } from "hono";
import { MAX_MANAGEMENT_REQUEST } from "../../../shared/schema.js";
import { fail, json, readJson } from "../../lib/http.js";
import { dashboardOrigin } from "../../middleware/dashboard.js";
import { snapshot } from "../../middleware/transaction.js";
import { me, removeCredential } from "../../services/auth.js";
import { acceptInvitation } from "../../services/organizations.js";
import auth from "./auth.js";
import instance from "./instance.js";
import organizations from "./organizations.js";

/** @type {import("hono").Hono<import("../../types.js").AppEnv>} */
const routes = new Hono();
routes.use("*", dashboardOrigin);
routes.all("/auth", snapshot, () => fail(404, "not_found", "Endpoint not found"));
routes.route("/auth", auth);
routes.get("/me", async (c, next) => {
	if (c.req.method !== "GET") return next();
	return json(await me(c.req.raw, c.env));
});
routes.use("*", snapshot);
routes.post("/invitations/accept", async (c) =>
	json(
		await acceptInvitation(
			c.req.raw,
			c.get("transaction"),
			await readJson(c.req.raw, MAX_MANAGEMENT_REQUEST),
		),
	),
);
routes.delete("/account/credentials/:credentialId", async (c) =>
	json(await removeCredential(c.req.raw, c.get("transaction"), c.req.param("credentialId"))),
);
routes.all("/instance", () => fail(404, "not_found", "Endpoint not found"));
routes.route("/instance", instance);
routes.route("/orgs", organizations);
routes.all("*", () => fail(404, "not_found", "Endpoint not found"));

export default routes;
