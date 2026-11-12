-- Part 16.03: goods receipt notes, their lines (with the inspection hold) and returns to vendor. Quantities are thousandths of the unit, rates and values paise.
CREATE TABLE IF NOT EXISTS inv_grns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  received_date   TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  po_id           INTEGER REFERENCES proc_purchase_orders (id),
  gate_inward_id  INTEGER REFERENCES inv_gate_inward (id),
  vendor_id       INTEGER NOT NULL REFERENCES mdm_partners (id),
  challan_no      TEXT,
  challan_date    TEXT,
  invoice_no      TEXT,
  emergency       INTEGER NOT NULL DEFAULT 0 CHECK (emergency IN (0, 1)),
  emergency_why   TEXT,
  excess          INTEGER NOT NULL DEFAULT 0 CHECK (excess IN (0, 1)),
  total_value     INTEGER NOT NULL DEFAULT 0 CHECK (total_value >= 0),
  photos_json     TEXT    NOT NULL DEFAULT '[]',
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  amendment_no    INTEGER NOT NULL DEFAULT 0 CHECK (amendment_no >= 0),
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
  remarks     TEXT,
  CHECK (emergency = 0 OR emergency_why IS NOT NULL OR status = 'DRAFT'),
  CHECK (po_id IS NOT NULL OR emergency = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_grn_doc ON inv_grns (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_grn_list ON inv_grns (company_id, status, received_date);
CREATE INDEX IF NOT EXISTS ix_inv_grn_project ON inv_grns (org_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_grn_site ON inv_grns (org_site_id);
CREATE INDEX IF NOT EXISTS ix_inv_grn_store ON inv_grns (store_id, status);
CREATE INDEX IF NOT EXISTS ix_inv_grn_po ON inv_grns (po_id);
CREATE INDEX IF NOT EXISTS ix_inv_grn_gate ON inv_grns (gate_inward_id);
CREATE INDEX IF NOT EXISTS ix_inv_grn_vendor ON inv_grns (vendor_id);

CREATE TABLE IF NOT EXISTS inv_grn_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  grn_id          INTEGER NOT NULL REFERENCES inv_grns (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  po_line_id      INTEGER REFERENCES proc_po_lines (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  uom             TEXT    NOT NULL,
  ordered_qty     INTEGER NOT NULL DEFAULT 0 CHECK (ordered_qty >= 0),
  balance_qty     INTEGER NOT NULL DEFAULT 0 CHECK (balance_qty >= 0),
  challan_qty     INTEGER NOT NULL DEFAULT 0 CHECK (challan_qty >= 0),
  received_qty    INTEGER NOT NULL CHECK (received_qty > 0),
  accepted_qty    INTEGER NOT NULL DEFAULT 0 CHECK (accepted_qty >= 0),
  rejected_qty    INTEGER NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
  rate            INTEGER NOT NULL DEFAULT 0 CHECK (rate >= 0),
  line_value      INTEGER NOT NULL DEFAULT 0 CHECK (line_value >= 0),
  batch_no        TEXT,
  heat_no         TEXT,
  mfg_date        TEXT,
  cert_file_id    INTEGER REFERENCES core_files (id),
  inspection_required INTEGER NOT NULL DEFAULT 0 CHECK (inspection_required IN (0, 1)),
  inspection_status TEXT   NOT NULL DEFAULT 'NA' CHECK (inspection_status IN ('NA', 'PENDING', 'PASSED', 'PARTIAL', 'FAILED')),
  released_qty    INTEGER NOT NULL DEFAULT 0 CHECK (released_qty >= 0),
  qc_rejected_qty INTEGER NOT NULL DEFAULT 0 CHECK (qc_rejected_qty >= 0),
  returned_qty    INTEGER NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  direct_charge   INTEGER NOT NULL DEFAULT 0 CHECK (direct_charge IN (0, 1)),
  excess_qty      INTEGER NOT NULL DEFAULT 0 CHECK (excess_qty >= 0),
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
  CHECK (accepted_qty + rejected_qty = received_qty),
  CHECK (released_qty + qc_rejected_qty <= accepted_qty)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_grnl_no ON inv_grn_lines (grn_id, line_no);
CREATE INDEX IF NOT EXISTS ix_inv_grnl_po_line ON inv_grn_lines (po_line_id);
CREATE INDEX IF NOT EXISTS ix_inv_grnl_item ON inv_grn_lines (item_id);
CREATE INDEX IF NOT EXISTS ix_inv_grnl_cert ON inv_grn_lines (cert_file_id);
CREATE INDEX IF NOT EXISTS ix_inv_grnl_wbs ON inv_grn_lines (wbs_id);
CREATE INDEX IF NOT EXISTS ix_inv_grnl_cost ON inv_grn_lines (cost_code_id);
CREATE INDEX IF NOT EXISTS ix_inv_grnl_insp ON inv_grn_lines (company_id, inspection_status);

CREATE TABLE IF NOT EXISTS inv_rtvs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  rtv_date        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  grn_id          INTEGER NOT NULL REFERENCES inv_grns (id),
  vendor_id       INTEGER NOT NULL REFERENCES mdm_partners (id),
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  reason          TEXT    NOT NULL,
  lines_json      TEXT    NOT NULL DEFAULT '[]',
  total_value     INTEGER NOT NULL DEFAULT 0 CHECK (total_value >= 0),
  gate_pass_id    INTEGER REFERENCES inv_gate_passes (id),
  debit_note_trigger TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  amendment_no    INTEGER NOT NULL DEFAULT 0 CHECK (amendment_no >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_rtv_doc ON inv_rtvs (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_rtv_list ON inv_rtvs (company_id, status, rtv_date);
CREATE INDEX IF NOT EXISTS ix_inv_rtv_project ON inv_rtvs (org_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_rtv_grn ON inv_rtvs (grn_id);
CREATE INDEX IF NOT EXISTS ix_inv_rtv_vendor ON inv_rtvs (vendor_id);
CREATE INDEX IF NOT EXISTS ix_inv_rtv_store ON inv_rtvs (store_id);
CREATE INDEX IF NOT EXISTS ix_inv_rtv_pass ON inv_rtvs (gate_pass_id);
