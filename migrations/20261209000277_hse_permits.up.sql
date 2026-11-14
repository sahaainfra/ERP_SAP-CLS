-- Part 19.02: permit types (the checklist, certifications, gas tests, isolations and conflicts each type needs) and the permits to work. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS hse_permit_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  name_hi         TEXT,
  risk_class      TEXT    NOT NULL DEFAULT 'NORMAL' CHECK (risk_class IN ('NORMAL', 'HIGH')),
  required_certs_json TEXT NOT NULL DEFAULT '[]',
  checklist_template_id INTEGER REFERENCES qa_checklist_templates (id),
  requires_gas_test INTEGER NOT NULL DEFAULT 0 CHECK (requires_gas_test IN (0, 1)),
  gases_json      TEXT    NOT NULL DEFAULT '[]',
  requires_isolation INTEGER NOT NULL DEFAULT 0 CHECK (requires_isolation IN (0, 1)),
  max_hours       INTEGER NOT NULL DEFAULT 12 CHECK (max_hours BETWEEN 1 AND 24),
  conflicts_json  TEXT    NOT NULL DEFAULT '[]',
  ppe_json        TEXT    NOT NULL DEFAULT '[]',
  type_status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (type_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_pt_code ON hse_permit_types (company_id, code);
CREATE INDEX IF NOT EXISTS ix_hse_pt_template ON hse_permit_types (checklist_template_id);
CREATE TABLE IF NOT EXISTS hse_permits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  type_id         INTEGER NOT NULL REFERENCES hse_permit_types (id),
  risk_class      TEXT    NOT NULL DEFAULT 'NORMAL' CHECK (risk_class IN ('NORMAL', 'HIGH')),
  location_id     INTEGER REFERENCES proj_locations (id),
  wa_id           INTEGER REFERENCES site_work_authorisations (id),
  jsa_id          INTEGER REFERENCES hse_jsa (id),
  checklist_inspection_id INTEGER REFERENCES qa_inspections (id),
  title           TEXT    NOT NULL,
  work_description TEXT,
  supervisor      TEXT    NOT NULL,
  valid_from      TEXT    NOT NULL,
  valid_to        TEXT    NOT NULL,
  extension_count INTEGER NOT NULL DEFAULT 0 CHECK (extension_count >= 0),
  workers_json    TEXT    NOT NULL DEFAULT '[]',
  ppe_json        TEXT    NOT NULL DEFAULT '[]',
  emergency_text  TEXT,
  gas_tests_json  TEXT    NOT NULL DEFAULT '[]',
  isolations_json TEXT    NOT NULL DEFAULT '[]',
  permit_status   TEXT    NOT NULL DEFAULT 'PENDING' CHECK (permit_status IN ('PENDING', 'ON_HOLD', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'CLOSED')),
  activated_at    TEXT,
  suspended_at    TEXT,
  suspended_reason TEXT,
  expired_at      TEXT,
  closed_at       TEXT,
  closed_by       TEXT,
  handback_json   TEXT,
  hold_reason     TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  cancel_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_pm_doc ON hse_permits (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_hse_pm_site ON hse_permits (org_site_id, permit_status);
CREATE INDEX IF NOT EXISTS ix_hse_pm_project ON hse_permits (org_project_id, status);
CREATE INDEX IF NOT EXISTS ix_hse_pm_type ON hse_permits (type_id);
CREATE INDEX IF NOT EXISTS ix_hse_pm_location ON hse_permits (location_id, permit_status);
CREATE INDEX IF NOT EXISTS ix_hse_pm_wa ON hse_permits (wa_id);
CREATE INDEX IF NOT EXISTS ix_hse_pm_jsa ON hse_permits (jsa_id);
CREATE INDEX IF NOT EXISTS ix_hse_pm_inspection ON hse_permits (checklist_inspection_id);
CREATE INDEX IF NOT EXISTS ix_hse_pm_window ON hse_permits (permit_status, valid_to);
