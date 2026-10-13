// @ts-check
import { Hono } from "hono";
import { MAX_MANAGEMENT_REQUEST } from "../../../shared/schema.js";
import { fail, json, readJson } from "../../lib/http.js";
import { operator } from "../../middleware/dashboard.js";
import { statement } from "../../storage/db.js";
import { createOrganization, recoveryInvitation } from "../../services/organizations.js";

/** @type {import("hono").Hono<import("../../types.js").AppEnv>} */
const routes = new Hono();
routes.use("*", operator);
routes.get("/organizations", async (c) =>
	json(
		(await statement(c.env, "SELECT id,name,created_at FROM organizations ORDER BY name").all())
			.results,
	),
);
routes.post("/organizations", async (c) =>
	json(
		await createOrganization(
			c.req.raw,
			c.get("transaction"),
			await readJson(c.req.raw, MAX_MANAGEMENT_REQUEST),
		),
	),
);
routes.get("/users", async (c) =>
	json(
		(await statement(c.env, "SELECT id,handle,is_operator FROM users ORDER BY handle").all())
			.results,
	),
);
routes.post("/recovery", async (c) =>
	json(
		await recoveryInvitation(
			c.req.raw,
			c.get("transaction"),
			await readJson(c.req.raw, MAX_MANAGEMENT_REQUEST),
		),
	),
);
routes.all("*", () => fail(404, "not_found", "Endpoint not found"));

export default routes;
