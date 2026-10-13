// @ts-check
import { test, expect } from "@playwright/test";

function gate() {
	/** @type {()=>void} */
	let release = () => {};

	const promise = new Promise((resolve) => {
		release = () => resolve(undefined);
	});
	return { promise, release };
}

/** @param {string} id */
function email(id) {
	return {
		id,
		from: "hello@example.com",
		to: ["test@example.net"],
		subject: id,
		created_at: "2026-01-01T00:00:00Z",
		cdfsend: { status: "sent", error: null },
	};
}

/** @param {import("@playwright/test").Page} page */
async function mockPasskeyAuthentication(page) {
	// Synthetic WebAuthn assertion: this test verifies frontend ownership, not cryptography.
	await page.addInitScript(() => {
		Object.defineProperty(navigator.credentials, "get", {
			value: async () => ({
				id: "synthetic",
				rawId: new ArrayBuffer(1),
				type: "public-key",
				response: {
					authenticatorData: new ArrayBuffer(1),
					clientDataJSON: new ArrayBuffer(1),
					signature: new ArrayBuffer(1),
				},
				getClientExtensionResults: () => ({}),
			}),
		});
	});
	await page.route("**/api/auth/login/options", (route) =>
		route.fulfill({
			json: { ceremonyId: "synthetic", options: { challenge: "AQ", allowCredentials: [] } },
		}),
	);
}

test.beforeEach(async ({ page }) => {
	// Browser-only fixtures: no real credentials, database writes, or email delivery.
	await page.route("**/api/**", async (route) => {
		const pathname = new URL(route.request().url()).pathname;
		let json = {};

		if (pathname === "/api/auth/status") json = { bootstrapped: true };
		else if (pathname === "/api/me") {
			json = {
				user: { id: "owner", handle: "owner@example.com", is_operator: 1 },
				organizations: [
					{ id: "alpha", name: "Alpha", role: "owner" },
					{ id: "beta", name: "Beta", role: "member" },
				],
				credentials: [],
			};
		} else json = { data: [], has_more: false };

		await route.fulfill({ json });
	});
});

test("shows pending data, retries failures, and paginates without replacing earlier rows", async ({
	page,
}) => {
	const requested = gate();
	const response = gate();
	let attempts = 0;
	await page.route("**/api/orgs/alpha/emails?**", async (route) => {
		attempts += 1;
		const after = new URL(route.request().url()).searchParams.get("after");

		if (after) {
			expect(after).toBe("first-page");
			await route.fulfill({ json: { data: [email("second-page")], has_more: false } });
			return;
		}

		if (attempts === 1) {
			requested.release();
			await response.promise;
			await route.fulfill({
				status: 503,
				json: { name: "unavailable", message: "History temporarily unavailable" },
			});
			return;
		}

		await route.fulfill({ json: { data: [email("first-page")], has_more: true } });
	});
	await page.goto("/app/emails?org=alpha");
	await requested.promise;
	await expect(page.getByRole("status")).toHaveText("Loading page…");
	await expect(page.getByRole("navigation")).toBeVisible();
	response.release();
	await expect(page.getByRole("alert")).toContainText("History temporarily unavailable");
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(page.getByRole("button", { name: "first-page", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Load more emails" }).click();
	await expect(page.getByRole("button", { name: "second-page", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "first-page", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Load more emails" })).toHaveCount(0);
});

for (const outcome of ["data", "errors"]) {
	test(`discards pending organization ${outcome} after navigation`, async ({ page }) => {
		const requested = gate();
		const response = gate();
		await page.route("**/api/orgs/alpha/emails?**", async (route) => {
			requested.release();
			await response.promise;

			if (outcome === "errors") {
				await route.fulfill({
					status: 503,
					json: { name: "unavailable", message: "Obsolete Alpha failure" },
				});
			} else {
				await route.fulfill({ json: { data: [email("Obsolete Alpha history")], has_more: false } });
			}
		});
		await page.route("**/api/orgs/beta/emails?**", (route) =>
			route.fulfill({ json: { data: [email("Beta history")], has_more: false } }),
		);
		await page.goto("/?org=alpha");
		await requested.promise;
		await page.getByLabel("Organization", { exact: true }).selectOption("beta");
		await expect(page.getByRole("button", { name: "Beta history", exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Send test email", exact: false })).toHaveCount(
			0,
		);
		const obsoleteResponse = page.waitForResponse("**/api/orgs/alpha/emails?**");
		response.release();
		await obsoleteResponse;
		// A new page load flushes async work and must not inherit the destroyed boundary's error.
		await page.getByRole("link", { name: "Emails", exact: false }).first().click();
		await expect(page.getByRole("heading", { name: "Emails", exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Beta history", exact: true })).toBeVisible();
		await expect(page.getByRole("alert")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Obsolete Alpha history", exact: true }),
		).toHaveCount(0);
	});
}

test("keeps a created key visible while asynchronously refreshing data in parallel", async ({
	page,
}) => {
	let created = false;
	const domainsRequested = gate();
	const keysRequested = gate();
	const response = gate();
	await page.route("**/api/orgs/alpha/domains?**", async (route) => {
		if (created) {
			domainsRequested.release();
			await response.promise;
		}

		await route.fulfill({ json: { data: [], has_more: false } });
	});
	await page.route("**/api/orgs/alpha/keys**", async (route) => {
		if (route.request().method() === "POST") {
			created = true;
			await route.fulfill({ json: { token: "synthetic-key" } });
			return;
		}

		if (created) {
			keysRequested.release();
			await response.promise;
		}

		const data = created
			? [
					{
						id: "key",
						name: "Async app",
						prefix: "test",
						permission: "sending_access",
						created_at: 1,
					},
				]
			: [];
		await route.fulfill({ json: { data, has_more: false } });
	});
	await page.goto("/app/keys?org=alpha");
	await page.getByLabel("Key name").fill("Async app");
	await page.getByRole("button", { name: "Create key" }).click();
	await Promise.all([domainsRequested.promise, keysRequested.promise]);
	await expect(page.getByRole("status").filter({ hasText: "Updating page…" })).toBeVisible();
	await expect(page.getByLabel("New API key")).toHaveValue("synthetic-key");
	response.release();
	await expect(page.getByRole("cell", { name: "Async app", exact: false })).toBeVisible();
	await expect(page.getByLabel("New API key")).toHaveValue("synthetic-key");
	await expect(page.getByRole("status")).toHaveCount(0);
});

test("returns to entry when async page loading loses its session", async ({ page }) => {
	await page.route("**/api/orgs/alpha/domains?**", (route) =>
		route.fulfill({
			status: 401,
			json: { name: "unauthorized", message: "Session expired" },
		}),
	);
	await page.goto("/app/domains?org=alpha");
	await expect(page.getByLabel("Account handle")).toBeVisible();
	await expect(page.getByRole("navigation")).toHaveCount(0);
});

test("keeps the composer's idempotency key across a failed send and refreshes after success", async ({
	page,
}) => {
	/** @type {string[]} */
	const keys = [];
	await page.route("**/api/orgs/alpha/domains?**", (route) =>
		route.fulfill({
			json: { data: [{ id: "domain", name: "example.com" }], has_more: false },
		}),
	);
	await page.route("**/api/orgs/alpha/emails", async (route) => {
		keys.push(route.request().headers()["idempotency-key"]);
		expect(route.request().postDataJSON()).toMatchObject({
			from: "hello@example.com",
			to: "test@example.net",
			subject: "Composer regression",
		});

		if (keys.length === 1) {
			await route.fulfill({
				status: 503,
				json: { name: "unavailable", message: "Try sending again" },
			});
		} else await route.fulfill({ json: { id: "synthetic-send" } });
	});
	await page.goto("/app/emails?org=alpha");
	await page.getByRole("button", { name: "Send test email", exact: false }).click();
	const composer = page.getByRole("dialog", { name: "Send a test email" });
	await expect(composer.getByLabel("From", { exact: true })).toHaveValue("hello@example.com");
	await composer.getByLabel("To", { exact: true }).fill("test@example.net");
	await composer.getByLabel("Subject", { exact: true }).fill("Composer regression");
	await composer.getByRole("button", { name: "Send email", exact: false }).click();
	await expect(composer.getByRole("alert")).toHaveText("Try sending again");
	await composer.getByRole("button", { name: "Send email", exact: false }).click();
	await expect(composer).toHaveCount(0);
	await expect(page.getByText("Cloudflare accepted your email. ID: synthetic-send")).toBeVisible();
	expect(keys).toHaveLength(2);
	expect(keys[0]).toBeTruthy();
	expect(keys[1]).toBe(keys[0]);
});

test("navigates away from a pending route import without mounting the obsolete page", async ({
	page,
}) => {
	const requested = gate();
	const response = gate();
	/** @type {string[]} */
	const domainRequests = [];
	page.on("request", (request) => {
		if (request.url().includes("/api/orgs/alpha/domains")) domainRequests.push(request.url());
	});
	await page.route("**/src/pages/Domains.svelte*", async (route) => {
		requested.release();
		await response.promise;
		await route.continue();
	});
	await page.goto("/app/emails?org=alpha");
	await expect(page.getByRole("heading", { name: "Emails", exact: true })).toBeVisible();
	await page.getByRole("link", { name: "Domains", exact: false }).first().click();
	await requested.promise;

	try {
		await expect(page.getByRole("heading", { name: "Emails", exact: true })).toBeVisible();
		await page.getByRole("link", { name: "Security", exact: false }).click();
		await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
	} finally {
		response.release();
	}

	// An aborted sv-router navigation must not create a history entry or mount its page.
	await page.goBack();
	await expect(page.getByRole("heading", { name: "Emails", exact: true })).toBeVisible();
	expect(domainRequests).toHaveLength(0);
	await page.getByRole("link", { name: "Domains", exact: false }).first().click();
	await expect(page.getByRole("heading", { name: "Domains", exact: true })).toBeVisible();
	expect(domainRequests).toHaveLength(1);
	await page.goBack();
	await expect(page.getByRole("heading", { name: "Emails", exact: true })).toBeVisible();
	await page.goForward();
	await expect(page.getByRole("heading", { name: "Domains", exact: true })).toBeVisible();
});

test("leaves modified, external, fragment, download, and new-tab links to the browser", async ({
	page,
}) => {
	await page.goto("/app/guide?org=alpha");
	await expect(page.getByRole("heading", { name: "Quick start", exact: true })).toBeVisible();
	const intercepted = await page.evaluate(() => {
		const scenarios = [
			{ href: "/app/domains?org=alpha", ctrlKey: true },
			{ href: "/app/domains?org=alpha", metaKey: true },
			{ href: "/app/domains?org=alpha", shiftKey: true },
			{ href: "/app/domains?org=alpha", altKey: true },
			{ href: "/app/domains?org=alpha", button: 1 },
			{ href: "/app/domains?org=alpha", target: "_blank" },
			{ href: "/app/domains?org=alpha", download: true },
			{ href: "#guide" },
			{ href: "https://external.example/" },
		];
		return scenarios.map((scenario) => {
			const anchor = document.createElement("a");
			anchor.href = scenario.href;
			if (scenario.target) anchor.target = scenario.target;
			if (scenario.download) anchor.download = "example";
			document.body.appendChild(anchor);
			let intercepted = false;
			window.addEventListener(
				"click",
				(event) => {
					intercepted = event.defaultPrevented;
					// Observe native behavior without navigating or contacting an external site.
					event.preventDefault();
				},
				{ once: true },
			);
			const event = new MouseEvent(
				"click",
				Object.assign({ bubbles: true, cancelable: true }, scenario),
			);
			anchor.dispatchEvent(event);
			anchor.remove();
			return intercepted;
		});
	});
	expect(intercepted).toEqual(Array(9).fill(false));
	await expect(page).toHaveURL("/app/guide?org=alpha");
});

test("runs independent mutations concurrently without blocking navigation or duplicate-submitting", async ({
	page,
}) => {
	const creationRequested = gate();
	const recoveryRequested = gate();
	const response = gate();
	let creations = 0;
	await page.route("**/api/instance/users", (route) =>
		route.fulfill({ json: [{ id: "member", handle: "member@example.com", is_operator: 0 }] }),
	);
	await page.route("**/api/instance/organizations", async (route) => {
		if (route.request().method() === "GET") {
			await route.fulfill({ json: [] });
			return;
		}

		creations += 1;
		creationRequested.release();
		await response.promise;
		await route.fulfill({
			json: { id: "new", invitation: { url: "https://example.test/#invite=organization" } },
		});
	});
	await page.route("**/api/instance/recovery", async (route) => {
		recoveryRequested.release();
		await response.promise;
		await route.fulfill({ json: { url: "https://example.test/#recover=account" } });
	});
	await page.goto("/app/instance?org=alpha");
	await page.getByLabel("Organization name", { exact: true }).fill("Concurrent organization");
	await page.getByRole("button", { name: "Create organization", exact: false }).click();
	await creationRequested.promise;
	await expect(
		page.getByRole("button", { name: "Create organization", exact: false }),
	).toBeDisabled();
	// Keyboard/programmatic form submission must also respect the local guard.
	await page
		.getByLabel("Organization name", { exact: true })
		.evaluate((input) => input.closest("form")?.requestSubmit());
	await page.getByRole("combobox", { name: "Account", exact: true }).selectOption("member");
	await page.getByRole("button", { name: "Create recovery link" }).click();
	await recoveryRequested.promise;
	await expect(page.getByLabel("Organization", { exact: true })).toBeEnabled();
	await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
	await expect(page.getByRole("link", { name: "Domains", exact: false }).first()).toBeEnabled();
	response.release();
	await expect(page.getByLabel("Organization invitation link")).toHaveValue(
		"https://example.test/#invite=organization",
	);
	await expect(page.getByLabel("Instance invitation link")).toHaveValue(
		"https://example.test/#recover=account",
	);
	expect(creations).toBe(1);
});

test("keeps row mutations and verification requests independent", async ({ page }) => {
	const roles = [
		{ id: "one", handle: "one@example.com", role: "member" },
		{ id: "two", handle: "two@example.com", role: "member" },
	];
	await page.route("**/api/orgs/alpha/members", async (route) => {
		if (route.request().method() === "GET") {
			await route.fulfill({ json: roles });
			return;
		}

		await route.fulfill({
			status: 403,
			json: { name: "reauthentication_required", message: "Verify your passkey" },
		});
	});
	await page.goto("/app/members?org=alpha");
	const first = page.getByRole("row").filter({ hasText: "one@example.com" });
	const second = page.getByRole("row").filter({ hasText: "two@example.com" });
	await first.getByRole("combobox").selectOption("admin");
	await expect(first.getByRole("button", { name: "Verify and continue" })).toBeVisible();
	await expect(second.getByRole("combobox")).toBeEnabled();
	await second.getByRole("combobox").selectOption("admin");
	await expect(second.getByRole("button", { name: "Verify and continue" })).toBeVisible();
	await first.getByRole("button", { name: "Cancel verification" }).click();
	await expect(first.getByRole("button", { name: "Verify and continue" })).toHaveCount(0);
	await expect(second.getByRole("button", { name: "Verify and continue" })).toBeVisible();
	await expect(first.getByRole("combobox")).toBeEnabled();
});

test("verifies and retries the submitted snapshot, not the edited form", async ({ page }) => {
	await mockPasskeyAuthentication(page);
	/** @type {unknown[]} */
	const inputs = [];
	await page.route("**/api/orgs/alpha/keys", async (route) => {
		inputs.push(route.request().postDataJSON());
		if (inputs.length === 1) {
			await route.fulfill({
				status: 403,
				json: { name: "reauthentication_required", message: "Verify your passkey" },
			});
		} else await route.fulfill({ json: { token: "snapshot-key" } });
	});
	await page.goto("/app/keys?org=alpha");
	await page.getByLabel("Key name").fill("Original app");
	await page.getByRole("button", { name: "Create key" }).click();
	await expect(page.getByRole("button", { name: "Verify and continue" })).toBeVisible();
	await page.getByLabel("Key name").fill("Next app");
	await page.screenshot({ path: "test-results/verification-desktop.png", fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	await page.screenshot({ path: "test-results/verification-mobile.png", fullPage: true });
	await page.getByRole("button", { name: "Verify and continue" }).click();
	await expect(page.getByLabel("New API key")).toHaveValue("snapshot-key");
	await expect(page.getByLabel("Key name")).toHaveValue("Next app");
	expect(inputs).toEqual([
		{ name: "Original app", permission: "sending_access" },
		{ name: "Original app", permission: "sending_access" },
	]);
});

test("does not replay a successful write when refreshing fails", async ({ page }) => {
	let writes = 0;
	await page.route("**/api/orgs/alpha/keys", async (route) => {
		writes += 1;
		await route.fulfill({ json: { token: "saved-once" } });
	});
	await page.goto("/app/keys?org=alpha");
	await expect(page.getByRole("heading", { name: "API keys", exact: true })).toBeVisible();
	await page.route("**/api/me", (route) =>
		route.fulfill({
			status: 403,
			json: { name: "reauthentication_required", message: "Synthetic refresh failure" },
		}),
	);
	await page.getByLabel("Key name").fill("Created app");
	await page.getByRole("button", { name: "Create key" }).click();
	await expect(page.getByLabel("New API key")).toHaveValue("saved-once");
	await expect(page.getByRole("alert")).toContainText(
		"The change succeeded, but refreshing failed",
	);
	await expect(page.getByRole("button", { name: "Verify and continue" })).toHaveCount(0);
	expect(writes).toBe(1);
});

for (const destination of ["navigation", "organization", "sign-out"]) {
	test(`discards a late mutation completion after ${destination}`, async ({ page }) => {
		const requested = gate();
		const response = gate();
		let refreshes = 0;
		page.on("request", (request) => {
			if (new URL(request.url()).pathname === "/api/me") refreshes += 1;
		});
		await page.route("**/api/orgs/alpha/keys", async (route) => {
			requested.release();
			await response.promise;
			await route.fulfill({ json: { token: "obsolete-secret" } });
		});
		await page.goto("/app/keys?org=alpha");
		await page.getByLabel("Key name").fill("Obsolete app");
		await page.getByRole("button", { name: "Create key" }).click();
		await requested.promise;

		if (destination === "navigation") {
			await page.getByRole("link", { name: "Security", exact: false }).click();
			await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
		} else if (destination === "organization") {
			await page.getByLabel("Organization", { exact: true }).selectOption("beta");
			await expect(page.getByLabel("Organization", { exact: true })).toHaveValue("beta");
			await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
		} else {
			await page.getByRole("button", { name: "Sign out", exact: true }).click();
			await expect(page.getByLabel("Account handle")).toBeVisible();
		}

		const completed = page.waitForResponse("**/api/orgs/alpha/keys");
		response.release();
		await completed;
		// A subsequent navigation flushes the response continuation without reloading the app.
		if (destination !== "sign-out") {
			await page.getByRole("link", { name: "Security", exact: false }).click();
			await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
		} else await expect(page.getByLabel("Account handle")).toBeVisible();
		await expect(page.getByLabel("New API key")).toHaveCount(0);
		expect(refreshes).toBe(1);
	});
}

test("invalidates verification on navigation and organization changes", async ({ page }) => {
	let writes = 0;
	await page.route("**/api/orgs/alpha/keys", async (route) => {
		writes += 1;
		await route.fulfill({
			status: 403,
			json: { name: "reauthentication_required", message: "Verify your passkey" },
		});
	});
	await page.goto("/app/keys?org=alpha");
	await page.getByLabel("Key name").fill("Cancelled app");
	await page.getByRole("button", { name: "Create key" }).click();
	await page.getByRole("button", { name: "Cancel verification" }).click();
	await expect(page.getByRole("button", { name: "Verify and continue" })).toHaveCount(0);
	await page.getByRole("button", { name: "Create key" }).click();
	await expect(page.getByRole("button", { name: "Verify and continue" })).toBeVisible();
	await page.getByLabel("Organization", { exact: true }).selectOption("beta");
	await expect(page.getByRole("button", { name: "Verify and continue" })).toHaveCount(0);
	await page.getByLabel("Organization", { exact: true }).selectOption("alpha");
	await page.getByRole("link", { name: "API keys", exact: false }).click();
	await expect(page.getByRole("heading", { name: "API keys", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Verify and continue" })).toHaveCount(0);
	expect(writes).toBe(2);
});

for (const status of [200, 401]) {
	test(`does not let an obsolete refresh (${status}) overwrite a newer session result`, async ({
		page,
	}) => {
		const requested = gate();
		const response = gate();
		await page.goto("/?org=alpha");
		await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
		let refreshes = 0;
		await page.route("**/api/me", async (route) => {
			refreshes += 1;
			const firstRefresh = refreshes === 1;

			if (firstRefresh) {
				requested.release();
				await response.promise;
			}

			const responseStatus = firstRefresh ? status : 200;
			const handle = firstRefresh ? "obsolete@example.com" : "newer@example.com";
			await route.fulfill({
				status: responseStatus,
				json: {
					user: { id: "owner", handle, is_operator: 1 },
					organizations: [{ id: "alpha", name: "Alpha", role: "owner" }],
					credentials: [],
				},
			});
		});
		await page.getByRole("button", { name: "Refresh", exact: false }).click();
		await requested.promise;
		await page.getByRole("link", { name: "API keys", exact: false }).click();
		await page.route("**/api/orgs/alpha/keys", (route) =>
			route.fulfill({ json: { token: "newer-key" } }),
		);
		await page.getByLabel("Key name").fill("Newer app");
		await page.getByRole("button", { name: "Create key" }).click();
		await expect(page.locator(".account strong")).toHaveText("newer@example.com");
		const completed = page.waitForResponse("**/api/me");
		response.release();
		await completed;
		await page.getByRole("link", { name: "Security", exact: false }).click();
		await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
		await expect(page.locator(".account strong")).toHaveText("newer@example.com");
	});
}

test("an in-flight session refresh cannot restore a signed-out session", async ({ page }) => {
	const requested = gate();
	const response = gate();
	await page.goto("/?org=alpha");
	await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
	await page.route("**/api/me", async (route) => {
		requested.release();
		await response.promise;
		await route.fulfill({
			json: {
				user: { id: "owner", handle: "obsolete@example.com", is_operator: 1 },
				organizations: [{ id: "alpha", name: "Alpha", role: "owner" }],
				credentials: [],
			},
		});
	});
	await page.getByRole("button", { name: "Refresh", exact: false }).click();
	await requested.promise;
	await page.getByRole("button", { name: "Sign out", exact: true }).click();
	await expect(page.getByLabel("Account handle")).toBeVisible();
	const completed = page.waitForResponse("**/api/me");
	response.release();
	await completed;
	await expect(page.getByLabel("Account handle")).toBeVisible();
	await expect(page.getByRole("navigation")).toHaveCount(0);
});

test("a late unauthorized mutation cannot expire a newer login", async ({ page }) => {
	await mockPasskeyAuthentication(page);
	const requested = gate();
	const response = gate();
	await page.route("**/api/orgs/alpha/keys", async (route) => {
		requested.release();
		await response.promise;
		await route.fulfill({
			status: 401,
			json: { name: "unauthorized", message: "Old session expired" },
		});
	});
	await page.goto("/app/keys?org=alpha");
	await page.getByLabel("Key name").fill("Old session app");
	await page.getByRole("button", { name: "Create key" }).click();
	await requested.promise;
	await page.getByRole("button", { name: "Sign out", exact: true }).click();
	await page.getByLabel("Account handle").fill("owner@example.com");
	await page.getByRole("button", { name: "Continue with a passkey" }).click();
	await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
	const completed = page.waitForResponse("**/api/orgs/alpha/keys");
	response.release();
	await completed;
	await page.getByRole("link", { name: "Security", exact: false }).click();
	await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
	await expect(page.getByLabel("Account handle")).toHaveCount(0);
	await expect(page.getByRole("alert")).toHaveCount(0);
});
