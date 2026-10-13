// @ts-check
import { test, expect } from "@playwright/test";
import { Resend } from "resend";

/** @param {import("@playwright/test").BrowserContext} context @param {import("@playwright/test").Page} page */
async function passkey(context, page) {
	const cdp = await context.newCDPSession(page);
	await cdp.send("WebAuthn.enable");
	const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "usb",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
	return { cdp, authenticatorId };
}

test("real passkeys, SDK sending, team invitations, tenant switching, and sandboxed previews", async ({
	page,
	context,
	browser,
}) => {
	const ownerAuthenticator = await passkey(context, page);
	await page.goto("/");
	await page.getByLabel("Account handle").fill("owner@example.com");
	await expect(page.getByRole("textbox")).toHaveCount(1);
	await page.getByRole("button", { name: "Create instance owner" }).click();
	await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
	await expect(page.getByLabel("Organization", { exact: true })).toContainText("Default");

	const navigationNames = ["Emails", "Domains", "API keys", "Members"];
	await Promise.all(
		navigationNames.map((name) =>
			expect(page.getByRole("link", { name, exact: false }).first()).toBeEnabled(),
		),
	);

	const setup = await (await page.request.get("/api/me")).json();
	expect(setup.organizations).toHaveLength(1);
	expect(setup.organizations[0].role).toBe("owner");
	await page.getByRole("link", { name: "Instance", exact: false }).click();
	await expect(page.getByRole("heading", { name: "Your instance" })).toBeVisible();
	await page.getByLabel("Organization name", { exact: true }).fill("Acme");
	await expect(page.getByLabel("Owner's account handle")).toHaveValue("owner@example.com");
	await page.getByRole("button", { name: "Create organization", exact: false }).click();
	await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
	await expect(
		page.getByLabel("Organization", { exact: true }).locator("option:checked"),
	).toHaveText("Acme");
	await page.getByRole("link", { name: "Domains", exact: false }).first().click();
	await expect(page).toHaveURL(/\/app\/domains\?org=/);
	await page.reload();
	await expect(page.getByRole("heading", { name: "Domains", exact: true })).toBeVisible();
	await expect(
		page.getByLabel("Organization", { exact: true }).locator("option:checked"),
	).toHaveText("Acme");
	await page.getByRole("link", { name: "API keys", exact: false }).click();
	await expect(page).toHaveURL(/\/app\/keys\?org=/);
	await page.goBack();
	await expect(page.getByRole("heading", { name: "Domains", exact: true })).toBeVisible();
	await page.goForward();
	await expect(page.getByRole("heading", { name: "API keys", exact: true })).toBeVisible();
	await page.goBack();
	await expect(page.getByRole("heading", { name: "Domains", exact: true })).toBeVisible();
	let requireReauthentication = true;
	await page.route("**/api/orgs/*/domains", async (route) => {
		if (route.request().method() !== "POST" || !requireReauthentication) {
			await route.continue();
			return;
		}

		requireReauthentication = false;
		await route.fulfill({
			status: 403,
			json: { name: "reauthentication_required", message: "Verify your passkey" },
		});
	});
	await page.getByLabel("Domain name").fill("example.com");
	await page.getByRole("button", { name: "Add domain" }).click();
	await page.getByRole("button", { name: "Verify and continue" }).click();
	await expect(page.getByRole("heading", { name: "example.com" })).toBeVisible();
	await page.unroute("**/api/orgs/*/domains");
	await page.getByRole("link", { name: "API keys", exact: false }).click();
	await page.getByLabel("Key name").fill("Browser-tested app");
	await page.getByRole("button", { name: "Create key" }).click();
	const token = await page.getByLabel("New API key").inputValue();
	await page.getByRole("button", { name: "Dismiss API key" }).click();
	const sdk = new Resend(token, { baseUrl: "http://localhost:5174" });
	const result = await sdk.emails.send(
		{
			from: "hello@example.com",
			to: "test@example.net",
			subject: "SDK browser lifecycle",
			html: '<h1>Hello from cdfsend</h1><img src="https://external.example/pixel"><script>parent.postMessage("unsafe", "*")</script>',
			text: "Hello from cdfsend",
		},
		{ idempotencyKey: "e2e-message" },
	);
	expect(result.error).toBeNull();
	await page.getByRole("link", { name: "Emails", exact: false }).first().click();
	await expect(
		page.getByRole("button", { name: "SDK browser lifecycle", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "SDK browser lifecycle", exact: true }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(page.locator("iframe")).toHaveAttribute("sandbox", "");
	await expect(
		page.frameLocator("iframe").getByRole("heading", { name: "Hello from cdfsend" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Close email details" }).click();

	// One account can join multiple orgs, and an exact domain may be registered in each.
	await page.getByRole("link", { name: "Instance", exact: false }).click();
	await page.getByLabel("Organization name", { exact: true }).fill("Beta");
	await page.getByLabel("Owner's account handle").fill("owner@example.com");
	await page.getByRole("button", { name: "Create organization", exact: false }).click();
	await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
	await expect(page.getByLabel("Organization", { exact: true }).locator("option")).toHaveText([
		"Acme",
		"Beta",
		"Default",
	]);
	await page.getByLabel("Organization", { exact: true }).selectOption({ label: "Beta" });
	await expect(page.getByText("No emails yet.")).toBeVisible();
	await page.getByRole("link", { name: "Domains", exact: false }).first().click();
	await page.getByLabel("Domain name").fill("example.com");
	await page.getByRole("button", { name: "Add domain" }).click();
	await expect(page.getByRole("heading", { name: "example.com" })).toBeVisible();

	await page.getByRole("link", { name: "Members", exact: false }).click();
	await page.getByLabel("Account handle", { exact: true }).fill("member@example.com");
	await page.getByRole("button", { name: "Create invitation" }).click();
	const invitation = await page.getByLabel("Invitation link", { exact: true }).inputValue();
	const memberContext = await browser.newContext();
	const memberPage = await memberContext.newPage();
	await passkey(memberContext, memberPage);
	await memberPage.goto(invitation);
	await expect(memberPage).not.toHaveURL(/#invite=/);
	await memberPage.getByRole("button", { name: "Join with a passkey" }).click();
	await expect(memberPage.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
	await memberPage.getByRole("link", { name: "Domains", exact: false }).first().click();
	await expect(memberPage.getByRole("heading", { name: "example.com" })).toBeVisible();
	await expect(memberPage.getByRole("button", { name: "Add domain" })).toHaveCount(0);
	await memberPage.goto("/app/instance");
	await expect(memberPage.getByRole("heading", { name: "Instance access required" })).toBeVisible();
	await memberPage.getByRole("button", { name: "Sign out", exact: true }).click();
	await memberPage.getByLabel("Account handle").fill("member@example.com");
	await memberPage.getByRole("button", { name: "Continue with a passkey" }).click();
	await expect(memberPage.getByLabel("Organization", { exact: true })).toContainText("Beta");
	const oldSession = (await memberContext.cookies()).find(
		(cookie) => cookie.name === "__Host-cdfsend",
	);
	await memberContext.close();

	await page.getByRole("link", { name: "Instance", exact: false }).click();
	await page
		.getByRole("combobox", { name: "Account", exact: true })
		.selectOption({ label: "member@example.com" });
	await page.getByRole("button", { name: "Create recovery link" }).click();
	const recoveryLink = await page.getByLabel("Instance invitation link").inputValue();
	const recoveryContext = await browser.newContext();
	const recoveryPage = await recoveryContext.newPage();
	await passkey(recoveryContext, recoveryPage);
	await recoveryPage.goto(recoveryLink);
	await recoveryPage.getByRole("button", { name: "Restore with a passkey" }).click();
	await expect(recoveryPage.getByLabel("Organization", { exact: true })).toContainText("Beta");
	const invalidated = await page.request.get("/api/me", {
		headers: { Cookie: `__Host-cdfsend=${oldSession?.value}` },
	});
	expect(invalidated.status()).toBe(401);
	await recoveryContext.close();

	await page.goto("/app/missing");
	await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
	await page.getByRole("link", { name: "Security", exact: false }).click();
	await page.getByLabel("Passkey label").fill("Backup key");
	// A second authenticator is needed because resident authenticators reject duplicate enrollment.
	await ownerAuthenticator.cdp.send("WebAuthn.removeVirtualAuthenticator", {
		authenticatorId: ownerAuthenticator.authenticatorId,
	});
	await passkey(context, page);
	await page.getByRole("button", { name: "Add passkey" }).click();
	await expect(page.getByRole("heading", { name: "Backup key" })).toBeVisible();
	await page.screenshot({ path: "test-results/security-desktop.png", fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	await page.screenshot({ path: "test-results/security-mobile.png", fullPage: true });
});
