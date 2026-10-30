-- Integration hub (part 01.08): connectors to outside services, their encrypted credentials, the log of every call and the
-- receipts that stop a replayed webhook being processed twice. Connectors and secrets are business tables (standard
-- columns); logs and receipts are technical records.

CREATE TABLE IF NOT EXISTS core_connectors (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id             INTEGER NOT NULL,
  code                   TEXT    NOT NULL,
  name                   TEXT    NOT NULL,
  type                   TEXT    NOT NULL CHECK (type IN ('email', 'sms', 'whatsapp', 'gsp', 'bank', 'biometric', 'maps', 'ocr', 'ai', 'storage')),
  provider               TEXT    NOT NULL,
  environment            TEXT    NOT NULL DEFAULT 'development' CHECK (environment IN ('development', 'staging', 'production')),
  config_json            TEXT    NOT NULL DEFAULT '{}',
  status                 TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DISABLED', 'ENABLED')),
  timeout_ms             INTEGER NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 100 AND 120000),
  max_retries            INTEGER NOT NULL DEFAULT 2 CHECK (max_retries BETWEEN 0 AND 10),
  retry_backoff_ms       INTEGER NOT NULL DEFAULT 500 CHECK (retry_backoff_ms BETWEEN 0 AND 60000),
  rate_limit_per_minute  INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_per_minute BETWEEN 1 AND 100000),
  breaker_threshold      INTEGER NOT NULL DEFAULT 5 CHECK (breaker_threshold BETWEEN 1 AND 100),
  breaker_reset_seconds  INTEGER NOT NULL DEFAULT 60 CHECK (breaker_reset_seconds BETWEEN 1 AND 3600),
  retention_days         INTEGER NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 7 AND 3650),
  last_health_at         TEXT,
  last_health_status     TEXT CHECK (last_health_status IN ('ok', 'failed')),
  last_health_message    TEXT,
  last_used_at           TEXT,
  project_id             INTEGER,
  site_id                INTEGER,
  created_by             TEXT,
  created_at             TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by             TEXT,
  updated_at             TEXT,
  version                INTEGER NOT NULL DEFAULT 1,
  is_active              INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at             TEXT,
  deleted_by             TEXT,
  source_type            TEXT,
  source_id              TEXT,
  remarks                TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_connectors_code ON core_connectors (code);
CREATE INDEX IF NOT EXISTS ix_core_connectors_company ON core_connectors (company_id, status);
CREATE INDEX IF NOT EXISTS ix_core_connectors_type ON core_connectors (company_id, type);

CREATE TABLE IF NOT EXISTS core_connector_secrets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL,
  connector_id     INTEGER NOT NULL REFERENCES core_connectors (id),
  key              TEXT    NOT NULL,
  encrypted_value  TEXT    NOT NULL,
  key_version      INTEGER NOT NULL DEFAULT 1,
  status           TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED')),
  rotated_at       TEXT,
  expires_at       TEXT,
  project_id       INTEGER,
  site_id          INTEGER,
  created_by       TEXT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by       TEXT,
  updated_at       TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at       TEXT,
  deleted_by       TEXT,
  source_type      TEXT,
  source_id        TEXT,
  remarks          TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_connector_secrets_active ON core_connector_secrets (connector_id, key) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_connector_secrets_pending ON core_connector_secrets (connector_id, key) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS ix_core_connector_secrets_company ON core_connector_secrets (company_id, status);

CREATE TABLE IF NOT EXISTS core_integration_logs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL,
  connector_id       INTEGER NOT NULL REFERENCES core_connectors (id),
  direction          TEXT    NOT NULL CHECK (direction IN ('outbound', 'inbound', 'test')),
  operation          TEXT    NOT NULL,
  endpoint           TEXT,
  status             TEXT    NOT NULL CHECK (status IN ('success', 'failure', 'timeout', 'rejected', 'circuit_open', 'rate_limited', 'duplicate')),
  http_status        INTEGER,
  duration_ms        INTEGER NOT NULL DEFAULT 0,
  attempts           INTEGER NOT NULL DEFAULT 1,
  request_redacted   TEXT,
  response_redacted  TEXT,
  error              TEXT,
  correlation_id     TEXT,
  user_ref           TEXT,
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_core_integration_logs_connector ON core_integration_logs (connector_id, created_at);
CREATE INDEX IF NOT EXISTS ix_core_integration_logs_company ON core_integration_logs (company_id, created_at);
CREATE INDEX IF NOT EXISTS ix_core_integration_logs_status ON core_integration_logs (company_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_core_integration_logs_correlation ON core_integration_logs (correlation_id);

CREATE TABLE IF NOT EXISTS core_webhook_receipts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  connector_id  INTEGER NOT NULL REFERENCES core_connectors (id),
  delivery_id   TEXT    NOT NULL,
  received_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_webhook_receipts_delivery ON core_webhook_receipts (connector_id, delivery_id);
