-- Part 04.09: automation and alert rules. alr_rules are the rules (a shared library with no company, and each company's own, versioned: a change that affects external messages waits for approval);
-- alr_alerts are what the rules raise (open, acknowledged, resolved, with an owner and a note); alr_rule_runs are the log of each evaluation with its counts and errors.

CREATE TABLE IF NOT EXISTS alr_rules (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER REFERENCES org_companies (id),
  code             TEXT    NOT NULL,
  name             TEXT    NOT NULL,
  description      TEXT,
  trigger_type     TEXT    NOT NULL CHECK (trigger_type IN ('EVENT', 'SCHEDULE')),
  event_type       TEXT,
  schedule         TEXT,
  dataset          TEXT,
  condition_json   TEXT    NOT NULL DEFAULT '{}',
  actions_json     TEXT    NOT NULL DEFAULT '[]',
  message_template TEXT    NOT NULL,
  throttle_minutes INTEGER NOT NULL DEFAULT 1440 CHECK (throttle_minutes BETWEEN 0 AND 525600),
  severity         TEXT    NOT NULL DEFAULT 'WARNING' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  owner_module     TEXT    NOT NULL,
  owner_role       TEXT    NOT NULL DEFAULT 'SYSADM',
  external         INTEGER NOT NULL DEFAULT 0 CHECK (external IN (0, 1)),
  enabled          INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  rule_version     INTEGER NOT NULL DEFAULT 1 CHECK (rule_version >= 1),
  status           TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('LIBRARY', 'PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  instance_id      INTEGER,
  reason           TEXT,
  last_run_at      TEXT,
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
  remarks     TEXT,
  CHECK ((trigger_type = 'EVENT' AND event_type IS NOT NULL) OR (trigger_type = 'SCHEDULE' AND schedule IS NOT NULL AND dataset IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_alr_rules_version ON alr_rules (COALESCE(company_id, 0), code, rule_version);
CREATE INDEX IF NOT EXISTS ix_alr_rules_company ON alr_rules (company_id, status, enabled);
CREATE INDEX IF NOT EXISTS ix_alr_rules_event ON alr_rules (event_type, status, enabled);
CREATE INDEX IF NOT EXISTS ix_alr_rules_code ON alr_rules (company_id, code, status);

CREATE TABLE IF NOT EXISTS alr_alerts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  rule_code        TEXT    NOT NULL,
  rule_version     INTEGER NOT NULL DEFAULT 1,
  entity           TEXT    NOT NULL,
  entity_id        TEXT    NOT NULL,
  entity_label     TEXT,
  route            TEXT,
  severity         TEXT    NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  message          TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  owner_user_ref   TEXT,
  recipients_json  TEXT    NOT NULL DEFAULT '[]',
  occurrences      INTEGER NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  first_seen_at    TEXT    NOT NULL,
  last_seen_at     TEXT    NOT NULL,
  last_notified_at TEXT,
  acknowledged_at  TEXT,
  acknowledged_by  TEXT,
  resolved_at      TEXT,
  resolved_by      TEXT,
  resolution       TEXT,
  escalated_at     TEXT,
  deliveries_json  TEXT    NOT NULL DEFAULT '[]',
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
CREATE INDEX IF NOT EXISTS ix_alr_alerts_company_id ON alr_alerts (company_id, id);
CREATE INDEX IF NOT EXISTS ix_alr_alerts_list ON alr_alerts (company_id, status, severity);
CREATE INDEX IF NOT EXISTS ix_alr_alerts_key ON alr_alerts (company_id, rule_code, entity, entity_id, id);
CREATE INDEX IF NOT EXISTS ix_alr_alerts_owner ON alr_alerts (company_id, owner_user_ref, status);
CREATE INDEX IF NOT EXISTS ix_alr_alerts_project ON alr_alerts (company_id, project_id, status);

CREATE TABLE IF NOT EXISTS alr_rule_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  rule_code    TEXT    NOT NULL,
  rule_version INTEGER NOT NULL DEFAULT 1,
  trigger      TEXT    NOT NULL CHECK (trigger IN ('schedule', 'event', 'dry_run', 'manual')),
  started_at   TEXT    NOT NULL,
  finished_at  TEXT,
  matched      INTEGER NOT NULL DEFAULT 0 CHECK (matched >= 0),
  created      INTEGER NOT NULL DEFAULT 0 CHECK (created >= 0),
  throttled    INTEGER NOT NULL DEFAULT 0 CHECK (throttled >= 0),
  actions_done INTEGER NOT NULL DEFAULT 0 CHECK (actions_done >= 0),
  errors       INTEGER NOT NULL DEFAULT 0 CHECK (errors >= 0),
  error_text   TEXT,
  duration_ms  INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
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
CREATE INDEX IF NOT EXISTS ix_alr_runs_company_id ON alr_rule_runs (company_id, id);
CREATE INDEX IF NOT EXISTS ix_alr_runs_rule ON alr_rule_runs (company_id, rule_code, id);
