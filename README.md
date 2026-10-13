# cdfsend

cdfsend is a self-hosted email API and administration dashboard for Cloudflare
Workers. It sends through Cloudflare's native Email Sending binding and supports
selected methods of the unmodified Resend JavaScript SDK.

A deployment runs in one trusted Cloudflare account. Organizations keep their
memberships, domain registrations, API keys, and email histories separate; they
share the account's sending permissions and provider limits.

## What it supports

- Single and batch sends, with HTML/text bodies and attachments on single sends.
- Organization-wide or domain-scoped sending keys, plus management keys.
- Passkey sign-in, organization roles, invitations, and account recovery.
- Email history and sandboxed body previews, with access expiring after 30 days.
- 24-hour idempotency records and configurable per-key and per-organization limits.

This is a Resend-compatible subset, not a complete replacement for the Resend
service. Compatibility is tested against `resend@6.32.1`. Unsupported SDK methods
return 501; unsupported input fields are rejected. See [API compatibility](docs/API.md)
for supported routes, payloads, limits, and failure semantics.

Domain registration is organization-local: the same domain can appear in multiple
organizations. It does not configure Cloudflare, verify DNS ownership, or grant
sending permission. Cloudflare sending must already be configured for your sender
outside cdfsend.

## Local quickstart

Requirements:

- Bun **1.4.3**, as pinned in `package.json` and CI.
- Node.js **22.12 or later**, as required by the project.
- Turso CLI with its bundled `sqld` server available on `PATH` (`turso dev --version`).
- A browser and authenticator that support passkeys.

From a checkout of this repository, run:

```sh
bun install --frozen-lockfile
bun run dev:offline
```

Open **http://localhost:5174**. This mode disables remote bindings, uses a local libSQL server
and simulates email sending without a Cloudflare account. Its default
database state is stored in `.wrangler/turso`. The server starts, migrates, and stops automatically.

1. Choose an account handle and register a passkey. The first successful
   registration atomically creates the instance owner and a default organization;
   no operator or bootstrap secret is required.
2. Add a backup passkey from **Security**. After setup, new accounts require invitations.
3. In **Domains**, register a sender domain for the current organization.
4. In **Keys**, create a sending key, preferably scoped to that domain. The full
   token is shown only once; keep it in your server-side application's environment.
5. Send using the example below and inspect the result in **Emails**. Offline
   simulation does not deliver email.

For development with the configured remote email binding, use `bun run dev` and
open **http://localhost:5173**. Unlike the offline command above, this enables
remote bindings and can send real mail; it requires access to the configured
Cloudflare account. Local email simulation may print message content, so use
synthetic messages.

## Send with the Resend SDK

In your server-side client project:

```sh
bun add resend@6.32.1
```

Set `CDFSEND_API_KEY` to the sending key you created and `CDFSEND_BASE_URL` to the
Worker's root origin, such as `http://localhost:5174` for offline development or
your deployed HTTPS origin. Do not append `/api` or `/emails`.

```js
// @ts-check
import { Resend } from "resend";

const resend = new Resend(process.env.CDFSEND_API_KEY, {
	baseUrl: process.env.CDFSEND_BASE_URL,
});

const { data, error } = await resend.emails.send(
	{
		from: "Example <hello@example.com>",
		to: "recipient@example.com",
		subject: "Test message",
		text: "Hello from cdfsend.",
	},
	{ idempotencyKey: "test-message-001" },
);

if (error) throw new Error(error.message);
console.log(data?.id);
```

Replace the sender with a domain registered in the organization. For real sends,
use a sender permitted by Cloudflare and a recipient you control. Keep API keys
out of browser code.

A successful response means Cloudflare **accepted** the message, not that it was
delivered. cdfsend does not track delivery, bounces, opens, or clicks. It never
automatically retries sends. Reuse an idempotency key only for the same logical
request and payload; investigate uncertain outcomes before retrying, since a new
key can duplicate an accepted message. See [acceptance and failures](docs/API.md#acceptance-and-failures)
and [idempotency](docs/API.md#idempotency-and-limits).

## Deploy

Production requires a Cloudflare account with Workers and Email Sending
enabled, plus a Turso database. The Svelte dashboard and API are served by the same Worker and origin.

Follow the [deployment guide](docs/DEPLOYMENT.md) to provision resources and update
`wrangler.jsonc`. Replace the checked-in account and Turso URL with your own
deployment values and add your exact HTTPS dashboard origin to the backend
allowlist in `worker/security/origin.js`. Origin and passkey RP ID are derived
from the browser location, with no environment variables. Sending domains are configured separately in Cloudflare, not through the dashboard.

After provisioning and configuring resources:

```sh
bun run types:worker
bun run db:migrate:remote
# When ready to publish, upload the token with the new Worker version:
bun run deploy --secrets-file .env.turso.secrets
```

Open the configured origin and complete first-run passkey registration. The
first successful registrant becomes the instance owner. Enroll a backup passkey;
there is no anonymous owner-reset route. Keep the RP ID stable across releases.

Message history access expires after 30 days; scheduled cleanup removes expired
records and bodies atomically in Turso. The checked-in cron runs daily at 00:00 UTC;
review the schedule and cleanup capacity before production use.

## Development and checks

```sh
bun x playwright install chrome
bun run verify
```

Tests use isolated temporary libSQL databases; no Turso login or production token is needed.
The browser suite uses Google Chrome. On Linux CI, use
`bun x playwright install --with-deps chrome` to install its system dependencies.
`verify` runs type checks, formatting checks, lint, unit tests, Worker integration
tests, a production build, and end-to-end tests. Worker and browser tests disable
remote bindings; never enable remote email sending in automated tests.

| Command               | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `bun run ci:check`    | Type, formatting, and lint checks                         |
| `bun run fmt`         | Format source files                                       |
| `bun run test`        | Unit tests                                                |
| `bun run test:worker` | Worker integration and SDK compatibility tests            |
| `bun run test:e2e`    | Passkey and dashboard lifecycle tests                     |
| `bun run build`       | Build the dashboard and Worker into `dist/`               |
| `bun run preview`     | Serve the built app locally; uses the configured bindings |

The codebase uses JavaScript ES modules, `// @ts-check`, JSDoc, and plain-JavaScript
Svelte 5 with `experimental.async` enabled. Routed screens live in `src/pages/` and
load data with async `$derived(await …)` expressions. `src/lib/router.js` uses
`sv-router` to import each page directly. `App.svelte` mounts the router;
`Dashboard.svelte` composes focused session, feedback, route, and dialog components.
`PageLayout.svelte` only renders the dashboard shell. Authentication state and
mutating-action/re-authentication state live in separate `.svelte.js` modules;
there is no Svelte context or generic workspace/page-data facade. Refreshing the
session re-runs active page queries after mutations.
Organization changes recreate the page boundary so pending requests cannot display
another organization’s data. Follow [AGENTS.md](AGENTS.md), run `bun run verify` for behavioral changes,
and add new migrations rather than rewriting applied ones.

| Path                               | Contents                                                               |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `src/`                             | Svelte dashboard, routing, and browser API client                      |
| `worker/index.js`, `worker/app.js` | Worker lifecycle and Hono app composition                              |
| `worker/routes/`                   | SDK routes and shared email/domain/key HTTP handlers                   |
| `worker/routes/dashboard/`         | Dashboard auth, instance, and organization routers                     |
| `worker/middleware/`               | Security headers, origin checks, authorization, and revision snapshots |
| `worker/services/`                 | Passkeys, organizations, domains, keys, and email business logic       |
| `worker/security/`, `worker/lib/`  | Authorization/crypto primitives and HTTP/pagination utilities          |
| `worker/storage/`                  | Turso persistence and retention cleanup                                |
| `shared/`                          | Shared validation schemas and utilities                                |
| `migrations/`                      | Turso schema migrations                                                |
| `tests/`                           | Unit, Worker integration, and browser tests                            |

The Hono app composes explicit method/path routes and request-scoped middleware.
Business services remain independent of Hono; shared resource handlers serve both
SDK and dashboard routes. `worker/index.js` exports Hono's fetch handler alongside
the scheduled retention handler.

## Documentation and support

- [API compatibility](docs/API.md): SDK methods, payloads, permissions, and limits.
- [Deployment](docs/DEPLOYMENT.md): provisioning, releases, and monitoring.
- [Security model](docs/SECURITY.md): trust boundaries, credentials, recovery, and retention.

For bugs or feature requests, open an issue in this repository with reproduction
steps and relevant version information. Do not include API keys, invitation
tokens, credentials, recipients, or private message content in reports or logs.

## License

[MIT](LICENSE).
