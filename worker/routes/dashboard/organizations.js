// @ts-check
import { Hono } from "hono";
import { MAX_MANAGEMENT_REQUEST } from "../../../shared/schema.js";
import { fail, json, readJson } from "../../lib/http.js";
import { organizationActor, recentMutation } from "../../middleware/dashboard.js";
import { commit } from "../../storage/db.js";
import * as org from "../../services/organizations.js";
import { listEmails, retrieveEmail, sendEmail } from "../emails.js";
import { listDomains, createDomain, deleteDomain } from "../domains.js";
import { listKeys, createKey, deleteKey } from "../keys.js";

/** @type {import("hono").Hono<import("../../types.js").AppEnv>} */
const routes = new Hono();
routes.use("/:orgId/:resource/:id?", organizationActor);
// Sending does not require recent passkey verification. It performs its own quota checks.
routes.post("/:orgId/emails", sendEmail);
routes.use("/:orgId/:resource/:id?", recentMutation);
routes.get("/:orgId/emails", listEmails);
routes.get("/:orgId/emails/:id", retrieveEmail);
routes.get("/:orgId/domains", listDomains);
routes.post("/:orgId/domains", createDomain);
routes.delete("/:orgId/domains/:id", deleteDomain);
routes.get("/:orgId/keys", listKeys);
routes.post("/:orgId/keys", createKey);
routes.delete("/:orgId/keys/:id", deleteKey);
routes.get("/:orgId/members", async (c) => json(await org.members(c.env, c.get("actor"))));
routes.get("/:orgId/invitations", async (c) => json(await org.invitations(c.env, c.get("actor"))));
routes.post("/:orgId/invitations", async (c) => {
	const tx = c.get("transaction");
	const result = await org.inviteMember(
		c.req.raw,
		tx,
		c.get("actor"),
		await readJson(c.req.raw, MAX_MANAGEMENT_REQUEST),
	);
	await commit(tx);
	return json(result);
});
routes.patch("/:orgId/members", async (c) => {
	const tx = c.get("transaction");
	const result = await org.changeMember(
		tx,
		c.get("actor"),
		await readJson(c.req.raw, MAX_MANAGEMENT_REQUEST),
	);
	await commit(tx);
	return json(result);
});
routes.delete("/:orgId/members/:id", async (c) => {
	const tx = c.get("transaction");
	const result = await org.removeMember(tx, c.get("actor"), c.req.param("id"));
	await commit(tx);
	return json(result);
});
routes.delete("/:orgId/invitations/:id", async (c) => {
	const tx = c.get("transaction");
	const result = await org.revokeInvitation(tx, c.get("actor"), c.req.param("id"));
	await commit(tx);
	return json(result);
});
routes.all("/:orgId/:resource/:id?", async (c) => {
	if (c.req.method === "GET") fail(404, "not_found", "Endpoint not found");

	if (c.req.method === "POST" && !c.req.param("id")) {
		await readJson(c.req.raw, MAX_MANAGEMENT_REQUEST);
	}

	return fail(405, "validation_error", "Operation not supported");
});

export default routes;
