-- Part 04.04: the Protocol & Control Engine. pcs_control_points is the registry of control points of a company (what is checked, how hard, in which mode);
-- pcs_check_results is the log of what the checks found (a pass is only sampled); pcs_exceptions are the requests to go ahead although a control failed, each
-- with a reason code, a justification and evidence, decided through the workflow engine; pcs_reason_codes is the one list of reasons the ERP offers for an action
-- (cancel, reject, return, reverse, deviate, override); pcs_control_changes holds a change of a control that waits for its approval chain; pcs_cycle_stages
-- records which stage of Plan, Verify, Approve, Execute, Record, Monitor, Reconcile and Close a business object has passed. Money is integer paise.

CREATE TABLE IF NOT EXISTS pcs_control_points (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  code             TEXT    NOT NULL,
  module           TEXT    NOT NULL,
  stage            TEXT    NOT NULL CHECK (stage IN ('PLAN','VERIFY','APPROVE','EXECUTE','RECORD','MONITOR','RECONCILE','CLOSE')),
  description      TEXT    NOT NULL,
  rule_ref         TEXT    NOT NULL,
  enforcement      TEXT    NOT NULL CHECK (enforcement IN ('BLOCK', 'EXCEPTION', 'WARN', 'MONITOR')),
  thresholds_json  TEXT    NOT NULL DEFAULT '{}',
  evidence_required INTEGER NOT NULL DEFAULT 0 CHECK (evidence_required IN (0, 1)),
  escalation_level INTEGER NOT NULL DEFAULT 1 CHECK (escalation_level BETWEEN 1 AND 3),
  mode             TEXT    NOT NULL DEFAULT 'OFF' CHECK (mode IN ('OFF', 'OBSERVE', 'WARN', 'ENFORCE')),
  owner_role       TEXT    NOT NULL,
  emergency_allowed INTEGER NOT NULL DEFAULT 0 CHECK (emergency_allowed IN (0, 1)),
  observe_since    TEXT,
  mode_changed_at  TEXT,
  pending_change_id INTEGER,
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
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS ix_pcs_controls_module ON pcs_control_points (company_id, module, mode);

CREATE TABLE IF NOT EXISTS pcs_check_results (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  control_id   INTEGER NOT NULL REFERENCES pcs_control_points (id),
  control_code TEXT    NOT NULL,
  entity       TEXT    NOT NULL,
  entity_id    TEXT    NOT NULL,
  result       TEXT    NOT NULL CHECK (result IN ('PASS', 'WARN', 'BLOCK', 'EXCEPTION_REQUIRED', 'EXCEPTED', 'MONITORED', 'WOULD_WARN', 'WOULD_BLOCK', 'WOULD_REQUIRE_EXCEPTION')),
  mode         TEXT    NOT NULL,
  details_json TEXT    NOT NULL DEFAULT '{}',
  check_source TEXT    NOT NULL DEFAULT 'api',
  user_id      TEXT,
  value_at_risk INTEGER CHECK (value_at_risk IS NULL OR value_at_risk >= 0),
  at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
CREATE INDEX IF NOT EXISTS ix_pcs_results_control ON pcs_check_results (control_id, at);
CREATE INDEX IF NOT EXISTS ix_pcs_results_entity ON pcs_check_results (company_id, entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_pcs_results_company ON pcs_check_results (company_id, result, at);
CREATE TRIGGER IF NOT EXISTS trg_pcs_results_no_update BEFORE UPDATE ON pcs_check_results BEGIN SELECT RAISE(ABORT, 'A check result cannot be changed'); END;
CREATE TRIGGER IF NOT EXISTS trg_pcs_results_no_delete BEFORE DELETE ON pcs_check_results BEGIN SELECT RAISE(ABORT, 'A check result cannot be removed'); END;

CREATE TABLE IF NOT EXISTS pcs_exceptions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER NOT NULL REFERENCES org_companies (id),
  exception_no         TEXT    NOT NULL,
  control_id           INTEGER NOT NULL REFERENCES pcs_control_points (id),
  control_code         TEXT    NOT NULL,
  entity               TEXT    NOT NULL,
  entity_id            TEXT    NOT NULL,
  entity_ref           TEXT,
  reason_code          TEXT    NOT NULL,
  justification        TEXT    NOT NULL,
  evidence_file_ids    TEXT    NOT NULL DEFAULT '[]',
  value_at_risk        INTEGER NOT NULL DEFAULT 0 CHECK (value_at_risk >= 0),
  level                INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  status               TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'USED', 'REJECTED', 'RETURNED', 'CANCELLED')),
  emergency            INTEGER NOT NULL DEFAULT 0 CHECK (emergency IN (0, 1)),
  regularise_by        TEXT,
  regularised_at       TEXT,
  escalated_at         TEXT,
  workflow_instance_id INTEGER REFERENCES wf_instances (id),
  raised_by            TEXT    NOT NULL,
  used_at              TEXT,
  used_by              TEXT,
  decided_at           TEXT,
  check_context_json   TEXT    NOT NULL DEFAULT '{}',
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
  CHECK (emergency = 0 OR regularise_by IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pcs_exceptions_no ON pcs_exceptions (company_id, exception_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pcs_exceptions_open ON pcs_exceptions (company_id, control_code, entity, entity_id) WHERE status IN ('DRAFT', 'PENDING', 'APPROVED', 'RETURNED');
CREATE INDEX IF NOT EXISTS ix_pcs_exceptions_control ON pcs_exceptions (control_id);
CREATE INDEX IF NOT EXISTS ix_pcs_exceptions_status ON pcs_exceptions (company_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_pcs_exceptions_user ON pcs_exceptions (company_id, raised_by);
CREATE INDEX IF NOT EXISTS ix_pcs_exceptions_instance ON pcs_exceptions (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_pcs_exceptions_regularise ON pcs_exceptions (emergency, status, regularise_by);

CREATE TABLE IF NOT EXISTS pcs_reason_codes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER REFERENCES org_companies (id),
  action_type    TEXT    NOT NULL CHECK (action_type IN ('cancel', 'reject', 'return', 'reverse', 'deviate', 'override')),
  code           TEXT    NOT NULL CHECK (code GLOB '[A-Z]*' AND length(code) BETWEEN 2 AND 40),
  label          TEXT    NOT NULL,
  requires_evidence INTEGER NOT NULL DEFAULT 0 CHECK (requires_evidence IN (0, 1)),
  needs_text     INTEGER NOT NULL DEFAULT 0 CHECK (needs_text IN (0, 1)),
  sort_order     INTEGER NOT NULL DEFAULT 100,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pcs_reason_codes ON pcs_reason_codes (COALESCE(company_id, 0), action_type, code);
CREATE INDEX IF NOT EXISTS ix_pcs_reason_codes_company ON pcs_reason_codes (company_id);

CREATE TABLE IF NOT EXISTS pcs_control_changes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  control_id    INTEGER NOT NULL REFERENCES pcs_control_points (id),
  control_code  TEXT    NOT NULL,
  change_json   TEXT    NOT NULL,
  from_mode     TEXT    NOT NULL,
  to_mode       TEXT    NOT NULL,
  observed_days INTEGER NOT NULL DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED')),
  instance_id   INTEGER REFERENCES wf_instances (id),
  requested_by  TEXT    NOT NULL,
  reason        TEXT,
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
CREATE INDEX IF NOT EXISTS ix_pcs_changes_control ON pcs_control_changes (control_id, status);
CREATE INDEX IF NOT EXISTS ix_pcs_changes_company ON pcs_control_changes (company_id, status);
CREATE INDEX IF NOT EXISTS ix_pcs_changes_instance ON pcs_control_changes (instance_id);

CREATE TABLE IF NOT EXISTS pcs_cycle_stages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  entity       TEXT    NOT NULL,
  entity_id    TEXT    NOT NULL,
  stage        TEXT    NOT NULL CHECK (stage IN ('PLAN','VERIFY','APPROVE','EXECUTE','RECORD','MONITOR','RECONCILE','CLOSE')),
  control_code TEXT,
  done_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  done_by      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pcs_cycle ON pcs_cycle_stages (company_id, entity, entity_id, stage);
CREATE INDEX IF NOT EXISTS ix_pcs_cycle_company ON pcs_cycle_stages (company_id);
