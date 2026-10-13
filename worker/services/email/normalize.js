// @ts-check
import { email, MAX_MESSAGE } from "../../../shared/schema.js";
import { fail, parse } from "../../lib/http.js";

const allowedHeaders = new Set([
	"in-reply-to",
	"references",
	"thread-index",
	"thread-topic",
	"list-unsubscribe",
	"list-unsubscribe-post",
	"list-id",
	"list-archive",
	"list-help",
	"list-owner",
	"list-post",
	"list-subscribe",
	"precedence",
	"auto-submitted",
	"content-language",
	"keywords",
	"comments",
	"importance",
	"priority",
	"sensitivity",
	"organization",
	"require-recipient-valid-since",
	"expires",
	"reply-by",
	"archived-at",
]);
const mimeTypes = /** @type {Record<string,string>} */ ({
	pdf: "application/pdf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	txt: "text/plain",
	csv: "text/csv",
	json: "application/json",
	zip: "application/zip",
	webp: "image/webp",
	html: "text/html",
	svg: "image/svg+xml",
});

/** @param {string} value @returns {EmailAddress} */
export function parseAddress(value) {
	const match = /^(.*?)\s*<([^<>]+)>$/.exec(value.trim());
	const emailAddress = match ? match[2].trim() : value.trim();
	const valid =
		/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z][a-zA-Z0-9-]{1,62}$/.test(
			emailAddress,
		);
	if (!valid || /[\r\n\0]/.test(value)) fail(422, "validation_error", "Invalid email address");
	const parts = emailAddress.split("@");
	const name = match ? match[1].trim().replace(/^"(.*)"$/, "$1") : "";
	return { email: `${parts[0]}@${parts[1].toLowerCase()}`, name };
}

/** @param {string|string[]|undefined} value */
function addressList(value) {
	if (value === undefined) return [];
	const values = Array.isArray(value) ? value : [value];
	return values.map(parseAddress);
}

/** @param {Record<string,string>|undefined} headers */
function validateHeaders(headers) {
	let size = 0;
	let count = 0;
	const seen = new Set();

	const providedHeaders = headers ?? {};

	for (const [name, value] of Object.entries(providedHeaders)) {
		const lower = name.toLowerCase();
		const custom = /^x-[a-z0-9_-]+$/i.test(name);

		if (!custom && !allowedHeaders.has(lower)) {
			fail(422, "validation_error", "Header not supported by Cloudflare");
		}

		if (seen.has(lower)) fail(422, "validation_error", "Duplicate header name");
		seen.add(lower);
		validateHeaderValue(name, value);
		size += new TextEncoder().encode(`${name}: ${value}\r\n`).byteLength;
		if (!custom) count++;
	}

	if (size > 16_384 || count > 20) {
		fail(422, "validation_error", "Too many or oversized custom headers");
	}
}

/** @param {string} name @param {string} value */
function validateHeaderValue(name, value) {
	if (!/^[a-z0-9_-]{1,100}$/i.test(name)) fail(422, "validation_error", "Invalid header name");
	if (!value || /[\r\n\0]/.test(value)) fail(422, "validation_error", "Invalid header value");

	if (new TextEncoder().encode(value).byteLength > 2048) {
		fail(422, "validation_error", "Header value too long");
	}
}

/** @param {import("../../../shared/schema.js").EmailInput["attachments"]} attachments @returns {EmailAttachment[]} */
function normalizeAttachments(attachments) {
	return (attachments ?? []).map((attachment) => {
		const extension = attachment.filename.split(".").pop()?.toLowerCase() ?? "";
		const type = attachment.content_type ?? mimeTypes[extension] ?? "application/octet-stream";

		if (!/^[\w.+-]+\/[\w.+-]+$/.test(type)) {
			fail(422, "validation_error", "Invalid attachment MIME type");
		}

		const content = attachmentContent(attachment.content);

		if (attachment.content_id) {
			if (/[\r\n\0<>]/.test(attachment.content_id)) {
				fail(422, "validation_error", "Invalid content ID");
			}

			return {
				filename: attachment.filename,
				type,
				content,
				disposition: "inline",
				contentId: attachment.content_id,
			};
		}

		return { filename: attachment.filename, type, content, disposition: "attachment" };
	});
}

/** @param {string|{type: "Buffer",data: number[]}} content */
function attachmentContent(content) {
	if (typeof content !== "string") {
		// Avoid spreading megabyte arrays into the argument stack.
		let binary = "";

		for (let offset = 0; offset < content.data.length; offset += 8192) {
			const chunkEnd = offset + 8192;
			binary += String.fromCharCode(...content.data.slice(offset, chunkEnd));
		}

		return btoa(binary);
	}

	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
		fail(422, "validation_error", "Attachment content must be base64");
	}

	return content;
}

/** @param {unknown} raw */
export function normalizeEmail(raw) {
	const input = parse(email, raw);
	const from = parseAddress(input.from);
	const to = addressList(input.to);
	const cc = addressList(input.cc);
	const bcc = addressList(input.bcc);
	const recipientCount = to.length + cc.length + bcc.length;

	if (recipientCount > 50) {
		fail(422, "validation_error", "Maximum 50 combined recipients");
	}

	validateHeaders(input.headers);
	const attachments = normalizeAttachments(input.attachments);
	const replyTo = addressList(input.reply_to)[0];
	/** @type {EmailMessageBuilder} */
	const builder = {
		from,
		to,
		cc,
		bcc,
		subject: input.subject,
		html: input.html,
		text: input.text,
		headers: input.headers,
		attachments,
		replyTo,
	};
	validateMessageSize(builder);
	const replyToAddresses = replyTo ? [replyTo.email] : [];
	const metadata = {
		from: input.from,
		to: to.map((recipient) => recipient.email),
		cc: cc.map((recipient) => recipient.email),
		bcc: bcc.map((recipient) => recipient.email),
		reply_to: replyToAddresses,
		subject: input.subject,
		tags: input.tags ?? [],
		scheduled_at: null,
		attachments: attachments.map((attachment) => ({
			filename: attachment.filename,
			content_type: attachment.type,
			content_id: attachment.contentId ?? null,
		})),
	};
	return { builder, metadata, domain: from.email.split("@")[1] };
}

/** @param {EmailMessageBuilder} builder */
function validateMessageSize(builder) {
	const attachmentSize = (builder.attachments ?? []).reduce(
		(sum, attachment) => sum + String(attachment.content).length + 512,
		0,
	);
	const withoutAttachments = Object.assign({}, builder, { attachments: undefined });
	const bodySize = new TextEncoder().encode(JSON.stringify(withoutAttachments)).byteLength;
	// Conservative MIME overhead; Cloudflare remains the final size authority.
	const messageSize = bodySize + attachmentSize + 2048;

	if (messageSize > MAX_MESSAGE) {
		fail(413, "validation_error", "Message exceeds Cloudflare's 5 MiB limit");
	}
}
