-- D-740 (follow-up of 23.09): the opening written-down value of each Income-tax block in the first tax year the register computes, for assets taken over at go-live.
CREATE TABLE IF NOT EXISTS fa_tax_openings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES org_companies (id),
  tax_block         TEXT    NOT NULL,
  fy                TEXT    NOT NULL CHECK (length(fy) = 7),
  opening_wdv_paise INTEGER NOT NULL CHECK (opening_wdv_paise >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_tax_openings_block ON fa_tax_openings (company_id, tax_block) WHERE deleted_at IS NULL;
