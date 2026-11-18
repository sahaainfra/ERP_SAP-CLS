-- D-739 (follow-up of 23.09): an addition to a capitalised asset is a component of it (its own cost and life, the parent's remaining life by default), moved and disposed of with it.
CREATE TABLE IF NOT EXISTS fa_asset_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  asset_id        INTEGER NOT NULL REFERENCES fa_assets (id),
  parent_asset_id INTEGER NOT NULL REFERENCES fa_assets (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_asset_components_asset ON fa_asset_components (asset_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fa_asset_components_parent ON fa_asset_components (parent_asset_id);
CREATE INDEX IF NOT EXISTS ix_fa_asset_components_company ON fa_asset_components (company_id);
