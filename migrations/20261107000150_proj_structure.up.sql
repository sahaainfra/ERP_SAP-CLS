-- Part 10.03: the project structure (module proj, tables proj_*): the work breakdown structure, work packages, the location breakdown structure and the WBS x location matrix. Percentages x 10 000 (100 % = 1 000 000), chainage in metres.
-- proj_wbs: the tree of a project (codes unique within the project, weights of the children of a node sum to 100 %, control accounts, responsible person, discipline). proj_wbs_versions: every version after the WBS is baselined (the baseline,
-- then each approved change with its reason, its operations and the snapshot). proj_work_packages: groupings of WBS nodes for subcontracting, procurement or self-execution. proj_locations: buildings, blocks, floors, zones and rooms, or chainage
-- segments and structures of a linear project, with a map reference. proj_wbs_locations: the matrix of which WBS node applies in which location (for activities and measurements).
CREATE TABLE IF NOT EXISTS proj_wbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  project_id      INTEGER NOT NULL REFERENCES org_projects (id),
  parent_id       INTEGER REFERENCES proj_wbs (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  level           INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1 AND level <= 10),
  weight          INTEGER NOT NULL DEFAULT 0 CHECK (weight >= 0 AND weight <= 1000000),
  discipline      TEXT,
  responsible_user TEXT,
  is_control_account INTEGER NOT NULL DEFAULT 0 CHECK (is_control_account IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  wbs_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (wbs_status IN ('ACTIVE', 'INACTIVE')),
  description     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_wbs_code ON proj_wbs (project_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proj_wbs_parent_id ON proj_wbs (parent_id);
CREATE INDEX IF NOT EXISTS ix_proj_wbs_company_id ON proj_wbs (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_wbs_parent ON proj_wbs (project_id, parent_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_proj_wbs_responsible ON proj_wbs (company_id, responsible_user);

CREATE TABLE IF NOT EXISTS proj_wbs_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  project_id      INTEGER NOT NULL REFERENCES org_projects (id),
  version_no      INTEGER NOT NULL CHECK (version_no >= 1),
  kind            TEXT    NOT NULL CHECK (kind IN ('BASELINE', 'CHANGE')),
  version_status  TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (version_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  reason          TEXT,
  ops_json        TEXT    NOT NULL DEFAULT '[]',
  snapshot_json   TEXT,
  diff_json       TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  decided_at      TEXT,
  project_ref_id  INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_proj_wbs_versions_company_id ON proj_wbs_versions (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_wbs_versions_project ON proj_wbs_versions (project_id, version_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_wbs_versions_open ON proj_wbs_versions (project_id) WHERE deleted_at IS NULL AND kind = 'CHANGE' AND version_status IN ('DRAFT', 'SUBMITTED', 'RETURNED');

CREATE TABLE IF NOT EXISTS proj_work_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  project_id      INTEGER NOT NULL REFERENCES org_projects (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  wp_type         TEXT    NOT NULL DEFAULT 'SELF' CHECK (wp_type IN ('SELF', 'SUBCONTRACT', 'PROCUREMENT')),
  wbs_ids_json    TEXT    NOT NULL DEFAULT '[]',
  owner_user      TEXT,
  wp_status       TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (wp_status IN ('ACTIVE', 'INACTIVE', 'CLOSED')),
  description     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_work_packages_code ON proj_work_packages (project_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proj_work_packages_company_id ON proj_work_packages (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_work_packages_project ON proj_work_packages (project_id, wp_type);
CREATE INDEX IF NOT EXISTS ix_proj_work_packages_owner ON proj_work_packages (company_id, owner_user);

CREATE TABLE IF NOT EXISTS proj_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  project_id      INTEGER NOT NULL REFERENCES org_projects (id),
  parent_id       INTEGER REFERENCES proj_locations (id),
  loc_type        TEXT    NOT NULL CHECK (loc_type IN ('BLOCK', 'BUILDING', 'FLOOR', 'ZONE', 'ROOM', 'CHAINAGE', 'STRUCTURE')),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  chainage_from   INTEGER CHECK (chainage_from IS NULL OR chainage_from >= 0),
  chainage_to     INTEGER CHECK (chainage_to IS NULL OR chainage_to >= 0),
  lat             REAL    CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)),
  lng             REAL    CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  loc_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (loc_status IN ('ACTIVE', 'INACTIVE')),
  description     TEXT,
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
  CHECK (chainage_from IS NULL OR chainage_to IS NULL OR chainage_to >= chainage_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_locations_code ON proj_locations (project_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proj_locations_parent_id ON proj_locations (parent_id);
CREATE INDEX IF NOT EXISTS ix_proj_locations_company_id ON proj_locations (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_locations_parent ON proj_locations (project_id, parent_id, sort_order);

CREATE TABLE IF NOT EXISTS proj_wbs_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  project_id      INTEGER NOT NULL REFERENCES org_projects (id),
  wbs_id          INTEGER NOT NULL REFERENCES proj_wbs (id),
  location_id     INTEGER NOT NULL REFERENCES proj_locations (id),
  note            TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_wbs_locations_cell ON proj_wbs_locations (wbs_id, location_id);
CREATE INDEX IF NOT EXISTS ix_proj_wbs_locations_company_id ON proj_wbs_locations (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_wbs_locations_project ON proj_wbs_locations (project_id);
CREATE INDEX IF NOT EXISTS ix_proj_wbs_locations_location ON proj_wbs_locations (location_id);
