-- Part 20.01: batching plants (with their silos and weighing scales) and mix designs (recipes), both approval-controlled; quantities in thousandths, a plant belongs to one project and site and serves others.
CREATE TABLE IF NOT EXISTS bp_plants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  equipment_id    INTEGER REFERENCES plt_equipment (id),
  make_model      TEXT,
  capacity_m3h_milli INTEGER NOT NULL DEFAULT 0 CHECK (capacity_m3h_milli >= 0),
  ownership       TEXT    NOT NULL DEFAULT 'OWN' CHECK (ownership IN ('OWN', 'HIRED')),
  cc_code         TEXT,
  head_code       TEXT,
  project_ids_json TEXT   NOT NULL DEFAULT '[]',
  crew_json       TEXT    NOT NULL DEFAULT '[]',
  plant_status    TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (plant_status IN ('ACTIVE', 'MAINTENANCE', 'INACTIVE')),
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  root_id         INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_bp_plants_root ON bp_plants (root_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_plants_doc ON bp_plants (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_plants_code ON bp_plants (company_id, code, version_no);
CREATE INDEX IF NOT EXISTS ix_bp_plants_org_project_id ON bp_plants (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bp_plants_org_site_id ON bp_plants (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bp_plants_location_id ON bp_plants (location_id);
CREATE INDEX IF NOT EXISTS ix_bp_plants_equipment_id ON bp_plants (equipment_id);
CREATE TABLE IF NOT EXISTS bp_silos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  plant_id        INTEGER NOT NULL REFERENCES bp_plants (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  kind            TEXT    NOT NULL DEFAULT 'SILO' CHECK (kind IN ('SILO', 'BIN', 'TANK')),
  capacity_milli  INTEGER NOT NULL CHECK (capacity_milli >= 0),
  current_level_milli INTEGER NOT NULL DEFAULT 0 CHECK (current_level_milli >= 0),
  uom             TEXT    NOT NULL DEFAULT 'KG',
  silo_status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (silo_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_silos_code ON bp_silos (plant_id, code);
CREATE INDEX IF NOT EXISTS ix_bp_silos_company_id ON bp_silos (company_id);
CREATE INDEX IF NOT EXISTS ix_bp_silos_item_id ON bp_silos (item_id);
CREATE TABLE IF NOT EXISTS bp_scales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  plant_id        INTEGER NOT NULL REFERENCES bp_plants (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  scale_type      TEXT    NOT NULL CHECK (scale_type IN ('CEMENT', 'AGGREGATE', 'WATER', 'ADMIXTURE', 'OTHER')),
  capacity_milli  INTEGER NOT NULL DEFAULT 0 CHECK (capacity_milli >= 0),
  calibrated_on   TEXT,
  calibration_due TEXT,
  certificate_ref TEXT,
  scale_status    TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (scale_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_scales_code ON bp_scales (plant_id, code);
CREATE INDEX IF NOT EXISTS ix_bp_scales_company_id ON bp_scales (company_id);
CREATE TABLE IF NOT EXISTS bp_mix_designs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  code            TEXT    NOT NULL COLLATE NOCASE,
  plant_id        INTEGER NOT NULL REFERENCES bp_plants (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  grade           TEXT    NOT NULL CHECK (grade IN ('M10', 'M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50', 'M55', 'M60')),
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  proportions_json TEXT   NOT NULL DEFAULT '[]',
  binder_milli    INTEGER NOT NULL DEFAULT 0 CHECK (binder_milli >= 0),
  wc_ratio_milli  INTEGER NOT NULL DEFAULT 0 CHECK (wc_ratio_milli >= 0),
  volume_ppm      INTEGER NOT NULL DEFAULT 0 CHECK (volume_ppm >= 0),
  slump_mm        INTEGER NOT NULL DEFAULT 0 CHECK (slump_mm >= 0),
  trial_results_json TEXT NOT NULL DEFAULT '[]',
  effective_from  TEXT,
  effective_to    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_mix_doc ON bp_mix_designs (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_mix_code ON bp_mix_designs (company_id, code, version_no);
CREATE INDEX IF NOT EXISTS ix_bp_mix_designs_plant_id ON bp_mix_designs (plant_id);
CREATE INDEX IF NOT EXISTS ix_bp_mix_designs_org_project_id ON bp_mix_designs (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bp_mix_designs_org_site_id ON bp_mix_designs (org_site_id);
