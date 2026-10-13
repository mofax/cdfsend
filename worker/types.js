// @ts-check
/** @typedef {Env & {DB: import("./storage/turso.js").Database}} AppBindings */
/** @typedef {{id: string, handle: string, is_operator: number, created_at: number}} User */
/** @typedef {{id: string, name: string, created_at: number, role?: "owner"|"admin"|"member"}} Organization */
/** @typedef {{hash: string, user_id: string, auth_at: number, expires_at: number}} Session */
/** @typedef {{id: string, org_id: string, name: string, created_at: number}} Domain */
/** @typedef {{id: string, org_id: string, name: string, hash: string, prefix: string, permission: "full_access"|"sending_access", domain_id: string|null, created_at: number}} ApiKey */
/** @typedef {{id: string, org_id: string, domain_id: string, credential_id: string, metadata: string, status: "processing"|"sent"|"failed"|"uncertain", message_id: string|null, error: string|null, body_chunks: number, created_at: number, expires_at: number}} EmailRow */
/** @typedef {{id: string, token_hash: string, handle: string, org_id: string|null, role: "owner"|"admin"|"member", purpose: string, user_id: string|null, expires_at: number, created_at: number}} Invitation */
/** @typedef {{id: string, challenge: string, purpose: string, user_id: string|null, invitation_id: string|null, handle: string|null, session_hash: string|null, origin: string, expires_at: number}} Ceremony */
/** @typedef {{id: string, user_id: string, data: string, label: string, created_at: number}} Credential */
/** @typedef {{scope: string, fingerprint: string, state: string, response: string|null, status_code: number|null, created_at: number, expires_at: number}} Idempotency */
/** @typedef {{orgId: string, userId: string|null, role: "owner"|"admin"|"member", credentialId: string, domainId: string|null, permission: "full_access"|"sending_access", authAt: number, isOperator: boolean}} Actor */
/** @typedef {{env: AppBindings, version: number, writes: import("./storage/turso.js").PreparedStatement[]}} Transaction */
/** @typedef {{Bindings: AppBindings, Variables: {transaction: Transaction, actor: Actor, authBody: unknown}}} AppEnv */
/** @template {string} [Path=string] @typedef {import("hono").Context<AppEnv, Path>} AppContext */
/** @typedef {import("hono").MiddlewareHandler<AppEnv>} AppMiddleware */
export {};
