-- Part 10.04: BOQ management (module proj, tables proj_boq_*): versions (tender, contract, revised) with their hierarchy of lines, the split of each item over WBS nodes and locations, resource norms and the changes of mapping after the freeze.
-- Quantities x 1 000, rates x 10 000, amounts in paise, percentages x 10 000. proj_boq_versions: a version of the BOQ of a project (a contract version is frozen by approval and then immutable); proj_boq_lines: bill, section, item and sub-item
-- (only the lowest lines carry quantity, rate and amount); proj_boq_line_wbs: the quantity of an item in a WBS node and optionally a location (the splits sum to the item quantity); proj_boq_line_norms: the resource norms of an item (per unit of
-- the item); proj_boq_changes: a change of mapping or norms of a frozen version, approved by QS and the project manager. The thin proj_boq_items of part 10.02 stays as the copy of the award; a tender version is made from it.
CREATE TABLE IF NOT EXISTS proj_boq_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  vtype           TEXT    NOT NULL CHECK (vtype IN ('TENDER', 'CONTRACT', 'REVISED')),
  version_no      INTEGER NOT NULL CHECK (version_no >= 1),
  name            TEXT    NOT NULL,
  source_ref      TEXT,
  parent_version_id INTEGER REFERENCES proj_boq_versions (id),
  variation_ref   TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  total_amount    INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  items_count     INTEGER NOT NULL DEFAULT 0,
  import_map_json TEXT,
  frozen_at       TEXT,
  frozen_by       TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  reason          TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_boq_versions_doc ON proj_boq_versions (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_boq_versions_no ON proj_boq_versions (org_project_id, version_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_boq_versions_contract ON proj_boq_versions (org_project_id) WHERE deleted_at IS NULL AND vtype = 'CONTRACT' AND status IN ('SUBMITTED', 'APPROVED');
CREATE INDEX IF NOT EXISTS ix_proj_boq_versions_company_id ON proj_boq_versions (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_boq_versions_status ON proj_boq_versions (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proj_boq_versions_parent ON proj_boq_versions (parent_version_id);

CREATE TABLE IF NOT EXISTS proj_boq_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  version_id      INTEGER NOT NULL REFERENCES proj_boq_versions (id),
  parent_id       INTEGER REFERENCES proj_boq_lines (id),
  line_kind       TEXT    NOT NULL CHECK (line_kind IN ('BILL', 'SECTION', 'ITEM', 'SUBITEM')),
  item_code       TEXT    NOT NULL COLLATE NOCASE,
  description     TEXT    NOT NULL,
  uom             TEXT,
  qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  rate            INTEGER NOT NULL DEFAULT 0 CHECK (rate >= 0),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  is_extra        INTEGER NOT NULL DEFAULT 0 CHECK (is_extra IN (0, 1)),
  work_item_id    INTEGER REFERENCES mdm_items (id),
  analysis_id     INTEGER REFERENCES ra_analyses (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  source_line_id  INTEGER,
  source_row      INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_boq_lines_code ON proj_boq_lines (version_id, item_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proj_boq_lines_company_id ON proj_boq_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_boq_lines_parent ON proj_boq_lines (version_id, parent_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_proj_boq_lines_parent_id ON proj_boq_lines (parent_id);
CREATE INDEX IF NOT EXISTS ix_proj_boq_lines_work_item ON proj_boq_lines (work_item_id);
CREATE INDEX IF NOT EXISTS ix_proj_boq_lines_analysis ON proj_boq_lines (analysis_id);
CREATE INDEX IF NOT EXISTS ix_proj_boq_lines_cost_code ON proj_boq_lines (cost_code_id);

CREATE TABLE IF NOT EXISTS proj_boq_line_wbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  line_id         INTEGER NOT NULL REFERENCES proj_boq_lines (id),
  wbs_id          INTEGER NOT NULL REFERENCES proj_wbs (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  qty             INTEGER NOT NULL CHECK (qty >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_boq_line_wbs ON proj_boq_line_wbs (line_id, wbs_id, COALESCE(location_id, 0));
CREATE INDEX IF NOT EXISTS ix_proj_boq_line_wbs_company_id ON proj_boq_line_wbs (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_boq_line_wbs_wbs ON proj_boq_line_wbs (wbs_id);
CREATE INDEX IF NOT EXISTS ix_proj_boq_line_wbs_location ON proj_boq_line_wbs (location_id);

CREATE TABLE IF NOT EXISTS proj_boq_line_norms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  line_id         INTEGER NOT NULL REFERENCES proj_boq_lines (id),
  resource_item_id INTEGER REFERENCES mdm_items (id),
  norm_type       TEXT    NOT NULL CHECK (norm_type IN ('MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER')),
  description     TEXT    NOT NULL,
  uom             TEXT    NOT NULL,
  qty_per_unit    INTEGER NOT NULL CHECK (qty_per_unit >= 0),
  wastage_pct     INTEGER NOT NULL DEFAULT 0 CHECK (wastage_pct >= 0),
  sort_order      INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS ix_proj_boq_line_norms_company_id ON proj_boq_line_norms (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_boq_line_norms_line ON proj_boq_line_norms (line_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_proj_boq_line_norms_item ON proj_boq_line_norms (resource_item_id);

CREATE TABLE IF NOT EXISTS proj_boq_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  version_id      INTEGER NOT NULL REFERENCES proj_boq_versions (id),
  change_status   TEXT    NOT NULL DEFAULT 'SUBMITTED' CHECK (change_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  reason          TEXT    NOT NULL,
  ops_json        TEXT    NOT NULL DEFAULT '[]',
  diff_json       TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  decided_at      TEXT,
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
CREATE INDEX IF NOT EXISTS ix_proj_boq_changes_company_id ON proj_boq_changes (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_boq_changes_version ON proj_boq_changes (version_id, change_status);

-- proj_boq_import_rows: the rows of a client BOQ staged in chunks (a request body is limited to 50 KB) until the import is committed or abandoned.
CREATE TABLE IF NOT EXISTS proj_boq_import_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  stage_id        TEXT    NOT NULL,
  user_ref        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  row_no          INTEGER NOT NULL,
  data_json       TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_proj_boq_import_rows_company_id ON proj_boq_import_rows (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_boq_import_rows_stage ON proj_boq_import_rows (stage_id, row_no);
CREATE INDEX IF NOT EXISTS ix_proj_boq_import_rows_project ON proj_boq_import_rows (org_project_id);
