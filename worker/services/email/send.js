// @ts-check
import { ApiError, fail, json, errorResponse } from "../../lib/http.js";
import { normalizeEmail } from "./normalize.js";
import { claim, complete } from "./idempotency.js";
import { write, statement, commit } from "../../storage/db.js";
import { configuredLimit, rateLimit, requireManagement } from "../../security/access.js";
import { forEachSequential } from "../../../shared/async.js";
import { HISTORY_DAYS } from "../../../shared/schema.js";
import { bodyChunks, writeBody } from "../../storage/bodies.js";
import { log, logError } from "../../lib/log.js";

/** @typedef {ReturnType<typeof normalizeEmail> & {domainId: string}} PreparedEmail */
/** @typedef {{id: string, prepared: PreparedEmail}} Attempt */
/** @typedef {{index: number, id: string, status: string, error?: {name: string,message: string,statusCode: number}}} SendOutcome */

/** @param {import("../../types.js").AppBindings} env @param {import("../../types.js").Actor} actor @param {unknown} raw @returns {Promise<PreparedEmail>} */
export async function prepareEmail(env, actor, raw) {
	const normalized = normalizeEmail(raw);
	const domain = await statement(
		env,
		"SELECT id FROM domains WHERE org_id=? AND name=?",
		actor.orgId,
		normalized.domain,
	).first("id");

	if (typeof domain !== "string") {
		fail(403, "validation_error", "Register the sender's domain in this organization first");
	}

	if (actor.domainId && actor.domainId !== domain) {
		fail(403, "restricted_api_key", "API key cannot send from this domain");
	}

	return Object.assign(normalized, { domainId: domain });
}

/** @param {import("../../types.js").AppBindings} env @param {import("../../types.js").Actor} actor @param {number} count */
async function chargeSending(env, actor, count) {
	await rateLimit(env, `key:${actor.credentialId}`, configuredLimit(env.KEY_RATE_LIMIT, 60), count);
	await rateLimit(env, `org:${actor.orgId}`, configuredLimit(env.ORG_RATE_LIMIT, 300), count);
}

/** @param {import("../../types.js").Transaction} tx @param {import("../../types.js").Actor} actor @param {PreparedEmail} prepared */
function persistAttempt(tx, actor, prepared) {
	const id = crypto.randomUUID();
	const body = { html: prepared.builder.html ?? null, text: prepared.builder.text ?? null };
	const chunks = bodyChunks(body);
	const retentionDuration = HISTORY_DAYS * 86400_000;
	const now = Date.now();
	const expiresAt = now + retentionDuration;
	write(
		tx,
		"INSERT INTO emails(id,org_id,domain_id,credential_id,metadata,status,body_chunks,created_at,expires_at) VALUES(?,?,?,?,?,'processing',?,?,?)",
		id,
		actor.orgId,
		prepared.domainId,
		actor.credentialId,
		JSON.stringify(prepared.metadata),
		chunks.length,
		now,
		expiresAt,
	);
	writeBody(tx, id, chunks);
	return { id, prepared };
}

/** @param {unknown} error */
function providerCode(error) {
	if (!error || typeof error !== "object") return "E_UNKNOWN";
	if (!("code" in error)) return "E_UNKNOWN";
	return String(error.code);
}

/** @param {import("../../types.js").AppBindings} env @param {unknown} error */
function providerError(env, error) {
	void env;
	const code = providerCode(error);

	if (code.includes("LIMIT_EXCEEDED")) {
		return new ApiError(429, "rate_limit_exceeded", "Cloudflare sending limit exceeded");
	}

	if (code.startsWith("E_HEADER") || code === "E_VALIDATION_ERROR") {
		return new ApiError(422, "validation_error", "Cloudflare rejected message fields or headers", {
			provider_code: code,
		});
	}

	if (code.includes("SENDER") || code.includes("RECIPIENT")) {
		return new ApiError(
			403,
			"validation_error",
			"Cloudflare rejected the sender domain or recipient",
			{ provider_code: code },
		);
	}

	if (code === "E_CONTENT_TOO_LARGE") {
		return new ApiError(413, "validation_error", "Cloudflare rejected the message size");
	}

	return new ApiError(502, "application_error", "Cloudflare email sending failed", {
		provider_code: code,
	});
}

/** @param {import("../../types.js").AppBindings} env @param {Attempt} attempt @param {number} index @returns {Promise<SendOutcome>} */
async function dispatch(env, attempt, index) {
	let result;

	try {
		result = await env.EMAIL.send(attempt.prepared.builder);
	} catch (error) {
		return rejectedAttempt(env, attempt.id, index, error);
	}

	try {
		await statement(
			env,
			"UPDATE emails SET status='sent',message_id=? WHERE id=?",
			result.messageId,
			attempt.id,
		).run();
		return { index, id: attempt.id, status: "sent" };
	} catch (error) {
		// Cloudflare accepted it, but history could not be committed. Never resend.
		logError("email_history_update_failed", error, {
			email_id: attempt.id,
			provider_accepted: true,
			status: "uncertain",
		});
		return {
			index,
			id: attempt.id,
			status: "uncertain",
			error: {
				name: "application_error",
				message: "Cloudflare accepted the email but persistence failed; do not resend",
				statusCode: 502,
			},
		};
	}
}

/** @param {import("../../types.js").AppBindings} env @param {string} id @param {number} index @param {unknown} error @returns {Promise<SendOutcome>} */
async function rejectedAttempt(env, id, index, error) {
	const rejection = providerError(env, error);
	const reportedCode = rejection.details.provider_code ?? "";
	const code = String(reportedCode);
	const uncertain = code === "E_UNKNOWN" || code === "E_INTERNAL_SERVER_ERROR";
	const status = uncertain ? "uncertain" : "failed";
	logError("email_provider_failed", error, {
		email_id: id,
		status,
		error_code: rejection.name,
		status_code: rejection.statusCode,
	});
	const storedError = {
		name: rejection.name,
		message: rejection.message,
		statusCode: rejection.statusCode,
	};

	try {
		await statement(
			env,
			"UPDATE emails SET status=?,error=? WHERE id=?",
			status,
			JSON.stringify(storedError),
			id,
		).run();
	} catch (persistenceError) {
		logError("email_history_update_failed", persistenceError, {
			email_id: id,
			provider_accepted: false,
			status: "uncertain",
		});
		return { index, id, status: "uncertain", error: storedError };
	}

	return { index, id, status, error: storedError };
}

/** @template T,R @param {T[]} items @param {(item:T,index:number)=>Promise<R>} execute @returns {Promise<R[]>} */
async function pool(items, execute) {
	const results = /** @type {R[]} */ ([]);
	let cursor = 0;

	/** @returns {Promise<void>} */
	async function consume() {
		if (cursor >= items.length) return;
		const index = cursor++;
		results[index] = await execute(items[index], index);
		return consume();
	}

	await Promise.all(Array.from({ length: Math.min(4, items.length) }, consume));
	return results;
}

/** @param {Request} request @param {import("../../types.js").Transaction} tx @param {import("../../types.js").Actor} actor @param {unknown} raw @param {boolean} [batch] */
export async function send(request, tx, actor, raw, batch = false) {
	if (actor.userId) requireManagement(actor);
	const validation = request.headers.get("x-batch-validation") ?? "strict";

	if (!["strict", "permissive"].includes(validation)) {
		fail(422, "validation_error", "Unknown batch validation mode");
	}

	const inputs = batch ? batchInputs(raw) : [raw];
	const validated = await validateInputs(tx.env, actor, inputs, batch, validation);
	const idempotency = await claim(request, tx.env, actor, raw);
	if (idempotency.replay) return idempotency.replay;
	let response;

	try {
		await chargeSending(tx.env, actor, validated.valid.length);
		const outcomes = await executePrepared(tx, actor, validated.valid);
		logSendSummary(actor, outcomes, validated.errors.length);
		response = sendResponse(outcomes, validated.errors, batch, validation);
	} catch (error) {
		response = errorResponse(error, { operation: "email_send", org_id: actor.orgId, batch });
	}

	return complete(tx.env, idempotency.scope, response);
}

/** One summary per send request, not per successful message. @param {import("../../types.js").Actor} actor @param {SendOutcome[]} outcomes @param {number} rejected */
function logSendSummary(actor, outcomes, rejected) {
	const sent = outcomes.filter((outcome) => outcome.status === "sent").length;
	const failed = outcomes.filter((outcome) => outcome.status === "failed").length;
	const uncertain = outcomes.filter((outcome) => outcome.status === "uncertain").length;
	const deliveryFailures = failed + uncertain;
	const partial = deliveryFailures > 0 || rejected > 0;
	const level = partial ? "warn" : "info";
	log(level, "email_send_completed", {
		org_id: actor.orgId,
		sent,
		failed,
		uncertain,
		validation_rejected: rejected,
	});
}

/** @param {unknown} raw */
function batchInputs(raw) {
	if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) {
		fail(422, "validation_error", "Batch must contain 1–100 emails");
	}

	return /** @type {unknown[]} */ (raw);
}

/** @param {import("../../types.js").AppBindings} env @param {import("../../types.js").Actor} actor @param {unknown[]} inputs @param {boolean} batch @param {string} validation */
async function validateInputs(env, actor, inputs, batch, validation) {
	const valid = /** @type {{index:number,prepared:PreparedEmail}[]} */ ([]);
	const errors = /** @type {{index:number,message:string}[]} */ ([]);

	await forEachSequential(inputs, async (input, index) => {
		try {
			const objectInput = input && typeof input === "object";
			const hasAttachments = objectInput && "attachments" in input;

			if (batch && hasAttachments) {
				fail(422, "validation_error", "Batch attachments are unsupported");
			}

			valid.push({ index, prepared: await prepareEmail(env, actor, input) });
		} catch (error) {
			if (validation !== "permissive" || !batch || !(error instanceof ApiError)) throw error;
			errors.push({ index, message: error.message });
		}
	});
	return { valid, errors };
}

/** @param {import("../../types.js").Transaction} tx @param {import("../../types.js").Actor} actor @param {{index:number,prepared:PreparedEmail}[]} valid */
async function executePrepared(tx, actor, valid) {
	const attempts = /** @type {{index:number,attempt:Attempt}[]} */ ([]);

	// Commit metadata and bodies atomically before sending. Attachments remain in memory only.
	for (const item of valid) {
		const attempt = persistAttempt(tx, actor, item.prepared);
		attempts.push({ index: item.index, attempt });
	}

	await commit(tx);
	return pool(attempts, (item) => dispatch(tx.env, item.attempt, item.index));
}

/** @param {SendOutcome[]} outcomes @param {{index:number,message:string}[]} errors @param {boolean} batch @param {string} validation */
function sendResponse(outcomes, errors, batch, validation) {
	const failure = outcomes.find((outcome) => outcome.status !== "sent");

	if (failure) {
		const status = failure.error?.statusCode ?? 502;
		return json(
			{
				name: failure.error?.name ?? "application_error",
				message: failure.error?.message ?? "Sending failed",
				statusCode: status,
				cdfsend: { results: outcomes, validation_errors: errors },
			},
			status,
		);
	}

	if (!batch) return json({ id: outcomes[0].id });
	const body = { data: outcomes.map((outcome) => ({ id: outcome.id })) };
	if (validation === "permissive") return json(Object.assign(body, { errors }));
	return json(body);
}
