// @ts-check
import { afterEach, describe, expect, it, vi } from "vitest";
import { logError } from "../../worker/lib/log.js";
import { ApiError, errorResponse } from "../../worker/lib/http.js";

afterEach(() => vi.restoreAllMocks());

describe("redacted backend logging", () => {
	it.each([
		new TypeError("private content"),
		new SyntaxError("private content"),
		new RangeError("private content"),
		Object.assign(new Error("private content"), { name: "private name", code: "private code" }),
		{ message: "private content", token: "secret" },
		"private content",
		null,
	])("does not serialize exception text or arbitrary properties", (error) => {
		const output = vi.spyOn(console, "log").mockImplementation(() => {});
		logError("operation_failed", error, { status_code: 500 });
		expect(output).toHaveBeenCalledOnce();
		const entry = JSON.parse(output.mock.calls[0][0]);
		expect(entry).toMatchObject({ level: "error", event: "operation_failed", status_code: 500 });
		expect(output.mock.calls[0][0]).not.toMatch(/private|secret|message|stack|token/);
	});
	it("logs unexpected failures once without exposing them in the response", async () => {
		const output = vi.spyOn(console, "log").mockImplementation(() => {});
		const response = errorResponse(new TypeError("private details"), {
			method: "POST",
			route: "/emails",
		});
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			name: "application_error",
			message: "Internal server error",
			statusCode: 500,
		});
		expect(output).toHaveBeenCalledOnce();
		expect(JSON.parse(output.mock.calls[0][0])).toEqual({
			level: "error",
			event: "internal_error",
			error_type: "TypeError",
			status_code: 500,
			method: "POST",
			route: "/emails",
		});
	});
	it("warns on expected API failures without logging validation messages or details", async () => {
		const output = vi.spyOn(console, "warn").mockImplementation(() => {});
		const errors = vi.spyOn(console, "log").mockImplementation(() => {});
		const response = errorResponse(
			new ApiError(429, "rate_limit_exceeded", "private text", {
				private_detail: "secret",
			}),
		);
		expect(response.status).toBe(429);
		expect(response.headers.get("Retry-After")).toBe("60");
		expect(JSON.parse(output.mock.calls[0][0])).toEqual({
			level: "warn",
			event: "api_error",
			error_code: "rate_limit_exceeded",
			status_code: 429,
		});
		expect(errors).not.toHaveBeenCalled();
	});
	it("logs server-side API failures at error level", () => {
		const output = vi.spyOn(console, "log").mockImplementation(() => {});
		errorResponse(new ApiError(503, "application_error", "private text"));
		expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
			level: "error",
			event: "api_error",
			error_code: "application_error",
			status_code: 503,
		});
	});
});
