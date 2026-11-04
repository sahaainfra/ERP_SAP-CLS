-- Part 04.05: accountability. acc_raci_templates are the standard processes of a construction company with who is usually Responsible, Accountable, Consulted and
-- Informed (shared rows have no company; a company may add its own); acc_raci_assignments say, for a scope (company, department, project or site) and a process, who is R, A, C
-- or I, from a date; a change of a live project waits as PENDING until its approval chain approves it. acc_action_ledger is the append-only record of who did what to which
-- business object, fed from workflow events, module events and the audit trail. acc_ledger_cursors remembers how far each feed has been read.

CREATE TABLE IF NOT EXISTS acc_raci_templates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER REFERENCES org_companies (id),
  process_code   TEXT    NOT NULL CHECK (process_code GLOB '[A-Z]*' AND length(process_code) BETWEEN 2 AND 30),
  name           TEXT    NOT NULL,
  description    TEXT,
  roles_json     TEXT    NOT NULL DEFAULT '[]',
  doc_types_json TEXT    NOT NULL DEFAULT '[]',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_acc_templates ON acc_raci_templates (COALESCE(company_id, 0), process_code);
CREATE INDEX IF NOT EXISTS ix_acc_templates_company ON acc_raci_templates (company_id);

CREATE TABLE IF NOT EXISTS acc_raci_assignments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  scope_type     TEXT    NOT NULL CHECK (scope_type IN ('COMPANY', 'DEPARTMENT', 'PROJECT', 'SITE', 'WBS')),
  scope_id       INTEGER NOT NULL DEFAULT 0,
  process_code   TEXT    NOT NULL,
  user_id        TEXT,
  role_code      TEXT,
  raci           TEXT    NOT NULL CHECK (raci IN ('R', 'A', 'C', 'I')),
  status         TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  effective_from TEXT    NOT NULL,
  effective_to   TEXT,
  batch_id       INTEGER NOT NULL,
  reason         TEXT,
  instance_id    INTEGER REFERENCES wf_instances (id),
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
  CHECK (user_id IS NOT NULL OR role_code IS NOT NULL),
  CHECK (raci != 'A' OR user_id IS NOT NULL),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS ix_acc_raci_scope ON acc_raci_assignments (company_id, scope_type, scope_id, process_code, status);
CREATE INDEX IF NOT EXISTS ix_acc_raci_user ON acc_raci_assignments (company_id, user_id, status);
CREATE INDEX IF NOT EXISTS ix_acc_raci_role ON acc_raci_assignments (company_id, role_code, status);
CREATE INDEX IF NOT EXISTS ix_acc_raci_batch ON acc_raci_assignments (batch_id);
CREATE INDEX IF NOT EXISTS ix_acc_raci_instance ON acc_raci_assignments (instance_id);

CREATE TABLE IF NOT EXISTS acc_action_ledger (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  occurred_at    TEXT    NOT NULL,
  actor_id       TEXT    NOT NULL,
  role_code      TEXT,
  action         TEXT    NOT NULL CHECK (action IN ('created','submitted','verified','approved','rejected','modified','executed','recorded','reconciled','cancelled','reversed','closed')),
  entity         TEXT    NOT NULL,
  entity_id      TEXT    NOT NULL,
  entity_ref     TEXT,
  process_code   TEXT,
  outcome        TEXT    NOT NULL DEFAULT 'OK',
  due_at         TEXT,
  on_time        INTEGER CHECK (on_time IS NULL OR on_time IN (0, 1)),
  affected_user  TEXT,
  details_json   TEXT    NOT NULL DEFAULT '{}',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_acc_ledger_source ON acc_action_ledger (company_id, source_type, source_id, action) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_acc_ledger_actor ON acc_action_ledger (company_id, actor_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_acc_ledger_project ON acc_action_ledger (company_id, project_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_acc_ledger_entity ON acc_action_ledger (company_id, entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_acc_ledger_process ON acc_action_ledger (company_id, process_code, occurred_at);
CREATE INDEX IF NOT EXISTS ix_acc_ledger_affected ON acc_action_ledger (company_id, affected_user, outcome);
CREATE TRIGGER IF NOT EXISTS trg_acc_ledger_no_update BEFORE UPDATE ON acc_action_ledger BEGIN SELECT RAISE(ABORT, 'A ledger entry cannot be changed'); END;
CREATE TRIGGER IF NOT EXISTS trg_acc_ledger_no_delete BEFORE DELETE ON acc_action_ledger BEGIN SELECT RAISE(ABORT, 'A ledger entry cannot be removed'); END;

CREATE TABLE IF NOT EXISTS acc_ledger_cursors (
  source_type TEXT PRIMARY KEY,
  last_id     INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT
);
