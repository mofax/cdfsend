// @ts-check
import { Hono } from "hono";
import { routePath } from "hono/route";
import { errorResponse, json } from "./lib/http.js";
import { securityHeaders } from "./middleware/security.js";
import dashboard from "./routes/dashboard/index.js";
import sdk, { sdkResources } from "./routes/sdk.js";

/** @type {import("hono").Hono<import("./types.js").AppEnv>} */
const app = new Hono({ getPath: requestPath });
app.use("*", securityHeaders);
app.onError((error, c) => errorResponse(error, { method: c.req.method, route: routePath(c) }));
app.all("/health", () => json({ name: "cdfsend", status: "ok" }));
// The dashboard namespace starts at /api/, leaving bare /api to the SPA as before.
app.all("/api", (c) => c.env.ASSETS.fetch(c.req.raw));
app.route("/api", dashboard);
app.route("/", sdk);
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

/** @param {Request} request */
function requestPath(request) {
	const path = new URL(request.url).pathname;
	if (!sdkResources.has(path.split("/")[1])) return path;
	// The SDK dispatcher historically ignored empty segments. Keep the raw request
	// unchanged so idempotency scopes and asset forwarding retain the original URL.
	const segments = path.split("/").filter(Boolean);
	return `/${segments.join("/")}`;
}
