# Security model

## Trust boundaries

Each deployment uses one trusted Cloudflare account and a dedicated Turso database. Organizations isolate
memberships, keys, domains, email records, and Turso body access. Tenant identifiers
come from verified sessions/memberships or key hashes, never a client-supplied
organization ID on SDK calls. Unknown cross-tenant records return 404.

**Domains are not exclusive ownership claims.** Invite-only administrators may
register the same domain in any organization. cdfsend checks only the local
registration and optional sending-key scope. Cloudflare determines whether the
shared binding may send. Provider quotas and reputation are shared by the account.
Do not enable public signup without redesigning this trust model.

The Worker sees plaintext messages for delivery. This is not an end-to-end
encrypted store. Turso administrators and holders of the database token can inspect stored data;
Cloudflare account operators can access Worker secrets and logs.
Application isolation does not prevent infrastructure administrators accessing
data. Instance ownership alone does not grant dashboard access to organization
content, but the operator can issue recovery invitations for non-operator accounts.

The Worker connects to Turso over authenticated HTTPS. Store the database-scoped
read/write token as the `TURSO_AUTH_TOKEN` Worker secret, never in source or browser
code. Keep local provisioning credentials in the ignored `.env.turso` file. Local
development and automated tests override the connection with a loopback libSQL
server and an empty token; tests never use the production database.

## Credentials and sessions

Passkey verification checks signatures, challenge, origin, RP ID, user presence,
user verification, and counters through SimpleWebAuthn. Challenges expire in five
minutes and are atomically consumed before verification, even on invalid proofs.
Passkey RP IDs come from the browser hostname and are independently derived by
the backend from the validated browser `Origin`. The exact origin must be in
`worker/security/origin.js`'s allowlist and match the request URL origin. Unlisted,
missing, opaque, or cross-site origins are rejected; forwarded-host/origin headers
are not trusted. Each challenge stores its initiating origin; verification cannot
switch to another allowed origin and burns the challenge before verification.
Private passkey material is never sent to the server. First-run setup is public,
matching compassword: the first successful passkey registration atomically claims
instance ownership and creates a default organization and owner membership in the
same transaction. Abandoned or failed ceremonies do not reserve ownership.
Once setup completes, further bootstrap attempts are rejected, including ceremonies
started before the owner finished registration. Later accounts require invitations.

Random 256-bit session tokens live only in Secure/HttpOnly/SameSite=Strict
`__Host-cdfsend` cookies. Only SHA-256 hashes are stored; sessions expire in 12
hours. Dashboard mutations enforce exact Origin. Sensitive actions require
passkey authentication within five minutes. The browser prompts for verification
and resumes the rejected action after reauthentication. Each mutation owns its
submission state and retry payload; unrelated dashboard actions are not serialized.
Verification retries use the submitted payload, and leaving its page, organization,
or authenticated session discards the retry. A successful write is never replayed
because a subsequent data refresh failed. Stale session refresh responses cannot
overwrite newer refreshes or restore a signed-out session.

API keys and invitation tokens are random 256-bit values with stored SHA-256
hashes. API tokens are shown only upon creation. Invitation/recovery links use the validated request origin and
fragments and the UI removes fragments from the address bar; it does not store
tokens in LocalStorage, SessionStorage, or cookies. Links expire in 24 hours and
are consumed with the associated account/membership mutation. Invitations for
existing accounts require login and a handle match. An organization administrator
cannot reset a shared account's passkeys.

The instance owner can issue one-use recovery links for non-operator accounts.
Successful redemption replaces all passkeys, invalidates all sessions and other
recovery invitations, and preserves organization memberships. Owners should
enroll a backup passkey: there is intentionally no anonymous operator reset route.

## Authorization and concurrency

Hono middleware stores revision snapshots and verified actors in each request's
context, never in module-level state. Dashboard origin checks run before any
mutation handler. Protected dashboard and SDK routes snapshot the Turso revision
before authorization; management writes still commit with the revision guard.
SDK management middleware checks key permissions and charges its management
counter; sending handlers use their separate send quotas and idempotency path.
Dashboard sending bypasses recent-passkey checks, but retains membership and
management-role checks. No access boundary depends on static asset fallback.

Organization owners/admins manage resources; members read the dashboard only.
Only owners can assign, demote, or remove owners. An organization cannot lose its
last owner. Accounts may belong to multiple organizations. Removing a membership
does not destroy the account or memberships in other organizations.

Management keys authorize organization-local email/domain/key operations, not
dashboard identities, recovery, or memberships. Sending keys never read history
or manage resources. Revocation takes effect on subsequent authorization; sends
already authorized and in progress may finish.

Authorization-dependent writes use optimistic Turso revision checks inside atomic
batches. Concurrent changes return 409 before external sending begins, rather
than committing against stale membership/key state. There is no transaction
between Turso and the sending binding; uncertain external outcomes are retained
and are never automatically retried.

## Content and retention

Application logs/audit events do not contain tokens, invitation URLs, message
bodies, recipients, or provider exception text. Production logs use structured
events. Local Cloudflare email simulation can output synthetic email contents;
do not use private production content in local tests.

Message bodies are stored as ordered JSON chunks in Turso, separate from email
metadata. Metadata and chunks commit atomically under the authorization revision
guard before sending, so failed persistence leaves neither orphan bodies nor
partial email records. Body retrieval checks tenant authorization and retention
before reading chunks, and rejects incomplete content. Attachment bytes remain
only in request memory and provider processing. Body previews use a sandboxed,
opaque-origin iframe with CSP blocking scripts, external resources, forms, and
network access.
HTML and JSON responses are not cached. Security headers block framing of the
application and disable unneeded browser capabilities. No external fonts,
analytics scripts, or runtime CDN dependencies are loaded.

History access expires after 30 days. Scheduled cleanup deletes email records
and cascades to their Turso body chunks in the same transaction; failures roll back
and can be retried. Cleanup handles up to 500 expired emails per invocation;
monitor backlog and increase the configured schedule frequency/batch processing
for higher volumes. Audit metadata also expires after 30 days.

Deletion concerns live records, not provider delivery logs or Cloudflare backups.
Operators restoring backups must consider stale sessions, revoked credentials,
retention deadlines, and idempotency records before reopening the service.
