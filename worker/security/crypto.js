// @ts-check

/** @param {string} [prefix] */
export function randomToken(prefix = "") {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return (
		prefix +
		btoa(String.fromCharCode(...bytes))
			.replaceAll("+", "-")
			.replaceAll("/", "_")
			.replaceAll("=", "")
	);
}

/** @param {string} value */
export async function hash(value) {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Deterministic JSON fingerprint, independent of object-property order. @param {unknown} value @returns {string} */
export function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

	if (value && typeof value === "object") {
		const record = /** @type {Record<string, unknown>} */ (value);
		const entries = Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
		return `{${entries.join(",")}}`;
	}

	return JSON.stringify(value) ?? "null";
}
