// @ts-check

/** @typedef {Record<string, string|number|boolean|null|undefined>} LogFields */

/** Fields must be safe metadata: never pass requests, credentials, message content, or exception text. @param {"error"|"warn"|"info"} level @param {string} event @param {LogFields} [fields] */
export function log(level, event, fields = {}) {
	const entry = JSON.stringify(Object.assign({}, fields, { level, event }));

	if (level === "warn") {
		console.warn(entry);
	} else if (level === "info") {
		console.info(entry);
	} else {
		// Keep errors on console.log as requested; severity is explicit in the JSON.
		console.log(entry);
	}
}

/** Do not serialize arbitrary errors: their messages, names, stacks, and codes can contain private data. @param {string} event @param {unknown} error @param {LogFields} [fields] */
export function logError(event, error, fields = {}) {
	const errorType = errorTypeOf(error);
	log("error", event, Object.assign({}, fields, { error_type: errorType }));
}

/** @param {unknown} error */
function errorTypeOf(error) {
	if (error instanceof TypeError) return "TypeError";
	if (error instanceof SyntaxError) return "SyntaxError";
	if (error instanceof RangeError) return "RangeError";
	if (error instanceof Error) return "Error";
	return "non_error";
}
