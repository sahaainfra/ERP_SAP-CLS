-- Organisation hierarchy (part 02.02): Company > Branch/Region > Division/Department > Project > Site, with locations, cost and
-- profit centres, and effective-dated assignments (site in-charge, project manager, department head). All are business tables
-- with the standard columns. Company 1 is seeded because earlier parts already store data against company_id 1.

CREATE TABLE IF NOT EXISTS org_companies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER,
  code          TEXT    NOT NULL COLLATE NOCASE,
  legal_name    TEXT    NOT NULL,
  short_name    TEXT    NOT NULL,
  gstin_primary TEXT,
  pan           TEXT,
  status        TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_org_companies_code ON org_companies (code);
INSERT OR IGNORE INTO org_companies (id, company_id, code, legal_name, short_name, status, created_by, source_type)
VALUES (1, 1, 'MAIN', 'Main Company (rename me)', 'Main', 'ACTIVE', 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS org_branches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  parent_id     INTEGER REFERENCES org_branches (id),
  kind          TEXT    NOT NULL DEFAULT 'BRANCH' CHECK (kind IN ('BRANCH', 'REGION')),
  code          TEXT    NOT NULL COLLATE NOCASE,
  name          TEXT    NOT NULL,
  state_code    TEXT,
  address       TEXT,
  gstin         TEXT,
  status        TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_org_branches_code ON org_branches (company_id, COALESCE(parent_id, 0), code);
CREATE INDEX IF NOT EXISTS ix_org_branches_parent ON org_branches (parent_id);

CREATE TABLE IF NOT EXISTS org_departments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  parent_id     INTEGER REFERENCES org_departments (id),
  branch_id     INTEGER REFERENCES org_branches (id),
  kind          TEXT    NOT NULL DEFAULT 'DEPARTMENT' CHECK (kind IN ('DIVISION', 'DEPARTMENT')),
  code          TEXT    NOT NULL COLLATE NOCASE,
  name          TEXT    NOT NULL,
  head_user_id  INTEGER REFERENCES iam_users (id),
  status        TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_org_departments_code ON org_departments (company_id, COALESCE(parent_id, 0), code);
CREATE INDEX IF NOT EXISTS ix_org_departments_parent ON org_departments (parent_id);
CREATE INDEX IF NOT EXISTS ix_org_departments_branch ON org_departments (branch_id);
CREATE INDEX IF NOT EXISTS ix_org_departments_head ON org_departments (head_user_id);

CREATE TABLE IF NOT EXISTS org_designations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  code          TEXT    NOT NULL COLLATE NOCASE,
  name          TEXT    NOT NULL,
  grade         TEXT,
  level         INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 20),
  status        TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_org_designations_code ON org_designations (company_id, code);

CREATE TABLE IF NOT EXISTS org_projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  branch_id     INTEGER REFERENCES org_branches (id),
  code          TEXT    NOT NULL COLLATE NOCASE,
  name          TEXT    NOT NULL,
  type          TEXT    NOT NULL CHECK (type IN ('BUILDING', 'ROAD', 'BRIDGE', 'INDUSTRIAL', 'EPC', 'WATER', 'RAIL', 'OTHER')),
  client_name   TEXT,
  status        TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CLOSED')),
  start_date    TEXT,
  end_date      TEXT,
  pm_user_id    INTEGER REFERENCES iam_users (id),
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_org_projects_code ON org_projects (company_id, code);
CREATE INDEX IF NOT EXISTS ix_org_projects_branch ON org_projects (branch_id);
CREATE INDEX IF NOT EXISTS ix_org_projects_pm ON org_projects (pm_user_id);
CREATE INDEX IF NOT EXISTS ix_org_projects_status ON org_projects (company_id, status);

CREATE TABLE IF NOT EXISTS org_sites (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id            INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id        INTEGER NOT NULL REFERENCES org_projects (id),
  code                  TEXT    NOT NULL COLLATE NOCASE,
  name                  TEXT    NOT NULL,
  site_type             TEXT    NOT NULL DEFAULT 'SITE' CHECK (site_type IN ('SITE', 'CAMP', 'STORE', 'PLANT', 'OFFICE')),
  status                TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
  address               TEXT,
  latitude              REAL    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude             REAL    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  geofence_type         TEXT    NOT NULL DEFAULT 'NONE' CHECK (geofence_type IN ('NONE', 'CIRCLE', 'POLYGON')),
  geofence_radius_m     INTEGER CHECK (geofence_radius_m IS NULL OR geofence_radius_m BETWEEN 25 AND 5000),
  geofence_polygon_json TEXT,
  working_start         TEXT,
  working_end           TEXT,
  in_charge_user_id     INTEGER REFERENCES iam_users (id),
  timezone              TEXT    NOT NULL DEFAULT 'Asia/Kolkata',
  project_id            INTEGER,
  site_id               INTEGER,
  created_by            TEXT,
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by            TEXT,
  updated_at            TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at            TEXT,
  deleted_by            TEXT,
  source_type           TEXT,
  source_id             TEXT,
  remarks               TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_org_sites_code ON org_sites (org_project_id, code);
CREATE INDEX IF NOT EXISTS ix_org_sites_company ON org_sites (company_id, status);
CREATE INDEX IF NOT EXISTS ix_org_sites_in_charge ON org_sites (in_charge_user_id);

CREATE TABLE IF NOT EXISTS org_locations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  type          TEXT    NOT NULL CHECK (type IN ('OFFICE', 'CENTRAL_WAREHOUSE', 'BATCHING_PLANT', 'LABOUR_CAMP')),
  code          TEXT    NOT NULL COLLATE NOCASE,
  name          TEXT    NOT NULL,
  state_code    TEXT,
  address       TEXT,
  latitude      REAL    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude     REAL    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  status        TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_org_locations_code ON org_locations (company_id, code);

CREATE TABLE IF NOT EXISTS org_cost_centres (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  parent_id     INTEGER REFERENCES org_cost_centres (id),
  code          TEXT    NOT NULL COLLATE NOCASE,
  name          TEXT    NOT NULL,
  type          TEXT    NOT NULL DEFAULT 'COST' CHECK (type IN ('COST', 'PROFIT')),
  linked_type   TEXT    CHECK (linked_type IS NULL OR linked_type IN ('DEPARTMENT', 'PROJECT', 'SITE')),
  linked_id     INTEGER,
  status        TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT,
  CHECK ((linked_type IS NULL) = (linked_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_org_cost_centres_code ON org_cost_centres (company_id, COALESCE(parent_id, 0), code);
CREATE INDEX IF NOT EXISTS ix_org_cost_centres_parent ON org_cost_centres (parent_id);
CREATE INDEX IF NOT EXISTS ix_org_cost_centres_link ON org_cost_centres (linked_type, linked_id);

-- Who held a role on a department, project or site, and from when to when (FR-07). A row whose effective_from is in the future
-- waits (applied = 0) until the daily job applies it; the current holder is also mirrored on the entity row.
CREATE TABLE IF NOT EXISTS org_assignments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  entity_type    TEXT    NOT NULL CHECK (entity_type IN ('DEPARTMENT', 'PROJECT', 'SITE')),
  entity_id      INTEGER NOT NULL,
  role           TEXT    NOT NULL CHECK (role IN ('HEAD', 'PROJECT_MANAGER', 'IN_CHARGE')),
  user_id        INTEGER REFERENCES iam_users (id),
  effective_from TEXT    NOT NULL,
  effective_to   TEXT,
  applied        INTEGER NOT NULL DEFAULT 1 CHECK (applied IN (0, 1)),
  reason         TEXT,
  project_id     INTEGER,
  site_id        INTEGER,
  created_by     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by     TEXT,
  updated_at     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at     TEXT,
  deleted_by     TEXT,
  source_type    TEXT,
  source_id      TEXT,
  remarks        TEXT,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS ix_org_assignments_entity ON org_assignments (entity_type, entity_id, effective_from);
CREATE INDEX IF NOT EXISTS ix_org_assignments_user ON org_assignments (user_id);
CREATE INDEX IF NOT EXISTS ix_org_assignments_pending ON org_assignments (applied, effective_from);
CREATE INDEX IF NOT EXISTS ix_org_assignments_company_id ON org_assignments (company_id);
