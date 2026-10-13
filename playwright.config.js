// @ts-check
import { defineConfig } from "@playwright/test";

const storagePath = `.wrangler/e2e-${Date.now()}`;
export default defineConfig({
	testDir: "./tests/e2e",
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	use: {
		baseURL: "http://localhost:5174",
		channel: "chrome",
		headless: true,
		viewport: { width: 1440, height: 1000 },
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	webServer: {
		command: "node scripts/local.js e2e",
		url: "http://localhost:5174",
		reuseExistingServer: false,
		env: {
			CDFSEND_TEST_STORAGE: storagePath,
			WRANGLER_LOG_PATH: ".wrangler/logs",
		},
	},
});
