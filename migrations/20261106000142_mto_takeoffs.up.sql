-- Part 09.02: quantity take-off, material take-off and bar bending schedules (module est, tables mto_*). Fixed-point integers as in 09.01: quantities x 1 000, percentages x 10 000; lengths in metres x 1 000; weights in kg x 1 000.
-- mto_takeoffs: a take-off sheet (measurement lines of a drawing) or an engineering MTO (EPC line items with their specs), in revisions sharing doc_no; released by a checker. mto_takeoff_lines: the measurement lines.
-- mto_bbs and mto_bbs_lines: a bar bending schedule of a drawing and member, in revisions: bar marks with diameter, IS 2502 shape code, number, cut length, total length and weight.
-- mto_material_requirements: the materials a released revision needs (BOQ quantity x bill of resources x (1 + wastage), or the steel of a BBS by diameter), for estimation and MRP.
CREATE TABLE IF NOT EXISTS mto_takeoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  revision_no     INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  kind            TEXT    NOT NULL DEFAULT 'TAKEOFF' CHECK (kind IN ('TAKEOFF', 'ENGINEERING')),
  discipline      TEXT    NOT NULL DEFAULT 'CIVIL' CHECK (discipline IN ('CIVIL', 'STRUCTURAL', 'PIPING', 'ELECTRICAL', 'MECHANICAL', 'OTHER')),
  title           TEXT    NOT NULL,
  tender_id       INTEGER REFERENCES tdr_tenders (id),
  estimate_id     INTEGER REFERENCES est_estimates (id),
  drawing_ref     TEXT    NOT NULL,
  drawing_rev     TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  released_at     TEXT,
  supersedes_id   INTEGER,
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
  CHECK (tender_id IS NOT NULL OR project_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mto_takeoffs_doc ON mto_takeoffs (company_id, doc_no, revision_no);
CREATE INDEX IF NOT EXISTS ix_mto_takeoffs_company_id ON mto_takeoffs (company_id);
CREATE INDEX IF NOT EXISTS ix_mto_takeoffs_status ON mto_takeoffs (company_id, status);
CREATE INDEX IF NOT EXISTS ix_mto_takeoffs_project ON mto_takeoffs (project_id);
CREATE INDEX IF NOT EXISTS ix_mto_takeoffs_tender ON mto_takeoffs (tender_id);
CREATE INDEX IF NOT EXISTS ix_mto_takeoffs_estimate ON mto_takeoffs (estimate_id);
CREATE INDEX IF NOT EXISTS ix_mto_takeoffs_drawing ON mto_takeoffs (company_id, drawing_ref);
CREATE TABLE IF NOT EXISTS mto_takeoff_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  takeoff_id      INTEGER NOT NULL REFERENCES mto_takeoffs (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  boq_item_ref    TEXT,
  description     TEXT    NOT NULL,
  location        TEXT,
  formula_code    TEXT    NOT NULL,
  work_item_id    INTEGER REFERENCES mdm_items (id),
  material_item_id INTEGER REFERENCES mdm_items (id),
  spec            TEXT,
  nos             INTEGER NOT NULL DEFAULT 1000 CHECK (nos >= 0),
  length          INTEGER CHECK (length IS NULL OR length >= 0),
  breadth         INTEGER CHECK (breadth IS NULL OR breadth >= 0),
  height          INTEGER CHECK (height IS NULL OR height >= 0),
  deduction       INTEGER NOT NULL DEFAULT 0 CHECK (deduction >= 0),
  quantity        INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  uom             TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_mto_takeoff_lines_company_id ON mto_takeoff_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_mto_takeoff_lines_takeoff ON mto_takeoff_lines (takeoff_id, line_no);
CREATE INDEX IF NOT EXISTS ix_mto_takeoff_lines_work_item ON mto_takeoff_lines (work_item_id);
CREATE INDEX IF NOT EXISTS ix_mto_takeoff_lines_material ON mto_takeoff_lines (material_item_id);
CREATE TABLE IF NOT EXISTS mto_bbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  revision_no     INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  title           TEXT    NOT NULL,
  drawing_ref     TEXT    NOT NULL,
  drawing_rev     TEXT,
  member          TEXT    NOT NULL,
  total_weight    INTEGER NOT NULL DEFAULT 0 CHECK (total_weight >= 0),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  released_at     TEXT,
  supersedes_id   INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mto_bbs_doc ON mto_bbs (company_id, doc_no, revision_no);
CREATE INDEX IF NOT EXISTS ix_mto_bbs_company_id ON mto_bbs (company_id);
CREATE INDEX IF NOT EXISTS ix_mto_bbs_status ON mto_bbs (company_id, status);
CREATE INDEX IF NOT EXISTS ix_mto_bbs_project ON mto_bbs (project_id);
CREATE INDEX IF NOT EXISTS ix_mto_bbs_drawing ON mto_bbs (company_id, drawing_ref);
CREATE TABLE IF NOT EXISTS mto_bbs_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  bbs_id          INTEGER NOT NULL REFERENCES mto_bbs (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  member          TEXT    NOT NULL,
  bar_mark        TEXT    NOT NULL,
  dia_mm          INTEGER NOT NULL CHECK (dia_mm BETWEEN 6 AND 50),
  shape_code      TEXT    NOT NULL,
  dim_a           INTEGER CHECK (dim_a IS NULL OR dim_a >= 0),
  dim_b           INTEGER CHECK (dim_b IS NULL OR dim_b >= 0),
  dim_c           INTEGER CHECK (dim_c IS NULL OR dim_c >= 0),
  dim_d           INTEGER CHECK (dim_d IS NULL OR dim_d >= 0),
  members_count   INTEGER NOT NULL DEFAULT 1 CHECK (members_count >= 1),
  bars_each       INTEGER NOT NULL CHECK (bars_each >= 1),
  nos             INTEGER NOT NULL CHECK (nos >= 1),
  cut_length_m    INTEGER NOT NULL DEFAULT 0 CHECK (cut_length_m >= 0),
  total_length_m  INTEGER NOT NULL DEFAULT 0 CHECK (total_length_m >= 0),
  unit_weight     INTEGER NOT NULL DEFAULT 0 CHECK (unit_weight >= 0),
  weight_kg       INTEGER NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
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
CREATE INDEX IF NOT EXISTS ix_mto_bbs_lines_company_id ON mto_bbs_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_mto_bbs_lines_bbs ON mto_bbs_lines (bbs_id, line_no);
CREATE INDEX IF NOT EXISTS ix_mto_bbs_lines_dia ON mto_bbs_lines (bbs_id, dia_mm);
CREATE TABLE IF NOT EXISTS mto_material_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  source_ref      TEXT    NOT NULL,
  item_id         INTEGER REFERENCES mdm_items (id),
  description     TEXT    NOT NULL,
  boq_item_ref    TEXT,
  net_qty         INTEGER NOT NULL CHECK (net_qty >= 0),
  wastage_pct     INTEGER NOT NULL DEFAULT 0 CHECK (wastage_pct >= 0),
  qty             INTEGER NOT NULL CHECK (qty >= 0),
  uom             TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_mto_material_requirements_company_id ON mto_material_requirements (company_id);
CREATE INDEX IF NOT EXISTS ix_mto_material_requirements_source ON mto_material_requirements (source_type, source_id);
CREATE INDEX IF NOT EXISTS ix_mto_material_requirements_item ON mto_material_requirements (item_id);
CREATE INDEX IF NOT EXISTS ix_mto_material_requirements_project ON mto_material_requirements (project_id);
