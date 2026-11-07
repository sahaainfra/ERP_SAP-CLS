-- Part 10.07: GIS, site maps and location intelligence (module proj, tables gis_*). Percentages x 10 000, opacity in whole percent, coordinates in degrees (WGS84).
-- gis_layers: a custom layer of a project (boundary, alignment, work front, store, camp, equipment, custom) as GeoJSON; the live content is the approved one, a change waits as pending_json for the maker-checker approval.
-- gis_overlays: a georeferenced site plan image (bounds south-west, north-east) with its opacity, same approval. gis_progress: percent complete by location and activity (the adapter until 14.05 supplies progress).
CREATE TABLE IF NOT EXISTS gis_layers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  name            TEXT    NOT NULL,
  ltype           TEXT    NOT NULL CHECK (ltype IN ('BOUNDARY', 'ALIGNMENT', 'WORK_FRONT', 'STORE', 'CAMP', 'EQUIPMENT', 'CUSTOM')),
  geojson         TEXT    NOT NULL DEFAULT '{"type":"FeatureCollection","features":[]}',
  style_json      TEXT    NOT NULL DEFAULT '{}',
  visible_roles_json TEXT NOT NULL DEFAULT '[]',
  cfg_status      TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (cfg_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  has_live        INTEGER NOT NULL DEFAULT 0 CHECK (has_live IN (0, 1)),
  pending_json    TEXT,
  revision        INTEGER NOT NULL DEFAULT 0,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_at     TEXT,
  effective_from  TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_gis_layers_name ON gis_layers (org_project_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_gis_layers_company_id ON gis_layers (company_id);
CREATE INDEX IF NOT EXISTS ix_gis_layers_project ON gis_layers (org_project_id, cfg_status);

CREATE TABLE IF NOT EXISTS gis_overlays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  name            TEXT    NOT NULL,
  image_url       TEXT    NOT NULL,
  file_id         INTEGER,
  bounds_json     TEXT    NOT NULL,
  opacity         INTEGER NOT NULL DEFAULT 70 CHECK (opacity BETWEEN 5 AND 100),
  cfg_status      TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (cfg_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  has_live        INTEGER NOT NULL DEFAULT 0 CHECK (has_live IN (0, 1)),
  pending_json    TEXT,
  revision        INTEGER NOT NULL DEFAULT 0,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_at     TEXT,
  effective_from  TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_gis_overlays_name ON gis_overlays (org_project_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_gis_overlays_company_id ON gis_overlays (company_id);
CREATE INDEX IF NOT EXISTS ix_gis_overlays_project ON gis_overlays (org_project_id, cfg_status);

CREATE TABLE IF NOT EXISTS gis_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  location_id     INTEGER NOT NULL REFERENCES proj_locations (id),
  activity        TEXT    NOT NULL,
  pct             INTEGER NOT NULL CHECK (pct BETWEEN 0 AND 1000000),
  as_of           TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_gis_progress_company_id ON gis_progress (company_id);
CREATE INDEX IF NOT EXISTS ix_gis_progress_project ON gis_progress (org_project_id, activity, as_of);
CREATE INDEX IF NOT EXISTS ix_gis_progress_location ON gis_progress (location_id, activity, as_of);
