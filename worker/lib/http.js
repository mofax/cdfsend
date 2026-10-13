// @ts-check
import { MAX_REQUEST } from "../../shared/schema.js";
import { log, logError } from "./log.js";

export class ApiError extends Error {
	/** @param {number} statusCode @param {string} name @param {string} message @param {Record<string,unknown>} [details] */
	constructor(statusCode, name, message, details = {}) {
		super(message);
		this.statusCode = statusCode;
		this.name = name;
		this.details = details;
	}
}

/** @param {number} status @param {string} name @param {string} message @param {Record<string,unknown>} [details] @returns {never} */
export function fail(status, name, message, details) {
	throw new ApiError(status, name, message, details);
}

/** @param {unknown} body @param {number} [status] @param {HeadersInit} [headers] */
export function json(body, status = 200, headers = {}) {
	const result = Response.json(body, { status, headers });
	result.headers.set("Cache-Control", "no-store");
	return result;
}

/** @param {unknown} error @param {import("./log.js").LogFields} [context] */
export function errorResponse(error, context = {}) {
	if (error instanceof ApiError) {
		const fields = Object.assign({}, context, {
			error_code: error.name,
			status_code: error.statusCode,
		});

		if (error.statusCode >= 500) {
			logError("api_error", error, fields);
		} else {
			log("warn", "api_error", fields);
		}

		const body = Object.assign(
			{ name: error.name, message: error.message, statusCode: error.statusCode },
			error.details,
		);
		const headers = new Headers();
		if (error.statusCode === 429) headers.set("Retry-After", "60");
		return json(body, error.statusCode, headers);
	}

	logError("internal_error", error, Object.assign({}, context, { status_code: 500 }));
	return json(
		{ name: "application_error", message: "Internal server error", statusCode: 500 },
		500,
	);
}

/** @template T @param {import("zod").ZodType<T>} schema @param {unknown} value @returns {T} */
export function parse(schema, value) {
	const result = schema.safeParse(value);

	if (!result.success) {
		const message = result.error.issues
			.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
			.join("; ");
		fail(422, "validation_error", message);
	}

	return result.data;
}

/** @param {Request} request @param {number} [limit] */
export async function readJson(request, limit = MAX_REQUEST) {
	validateJsonTransport(request, limit);
	const body = await readBoundedBody(request, limit);

	try {
		return /** @type {unknown} */ (JSON.parse(new TextDecoder().decode(body)));
	} catch {
		fail(400, "validation_error", "Invalid JSON");
	}
}

/** @param {Request} request @param {number} limit */
function validateJsonTransport(request, limit) {
	if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
		fail(415, "validation_error", "application/json required");
	}

	if (Number(request.headers.get("Content-Length")) > limit) {
		fail(413, "validation_error", "Request too large");
	}

	if (!request.body) fail(400, "validation_error", "JSON body required");
}

/** @param {Request} request @param {number} limit */
async function readBoundedBody(request, limit) {
	const stream = /** @type {ReadableStream<Uint8Array>} */ (request.body);
	/** @type {Uint8Array[]} */
	const chunks = [];
	let size = 0;
	const sink = new WritableStream({
		/** @param {Uint8Array} chunk */
		write(chunk) {
			size += chunk.byteLength;
			if (size > limit) fail(413, "validation_error", "Request too large");
			chunks.push(chunk);
		},
	});
	// A sink failure cancels the source and releases the stream locks.
	await stream.pipeTo(sink);

	const body = new Uint8Array(size);
	let offset = 0;

	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return body;
}
