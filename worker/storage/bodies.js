// @ts-check
import { fail } from "../lib/http.js";
import { statement, write } from "./db.js";

// Keep bounded rows: at most 768 KiB of UTF-8 per chunk.
const CHUNK_LENGTH = 256 * 1024;

/** @param {{html: string|null, text: string|null}} body */
export function bodyChunks(body) {
	const serialized = JSON.stringify(body);
	const chunks = /** @type {string[]} */ ([]);
	let offset = 0;

	while (offset < serialized.length) {
		const chunkEnd = offset + CHUNK_LENGTH;
		let end = Math.min(chunkEnd, serialized.length);
		const lastIndex = end - 1;
		const last = serialized.charCodeAt(lastIndex);
		// Keep surrogate pairs together so UTF-8 conversion is lossless.
		if (last >= 0xd800 && last <= 0xdbff) end--;
		chunks.push(serialized.slice(offset, end));
		offset = end;
	}

	return chunks;
}

/** @param {import("../types.js").Transaction} tx @param {string} emailId @param {string[]} chunks */
export function writeBody(tx, emailId, chunks) {
	chunks.forEach((content, position) => {
		write(
			tx,
			"INSERT INTO email_body_chunks(email_id,position,content) VALUES(?,?,?)",
			emailId,
			position,
			content,
		);
	});
}

/** Called only after authorizing the email's organization and retention window. @param {import("../types.js").AppBindings} env @param {string} emailId @param {number} expectedChunks */
export async function readBody(env, emailId, expectedChunks) {
	const result = await statement(
		env,
		"SELECT position,content FROM email_body_chunks WHERE email_id=? ORDER BY position",
		emailId,
	).all();
	const chunks = result.results;
	const incomplete = chunks.length !== expectedChunks;
	const unordered = chunks.some((chunk, position) => chunk.position !== position);

	if (incomplete || unordered) {
		fail(503, "application_error", "Email body temporarily unavailable");
	}

	return JSON.parse(chunks.map((chunk) => chunk.content).join(""));
}
