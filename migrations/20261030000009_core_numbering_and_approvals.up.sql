-- Document types, numbering series, issued numbers, change requests with their approval steps, and the sample
-- document used to prove numbering and period control end to end (part 01.03).

CREATE TABLE IF NOT EXISTS core_document_types (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER,
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  module          TEXT    NOT NULL,
  template_id     TEXT,
  workflow_code   TEXT,
  retention_class TEXT    NOT NULL DEFAULT 'standard' CHECK (retention_class IN ('permanent', 'statutory', 'standard', 'short')),
  statutory       INTEGER NOT NULL DEFAULT 0 CHECK (statutory IN (0, 1)),
  assign_at       TEXT    NOT NULL DEFAULT 'create' CHECK (assign_at IN ('create', 'submit', 'approval')),
  project_id      INTEGER,
  site_id         INTEGER,
  created_by      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by      TEXT,
  updated_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at      TEXT,
  deleted_by      TEXT,
  source_type     TEXT,
  source_id       TEXT,
  remarks         TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_document_types_code ON core_document_types (code);
CREATE INDEX IF NOT EXISTS ix_core_document_types_module ON core_document_types (module);
CREATE INDEX IF NOT EXISTS ix_core_document_types_company ON core_document_types (company_id);

CREATE TABLE IF NOT EXISTS core_number_series (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  doc_type_id INTEGER NOT NULL REFERENCES core_document_types(id),
  branch_code TEXT,
  project_id  INTEGER,
  name        TEXT    NOT NULL,
  prefix      TEXT    NOT NULL,
  format      TEXT    NOT NULL,
  gap_free    INTEGER NOT NULL DEFAULT 0 CHECK (gap_free IN (0, 1)),
  reset_rule  TEXT    NOT NULL DEFAULT 'financial_year' CHECK (reset_rule IN ('never', 'financial_year', 'monthly')),
  seq_start   INTEGER NOT NULL DEFAULT 1 CHECK (seq_start >= 1),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_number_series_scope ON core_number_series (company_id, doc_type_id, COALESCE(branch_code, ''), COALESCE(project_id, 0));
CREATE INDEX IF NOT EXISTS ix_core_number_series_doc_type ON core_number_series (doc_type_id);

-- One counter per series and reset period ('' = never reset, FY code, or YYYY-MM). Technical table.
CREATE TABLE IF NOT EXISTS core_number_counters (
  series_id   INTEGER NOT NULL REFERENCES core_number_series(id),
  period_key  TEXT    NOT NULL,
  next_value  INTEGER NOT NULL CHECK (next_value >= 1),
  PRIMARY KEY (series_id, period_key)
);

-- Every number ever issued. A cancelled document keeps its number (status CANCELLED); rows are never deleted.
CREATE TABLE IF NOT EXISTS core_number_issues (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  series_id   INTEGER NOT NULL REFERENCES core_number_series(id),
  doc_type_id INTEGER NOT NULL REFERENCES core_document_types(id),
  period_key  TEXT    NOT NULL,
  seq         INTEGER NOT NULL CHECK (seq >= 1),
  number      TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'CANCELLED')),
  ref_type    TEXT,
  ref_id      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_number_issues_seq ON core_number_issues (series_id, period_key, seq);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_number_issues_number ON core_number_issues (series_id, number);
CREATE INDEX IF NOT EXISTS ix_core_number_issues_company ON core_number_issues (company_id, status);
CREATE INDEX IF NOT EXISTS ix_core_number_issues_doc_type ON core_number_issues (doc_type_id);
CREATE INDEX IF NOT EXISTS ix_core_number_issues_ref ON core_number_issues (ref_type, ref_id);

-- Approval-controlled configuration changes (period reopen, numbering series change). A thin stand-in for the
-- workflow engine of part 04.01: the chain of roles is fixed per request type, every decision is recorded.
CREATE TABLE IF NOT EXISTS core_change_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  type         TEXT    NOT NULL CHECK (type IN ('period_reopen', 'number_series_change')),
  title        TEXT    NOT NULL,
  target_type  TEXT    NOT NULL,
  target_id    INTEGER NOT NULL,
  payload_json TEXT    NOT NULL,
  reason       TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED')),
  chain_json   TEXT    NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 1,
  requested_by TEXT    NOT NULL,
  project_id   INTEGER,
  site_id      INTEGER,
  created_by   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by   TEXT,
  updated_at   TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at   TEXT,
  deleted_by   TEXT,
  source_type  TEXT,
  source_id    TEXT,
  remarks      TEXT
);
CREATE INDEX IF NOT EXISTS ix_core_change_requests_company_status ON core_change_requests (company_id, status);
CREATE INDEX IF NOT EXISTS ix_core_change_requests_type ON core_change_requests (type, status);
CREATE INDEX IF NOT EXISTS ix_core_change_requests_target ON core_change_requests (target_type, target_id);

CREATE TABLE IF NOT EXISTS core_change_request_steps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES core_change_requests(id),
  step_no    INTEGER NOT NULL,
  role_code  TEXT    NOT NULL,
  decision   TEXT    NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'RETURNED')),
  decided_by TEXT    NOT NULL,
  decided_at TEXT    NOT NULL,
  comment    TEXT
);
CREATE INDEX IF NOT EXISTS ix_core_change_request_steps_request ON core_change_request_steps (request_id);

-- A small numbered, dated document that follows every convention. Real modules copy its shape; here it proves
-- numbering at create or submit and period control against a transaction (acceptance criteria AC-02 and AC-03).
CREATE TABLE IF NOT EXISTS core_sample_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  project_id  INTEGER,
  site_id     INTEGER,
  doc_no      TEXT,
  doc_date    TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'CANCELLED')),
  title       TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_sample_documents_doc_no ON core_sample_documents (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_core_sample_documents_company_status ON core_sample_documents (company_id, status);
CREATE INDEX IF NOT EXISTS ix_core_sample_documents_project ON core_sample_documents (project_id);
