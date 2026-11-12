-- Part 16.05: inter-store transfers with in-transit stock. Quantities are thousandths, rates and values paise.
CREATE TABLE IF NOT EXISTS inv_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  request_date    TEXT    NOT NULL,
  required_by     TEXT,
  from_store_id   INTEGER NOT NULL REFERENCES inv_stores (id),
  to_store_id     INTEGER NOT NULL REFERENCES inv_stores (id),
  from_project_id INTEGER REFERENCES org_projects (id),
  to_project_id   INTEGER REFERENCES org_projects (id),
  mr_id           INTEGER REFERENCES proc_material_requests (id),
  inter_project   INTEGER NOT NULL DEFAULT 0 CHECK (inter_project IN (0, 1)),
  inter_state     INTEGER NOT NULL DEFAULT 0 CHECK (inter_state IN (0, 1)),
  document_type   TEXT    NOT NULL DEFAULT 'DELIVERY_CHALLAN' CHECK (document_type IN ('DELIVERY_CHALLAN', 'TAX_INVOICE')),
  vehicle_no      TEXT,
  driver_name     TEXT,
  eway_bill_no    TEXT,
  eway_required   INTEGER NOT NULL DEFAULT 0 CHECK (eway_required IN (0, 1)),
  gate_pass_id    INTEGER REFERENCES inv_gate_passes (id),
  dispatch_date   TEXT,
  dispatched_by   TEXT,
  received_date   TEXT,
  total_value     INTEGER NOT NULL DEFAULT 0 CHECK (total_value >= 0),
  reason          TEXT,
  photos_json     TEXT    NOT NULL DEFAULT '[]',
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'DISCREPANCY', 'REJECTED', 'CANCELLED')),
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
  remarks     TEXT,
  CHECK (from_store_id <> to_store_id),
  CHECK (inter_project = 0 OR from_project_id IS NOT to_project_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_trf_doc ON inv_transfers (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_trf_list ON inv_transfers (company_id, status, request_date);
CREATE INDEX IF NOT EXISTS ix_inv_trf_from ON inv_transfers (from_store_id, status);
CREATE INDEX IF NOT EXISTS ix_inv_trf_to ON inv_transfers (to_store_id, status);
CREATE INDEX IF NOT EXISTS ix_inv_trf_fproject ON inv_transfers (from_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_trf_tproject ON inv_transfers (to_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_trf_mr ON inv_transfers (mr_id);
CREATE INDEX IF NOT EXISTS ix_inv_trf_pass ON inv_transfers (gate_pass_id);

CREATE TABLE IF NOT EXISTS inv_transfer_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  transfer_id     INTEGER NOT NULL REFERENCES inv_transfers (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  uom             TEXT    NOT NULL,
  qty_requested   INTEGER NOT NULL CHECK (qty_requested > 0),
  qty_dispatched  INTEGER NOT NULL DEFAULT 0 CHECK (qty_dispatched >= 0),
  qty_received    INTEGER NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  qty_damaged     INTEGER NOT NULL DEFAULT 0 CHECK (qty_damaged >= 0),
  qty_shortage    INTEGER NOT NULL DEFAULT 0 CHECK (qty_shortage >= 0),
  rate            INTEGER NOT NULL DEFAULT 0 CHECK (rate >= 0),
  value           INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  batch_no        TEXT,
  discrepancy_note TEXT,
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
  CHECK (qty_received + qty_damaged + qty_shortage <= qty_dispatched)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_trfl_no ON inv_transfer_lines (transfer_id, line_no);
CREATE INDEX IF NOT EXISTS ix_inv_trfl_company ON inv_transfer_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_inv_trfl_item ON inv_transfer_lines (item_id);

CREATE TABLE IF NOT EXISTS inv_transfer_discrepancies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  transfer_id     INTEGER NOT NULL REFERENCES inv_transfers (id),
  line_id         INTEGER NOT NULL REFERENCES inv_transfer_lines (id),
  shortage_qty    INTEGER NOT NULL DEFAULT 0 CHECK (shortage_qty >= 0),
  damaged_qty     INTEGER NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  value           INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  status          TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PENDING', 'RESOLVED')),
  resolution      TEXT    CHECK (resolution IS NULL OR resolution IN ('WRITE_OFF', 'RETURN_TO_SOURCE', 'ACCEPT')),
  resolution_note TEXT,
  workflow_instance_id INTEGER,
  raised_by       TEXT    NOT NULL,
  resolved_by     TEXT,
  resolved_at     TEXT,
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
CREATE INDEX IF NOT EXISTS ix_inv_trfd_company ON inv_transfer_discrepancies (company_id, status);
CREATE INDEX IF NOT EXISTS ix_inv_trfd_transfer ON inv_transfer_discrepancies (transfer_id);
CREATE INDEX IF NOT EXISTS ix_inv_trfd_line ON inv_transfer_discrepancies (line_id);
