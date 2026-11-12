-- Part 16.01: stores and warehouses, bins, the stock ledger, balances, valuation, reservations and adjustments (module inv, tables inv_*).
-- Quantities are thousandths of the base unit, rates and values paise. The stock ledger is append-only: triggers refuse an update or a delete and a correction is a reversing entry (BR-02).
-- The project_id of the ledger, balances and reservations is the project that owns the stock; empty means the company's common pool (FR-07).

CREATE TABLE IF NOT EXISTS inv_stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  store_type      TEXT    NOT NULL CHECK (store_type IN ('CENTRAL_WAREHOUSE', 'SITE_STORE', 'YARD', 'BATCHING_PLANT', 'TRANSIT')),
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  address         TEXT,
  keeper_ids_json TEXT    NOT NULL DEFAULT '[]',
  valuation_method TEXT   NOT NULL DEFAULT 'WAVG' CHECK (valuation_method IN ('WAVG', 'FIFO')),
  allow_negative  INTEGER NOT NULL DEFAULT 0 CHECK (allow_negative IN (0, 1)),
  store_status    TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (store_status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'ACTIVE', 'REJECTED', 'CANCELLED', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_store_code ON inv_stores (company_id, code);
CREATE INDEX IF NOT EXISTS ix_inv_store_list ON inv_stores (company_id, store_status);
CREATE INDEX IF NOT EXISTS ix_inv_store_project ON inv_stores (org_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_store_site ON inv_stores (org_site_id);

CREATE TABLE IF NOT EXISTS inv_store_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  changes_json    TEXT    NOT NULL,
  reason          TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  approved_by     TEXT,
  approved_at     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_chg_doc ON inv_store_changes (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_chg_store ON inv_store_changes (store_id, status);

CREATE TABLE IF NOT EXISTS inv_bins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  zone            TEXT,
  rack            TEXT,
  shelf           TEXT,
  capacity        INTEGER CHECK (capacity IS NULL OR capacity >= 0),
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_bin_code ON inv_bins (store_id, code);
CREATE INDEX IF NOT EXISTS ix_inv_bin_company ON inv_bins (company_id);

CREATE TABLE IF NOT EXISTS inv_stock_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  bin_id          INTEGER NOT NULL REFERENCES inv_bins (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  batch_no        TEXT    NOT NULL DEFAULT '',
  serial_no       TEXT    NOT NULL DEFAULT '',
  txn_type        TEXT    NOT NULL CHECK (txn_type IN ('OPENING', 'RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'SCRAP', 'REVERSAL', 'REVALUATION')),
  txn_date        TEXT    NOT NULL,
  qty_in          INTEGER NOT NULL DEFAULT 0 CHECK (qty_in >= 0),
  qty_out         INTEGER NOT NULL DEFAULT 0 CHECK (qty_out >= 0),
  rate            INTEGER NOT NULL DEFAULT 0 CHECK (rate >= 0),
  value           INTEGER NOT NULL DEFAULT 0,
  balance_qty     INTEGER NOT NULL,
  balance_value   INTEGER NOT NULL,
  wbs_id          INTEGER,
  reverses_id     INTEGER REFERENCES inv_stock_ledger (id),
  reason          TEXT,
  counter_id      INTEGER REFERENCES inv_stock_ledger (id),
  posted_by       TEXT    NOT NULL,
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
  remarks     TEXT,
  CHECK (qty_in = 0 OR qty_out = 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_ledger_doc ON inv_stock_ledger (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_ledger_card ON inv_stock_ledger (company_id, item_id, store_id, id);
CREATE INDEX IF NOT EXISTS ix_inv_ledger_item_id ON inv_stock_ledger (item_id);
CREATE INDEX IF NOT EXISTS ix_inv_ledger_store ON inv_stock_ledger (store_id, txn_date);
CREATE INDEX IF NOT EXISTS ix_inv_ledger_bin ON inv_stock_ledger (bin_id);
CREATE INDEX IF NOT EXISTS ix_inv_ledger_project ON inv_stock_ledger (project_id);
CREATE INDEX IF NOT EXISTS ix_inv_ledger_source ON inv_stock_ledger (company_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS ix_inv_ledger_reverses ON inv_stock_ledger (reverses_id);
CREATE INDEX IF NOT EXISTS ix_inv_ledger_counter ON inv_stock_ledger (counter_id);
CREATE TRIGGER IF NOT EXISTS trg_inv_ledger_no_update BEFORE UPDATE ON inv_stock_ledger BEGIN SELECT RAISE(ABORT, 'Stock ledger entries are never changed: post a reversing entry'); END;
CREATE TRIGGER IF NOT EXISTS trg_inv_ledger_no_delete BEFORE DELETE ON inv_stock_ledger BEGIN SELECT RAISE(ABORT, 'Stock ledger entries are never deleted: post a reversing entry'); END;

CREATE TABLE IF NOT EXISTS inv_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  bin_id          INTEGER NOT NULL REFERENCES inv_bins (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  batch_no        TEXT    NOT NULL DEFAULT '',
  serial_no       TEXT    NOT NULL DEFAULT '',
  qty_on_hand     INTEGER NOT NULL DEFAULT 0,
  qty_reserved    INTEGER NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
  qty_inspection  INTEGER NOT NULL DEFAULT 0 CHECK (qty_inspection >= 0),
  qty_in_transit  INTEGER NOT NULL DEFAULT 0 CHECK (qty_in_transit >= 0),
  avg_rate        INTEGER NOT NULL DEFAULT 0 CHECK (avg_rate >= 0),
  value           INTEGER NOT NULL DEFAULT 0,
  last_receipt_on TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_bal_key ON inv_balances (company_id, store_id, bin_id, item_id, batch_no, serial_no, COALESCE(project_id, 0));
CREATE INDEX IF NOT EXISTS ix_inv_bal_item ON inv_balances (company_id, item_id);
CREATE INDEX IF NOT EXISTS ix_inv_bal_item_id ON inv_balances (item_id);
CREATE INDEX IF NOT EXISTS ix_inv_bal_store ON inv_balances (store_id);
CREATE INDEX IF NOT EXISTS ix_inv_bal_bin ON inv_balances (bin_id);

CREATE TABLE IF NOT EXISTS inv_valuation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  qty             INTEGER NOT NULL DEFAULT 0,
  value           INTEGER NOT NULL DEFAULT 0,
  avg_rate        INTEGER NOT NULL DEFAULT 0 CHECK (avg_rate >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_val_key ON inv_valuation (company_id, store_id, item_id);
CREATE INDEX IF NOT EXISTS ix_inv_val_item ON inv_valuation (item_id);
CREATE INDEX IF NOT EXISTS ix_inv_val_store_id ON inv_valuation (store_id);

CREATE TABLE IF NOT EXISTS inv_fifo_layers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  ledger_id       INTEGER NOT NULL REFERENCES inv_stock_ledger (id),
  layer_date      TEXT    NOT NULL,
  qty_remaining   INTEGER NOT NULL CHECK (qty_remaining >= 0),
  layer_rate      INTEGER NOT NULL CHECK (layer_rate >= 0),
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
CREATE INDEX IF NOT EXISTS ix_inv_fifo_open ON inv_fifo_layers (company_id, store_id, item_id, qty_remaining, id);
CREATE INDEX IF NOT EXISTS ix_inv_fifo_ledger ON inv_fifo_layers (ledger_id);
CREATE INDEX IF NOT EXISTS ix_inv_fifo_item_id ON inv_fifo_layers (item_id);
CREATE INDEX IF NOT EXISTS ix_inv_fifo_store_id ON inv_fifo_layers (store_id);

CREATE TABLE IF NOT EXISTS inv_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  qty_consumed    INTEGER NOT NULL DEFAULT 0 CHECK (qty_consumed >= 0),
  reservation_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (reservation_status IN ('ACTIVE', 'CONSUMED', 'RELEASED')),
  needed_by       TEXT,
  released_reason TEXT,
  reserved_by     TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_res_doc ON inv_reservations (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_res_item ON inv_reservations (company_id, store_id, item_id, reservation_status);
CREATE INDEX IF NOT EXISTS ix_inv_res_source ON inv_reservations (company_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS ix_inv_res_item_id ON inv_reservations (item_id);
CREATE INDEX IF NOT EXISTS ix_inv_res_store_id ON inv_reservations (store_id);

CREATE TABLE IF NOT EXISTS inv_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  adj_type        TEXT    NOT NULL CHECK (adj_type IN ('QUANTITY', 'REVALUATION')),
  reason          TEXT    NOT NULL,
  lines_json      TEXT    NOT NULL DEFAULT '[]',
  value_delta     INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_adj_doc ON inv_adjustments (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_adj_list ON inv_adjustments (company_id, status);
CREATE INDEX IF NOT EXISTS ix_inv_adj_store ON inv_adjustments (store_id, status);
