# API compatibility

Use the unmodified `resend` npm package with a cdfsend API key and `baseUrl` pointing
to the Worker root. Compatibility is tested against **resend 6.32.1**. New SDK
versions may add unsupported methods. Alternatively, set `RESEND_BASE_URL` and
`RESEND_API_KEY` in server-side clients that support those environment variables.

## Supported methods

| SDK method                        | HTTP route                        | Required permission       |
| --------------------------------- | --------------------------------- | ------------------------- |
| `emails.send` / `emails.create`   | `POST /emails`                    | Sending or management key |
| `batch.send` / `batch.create`     | `POST /emails/batch`              | Sending or management key |
| `emails.get`                      | `GET /emails/:id`                 | Management key            |
| `emails.list`                     | `GET /emails`                     | Management key            |
| `domains.create`                  | `POST /domains`                   | Management key            |
| `domains.list` / `domains.get`    | `GET /domains[/:id]`              | Management key            |
| `domains.remove`                  | `DELETE /domains/:id`             | Management key            |
| `apiKeys.create` / `apiKeys.list` | `POST /api-keys`, `GET /api-keys` | Management key            |
| `apiKeys.remove`                  | `DELETE /api-keys/:id`            | Management key            |

All calls authenticate with `Authorization: Bearer cdf_...`. SDK methods receive
their normal `{ data, error, headers }` wrapper from the SDK; cdfsend itself returns
the API payload. Errors contain `{ name, message, statusCode }`. Unsupported
methods return 501; unsupported or malformed input fields return 422. JSON is
required and all JSON responses use `Cache-Control: no-store`.

List endpoints use `limit` (1–100, default 20), `after`, or `before`, and return
`{ object: "list", has_more, data }`. Cursors must belong to the same organization.
Expired history is excluded. Dashboard email lists additionally accept `status`.

## Messages

The SDK translates `replyTo`, `contentType`, and `contentId` into the HTTP
`reply_to`, `content_type`, and `content_id` fields. Names such as
`Acme <hello@example.com>` are translated to Cloudflare address objects. At least
one nonempty HTML/text body is required. React email components are rendered by
the SDK before transmission; install the SDK's optional renderer in your client.

Attachment `content` accepts base64 or Buffer JSON; `filename` is required.
Inline attachments use `contentId`. MIME type is inferred from common filename
extensions, falling back to `application/octet-stream`, or can be supplied.
Attachment URL/path fetching is unsupported. Batches do not accept attachments.
Attachment metadata is retained, but attachment bytes are not stored.

Cloudflare's current limits apply: 50 combined TO/CC/BCC recipients, 32 attachments,
998-character subject, 5 MiB total message, and platform header restrictions.
cdfsend applies a conservative size estimate before sending; Cloudflare is the
final authority. Request bodies are capped at 16 MiB. Only a single reply-to is
supported. Tags are stored as history metadata, not sent as provider tracking data.

## History storage

All persistent application data is stored in Turso. Email HTML/text bodies use
ordered JSON chunks, committed atomically with email metadata before sending.
`emails.get` reconstructs the original body; `emails.list` returns metadata only.
History access expires after 30 days, and scheduled cleanup deletes metadata and
body chunks together. A missing/incomplete body returns 503, never partial content.

## Domains and keys

Domain creation accepts **only `{ name }`**. Names are canonicalized to lowercase;
use ASCII/punycode names. Domains are unique per organization, never per instance.
Subdomains must be registered explicitly. Domain IDs are organization-local.
Deletion revokes the organization's keys scoped to that domain, but does not
delete email history or change Cloudflare configuration.

Domain responses use `status: "not_started"` and empty DNS `records`: cdfsend does
not inspect provider verification. `cdfsend.readiness` is `"unknown"`. The legacy
SDK `region` field is a compatibility placeholder, not a hosting-location claim.
Cloudflare is the sole readiness authority; `domains.verify` and configuration
updates are not implemented. Tracking, TLS, return-path, and receiving options
are rejected, not silently ignored.

Key creation accepts `{ name, permission?, domain_id? }`. SDK-compatible default
permission is `full_access`; the dashboard defaults to `sending_access`.
Management keys cannot be domain-scoped. Sending keys cannot retrieve content or
manage resources, even when they are organization-wide. Lists reveal identifying
metadata, never key hashes or complete tokens. Revoke/create instead of updating
keys. Management keys cannot administer dashboard accounts or organization roles.

## Acceptance and failures

Single sends return `{ id }` only after Cloudflare accepts the message. cdfsend's
UUID is independent from Cloudflare's `message_id`. Acceptance is **not delivery**.
History reports known acceptance as `last_event: "sent"`; provider rejection as
`"failed"`. Processing/uncertain attempts use `"queued"` for SDK compatibility;
the authoritative local state is `cdfsend.status`. No delivery, bounce, opening,
or click events are fabricated.

Batches contain 1–100 messages and support SDK `batchValidation: "strict"` (default)
or `"permissive"`. Strict mode validates every item before sending any. Permissive
mode skips invalid items and returns indexed validation errors. Success returns
`{ data: [{ id }] }`, plus `errors` in permissive mode.

The binding sends each accepted item individually, with concurrency capped at
four. Provider failures can yield partial success. In that case, the HTTP error
includes `cdfsend.results`, with original indexes, email IDs, and per-item
`sent`/`failed`/`uncertain` outcomes. Inspect history and do not resend the whole
batch with a fresh key. Known successes are never rolled back.

## Idempotency and limits

Send calls accept `Idempotency-Key`, set by SDK `idempotencyKey`. Keys last 24 hours
and are scoped to organization, credential, and endpoint. Same payloads replay
the saved response (including provider failures); changed payloads return 409.
Concurrent or interrupted requests return 409 until their outcomes are complete
or the 24-hour key expires. A replay adds `X-Cdfsend-Replay: true`.

No automatic retries occur. Turso and Cloudflare sending cannot participate in one
atomic transaction: a process can stop after provider acceptance but before
persisting the result. Such attempts remain uncertain. Investigate Cloudflare
logs; never assume a new idempotency key is safe. Without an idempotency key,
repeated calls are separate sends. After 24 hours the replay protection expires.

Defaults are 60 sends/key/minute and 300 sends/org/minute, including each accepted
batch item. Management calls have a separate per-key counter using the key limit.
Authentication defaults to 30 calls/client-IP/minute. Configure Wrangler vars;
Cloudflare additionally applies account-wide limits. 429 responses include
`Retry-After: 60` (the local fixed-window delay). Quotas are charged before sending,
including provider failures. Replays do not incur another send quota.

## Dashboard interfaces

Same-origin `/api/*` JSON endpoints use HttpOnly sessions rather than API keys.
`/api/auth/*` implements passkey ceremonies; `/api/me` returns memberships;
`/api/orgs/:orgId/*` manages organization resources; `/api/instance/*` is reserved
for the instance owner. Mutation requests must include an `Origin` from the backend allowlist that
exactly matches the request URL origin. The browser supplies this header
automatically; origin and passkey RP ID require no environment variables.
API keys cannot authenticate dashboard routes and sessions cannot authenticate
the public SDK routes.

## Backend routing

`worker/app.js` composes the Hono application. SDK routes are registered in
`worker/routes/sdk.js`; dashboard feature routers live in
`worker/routes/dashboard/`. Email, domain, and key HTTP handlers are shared across
both interfaces, while `worker/services/` owns business logic and validation.

Reserved SDK namespaces authenticate before returning unsupported-feature errors;
unknown dashboard endpoints return JSON errors, never the SPA. Other paths fall
back to the dashboard asset binding. Global middleware applies the existing
security headers to assets, API responses, and errors. The refactor requires no
client URL, payload, credential, or schema changes.
