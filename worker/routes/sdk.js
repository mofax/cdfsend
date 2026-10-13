// @ts-check
import { Hono } from "hono";
import { fail } from "../lib/http.js";
import { apiKey, management, unsupportedFeature } from "../middleware/sdk.js";
import { snapshot } from "../middleware/transaction.js";
import { listEmails, retrieveEmail, sendEmail, sendBatch } from "./emails.js";
import { listDomains, retrieveDomain, createDomain, deleteDomain } from "./domains.js";
import { listKeys, createKey, deleteKey } from "./keys.js";

export const sdkResources = new Set([
	"emails",
	"domains",
	"api-keys",
	"contacts",
	"audiences",
	"segments",
	"broadcasts",
	"webhooks",
	"templates",
	"events",
	"logs",
	"suppressions",
	"topics",
	"automations",
	"usage",
	"oauth",
	"contact-properties",
]);

/** @type {import("hono").Hono<import("../types.js").AppEnv>} */
const routes = new Hono();

for (const resource of sdkResources) {
	routes.use(`/${resource}/*`, snapshot, apiKey);
}

routes.post("/emails", sendEmail);
routes.post("/emails/batch", sendBatch);
routes.post("/emails/*", () => fail(501, "validation_error", "Email operation unsupported"));

for (const resource of sdkResources) {
	routes.use(`/${resource}/*`, management);
}

routes.get("/emails", listEmails);
routes.get("/emails/:id", retrieveEmail);
routes.get("/domains", listDomains);
routes.get("/domains/:id", retrieveDomain);
routes.post("/domains", createDomain);
routes.delete("/domains/:id", deleteDomain);
routes.get("/api-keys", listKeys);
routes.post("/api-keys", createKey);
routes.delete("/api-keys/:id", deleteKey);
routes.all("/domains/:id?", () =>
	fail(501, "validation_error", "Domain configuration is managed in Cloudflare, not cdfsend"),
);
routes.all("/api-keys/:id?", () =>
	fail(501, "validation_error", "API key operation unsupported; create or revoke keys instead"),
);

for (const resource of sdkResources) {
	routes.all(`/${resource}/*`, unsupportedFeature);
}

export default routes;
