-- Part 16.08: returnable site assets (formwork, shuttering, scaffolding): the catalogue with rates, current positions by location, movements (approval-controlled), hire charges (hire-in and internal) and damage / loss recoveries. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS rta_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  asset_group     TEXT    NOT NULL CHECK (asset_group IN ('FORMWORK', 'SCAFFOLDING', 'OTHER')),
  unit_weight     INTEGER NOT NULL DEFAULT 0 CHECK (unit_weight >= 0),
  internal_rate   INTEGER NOT NULL DEFAULT 0 CHECK (internal_rate >= 0),
  rate_basis      TEXT    NOT NULL DEFAULT 'DAY' CHECK (rate_basis IN ('DAY', 'MONTH')),
  replacement_value INTEGER NOT NULL DEFAULT 0 CHECK (replacement_value >= 0),
  life_months     INTEGER NOT NULL DEFAULT 0 CHECK (life_months >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_rta_asset_item ON rta_assets (company_id, item_id);
CREATE INDEX IF NOT EXISTS ix_rta_asset_item_id ON rta_assets (item_id);

CREATE TABLE IF NOT EXISTS rta_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  location_type   TEXT    NOT NULL CHECK (location_type IN ('STORE', 'WORK_FRONT', 'WITH_PARTY', 'REPAIR', 'IN_TRANSIT')),
  location_id     INTEGER NOT NULL DEFAULT 0,
  party_id        INTEGER NOT NULL DEFAULT 0,
  holder_project_id INTEGER NOT NULL DEFAULT 0,
  holder_site_id  INTEGER NOT NULL DEFAULT 0,
  work_front      TEXT    NOT NULL DEFAULT '',
  ownership       TEXT    NOT NULL DEFAULT 'OWNED' CHECK (ownership IN ('OWNED', 'HIRED')),
  hire_id         INTEGER NOT NULL DEFAULT 0,
  qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  since_date      TEXT    NOT NULL,
  expected_return TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_rta_pos_key ON rta_positions (company_id, item_id, location_type, location_id, party_id, holder_project_id, holder_site_id, work_front, ownership, hire_id);
CREATE INDEX IF NOT EXISTS ix_rta_pos_item ON rta_positions (item_id);
CREATE INDEX IF NOT EXISTS ix_rta_pos_list ON rta_positions (company_id, location_type);

CREATE TABLE IF NOT EXISTS rta_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  movement_type   TEXT    NOT NULL CHECK (movement_type IN ('RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER', 'HIRE_IN', 'HIRE_OUT', 'REPAIR_OUT', 'REPAIR_IN')),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  from_store_id   INTEGER REFERENCES inv_stores (id),
  to_store_id     INTEGER REFERENCES inv_stores (id),
  party_id        INTEGER REFERENCES mdm_partners (id),
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  holding_id      INTEGER REFERENCES rta_positions (id),
  dest_project_id INTEGER REFERENCES org_projects (id),
  dest_site_id    INTEGER REFERENCES org_sites (id),
  work_front      TEXT,
  wa_id           INTEGER,
  ownership       TEXT    NOT NULL DEFAULT 'OWNED' CHECK (ownership IN ('OWNED', 'HIRED')),
  hire_id         INTEGER NOT NULL DEFAULT 0,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  qty_good        INTEGER NOT NULL DEFAULT 0 CHECK (qty_good >= 0),
  qty_repairable  INTEGER NOT NULL DEFAULT 0 CHECK (qty_repairable >= 0),
  qty_scrap       INTEGER NOT NULL DEFAULT 0 CHECK (qty_scrap >= 0),
  qty_lost        INTEGER NOT NULL DEFAULT 0 CHECK (qty_lost >= 0),
  movement_date   TEXT    NOT NULL,
  expected_return TEXT,
  hire_rate       INTEGER NOT NULL DEFAULT 0 CHECK (hire_rate >= 0),
  hire_basis      TEXT    CHECK (hire_basis IS NULL OR hire_basis IN ('DAY', 'MONTH')),
  order_ref       TEXT,
  reason          TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  approved_by     TEXT,
  approved_at     TEXT,
  posted_at       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_rta_mov_doc ON rta_movements (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_rta_mov_list ON rta_movements (company_id, status, movement_date);
CREATE INDEX IF NOT EXISTS ix_rta_mov_item ON rta_movements (item_id);
CREATE INDEX IF NOT EXISTS ix_rta_mov_project ON rta_movements (org_project_id);
CREATE INDEX IF NOT EXISTS ix_rta_mov_from ON rta_movements (from_store_id);
CREATE INDEX IF NOT EXISTS ix_rta_mov_to ON rta_movements (to_store_id);
CREATE INDEX IF NOT EXISTS ix_rta_mov_party ON rta_movements (party_id);
CREATE INDEX IF NOT EXISTS ix_rta_mov_vendor ON rta_movements (vendor_id);
CREATE INDEX IF NOT EXISTS ix_rta_mov_holding ON rta_movements (holding_id);
CREATE INDEX IF NOT EXISTS ix_rta_mov_dproject ON rta_movements (dest_project_id);
CREATE INDEX IF NOT EXISTS ix_rta_mov_dsite ON rta_movements (dest_site_id);

CREATE TABLE IF NOT EXISTS rta_hire_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  kind            TEXT    NOT NULL CHECK (kind IN ('HIRE_IN', 'INTERNAL')),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  movement_id     INTEGER REFERENCES rta_movements (id),
  holder_key      TEXT    NOT NULL DEFAULT '',
  qty             INTEGER NOT NULL CHECK (qty > 0),
  start_date      TEXT    NOT NULL,
  end_date        TEXT,
  rate            INTEGER NOT NULL DEFAULT 0 CHECK (rate >= 0),
  rate_basis      TEXT    NOT NULL CHECK (rate_basis IN ('DAY', 'MONTH')),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  period_status   TEXT    NOT NULL DEFAULT 'OPEN' CHECK (period_status IN ('OPEN', 'CLOSED')),
  order_ref       TEXT,
  bill_no         TEXT,
  bill_amount     INTEGER,
  bill_diff       INTEGER,
  bill_status     TEXT    CHECK (bill_status IS NULL OR bill_status IN ('MATCHED', 'DIFFERENCE')),
  bill_by         TEXT,
  bill_at         TEXT,
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
CREATE INDEX IF NOT EXISTS ix_rta_hire_list ON rta_hire_periods (company_id, kind, period_status);
CREATE INDEX IF NOT EXISTS ix_rta_hire_item ON rta_hire_periods (item_id);
CREATE INDEX IF NOT EXISTS ix_rta_hire_vendor ON rta_hire_periods (vendor_id);
CREATE INDEX IF NOT EXISTS ix_rta_hire_project ON rta_hire_periods (org_project_id);
CREATE INDEX IF NOT EXISTS ix_rta_hire_movement ON rta_hire_periods (movement_id);
CREATE INDEX IF NOT EXISTS ix_rta_hire_holder ON rta_hire_periods (company_id, holder_key);

CREATE TABLE IF NOT EXISTS rta_damage_recoveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  movement_id     INTEGER NOT NULL REFERENCES rta_movements (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  party_id        INTEGER REFERENCES mdm_partners (id),
  loss_kind       TEXT    NOT NULL CHECK (loss_kind IN ('DAMAGE', 'SCRAP', 'LOSS')),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  disposition     TEXT    NOT NULL CHECK (disposition IN ('RECOVER', 'WRITE_OFF')),
  reason          TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_rta_rec_doc ON rta_damage_recoveries (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_rta_rec_list ON rta_damage_recoveries (company_id, status);
CREATE INDEX IF NOT EXISTS ix_rta_rec_movement ON rta_damage_recoveries (movement_id);
CREATE INDEX IF NOT EXISTS ix_rta_rec_item ON rta_damage_recoveries (item_id);
CREATE INDEX IF NOT EXISTS ix_rta_rec_project ON rta_damage_recoveries (org_project_id);
CREATE INDEX IF NOT EXISTS ix_rta_rec_party ON rta_damage_recoveries (party_id);
