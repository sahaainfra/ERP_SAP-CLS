-- Part 15.09: material rate intelligence (module proc, tables rti_*).
-- rti_observations: an append-only history of the rates paid, quoted or surveyed for an item, by specification, region and date, normalised to the base unit of measure on a landed basis (rates in paise).
--   Observations are never changed or deleted (BR-01): a correction is a new observation that names the one it replaces; triggers refuse an update or a delete.
-- rti_indices: external price indices (cement, steel, bitumen, fuel) by group, region and month, values x 10000.

CREATE TABLE IF NOT EXISTS rti_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  spec_key        TEXT    NOT NULL DEFAULT '',
  region_code     TEXT    NOT NULL DEFAULT 'ALL',
  org_project_id  INTEGER REFERENCES org_projects (id),
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  obs_date        TEXT    NOT NULL,
  rate            INTEGER NOT NULL CHECK (rate >= 0),
  uom             TEXT    NOT NULL,
  landed_rate     INTEGER NOT NULL CHECK (landed_rate >= 0),
  base_uom        TEXT    NOT NULL,
  base_landed_rate INTEGER NOT NULL CHECK (base_landed_rate >= 0),
  basis           TEXT    NOT NULL DEFAULT 'LANDED' CHECK (basis IN ('LANDED', 'BASIC', 'MARKET')),
  is_outlier      INTEGER NOT NULL DEFAULT 0 CHECK (is_outlier IN (0, 1)),
  outlier_reason  TEXT,
  supersedes_id   INTEGER REFERENCES rti_observations (id),
  correction_reason TEXT,
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
  source_type TEXT    NOT NULL CHECK (source_type IN ('QUOTATION', 'CS', 'PO', 'RATE_CONTRACT', 'SURVEY')),
  source_id   TEXT    NOT NULL,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rti_obs_source ON rti_observations (company_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS ix_rti_obs_item_id ON rti_observations (item_id);
CREATE INDEX IF NOT EXISTS ix_rti_obs_item ON rti_observations (company_id, item_id, region_code, obs_date);
CREATE INDEX IF NOT EXISTS ix_rti_obs_project ON rti_observations (org_project_id);
CREATE INDEX IF NOT EXISTS ix_rti_obs_vendor ON rti_observations (vendor_id);
CREATE INDEX IF NOT EXISTS ix_rti_obs_supersedes ON rti_observations (supersedes_id);
CREATE TRIGGER IF NOT EXISTS trg_rti_obs_no_update BEFORE UPDATE ON rti_observations BEGIN SELECT RAISE(ABORT, 'Rate observations are never changed: record a correction'); END;
CREATE TRIGGER IF NOT EXISTS trg_rti_obs_no_delete BEFORE DELETE ON rti_observations BEGIN SELECT RAISE(ABORT, 'Rate observations are never deleted: record a correction'); END;

CREATE TABLE IF NOT EXISTS rti_indices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  index_group     TEXT    NOT NULL COLLATE NOCASE,
  region_code     TEXT    NOT NULL DEFAULT 'ALL',
  period          TEXT    NOT NULL CHECK (length(period) = 7),
  index_value     INTEGER NOT NULL CHECK (index_value > 0),
  index_source    TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (index_source IN ('MANUAL', 'IMPORT', 'EXTERNAL')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_rti_idx_key ON rti_indices (company_id, index_group, region_code, period);
