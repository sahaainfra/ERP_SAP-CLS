-- Part 20.03: the cost of a batching plant by month (collected lines and the period they add up to), the cost per m3 by grade, internal transfer rates (approval-controlled), the charges to projects and the plant budget; money in paise, volumes in thousandths of m3.
CREATE TABLE IF NOT EXISTS bp_cost_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  plant_id        INTEGER NOT NULL REFERENCES bp_plants (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  material_paise  INTEGER NOT NULL DEFAULT 0 CHECK (material_paise >= 0),
  power_paise     INTEGER NOT NULL DEFAULT 0 CHECK (power_paise >= 0),
  fuel_paise      INTEGER NOT NULL DEFAULT 0 CHECK (fuel_paise >= 0),
  labour_paise    INTEGER NOT NULL DEFAULT 0 CHECK (labour_paise >= 0),
  maintenance_paise INTEGER NOT NULL DEFAULT 0 CHECK (maintenance_paise >= 0),
  depreciation_paise INTEGER NOT NULL DEFAULT 0 CHECK (depreciation_paise >= 0),
  overhead_paise  INTEGER NOT NULL DEFAULT 0 CHECK (overhead_paise >= 0),
  total_paise     INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  volume_milli    INTEGER NOT NULL DEFAULT 0 CHECK (volume_milli >= 0),
  produced_milli  INTEGER NOT NULL DEFAULT 0 CHECK (produced_milli >= 0),
  wasted_milli    INTEGER NOT NULL DEFAULT 0 CHECK (wasted_milli >= 0),
  per_m3_paise    INTEGER NOT NULL DEFAULT 0 CHECK (per_m3_paise >= 0),
  revenue_paise   INTEGER NOT NULL DEFAULT 0 CHECK (revenue_paise >= 0),
  period_status   TEXT    NOT NULL DEFAULT 'OPEN' CHECK (period_status IN ('OPEN', 'CLOSED')),
  collected_at    TEXT,
  closed_by       TEXT,
  closed_at       TEXT,
  reopen_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_cp_doc ON bp_cost_periods (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_cp_plant ON bp_cost_periods (plant_id, period);
CREATE INDEX IF NOT EXISTS ix_bp_cost_periods_org_project_id ON bp_cost_periods (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bp_cost_periods_org_site_id ON bp_cost_periods (org_site_id);
CREATE TABLE IF NOT EXISTS bp_cost_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  period_id       INTEGER NOT NULL REFERENCES bp_cost_periods (id),
  category        TEXT    NOT NULL CHECK (category IN ('MATERIAL', 'POWER', 'FUEL', 'LABOUR', 'MAINTENANCE', 'DEPRECIATION', 'OVERHEAD')),
  grade           TEXT,
  amount_paise    INTEGER NOT NULL CHECK (amount_paise >= 0),
  line_origin     TEXT    NOT NULL DEFAULT 'AUTO' CHECK (line_origin IN ('AUTO', 'MANUAL')),
  basis           TEXT,
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
CREATE INDEX IF NOT EXISTS ix_bp_cost_lines_company_id ON bp_cost_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_bp_cost_lines_period_id ON bp_cost_lines (period_id);
CREATE TABLE IF NOT EXISTS bp_cost_grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  period_id       INTEGER NOT NULL REFERENCES bp_cost_periods (id),
  grade           TEXT    NOT NULL CHECK (grade IN ('M10', 'M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50', 'M55', 'M60')),
  volume_milli    INTEGER NOT NULL CHECK (volume_milli >= 0),
  material_paise  INTEGER NOT NULL CHECK (material_paise >= 0),
  conversion_paise INTEGER NOT NULL CHECK (conversion_paise >= 0),
  total_paise     INTEGER NOT NULL CHECK (total_paise >= 0),
  per_m3_paise    INTEGER NOT NULL CHECK (per_m3_paise >= 0),
  rate_paise      INTEGER NOT NULL DEFAULT 0 CHECK (rate_paise >= 0),
  revenue_paise   INTEGER NOT NULL DEFAULT 0 CHECK (revenue_paise >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_cg ON bp_cost_grades (period_id, grade);
CREATE INDEX IF NOT EXISTS ix_bp_cost_grades_company_id ON bp_cost_grades (company_id);
CREATE TABLE IF NOT EXISTS bp_transfer_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  plant_id        INTEGER NOT NULL REFERENCES bp_plants (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  grade           TEXT    NOT NULL CHECK (grade IN ('M10', 'M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50', 'M55', 'M60')),
  rate_paise      INTEGER NOT NULL CHECK (rate_paise > 0),
  effective_from  TEXT    NOT NULL,
  previous_paise  INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_tr_doc ON bp_transfer_rates (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_bp_tr_plant ON bp_transfer_rates (plant_id, grade, effective_from);
CREATE INDEX IF NOT EXISTS ix_bp_transfer_rates_org_project_id ON bp_transfer_rates (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bp_transfer_rates_org_site_id ON bp_transfer_rates (org_site_id);
CREATE TABLE IF NOT EXISTS bp_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  period_id       INTEGER NOT NULL REFERENCES bp_cost_periods (id),
  plant_id        INTEGER NOT NULL REFERENCES bp_plants (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  grade           TEXT    NOT NULL CHECK (grade IN ('M10', 'M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50', 'M55', 'M60')),
  volume_milli    INTEGER NOT NULL CHECK (volume_milli >= 0),
  rate_paise      INTEGER NOT NULL CHECK (rate_paise >= 0),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise >= 0),
  cost_alloc_paise INTEGER NOT NULL CHECK (cost_alloc_paise >= 0),
  variance_paise  INTEGER NOT NULL,
  posted_at       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_ch ON bp_charges (period_id, org_project_id, grade);
CREATE INDEX IF NOT EXISTS ix_bp_charges_company_id ON bp_charges (company_id);
CREATE INDEX IF NOT EXISTS ix_bp_charges_plant_id ON bp_charges (plant_id);
CREATE INDEX IF NOT EXISTS ix_bp_charges_org_project_id ON bp_charges (org_project_id);
CREATE TABLE IF NOT EXISTS bp_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  plant_id        INTEGER NOT NULL REFERENCES bp_plants (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  category        TEXT    NOT NULL CHECK (category IN ('MATERIAL', 'POWER', 'FUEL', 'LABOUR', 'MAINTENANCE', 'DEPRECIATION', 'OVERHEAD')),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise >= 0),
  volume_milli    INTEGER NOT NULL DEFAULT 0 CHECK (volume_milli >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_bud ON bp_budgets (plant_id, period, category);
CREATE INDEX IF NOT EXISTS ix_bp_budgets_company_id ON bp_budgets (company_id);
