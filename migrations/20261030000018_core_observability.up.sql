-- Service-level objectives, alert rules and the alerts they raise, saved request metrics, and reports from the browser
-- (part 01.07). Metrics and alerts are technical records; SLO definitions and alert rules are configuration and follow the
-- standard columns.

CREATE TABLE IF NOT EXISTS core_slo_definitions (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id             INTEGER,
  journey                TEXT    NOT NULL,
  label                  TEXT    NOT NULL,
  description            TEXT,
  route_patterns_json    TEXT    NOT NULL,
  target_latency_ms      INTEGER NOT NULL CHECK (target_latency_ms BETWEEN 10 AND 60000),
  latency_percentile     INTEGER NOT NULL DEFAULT 95 CHECK (latency_percentile BETWEEN 50 AND 99),
  target_availability_bp INTEGER NOT NULL CHECK (target_availability_bp BETWEEN 5000 AND 10000),
  window_days            INTEGER NOT NULL DEFAULT 30 CHECK (window_days BETWEEN 1 AND 90),
  enabled                INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_slo_definitions_journey ON core_slo_definitions (journey);
CREATE INDEX IF NOT EXISTS ix_core_slo_definitions_company ON core_slo_definitions (company_id, enabled);

CREATE TABLE IF NOT EXISTS core_alert_rules (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER,
  code             TEXT    NOT NULL,
  kind             TEXT    NOT NULL CHECK (kind IN ('error_rate', 'slo_breach', 'outbox_backlog', 'dead_letters', 'disk_free', 'db_size', 'job_failures', 'client_errors')),
  description      TEXT    NOT NULL,
  threshold        INTEGER NOT NULL CHECK (threshold >= 0),
  unit             TEXT    NOT NULL,
  window_minutes   INTEGER NOT NULL DEFAULT 5 CHECK (window_minutes BETWEEN 1 AND 1440),
  min_requests     INTEGER NOT NULL DEFAULT 0 CHECK (min_requests >= 0),
  severity         TEXT    NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'critical')),
  channels_json    TEXT    NOT NULL DEFAULT '["email"]',
  cooldown_minutes INTEGER NOT NULL DEFAULT 30 CHECK (cooldown_minutes BETWEEN 1 AND 1440),
  enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_alert_rules_code ON core_alert_rules (code);
CREATE INDEX IF NOT EXISTS ix_core_alert_rules_company ON core_alert_rules (company_id, enabled);

CREATE TABLE IF NOT EXISTS core_alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_code       TEXT    NOT NULL,
  dedupe_key      TEXT    NOT NULL,
  severity        TEXT    NOT NULL CHECK (severity IN ('warning', 'critical')),
  message         TEXT    NOT NULL,
  value           TEXT,
  threshold       TEXT,
  status          TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  fired_at        TEXT    NOT NULL,
  resolved_at     TEXT,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  notified_json   TEXT    NOT NULL DEFAULT '[]',
  correlation_id  TEXT
);
CREATE INDEX IF NOT EXISTS ix_core_alerts_status ON core_alerts (status, fired_at);
CREATE INDEX IF NOT EXISTS ix_core_alerts_rule ON core_alerts (rule_code, dedupe_key, status);

CREATE TABLE IF NOT EXISTS core_metric_samples (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_hour   TEXT    NOT NULL,
  route_key     TEXT    NOT NULL,
  requests      INTEGER NOT NULL DEFAULT 0,
  server_errors INTEGER NOT NULL DEFAULT 0,
  client_errors INTEGER NOT NULL DEFAULT 0,
  sum_ms        INTEGER NOT NULL DEFAULT 0,
  hist_json     TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_metric_samples_bucket ON core_metric_samples (bucket_hour, route_key);

CREATE TABLE IF NOT EXISTS core_client_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER,
  user_ref       TEXT,
  type           TEXT    NOT NULL CHECK (type IN ('js_error', 'api_failure', 'page_load')),
  message        TEXT,
  path           TEXT,
  status         INTEGER,
  correlation_id TEXT,
  duration_ms    INTEGER,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_core_client_events_time ON core_client_events (created_at);
CREATE INDEX IF NOT EXISTS ix_core_client_events_type ON core_client_events (type, created_at);
CREATE INDEX IF NOT EXISTS ix_core_client_events_correlation ON core_client_events (correlation_id);
