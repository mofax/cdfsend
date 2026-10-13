// @ts-check
import { describe, it, expect } from "vitest";
import { requireOrigin } from "../../worker/security/origin.js";

describe("dashboard origin policy", () => {
	it.each(["http://localhost:5173", "http://localhost:5174"])(
		"derives passkey identity from the allowed same-origin browser location %s",
		(origin) => {
			const request = new Request(`${origin}/api/auth/register/options`, {
				headers: { Origin: origin },
			});
			expect(requireOrigin(request)).toEqual({ origin, rpId: "localhost" });
		},
	);
	it.each([
		"",
		"null",
		"not a URL",
		"https://attacker.test",
		"http://localhost:5175",
		"https://localhost:5173",
		"http://localhost:5173/",
		"http://localhost:5173/path",
		"http://localhost.attacker.test:5173",
	])("rejects unlisted or malformed origins: %s", (origin) => {
		const request = new Request("http://localhost:5173/api/auth/register/options", {
			headers: { Origin: origin },
		});
		expect(() => requireOrigin(request)).toThrow("Origin not allowed");
	});
	it("rejects a missing Origin instead of inferring trust from the request URL", () => {
		const request = new Request("http://localhost:5173/api/auth/register/options");
		expect(() => requireOrigin(request)).toThrow("Origin not allowed");
	});
	it("rejects another allowed origin when it does not match the request URL", () => {
		const request = new Request("http://localhost:5173/api/auth/register/options", {
			headers: { Origin: "http://localhost:5174" },
		});
		expect(() => requireOrigin(request)).toThrow("Origin not allowed");
	});
	it("rejects cross-site requests and ignores spoofed forwarding headers", () => {
		const request = new Request("http://localhost:5173/api/auth/register/options", {
			headers: {
				Origin: "http://localhost:5173",
				"Sec-Fetch-Site": "cross-site",
				"X-Forwarded-Host": "localhost:5173",
			},
		});
		expect(() => requireOrigin(request)).toThrow("Origin not allowed");
		const forwarded = new Request("https://attacker.test/api/auth/register/options", {
			headers: {
				Origin: "http://localhost:5173",
				"X-Forwarded-Host": "localhost:5173",
				"X-Forwarded-Proto": "http",
			},
		});
		expect(() => requireOrigin(forwarded)).toThrow("Origin not allowed");
	});
});
