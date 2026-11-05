-- Part 05.03: secure (end-to-end encrypted) messaging and the open-source licence register. The server keeps only public keys, ciphertext and the metadata needed to deliver (BR-01).
-- sec_devices: a device of a person, with its public identity key. sec_prekeys: signed and one-time pre-keys (public parts). sec_conversations: which conversations of the Messages app are secure.
-- sec_envelopes: one encrypted envelope per receiving device; the ciphertext is emptied when the device has fetched it. sec_policy: the company's secure messaging policy, versioned, changed only by an approved change.
-- sec_licence_reviews: the written licence review (approved by ITADM and then the director before any end-to-end code is used). oss_register: every open-source component, its licence and obligations.

CREATE TABLE IF NOT EXISTS sec_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  user_ref        TEXT    NOT NULL,
  device_no       INTEGER NOT NULL,
  device_name     TEXT    NOT NULL,
  platform        TEXT,
  registration_id INTEGER NOT NULL,
  identity_key    TEXT    NOT NULL,
  fingerprint     TEXT    NOT NULL,
  revoked_at      TEXT,
  revoked_by      TEXT,
  revoke_reason   TEXT,
  last_seen_at    TEXT,
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sec_devices_no ON sec_devices (company_id, user_ref, device_no);
CREATE INDEX IF NOT EXISTS ix_sec_devices_user ON sec_devices (company_id, user_ref, revoked_at);
CREATE INDEX IF NOT EXISTS ix_sec_devices_company_id ON sec_devices (company_id);

CREATE TABLE IF NOT EXISTS sec_prekeys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  device_id  INTEGER NOT NULL REFERENCES sec_devices (id),
  key_id     INTEGER NOT NULL,
  public_key TEXT    NOT NULL,
  signature  TEXT,
  signed     INTEGER NOT NULL DEFAULT 0 CHECK (signed IN (0, 1)),
  used_at    TEXT,
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sec_prekeys_key ON sec_prekeys (device_id, signed, key_id);
CREATE INDEX IF NOT EXISTS ix_sec_prekeys_free ON sec_prekeys (device_id, signed, used_at);
CREATE INDEX IF NOT EXISTS ix_sec_prekeys_company_id ON sec_prekeys (company_id);

CREATE TABLE IF NOT EXISTS sec_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  conversation_id   INTEGER NOT NULL REFERENCES msg_conversations (id),
  kind              TEXT    NOT NULL CHECK (kind IN ('ONE_TO_ONE', 'GROUP')),
  pair_key          TEXT,
  disappear_seconds INTEGER NOT NULL DEFAULT 0 CHECK (disappear_seconds >= 0),
  policy_version    INTEGER NOT NULL DEFAULT 0,
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sec_conv_conversation ON sec_conversations (conversation_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sec_conv_pair ON sec_conversations (company_id, pair_key) WHERE pair_key IS NOT NULL AND is_active = 1;
CREATE INDEX IF NOT EXISTS ix_sec_conv_company_id ON sec_conversations (company_id);

CREATE TABLE IF NOT EXISTS sec_envelopes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  conversation_id     INTEGER NOT NULL REFERENCES msg_conversations (id),
  message_uid         TEXT    NOT NULL,
  sender_user         TEXT    NOT NULL,
  sender_device_id    INTEGER NOT NULL REFERENCES sec_devices (id),
  recipient_user      TEXT    NOT NULL,
  recipient_device_id INTEGER NOT NULL REFERENCES sec_devices (id),
  ciphertext          TEXT    NOT NULL,
  size_bytes          INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  delivered_at        TEXT,
  expires_at          TEXT,
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sec_env_one ON sec_envelopes (conversation_id, message_uid, recipient_device_id);
CREATE INDEX IF NOT EXISTS ix_sec_env_device ON sec_envelopes (recipient_device_id, id);
CREATE INDEX IF NOT EXISTS ix_sec_env_sender ON sec_envelopes (sender_device_id);
CREATE INDEX IF NOT EXISTS ix_sec_env_unread ON sec_envelopes (company_id, recipient_user, delivered_at);
CREATE INDEX IF NOT EXISTS ix_sec_env_expiry ON sec_envelopes (expires_at);
CREATE INDEX IF NOT EXISTS ix_sec_env_conversation ON sec_envelopes (conversation_id);
CREATE INDEX IF NOT EXISTS ix_sec_env_company_id ON sec_envelopes (company_id);

CREATE TABLE IF NOT EXISTS sec_policy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  config_json    TEXT    NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1,
  status         TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SCHEDULED', 'ACTIVE', 'RETIRED', 'REJECTED')),
  instance_id    INTEGER,
  effective_from TEXT,
  reason         TEXT,
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sec_policy_version ON sec_policy (company_id, config_version);
CREATE INDEX IF NOT EXISTS ix_sec_policy_status ON sec_policy (company_id, status);

CREATE TABLE IF NOT EXISTS sec_licence_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  review_version INTEGER NOT NULL,
  subject        TEXT    NOT NULL,
  document_json  TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  instance_id    INTEGER,
  decided_at     TEXT,
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sec_review_version ON sec_licence_reviews (company_id, review_version);
CREATE INDEX IF NOT EXISTS ix_sec_review_status ON sec_licence_reviews (company_id, status);

CREATE TABLE IF NOT EXISTS oss_register (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  component         TEXT    NOT NULL,
  component_version TEXT    NOT NULL DEFAULT '',
  licence           TEXT    NOT NULL,
  usage             TEXT    NOT NULL DEFAULT '',
  obligations       TEXT    NOT NULL DEFAULT '',
  compliance_status TEXT    NOT NULL DEFAULT 'TO_REVIEW' CHECK (compliance_status IN ('TO_REVIEW', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'NOT_USED')),
  entry_source      TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (entry_source IN ('MANUAL', 'SCAN', 'SEED')),
  review_id         INTEGER REFERENCES sec_licence_reviews (id),
  reviewed_by       TEXT,
  reviewed_at       TEXT,
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_oss_component ON oss_register (company_id, component);
CREATE INDEX IF NOT EXISTS ix_oss_status ON oss_register (company_id, compliance_status);
CREATE INDEX IF NOT EXISTS ix_oss_review ON oss_register (review_id);

