-- Part 04.07: the communication gateway. comm_messages is every message that left or arrived (the words of a code that carries a secret are never kept); comm_consents says who agreed
-- to hear from us on which channel; comm_otps are the one-time codes (only a hash is kept); comm_channels says, per channel, which connector sends first, which takes over, the sender
-- identity and the pace; comm_dlt_templates are the registered text-message templates of India's DLT; comm_wa_templates are the WhatsApp templates the provider approved.

CREATE TABLE IF NOT EXISTS comm_messages (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER NOT NULL REFERENCES org_companies (id),
  channel              TEXT    NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH')),
  direction            TEXT    NOT NULL DEFAULT 'OUT' CHECK (direction IN ('OUT', 'IN')),
  purpose              TEXT    NOT NULL DEFAULT 'TRANSACTIONAL' CHECK (purpose IN ('TRANSACTIONAL', 'COMMERCIAL', 'OTP')),
  priority             INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  to_address           TEXT    NOT NULL,
  from_address         TEXT,
  template_code        TEXT,
  provider_template_id TEXT,
  subject              TEXT,
  body_redacted        TEXT    NOT NULL DEFAULT '',
  payload_json         TEXT,
  attachments_json     TEXT    NOT NULL DEFAULT '[]',
  related_entity       TEXT,
  related_id           TEXT,
  conversation_key     TEXT,
  contact_type         TEXT,
  contact_id           TEXT,
  status               TEXT    NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED', 'RECEIVED', 'CANCELLED')),
  block_reason         TEXT,
  connector_code       TEXT,
  provider_msg_id      TEXT,
  reply_token          TEXT,
  attempts             INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  route_json           TEXT    NOT NULL DEFAULT '[]',
  last_error           TEXT,
  next_attempt_at      TEXT,
  sent_at              TEXT,
  delivered_at         TEXT,
  read_at              TEXT,
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
CREATE INDEX IF NOT EXISTS ix_comm_messages_queue ON comm_messages (status, priority, next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_comm_messages_company ON comm_messages (company_id, channel, status, created_at);
CREATE INDEX IF NOT EXISTS ix_comm_messages_address ON comm_messages (company_id, to_address, channel, created_at);
CREATE INDEX IF NOT EXISTS ix_comm_messages_related ON comm_messages (company_id, related_entity, related_id, created_at);
CREATE INDEX IF NOT EXISTS ix_comm_messages_conversation ON comm_messages (company_id, conversation_key, id);
CREATE INDEX IF NOT EXISTS ix_comm_messages_provider ON comm_messages (company_id, provider_msg_id);
CREATE INDEX IF NOT EXISTS ix_comm_messages_log ON comm_messages (company_id, id);
CREATE INDEX IF NOT EXISTS ix_comm_messages_token ON comm_messages (reply_token);
CREATE INDEX IF NOT EXISTS ix_comm_messages_contact ON comm_messages (company_id, contact_type, contact_id, created_at);

CREATE TABLE IF NOT EXISTS comm_consents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  contact_type TEXT    NOT NULL CHECK (contact_type IN ('USER', 'EMPLOYEE', 'VENDOR', 'CLIENT', 'SUBCONTRACTOR', 'OTHER')),
  contact_id   TEXT,
  contact_name TEXT,
  address      TEXT    NOT NULL,
  channel      TEXT    NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH')),
  status       TEXT    NOT NULL CHECK (status IN ('OPT_IN', 'OPT_OUT')),
  source       TEXT    NOT NULL CHECK (source IN ('PORTAL', 'FORM', 'STOP_KEYWORD', 'START_KEYWORD', 'IMPORT', 'ADMIN', 'API')),
  changed_at   TEXT    NOT NULL,
  changed_by   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_comm_consents ON comm_consents (company_id, address, channel);
CREATE INDEX IF NOT EXISTS ix_comm_consents_contact ON comm_consents (company_id, contact_type, contact_id);
CREATE INDEX IF NOT EXISTS ix_comm_consents_status ON comm_consents (company_id, status, channel);

CREATE TABLE IF NOT EXISTS comm_otps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  purpose       TEXT    NOT NULL CHECK (purpose IN ('LOGIN_MFA', 'MFA_ENROL', 'APPROVAL_LINK', 'PORTAL_SIGNUP', 'PAYMENT_CONFIRM', 'OTHER')),
  channel       TEXT    NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP')),
  address       TEXT    NOT NULL,
  user_ref      TEXT,
  subject_ref   TEXT    NOT NULL DEFAULT '',
  code_hash     TEXT    NOT NULL,
  expires_at    TEXT    NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts  INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  verified_at   TEXT,
  status        TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'EXPIRED', 'LOCKED', 'REPLACED', 'UNDELIVERED')),
  sent_at       TEXT,
  message_id    INTEGER REFERENCES comm_messages (id),
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
CREATE INDEX IF NOT EXISTS ix_comm_otps_subject ON comm_otps (company_id, purpose, subject_ref, status);
CREATE INDEX IF NOT EXISTS ix_comm_otps_address ON comm_otps (company_id, address, created_at);
CREATE INDEX IF NOT EXISTS ix_comm_otps_message ON comm_otps (message_id);

CREATE TABLE IF NOT EXISTS comm_channels (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES org_companies (id),
  channel             TEXT    NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'WHATSAPP', 'PUSH')),
  primary_connector   TEXT,
  secondary_connector TEXT,
  sender_id           TEXT,
  dlt_entity_id       TEXT,
  rate_per_minute     INTEGER NOT NULL DEFAULT 60 CHECK (rate_per_minute BETWEEN 1 AND 6000),
  enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  channel_version     INTEGER NOT NULL DEFAULT 1,
  status              TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  batch_id            INTEGER,
  reason              TEXT,
  instance_id         INTEGER REFERENCES wf_instances (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_comm_channels ON comm_channels (company_id, channel, channel_version);
CREATE INDEX IF NOT EXISTS ix_comm_channels_active ON comm_channels (company_id, channel, status);
CREATE INDEX IF NOT EXISTS ix_comm_channels_batch ON comm_channels (batch_id);
CREATE INDEX IF NOT EXISTS ix_comm_channels_instance ON comm_channels (instance_id);

CREATE TABLE IF NOT EXISTS comm_dlt_templates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  template_code   TEXT    NOT NULL,
  dlt_template_id TEXT    NOT NULL,
  sender_id       TEXT,
  body_pattern    TEXT    NOT NULL,
  dlt_version     INTEGER NOT NULL DEFAULT 1,
  status          TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  batch_id        INTEGER,
  reason          TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_comm_dlt ON comm_dlt_templates (company_id, template_code, dlt_version);
CREATE INDEX IF NOT EXISTS ix_comm_dlt_active ON comm_dlt_templates (company_id, template_code, status);
CREATE INDEX IF NOT EXISTS ix_comm_dlt_batch ON comm_dlt_templates (batch_id);

CREATE TABLE IF NOT EXISTS comm_wa_templates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  name           TEXT    NOT NULL,
  language       TEXT    NOT NULL DEFAULT 'en',
  category       TEXT    NOT NULL DEFAULT 'UTILITY',
  provider_status TEXT   NOT NULL DEFAULT 'PENDING' CHECK (provider_status IN ('APPROVED', 'PENDING', 'REJECTED', 'PAUSED')),
  template_code  TEXT,
  variables_json TEXT    NOT NULL DEFAULT '[]',
  synced_at      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_comm_wa ON comm_wa_templates (company_id, name, language);
CREATE INDEX IF NOT EXISTS ix_comm_wa_code ON comm_wa_templates (company_id, template_code, provider_status);
