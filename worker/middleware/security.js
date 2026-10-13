// @ts-check

/** @param {Response} response */
function secure(response) {
	const next = new Response(response.body, response);
	next.headers.set("X-Content-Type-Options", "nosniff");
	next.headers.set("X-Frame-Options", "DENY");
	next.headers.set("Referrer-Policy", "no-referrer");
	next.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
	next.headers.set(
		"Content-Security-Policy",
		"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
	);

	if (next.headers.get("Content-Type")?.includes("text/html")) {
		next.headers.set("Cache-Control", "no-store");
	}

	return next;
}

/** @type {import("../types.js").AppMiddleware} */
export async function securityHeaders(c, next) {
	await next();
	c.res = secure(c.res);
}
