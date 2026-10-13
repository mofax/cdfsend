// @ts-check
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ mode, command }) => {
	const e2e = mode === "e2e";
	const port = e2e ? 5174 : 5173;
	const logLevel = e2e ? "warn" : "info";
	const storagePath = process.env.CDFSEND_TEST_STORAGE ?? ".wrangler/e2e";
	const persistState = e2e ? { path: storagePath } : true;
	return {
		// Local email simulation logs message contents at info level.
		logLevel,
		plugins: [
			cloudflare({
				remoteBindings: !e2e,
				viteEnvironment: { name: "worker" },
				config: (config) => {
					if (command !== "serve" || !process.env.CDFSEND_DATABASE_URL) return {};
					return {
						vars: Object.assign({}, config.vars, {
							TURSO_DATABASE_URL: process.env.CDFSEND_DATABASE_URL,
							TURSO_AUTH_TOKEN: "",
						}),
					};
				},
				persistState,
			}),
			svelte(),
		],
		server: { port, strictPort: true },
		preview: { port: 5173, strictPort: true },
	};
});
