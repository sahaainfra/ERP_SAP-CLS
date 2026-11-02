-- Part 04.02: the approval matrix and its neighbours. wf_matrix (a version of the routing of a document type for the company, a department or a project, with the
-- date it takes effect) and wf_matrix_rules (its decision table: priority, conditions, steps; first full match wins); wf_authority_limits (what a role may
-- approve, by document type); wf_delegations (a person's authority handed to another for a period); wf_escalation_paths (the management hierarchy a late
-- task climbs); wf_sla_settings (time allowed and the reminder and escalation points, by document type). Every change is a row that takes effect only after
-- its approval chain has approved it (status PENDING until then), so running instances are never touched. Money is integer paise.

CREATE TABLE IF NOT EXISTS wf_matrix (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES org_companies (id),
  doc_type          TEXT    NOT NULL CHECK (doc_type GLOB '[A-Za-z]*' AND length(doc_type) <= 60),
  scope_type        TEXT    NOT NULL DEFAULT 'COMPANY' CHECK (scope_type IN ('COMPANY', 'DEPARTMENT', 'PROJECT')),
  scope_id          INTEGER NOT NULL DEFAULT 0 CHECK ((scope_type = 'COMPANY' AND scope_id = 0) OR (scope_type != 'COMPANY' AND scope_id >= 1)),
  matrix_version    INTEGER NOT NULL CHECK (matrix_version >= 1),
  name              TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  effective_from    TEXT,
  effective_to      TEXT,
  activation_instance_id INTEGER,
  activated_at      TEXT,
  activated_by      TEXT,
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
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  CHECK (status NOT IN ('PENDING', 'ACTIVE', 'RETIRED') OR effective_from IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wf_matrix_version ON wf_matrix (company_id, doc_type, scope_type, scope_id, matrix_version);
CREATE INDEX IF NOT EXISTS ix_wf_matrix_resolve ON wf_matrix (company_id, doc_type, status, effective_from);
CREATE INDEX IF NOT EXISTS ix_wf_matrix_activation ON wf_matrix (activation_instance_id);

CREATE TABLE IF NOT EXISTS wf_matrix_rules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  matrix_id      INTEGER NOT NULL REFERENCES wf_matrix (id),
  priority       INTEGER NOT NULL CHECK (priority >= 1),
  name           TEXT    NOT NULL,
  condition_json TEXT    NOT NULL DEFAULT '[]',
  steps_json     TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_wf_matrix_rules_priority ON wf_matrix_rules (matrix_id, priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_wf_matrix_rules_company ON wf_matrix_rules (company_id);

CREATE TABLE IF NOT EXISTS wf_authority_limits (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  role_code      TEXT    NOT NULL,
  doc_type       TEXT    NOT NULL,
  max_amount     INTEGER CHECK (max_amount IS NULL OR max_amount >= 0),
  currency       TEXT    NOT NULL DEFAULT 'INR',
  status         TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  effective_from TEXT    NOT NULL,
  effective_to   TEXT,
  batch_id       INTEGER,
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
  remarks     TEXT,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS ix_wf_authority_resolve ON wf_authority_limits (company_id, doc_type, role_code, status, effective_from);
CREATE INDEX IF NOT EXISTS ix_wf_authority_batch ON wf_authority_limits (batch_id);

CREATE TABLE IF NOT EXISTS wf_delegations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES org_companies (id),
  delegator           TEXT    NOT NULL,
  delegate            TEXT    NOT NULL,
  doc_types_json      TEXT    NOT NULL DEFAULT '[]',
  delegator_roles_json TEXT   NOT NULL DEFAULT '[]',
  max_amount          INTEGER CHECK (max_amount IS NULL OR max_amount >= 0),
  from_date           TEXT    NOT NULL,
  to_date             TEXT    NOT NULL,
  reason              TEXT    NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED', 'REJECTED')),
  instance_id         INTEGER,
  revoked_by          TEXT,
  revoked_at          TEXT,
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
  CHECK (to_date >= from_date),
  CHECK (delegator != delegate)
);
CREATE INDEX IF NOT EXISTS ix_wf_delegations_delegate ON wf_delegations (company_id, delegate, status, from_date);
CREATE INDEX IF NOT EXISTS ix_wf_delegations_delegator ON wf_delegations (company_id, delegator, status);
CREATE INDEX IF NOT EXISTS ix_wf_delegations_instance ON wf_delegations (instance_id);

CREATE TABLE IF NOT EXISTS wf_escalation_paths (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  scope_type     TEXT    NOT NULL DEFAULT 'COMPANY' CHECK (scope_type IN ('COMPANY', 'DEPARTMENT', 'PROJECT')),
  scope_id       INTEGER NOT NULL DEFAULT 0,
  levels_json    TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  effective_from TEXT    NOT NULL,
  effective_to   TEXT,
  batch_id       INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_wf_escalation_resolve ON wf_escalation_paths (company_id, scope_type, scope_id, status, effective_from);
CREATE INDEX IF NOT EXISTS ix_wf_escalation_batch ON wf_escalation_paths (batch_id);

CREATE TABLE IF NOT EXISTS wf_sla_settings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  doc_type       TEXT    NOT NULL,
  sla_hours      INTEGER NOT NULL CHECK (sla_hours >= 1 AND sla_hours <= 720),
  remind_pct     INTEGER NOT NULL DEFAULT 50 CHECK (remind_pct >= 1 AND remind_pct <= 100),
  escalate_pct   INTEGER NOT NULL DEFAULT 100 CHECK (escalate_pct >= 50),
  second_pct     INTEGER NOT NULL DEFAULT 200 CHECK (second_pct >= 100),
  status         TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  effective_from TEXT    NOT NULL,
  effective_to   TEXT,
  batch_id       INTEGER,
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
  remarks     TEXT,
  CHECK (remind_pct < escalate_pct AND escalate_pct <= second_pct)
);
CREATE INDEX IF NOT EXISTS ix_wf_sla_resolve ON wf_sla_settings (company_id, doc_type, status, effective_from);
CREATE INDEX IF NOT EXISTS ix_wf_sla_batch ON wf_sla_settings (batch_id);
