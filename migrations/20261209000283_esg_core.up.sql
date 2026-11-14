-- Part 19.05: environmental readings (consumption and monitoring), construction waste, versioned emission factors and environmental consents. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS esg_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  metric          TEXT    NOT NULL,
  period          TEXT    NOT NULL,
  reading_date    TEXT    NOT NULL,
  value_milli     INTEGER NOT NULL CHECK (value_milli >= 0),
  uom             TEXT    NOT NULL,
  limit_milli     INTEGER CHECK (limit_milli IS NULL OR limit_milli >= 0),
  breach          INTEGER NOT NULL DEFAULT 0 CHECK (breach IN (0, 1)),
  origin          TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (origin IN ('MANUAL', 'FUEL', 'MATERIAL', 'METER')),
  entered_by      TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_esg_rd_site ON esg_readings (org_site_id, metric, period);
CREATE INDEX IF NOT EXISTS ix_esg_rd_project ON esg_readings (org_project_id, period);
CREATE INDEX IF NOT EXISTS ix_esg_rd_breach ON esg_readings (company_id, breach, reading_date);
CREATE UNIQUE INDEX IF NOT EXISTS ux_esg_rd_pull ON esg_readings (company_id, source_type, source_id) WHERE source_id IS NOT NULL AND deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS esg_waste (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  waste_date      TEXT    NOT NULL,
  category        TEXT    NOT NULL CHECK (category IN ('CONCRETE', 'STEEL', 'WOOD', 'PLASTIC', 'PAPER', 'EXCAVATED_SOIL', 'EWASTE', 'HAZARDOUS', 'OTHER')),
  qty_milli       INTEGER NOT NULL CHECK (qty_milli > 0),
  disposal_method TEXT    NOT NULL CHECK (disposal_method IN ('REUSED', 'RECYCLED', 'AUTHORISED_VENDOR', 'LANDFILL', 'INCINERATION')),
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  manifest_no     TEXT,
  manifest_file_id INTEGER,
  entered_by      TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_esg_w_site ON esg_waste (org_site_id, waste_date);
CREATE INDEX IF NOT EXISTS ix_esg_w_project ON esg_waste (org_project_id, category);
CREATE INDEX IF NOT EXISTS ix_esg_w_vendor ON esg_waste (vendor_id);
CREATE TABLE IF NOT EXISTS esg_emission_factors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  metric          TEXT    NOT NULL,
  scope_no        INTEGER NOT NULL CHECK (scope_no IN (1, 2, 3)),
  factor_milli    INTEGER NOT NULL CHECK (factor_milli >= 0),
  unit            TEXT    NOT NULL,
  factor_source   TEXT    NOT NULL,
  effective_from  TEXT    NOT NULL,
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  factor_status   TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (factor_status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  entered_by      TEXT    NOT NULL,
  activated_by    TEXT,
  activated_at    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_esg_ef_ver ON esg_emission_factors (company_id, metric, version_no);
CREATE INDEX IF NOT EXISTS ix_esg_ef_metric ON esg_emission_factors (company_id, metric, factor_status, effective_from);
CREATE TABLE IF NOT EXISTS esg_permits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  permit_type     TEXT    NOT NULL CHECK (permit_type IN ('CTE', 'CTO', 'HAZARDOUS_WASTE', 'GROUNDWATER', 'OTHER')),
  permit_no       TEXT    NOT NULL,
  authority       TEXT    NOT NULL,
  valid_from      TEXT    NOT NULL,
  valid_until     TEXT    NOT NULL,
  file_id         INTEGER,
  alerted_state   TEXT,
  consent_status  TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (consent_status IN ('ACTIVE', 'SURRENDERED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_esg_pm_no ON esg_permits (company_id, permit_type, permit_no);
CREATE INDEX IF NOT EXISTS ix_esg_pm_project ON esg_permits (org_project_id, valid_until);
CREATE INDEX IF NOT EXISTS ix_esg_pm_site ON esg_permits (org_site_id);
CREATE INDEX IF NOT EXISTS ix_esg_waste_company_id ON esg_waste (company_id);
