-- cdfsend records are tenant-scoped. Domains are deliberately NOT globally unique.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    handle TEXT NOT NULL UNIQUE,
    is_operator INTEGER NOT NULL DEFAULT 0 CHECK(is_operator IN (0,1)),
    created_at INTEGER NOT NULL
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE memberships (
    org_id TEXT NOT NULL REFERENCES organizations(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
    PRIMARY KEY(org_id,user_id)
);
CREATE INDEX memberships_user ON memberships(user_id,org_id);
CREATE TABLE credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    data TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX credentials_user ON credentials(user_id);
CREATE TABLE sessions (
    hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    auth_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE invitations (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    handle TEXT NOT NULL,
    org_id TEXT REFERENCES organizations(id),
    role TEXT NOT NULL CHECK(role IN ('owner','admin','member')),
    purpose TEXT NOT NULL CHECK(purpose IN ('invite','recover')),
    user_id TEXT REFERENCES users(id),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    purpose TEXT NOT NULL,
    user_id TEXT,
    invitation_id TEXT,
    handle TEXT,
    session_hash TEXT,
    origin TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE domains (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(org_id,name)
);
CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    permission TEXT NOT NULL CHECK(permission IN ('full_access','sending_access')),
    domain_id TEXT REFERENCES domains(id),
    created_at INTEGER NOT NULL,
    CHECK(permission != 'full_access' OR domain_id IS NULL)
);
CREATE INDEX api_keys_org ON api_keys(org_id,id);
CREATE TABLE emails (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    domain_id TEXT NOT NULL,
    credential_id TEXT NOT NULL,
    metadata TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('processing','sent','failed','uncertain')),
    message_id TEXT,
    error TEXT,
    body_chunks INTEGER NOT NULL CHECK(body_chunks > 0),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX emails_org_time ON emails(org_id,created_at DESC,id DESC);
CREATE INDEX emails_expiry ON emails(expires_at);
CREATE TABLE email_body_chunks (
    email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK(position >= 0),
    content TEXT NOT NULL CHECK(length(CAST(content AS BLOB)) <= 786432),
    PRIMARY KEY(email_id,position)
);
CREATE TABLE idempotency (
    scope TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('processing','complete')),
    response TEXT,
    status_code INTEGER,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id TEXT,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX audit_org ON audit(org_id,created_at);

-- Optimistic, atomic management transactions protect membership/owner invariants.
CREATE TABLE revision (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL CHECK(value>=0));
INSERT INTO revision VALUES(1,0);
