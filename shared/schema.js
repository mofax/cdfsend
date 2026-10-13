// @ts-check
import { z } from "zod";

export const MAX_REQUEST = 16 * 1024 * 1024;
export const MAX_MANAGEMENT_REQUEST = 64 * 1024;
export const MAX_MESSAGE = 5 * 1024 * 1024;
export const HISTORY_DAYS = 30;
export const id = z.uuid();
export const label = z.string().trim().min(1).max(80);
export const handle = z
	.string()
	.trim()
	.toLowerCase()
	.min(3)
	.max(80)
	.regex(/^[a-z0-9][a-z0-9._@+-]*$/);
export const role = z.enum(["owner", "admin", "member"]);
export const domainName = z
	.string()
	.trim()
	.toLowerCase()
	.max(253)
	.regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/);
const address = z
	.string()
	.min(3)
	.max(320)
	.refine((value) => !/[\r\n\0]/.test(value));
const addresses = z.union([address, z.array(address).min(1).max(50)]);
const optionalAddresses = z.union([address, z.array(address).max(50)]);
const buffer = z
	.object({ type: z.literal("Buffer"), data: z.array(z.number().int().min(0).max(255)) })
	.strict();
const attachment = z
	.object({
		content: z.union([z.string(), buffer]),
		filename: z
			.string()
			.min(1)
			.max(255)
			.refine((value) => !/[\r\n\0]/.test(value)),
		content_type: z.string().max(120).optional(),
		content_id: z.string().min(1).max(200).optional(),
	})
	.strict();
export const email = z
	.object({
		from: address,
		to: addresses,
		cc: optionalAddresses.optional(),
		bcc: optionalAddresses.optional(),
		reply_to: z.union([address, z.array(address).length(1)]).optional(),
		subject: z
			.string()
			.max(998)
			.refine((value) => !/[\r\n\0]/.test(value)),
		html: z.string().max(MAX_MESSAGE).optional(),
		text: z.string().max(MAX_MESSAGE).optional(),
		headers: z.record(z.string(), z.string()).optional(),
		tags: z
			.array(
				z
					.object({
						name: z.string().regex(/^[\w-]{1,256}$/),
						value: z.string().regex(/^[\w-]{1,256}$/),
					})
					.strict(),
			)
			.max(50)
			.optional(),
		attachments: z.array(attachment).max(32).optional(),
	})
	.strict()
	.refine((value) => {
		const content = value.html || value.text;
		return Boolean(content);
	}, "Provide html or text");
export const createDomain = z.object({ name: domainName }).strict();
export const createKey = z
	.object({
		name: label,
		permission: z.enum(["full_access", "sending_access"]).default("full_access"),
		domain_id: id.optional(),
	})
	.strict()
	.refine(
		(value) => value.permission !== "full_access" || !value.domain_id,
		"Management keys cannot be domain-scoped",
	);
export const registration = z
	.object({
		purpose: z.enum(["bootstrap", "invite", "recover", "add"]),
		handle: handle.optional(),
		token: z.string().min(16).max(256).optional(),
	})
	.strict();
export const finishPasskey = z
	.object({
		ceremonyId: id,
		credential: z.record(z.string(), z.unknown()),
		label: label.default("My passkey"),
	})
	.strict();
export const invite = z.object({ handle, role: role.default("member") }).strict();
export const organization = z.object({ name: label, handle }).strict();
export const membership = z.object({ userId: id, role }).strict();
export const empty = z.object({}).strict();

/** @typedef {z.infer<typeof email>} EmailInput */
