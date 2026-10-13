# Deployment

## Provision

Use a Cloudflare account with Workers and Email Sending enabled, plus a Turso
account. Local development requires none of these remote resources. Run provisioning commands
only when intentionally deploying:

```sh
bun install --frozen-lockfile
bun run wrangler login
turso group create cdfsend --location aws-eu-west-1 --wait
turso db create cdfsend-production --group cdfsend --wait
umask 077
printf 'TURSO_AUTH_TOKEN=' > .env.turso.secrets
turso db tokens create cdfsend-production >> .env.turso.secrets
cp .env.turso.secrets .env.turso
printf 'TURSO_DATABASE_URL=%s\n' "$(turso db show cdfsend-production --url)" >> .env.turso
```

These commands create two ignored, private files: `.env.turso` contains the URL
and token for remote migrations; `.env.turso.secrets` contains only the token for
upload with the Worker version. Neither is used for local development or loaded
into the browser. Do not commit them. The token is database-scoped and read/write;
do not use a group-wide token.

Update `wrangler.jsonc`:

- Set `vars.TURSO_DATABASE_URL` to the returned database URL. There is no D1 binding.
- Keep `TURSO_AUTH_TOKEN` declared under `secrets.required`.
- Add your exact HTTPS dashboard origin to the backend allowlist in
  `worker/security/origin.js`, without a path or trailing slash. No origin or
  passkey-ID environment variables are needed. The browser derives both values
  from its current location; the backend enforces the allowlist and same-origin
  requests. Localhost ports 5173 and 5174 are included for development.
- Optionally configure a Worker custom domain or use the worker's `workers.dev`
  hostname. The API and dashboard share an origin.
- Keep the native `send_email` binding named `EMAIL`. No runtime Cloudflare API
  token is needed. Do not configure fixed sender restrictions that conflict with
  the domains you want to use.
- Configure the scheduled cleanup frequency in `triggers.crons`. History access
  expires after 30 days; each cleanup invocation deletes up to 500 expired emails
  and their body chunks atomically. The checked-in schedule runs daily.

Use separate Wrangler configs/accounts/resources for staging and production.
Never point automated tests at remote bindings. Cloudflare sending must already
be configured for every domain you want to send from. Enter those domains in
cdfsend without any onboarding or DNS changes inside the application.

## Storage design

Turso is the only persistent application store. Email metadata stays in `emails`;
HTML/text bodies are serialized as JSON in ordered `email_body_chunks` rows. Each
chunk holds at most 256 Ki UTF-16 code units (768 KiB of UTF-8), with surrogate
pairs kept intact. The existing bounded chunk format and 5 MiB message limit
are preserved.
Metadata, chunks, and the authorization revision guard commit in one atomic Turso write batch
before provider sending. Foreign-key cascading removes chunks with their email.
Attachment bytes are not retained.

The initial schema targets fresh databases only. Existing databases using an
earlier schema are not supported; there is no data migration or compatibility
layer. Do not apply this schema to an existing deployment expecting an upgrade.

## Publish and bootstrap

```sh
bun run types:worker
bun run db:migrate:remote
bun run deploy --secrets-file .env.turso.secrets
```

The deploy command uploads the credentials with the new Worker version. Remote
migrations alone do not deploy the Worker. `wrangler secret put` also deploys a
version immediately, so use the combined deploy command above for the cutover.
No existing D1 database is exported, modified, or deleted. This starts a fresh
instance: existing users, passkeys, keys, and histories are not transferred.

Open the exact configured origin. The first successful passkey registration claims
instance ownership, matching compassword; no bootstrap secret is required. Setup also
creates a default organization owned by that account.
Add a backup passkey from Security. Create organizations and invite owners from
Instance. Using the operator's own handle grants membership immediately, without an
invitation. Owners created before default-organization setup can create their first
organization this way; no account reset is required.
After setup, bootstrap is disabled and additional accounts require invitations.

Each organization's domains, keys, and histories remain separate, even when
domain names overlap. Configure Cloudflare sending independently. A local domain
registration is not proof that Cloudflare will accept it.

## Worker layout

Wrangler enters through `worker/index.js`, which constructs a request-scoped
Turso adapter for Hono's fetch handler and each scheduled cleanup invocation.
The adapter uses `@libsql/client/web`; no native SQLite module runs inside Workers.

## Local development and tests

Install the Turso CLI with its bundled `sqld` executable on `PATH`; verify with
`turso dev --version`. CI uses libSQL server 0.24.32. `bun run dev` starts a local
database and enables the configured remote email binding; it can send real mail.
`bun run dev:offline` uses the same persistent local database with simulated
email sending on localhost:5174. Neither command uses production Turso credentials.
Local database state lives in `.wrangler/turso`. The wrapper starts the server on
a loopback-only port, waits for readiness, applies migrations, and stops it on exit.
`bun run db:migrate:local` initializes or updates this database without starting Vite.
`bun run preview` uses Wrangler to serve built output against the same local
database; the explicit local URL overrides the production build configuration.

Worker, migration, and browser tests use temporary local databases and synthetic
messages. Test wrappers override remote database credentials and disable remote
Cloudflare bindings. No Turso login is required to run `bun run verify`.

## Subsequent releases

Run `bun run verify`, then apply new migrations and deploy built output. Commit
new numbered SQL migrations with dependent code; never rewrite migrations already applied to
a shared database. The migration runner records filenames in `schema_migrations`,
skips applied files, and commits each file and its record atomically.
The initial Turso revision guard serializes authorization-dependent
writes; under contention clients may receive 409 and should refresh/retry known
pre-send failures. Do not automatically retry uncertain email outcomes.

Passkeys are bound to the dashboard hostname derived from the browser location.
Changing hostnames requires new passkeys; keep the hostname stable when upgrading. Back up configuration and Turso according to your
operational requirements. Restoring old authorization/idempotency data requires
review before reopening access.

## Monitoring

Worker logs and sampled traces are enabled. Use Cloudflare's sending logs for
actual delivery, bounces, provider quotas, or uncertain outcomes. cdfsend does not
consume delivery webhooks. Do not add payload bodies or credential attributes to
traces. Local sending simulation may print messages; production application logs
are intentionally redacted.

Application logs are JSON with `event` and `level` fields. Errors use `console.log`
with `level: "error"`; filter on that field rather than console severity alone.
Expected API rejections (validation, authentication, authorization, rate limits,
and conflicts) use `console.warn`. Unhandled/API server failures, provider
rejections, history update failures, and cleanup failures emit redacted error
events. Request errors include the method and registered route pattern, never the
raw URL. Exception messages/stacks and raw provider codes are omitted.

`email_send_completed` reports aggregate sent/failed/uncertain/validation-rejected
counts once per send request (info on success, warning on partial failure).
Idempotency replays and completed retention cleanup emit info events; cleanup
also warns when stale attempts become uncertain. Successful reads and individual
successful emails do not emit application logs.

Monitor Worker errors, 429s, Turso revision conflicts, scheduled cleanup events, Turso
storage growth, and old `processing`/`uncertain` attempts. Cleanup marks attempts
older than five minutes uncertain, without retrying them. Increase cleanup
frequency/capacity if more than 500 records expire between cleanup invocations.

`GET /health` is a public liveness endpoint, not an authenticated readiness or
email-deliverability check. A staging smoke test should use a sender configured in
the staging Cloudflare account and a recipient you control; ordinary local tests
never send real mail.
