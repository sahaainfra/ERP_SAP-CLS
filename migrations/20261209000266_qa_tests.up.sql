-- Part 18.03: the test catalogue, site laboratory equipment with calibration, test requests (receiving inspection and tests on GRN lines under inspection) and their results. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS qa_test_catalogue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  material_category_id INTEGER REFERENCES mdm_item_categories (id),
  material_item_id INTEGER REFERENCES mdm_items (id),
  standard        TEXT,
  parameters_json TEXT    NOT NULL DEFAULT '[]',
  freq_basis      TEXT    NOT NULL DEFAULT 'NONE' CHECK (freq_basis IN ('NONE', 'QTY', 'LOT')),
  freq_qty        INTEGER NOT NULL DEFAULT 0 CHECK (freq_qty >= 0),
  freq_uom        TEXT,
  lab_type        TEXT    NOT NULL DEFAULT 'SITE' CHECK (lab_type IN ('SITE', 'THIRD_PARTY')),
  status          TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_tc_code ON qa_test_catalogue (company_id, code);
CREATE INDEX IF NOT EXISTS ix_qa_tc_category ON qa_test_catalogue (material_category_id);
CREATE INDEX IF NOT EXISTS ix_qa_tc_item ON qa_test_catalogue (material_item_id);
CREATE TABLE IF NOT EXISTS qa_lab_equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  name            TEXT    NOT NULL,
  make            TEXT,
  serial_no       TEXT,
  last_calibrated TEXT,
  calibration_due TEXT,
  interval_days   INTEGER NOT NULL DEFAULT 365 CHECK (interval_days BETWEEN 1 AND 3650),
  certificate_file_id INTEGER REFERENCES core_files (id),
  status          TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'OUT_OF_SERVICE', 'RETIRED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_le_code ON qa_lab_equipment (company_id, code);
CREATE INDEX IF NOT EXISTS ix_qa_le_project ON qa_lab_equipment (org_project_id);
CREATE INDEX IF NOT EXISTS ix_qa_le_site ON qa_lab_equipment (org_site_id);
CREATE INDEX IF NOT EXISTS ix_qa_le_due ON qa_lab_equipment (company_id, calibration_due);
CREATE INDEX IF NOT EXISTS ix_qa_le_cert ON qa_lab_equipment (certificate_file_id);
CREATE TABLE IF NOT EXISTS qa_test_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  catalogue_id    INTEGER REFERENCES qa_test_catalogue (id),
  material_item_id INTEGER REFERENCES mdm_items (id),
  grn_id          INTEGER REFERENCES inv_grns (id),
  grn_line_id     INTEGER REFERENCES inv_grn_lines (id),
  lot_qty         INTEGER NOT NULL DEFAULT 0 CHECK (lot_qty >= 0),
  sample_ref      TEXT,
  lab_type        TEXT    NOT NULL DEFAULT 'SITE' CHECK (lab_type IN ('SITE', 'THIRD_PARTY')),
  lab_name        TEXT,
  requested_on    TEXT    NOT NULL,
  sampled_on      TEXT,
  visual_ok       INTEGER CHECK (visual_ok IS NULL OR visual_ok IN (0, 1)),
  documents_ok    INTEGER CHECK (documents_ok IS NULL OR documents_ok IN (0, 1)),
  sampling_decision TEXT  NOT NULL DEFAULT 'TEST' CHECK (sampling_decision IN ('TEST', 'CERTIFICATE_ONLY')),
  certificate_file_id INTEGER REFERENCES core_files (id),
  result          TEXT    CHECK (result IS NULL OR result IN ('PASS', 'FAIL')),
  concession_ref  TEXT,
  concession_reason TEXT,
  outcome         TEXT    CHECK (outcome IS NULL OR outcome IN ('ACCEPTED', 'ACCEPTED_CONCESSION', 'REJECTED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_tr_doc ON qa_test_requests (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_qa_tr_project ON qa_test_requests (org_project_id, status);
CREATE INDEX IF NOT EXISTS ix_qa_tr_site ON qa_test_requests (org_site_id);
CREATE INDEX IF NOT EXISTS ix_qa_tr_catalogue ON qa_test_requests (catalogue_id);
CREATE INDEX IF NOT EXISTS ix_qa_tr_item ON qa_test_requests (material_item_id);
CREATE INDEX IF NOT EXISTS ix_qa_tr_grn ON qa_test_requests (grn_id);
CREATE INDEX IF NOT EXISTS ix_qa_tr_line ON qa_test_requests (grn_line_id);
CREATE INDEX IF NOT EXISTS ix_qa_tr_cert ON qa_test_requests (certificate_file_id);
CREATE TABLE IF NOT EXISTS qa_test_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  request_id      INTEGER NOT NULL REFERENCES qa_test_requests (id),
  parameter_code  TEXT    NOT NULL,
  parameter_name  TEXT    NOT NULL,
  unit            TEXT,
  value_e3        INTEGER NOT NULL,
  limit_min_e3    INTEGER,
  limit_max_e3    INTEGER,
  passed          INTEGER NOT NULL CHECK (passed IN (0, 1)),
  equipment_id    INTEGER REFERENCES qa_lab_equipment (id),
  tested_on       TEXT    NOT NULL,
  certificate_file_id INTEGER REFERENCES core_files (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_trs_param ON qa_test_results (request_id, parameter_code);
CREATE INDEX IF NOT EXISTS ix_qa_trs_company ON qa_test_results (company_id);
CREATE INDEX IF NOT EXISTS ix_qa_trs_equipment ON qa_test_results (equipment_id);
CREATE INDEX IF NOT EXISTS ix_qa_trs_cert ON qa_test_results (certificate_file_id);
