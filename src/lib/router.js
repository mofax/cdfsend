// @ts-check
import { createRouter } from "sv-router";

// Dashboard paths must not collide with the Resend-compatible SDK endpoints.
export const {
	p: routePath,
	navigate,
	route,
	isActive,
} = createRouter({
	layout: () => import("./components/Dashboard.svelte"),
	"/": () => import("../pages/Overview.svelte"),
	"/app/emails": () => import("../pages/Emails.svelte"),
	"/app/domains": () => import("../pages/Domains.svelte"),
	"/app/keys": () => import("../pages/Keys.svelte"),
	"/app/members": () => import("../pages/Team.svelte"),
	"/app/instance": () => import("../pages/Instance.svelte"),
	"/app/security": () => import("../pages/Security.svelte"),
	"/app/guide": () => import("../pages/Guide.svelte"),
	"*": () => import("../pages/NotFound.svelte"),
});
