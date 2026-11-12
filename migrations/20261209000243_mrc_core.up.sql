-- Part 16.10: the key materials that are reconciled every month, the monthly reconciliation per project and site (approval-controlled) with its lines, and the contributions of stores, procurement and accounts. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS mrc_key_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  default_wastage_pct INTEGER NOT NULL DEFAULT 0 CHECK (default_wastage_pct >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mrc_km_item ON mrc_key_materials (company_id, item_id);
CREATE INDEX IF NOT EXISTS ix_mrc_km_item_id ON mrc_key_materials (item_id);

CREATE TABLE IF NOT EXISTS mrc_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  period_start    TEXT    NOT NULL,
  period_end      TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  computed_at     TEXT,
  generated_by    TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  approved_by     TEXT,
  approved_at     TEXT,
  cancel_reason   TEXT,
  note            TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mrc_doc ON mrc_reconciliations (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mrc_site_period ON mrc_reconciliations (company_id, org_site_id, period) WHERE status NOT IN ('CANCELLED', 'REJECTED') AND deleted_at IS NULL AND source_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_mrc_list ON mrc_reconciliations (company_id, status, period);
CREATE INDEX IF NOT EXISTS ix_mrc_project ON mrc_reconciliations (org_project_id);
CREATE INDEX IF NOT EXISTS ix_mrc_site ON mrc_reconciliations (org_site_id);

CREATE TABLE IF NOT EXISTS mrc_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  recon_id        INTEGER NOT NULL REFERENCES mrc_reconciliations (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  opening         INTEGER NOT NULL DEFAULT 0,
  receipts        INTEGER NOT NULL DEFAULT 0,
  transfers_in    INTEGER NOT NULL DEFAULT 0,
  transfers_out   INTEGER NOT NULL DEFAULT 0,
  returns_vendor  INTEGER NOT NULL DEFAULT 0,
  issues          INTEGER NOT NULL DEFAULT 0,
  site_returns    INTEGER NOT NULL DEFAULT 0,
  adjustments     INTEGER NOT NULL DEFAULT 0,
  book_closing    INTEGER NOT NULL DEFAULT 0,
  physical_closing INTEGER,
  count_plan_id   INTEGER,
  executed_ref TEXT,
  theoretical_base INTEGER NOT NULL DEFAULT 0,
  theoretical     INTEGER NOT NULL DEFAULT 0,
  actual          INTEGER NOT NULL DEFAULT 0,
  variance        INTEGER NOT NULL DEFAULT 0,
  variance_pct    INTEGER,
  allowed_wastage_pct INTEGER NOT NULL DEFAULT 0 CHECK (allowed_wastage_pct >= 0),
  wastage_pct     INTEGER,
  over_allowed    INTEGER NOT NULL DEFAULT 0 CHECK (over_allowed IN (0, 1)),
  avg_rate        INTEGER NOT NULL DEFAULT 0 CHECK (avg_rate >= 0),
  reason_code     TEXT,
  explanation     TEXT,
  recovery_party_id INTEGER REFERENCES mdm_partners (id),
  recovery_amount INTEGER NOT NULL DEFAULT 0 CHECK (recovery_amount >= 0),
  sort_order      INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mrc_line ON mrc_lines (recon_id, item_id);
CREATE INDEX IF NOT EXISTS ix_mrc_lines_company ON mrc_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_mrc_lines_item ON mrc_lines (item_id);
CREATE INDEX IF NOT EXISTS ix_mrc_lines_party ON mrc_lines (recovery_party_id);

CREATE TABLE IF NOT EXISTS mrc_contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  recon_id        INTEGER NOT NULL REFERENCES mrc_reconciliations (id),
  line_id         INTEGER REFERENCES mrc_lines (id),
  contributor_role TEXT   NOT NULL,
  note            TEXT    NOT NULL,
  contributed_by  TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_mrc_contrib_recon ON mrc_contributions (recon_id);
CREATE INDEX IF NOT EXISTS ix_mrc_contrib_line ON mrc_contributions (line_id);
CREATE INDEX IF NOT EXISTS ix_mrc_contrib_company ON mrc_contributions (company_id);
