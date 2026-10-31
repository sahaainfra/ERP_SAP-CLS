-- Authentication, sessions, MFA and password policy (part 02.01). iam_users is a thin stand-in for the user master of part
-- 02.03 (defect D-059): it holds just enough to sign a person in. Credentials, MFA factors, devices and the policy are business
-- tables (standard columns); sessions, refresh tokens, login events, the login throttle and password resets are technical.

CREATE TABLE IF NOT EXISTS iam_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  username      TEXT    NOT NULL COLLATE NOCASE,
  email         TEXT    COLLATE NOCASE,
  mobile        TEXT,
  display_name  TEXT    NOT NULL,
  roles_json    TEXT    NOT NULL DEFAULT '[]',
  status        TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  last_login_at TEXT,
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_users_username ON iam_users (username);
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_users_email ON iam_users (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_users_mobile ON iam_users (mobile) WHERE mobile IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_iam_users_company ON iam_users (company_id, status);

CREATE TABLE IF NOT EXISTS iam_credentials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES iam_users (id),
  password_hash TEXT    NOT NULL,
  algo          TEXT    NOT NULL,
  changed_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at    TEXT,
  must_change   INTEGER NOT NULL DEFAULT 0 CHECK (must_change IN (0, 1)),
  history_json  TEXT    NOT NULL DEFAULT '[]',
  failed_count  INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  locked_until  TEXT,
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_credentials_user ON iam_credentials (user_id);
CREATE INDEX IF NOT EXISTS ix_iam_credentials_company ON iam_credentials (company_id);

CREATE TABLE IF NOT EXISTS iam_mfa_factors (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL,
  user_id           INTEGER NOT NULL REFERENCES iam_users (id),
  type              TEXT    NOT NULL CHECK (type IN ('totp', 'sms', 'whatsapp', 'backup')),
  secret_encrypted  TEXT,
  phone             TEXT,
  meta_json         TEXT    NOT NULL DEFAULT '{}',
  verified_at       TEXT,
  last_used_at      TEXT,
  last_counter      INTEGER,
  project_id        INTEGER,
  site_id           INTEGER,
  created_by        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by        TEXT,
  updated_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at        TEXT,
  deleted_by        TEXT,
  source_type       TEXT,
  source_id         TEXT,
  remarks           TEXT
);
CREATE INDEX IF NOT EXISTS ix_iam_mfa_factors_user ON iam_mfa_factors (user_id, type);
CREATE INDEX IF NOT EXISTS ix_iam_mfa_factors_company ON iam_mfa_factors (company_id);

CREATE TABLE IF NOT EXISTS iam_devices (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL,
  user_id             INTEGER NOT NULL REFERENCES iam_users (id),
  device_fingerprint  TEXT    NOT NULL,
  name                TEXT    NOT NULL,
  platform            TEXT,
  token_hash          TEXT,
  trusted_until       TEXT,
  pin_hash            TEXT,
  pin_failed          INTEGER NOT NULL DEFAULT 0 CHECK (pin_failed >= 0),
  registered_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at        TEXT,
  project_id          INTEGER,
  site_id             INTEGER,
  created_by          TEXT,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by          TEXT,
  updated_at          TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at          TEXT,
  deleted_by          TEXT,
  source_type         TEXT,
  source_id           TEXT,
  remarks             TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_devices_user_fingerprint ON iam_devices (user_id, device_fingerprint);
CREATE INDEX IF NOT EXISTS ix_iam_devices_company ON iam_devices (company_id);

CREATE TABLE IF NOT EXISTS iam_auth_policy (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL,
  settings_json  TEXT    NOT NULL,
  project_id     INTEGER,
  site_id        INTEGER,
  created_by     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by     TEXT,
  updated_at     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at     TEXT,
  deleted_by     TEXT,
  source_type    TEXT,
  source_id      TEXT,
  remarks        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_auth_policy_company ON iam_auth_policy (company_id);

CREATE TABLE IF NOT EXISTS iam_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id       TEXT    NOT NULL,
  company_id      INTEGER NOT NULL,
  user_id         INTEGER NOT NULL REFERENCES iam_users (id),
  device_id       INTEGER REFERENCES iam_devices (id),
  ip              TEXT,
  user_agent      TEXT,
  auth_method     TEXT    NOT NULL DEFAULT 'password' CHECK (auth_method IN ('password', 'pin', 'sso')),
  mfa_at          TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at      TEXT    NOT NULL,
  revoked_at      TEXT,
  revoked_reason  TEXT,
  revoked_by      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_sessions_public ON iam_sessions (public_id);
CREATE INDEX IF NOT EXISTS ix_iam_sessions_user ON iam_sessions (user_id, revoked_at);
CREATE INDEX IF NOT EXISTS ix_iam_sessions_device ON iam_sessions (device_id);
CREATE INDEX IF NOT EXISTS ix_iam_sessions_company ON iam_sessions (company_id, revoked_at);

CREATE TABLE IF NOT EXISTS iam_refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES iam_sessions (id),
  token_hash  TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'USED')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  used_at     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_refresh_tokens_hash ON iam_refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS ix_iam_refresh_tokens_session ON iam_refresh_tokens (session_id, status);

CREATE TABLE IF NOT EXISTS iam_login_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER,
  user_id             INTEGER REFERENCES iam_users (id),
  username_attempted  TEXT,
  result              TEXT    NOT NULL CHECK (result IN ('success', 'failure', 'locked', 'mfa_failed', 'mfa_required', 'suspicious', 'refresh_reuse', 'logout', 'forced_logout', 'password_changed', 'password_reset', 'pin_unlock', 'pin_failed')),
  ip                  TEXT,
  user_agent          TEXT,
  device_label        TEXT,
  device_fingerprint  TEXT,
  geo_country         TEXT,
  reason              TEXT,
  session_public_id   TEXT,
  at                  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_iam_login_events_user ON iam_login_events (user_id, at);
CREATE INDEX IF NOT EXISTS ix_iam_login_events_company ON iam_login_events (company_id, at);
CREATE INDEX IF NOT EXISTS ix_iam_login_events_result ON iam_login_events (company_id, result, at);

CREATE TABLE IF NOT EXISTS iam_login_throttle (
  key            TEXT PRIMARY KEY,
  failed_count   INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  last_failed_at TEXT
);

CREATE TABLE IF NOT EXISTS iam_password_resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES iam_users (id),
  token_hash  TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  ip          TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_password_resets_hash ON iam_password_resets (token_hash);
CREATE INDEX IF NOT EXISTS ix_iam_password_resets_user ON iam_password_resets (user_id);
