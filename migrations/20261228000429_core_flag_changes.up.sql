-- Audit AUD-DEF-009 / D-002: a feature-flag change in staging or production is a configuration change, which the approval reference
-- (07, part 29.01) and the role catalogue (06, SYSADM) make maker-checker: SYSADM proposes, ITADM approves (financial and security
-- modules: CFO or DIR too). Each requested change waits here for its checkers (not the workflow engine: that engine is itself behind a flag).
CREATE TABLE IF NOT EXISTS core_flag_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  flag_key        TEXT    NOT NULL,
  scope_level     TEXT    NOT NULL CHECK (scope_level IN ('default', 'environment', 'company', 'project')),
  scope_environment TEXT,
  scope_company_id INTEGER REFERENCES org_companies (id),
  scope_project_id INTEGER REFERENCES org_projects (id),
  enabled         INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  area            TEXT    NOT NULL DEFAULT 'GENERAL' CHECK (area IN ('GENERAL', 'FINANCIAL', 'SECURITY')),
  reason          TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPLIED', 'REJECTED', 'CANCELLED')),
  requested_by    TEXT    NOT NULL,
  first_approved_by TEXT,
  first_approved_at TEXT,
  decided_by      TEXT,
  decided_at      TEXT,
  decision_note   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_flag_changes_doc ON core_flag_changes (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_core_flag_changes_company_id ON core_flag_changes (company_id);
CREATE INDEX IF NOT EXISTS ix_core_flag_changes_status ON core_flag_changes (company_id, status);
CREATE INDEX IF NOT EXISTS ix_core_flag_changes_key ON core_flag_changes (flag_key);
CREATE INDEX IF NOT EXISTS ix_core_flag_changes_scope_company_id ON core_flag_changes (scope_company_id);
CREATE INDEX IF NOT EXISTS ix_core_flag_changes_scope_project_id ON core_flag_changes (scope_project_id);
