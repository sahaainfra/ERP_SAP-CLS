-- Part 07.07: leave management (module hr). lv_types (what a company grants and the rules), lv_entitlements (the balance of a person, a type and a year, always the sum of the ledger), lv_ledger (every movement),
-- lv_applications and lv_adjustments (approval-controlled), lv_year_runs (the year-end processing).

CREATE TABLE IF NOT EXISTS lv_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code           TEXT    NOT NULL COLLATE NOCASE,
  name           TEXT    NOT NULL,
  paid           INTEGER NOT NULL DEFAULT 1 CHECK (paid IN (0, 1)),
  rules_json     TEXT    NOT NULL DEFAULT '{}',
  status         TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_lv_types_code ON lv_types (company_id, code);
CREATE INDEX IF NOT EXISTS ix_lv_types_company_id ON lv_types (company_id);

CREATE TABLE IF NOT EXISTS lv_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  leave_type_id  INTEGER NOT NULL REFERENCES lv_types (id),
  year           INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  opening        REAL    NOT NULL DEFAULT 0,
  accrued        REAL    NOT NULL DEFAULT 0,
  adjusted       REAL    NOT NULL DEFAULT 0,
  availed        REAL    NOT NULL DEFAULT 0,
  lapsed         REAL    NOT NULL DEFAULT 0,
  encashed       REAL    NOT NULL DEFAULT 0,
  remaining      REAL    NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_lv_entitlements_key ON lv_entitlements (company_id, employee_id, leave_type_id, year);
CREATE INDEX IF NOT EXISTS ix_lv_entitlements_company_id ON lv_entitlements (company_id);
CREATE INDEX IF NOT EXISTS ix_lv_entitlements_type ON lv_entitlements (leave_type_id);
CREATE INDEX IF NOT EXISTS ix_lv_entitlements_employee ON lv_entitlements (employee_id);

CREATE TABLE IF NOT EXISTS lv_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  leave_type_id  INTEGER NOT NULL REFERENCES lv_types (id),
  year           INTEGER NOT NULL,
  txn_date       TEXT    NOT NULL,
  txn_type       TEXT    NOT NULL CHECK (txn_type IN ('OPENING', 'ACCRUAL', 'AVAILED', 'REVERSAL', 'LAPSED', 'ENCASHED', 'ADJUSTMENT', 'COMP_OFF')),
  days           REAL    NOT NULL CHECK (days != 0),
  ref_type       TEXT,
  ref_id         INTEGER,
  ref_key        TEXT,
  expires_on     TEXT,
  note           TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_lv_ledger_ref ON lv_ledger (company_id, employee_id, leave_type_id, ref_key) WHERE ref_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_lv_ledger_company_id ON lv_ledger (company_id);
CREATE INDEX IF NOT EXISTS ix_lv_ledger_person ON lv_ledger (employee_id, leave_type_id, year);
CREATE INDEX IF NOT EXISTS ix_lv_ledger_type ON lv_ledger (leave_type_id);

CREATE TABLE IF NOT EXISTS lv_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  revision_no    INTEGER NOT NULL DEFAULT 1,
  root_id        INTEGER,
  supersedes_id  INTEGER,
  doc_date       TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  leave_type_id  INTEGER NOT NULL REFERENCES lv_types (id),
  doc_site_id    INTEGER REFERENCES org_sites (id),
  from_date      TEXT    NOT NULL,
  to_date        TEXT    NOT NULL,
  half_day       TEXT    NOT NULL DEFAULT 'NONE' CHECK (half_day IN ('NONE', 'FIRST', 'SECOND')),
  days           REAL    NOT NULL CHECK (days > 0),
  leave_year     INTEGER NOT NULL,
  reason         TEXT    NOT NULL,
  attachment_file_id INTEGER,
  delegate_user  TEXT,
  delegation_id  INTEGER,
  applied_at     TEXT,
  band           TEXT    NOT NULL DEFAULT 'STANDARD',
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
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
  CHECK (to_date >= from_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lv_applications_doc ON lv_applications (company_id, doc_no, revision_no);
CREATE INDEX IF NOT EXISTS ix_lv_applications_company_id ON lv_applications (company_id);
CREATE INDEX IF NOT EXISTS ix_lv_applications_employee ON lv_applications (employee_id);
CREATE INDEX IF NOT EXISTS ix_lv_applications_type ON lv_applications (leave_type_id);
CREATE INDEX IF NOT EXISTS ix_lv_applications_site ON lv_applications (doc_site_id);
CREATE INDEX IF NOT EXISTS ix_lv_applications_status ON lv_applications (company_id, status);
CREATE INDEX IF NOT EXISTS ix_lv_applications_root_id ON lv_applications (root_id);
CREATE INDEX IF NOT EXISTS ix_lv_applications_supersedes_id ON lv_applications (supersedes_id);
CREATE INDEX IF NOT EXISTS ix_lv_applications_dates ON lv_applications (employee_id, from_date, to_date);
CREATE INDEX IF NOT EXISTS ix_lv_applications_attachment ON lv_applications (attachment_file_id);

CREATE TABLE IF NOT EXISTS lv_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  revision_no    INTEGER NOT NULL DEFAULT 1,
  root_id        INTEGER,
  supersedes_id  INTEGER,
  doc_date       TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  leave_type_id  INTEGER NOT NULL REFERENCES lv_types (id),
  doc_site_id    INTEGER REFERENCES org_sites (id),
  year           INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  days           REAL    NOT NULL CHECK (days != 0),
  reason         TEXT    NOT NULL,
  applied_at     TEXT,
  band           TEXT    NOT NULL DEFAULT 'STANDARD',
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_lv_adjustments_doc ON lv_adjustments (company_id, doc_no, revision_no);
CREATE INDEX IF NOT EXISTS ix_lv_adjustments_company_id ON lv_adjustments (company_id);
CREATE INDEX IF NOT EXISTS ix_lv_adjustments_employee ON lv_adjustments (employee_id);
CREATE INDEX IF NOT EXISTS ix_lv_adjustments_type ON lv_adjustments (leave_type_id);
CREATE INDEX IF NOT EXISTS ix_lv_adjustments_site ON lv_adjustments (doc_site_id);
CREATE INDEX IF NOT EXISTS ix_lv_adjustments_status ON lv_adjustments (company_id, status);
CREATE INDEX IF NOT EXISTS ix_lv_adjustments_root_id ON lv_adjustments (root_id);
CREATE INDEX IF NOT EXISTS ix_lv_adjustments_supersedes_id ON lv_adjustments (supersedes_id);

CREATE TABLE IF NOT EXISTS lv_year_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  year           INTEGER NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'DONE' CHECK (status IN ('DONE')),
  summary_json   TEXT    NOT NULL DEFAULT '{}',
  run_by         TEXT    NOT NULL,
  run_at         TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_lv_year_runs_year ON lv_year_runs (company_id, year);
CREATE INDEX IF NOT EXISTS ix_lv_year_runs_company_id ON lv_year_runs (company_id);
