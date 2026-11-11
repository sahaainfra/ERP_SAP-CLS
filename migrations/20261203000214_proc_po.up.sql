-- Part 15.05: purchase orders, amendments, short-close, dispatches, receipts and advances.
-- proc_purchase_orders / proc_po_lines / proc_po_schedules: the order, its lines (rate, discount, GST split by place of supply) and the delivery schedule.
-- proc_po_amendments: amendments (changed quantity, rate, dates, terms; the before and after of the whole order), and the requests to short-close or cancel.
-- proc_dispatches: advance shipping notices; proc_po_receipts: goods received against the lines (until the stock module posts them); proc_po_advances: advance payment requests.

CREATE TABLE IF NOT EXISTS proc_purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  po_site_id      INTEGER REFERENCES org_sites (id),
  vendor_id       INTEGER NOT NULL REFERENCES mdm_partners (id),
  po_source       TEXT    NOT NULL DEFAULT 'CS' CHECK (po_source IN ('CS', 'DIRECT')),
  cs_id           INTEGER REFERENCES proc_comparative_statements (id),
  direct_reason   TEXT,
  is_emergency    INTEGER NOT NULL DEFAULT 0 CHECK (is_emergency IN (0, 1)),
  delivery_address TEXT,
  delivery_state  TEXT,
  vendor_state    TEXT,
  vendor_gstin    TEXT,
  supply_type     TEXT    NOT NULL DEFAULT 'INTRA' CHECK (supply_type IN ('INTRA', 'INTER', 'NONE')),
  payment_terms   TEXT,
  advance_pct     INTEGER NOT NULL DEFAULT 0 CHECK (advance_pct >= 0 AND advance_pct <= 1000000),
  credit_days     INTEGER NOT NULL DEFAULT 0 CHECK (credit_days >= 0),
  milestone_terms TEXT,
  delivery_basis  TEXT    NOT NULL DEFAULT 'FOR_SITE' CHECK (delivery_basis IN ('EX_WORKS', 'FOR_SITE', 'FOR_DESTINATION')),
  freight_terms   TEXT,
  insurance_terms TEXT,
  warranty_terms  TEXT,
  ld_terms        TEXT,
  ld_pct_per_week INTEGER NOT NULL DEFAULT 0 CHECK (ld_pct_per_week >= 0),
  ld_cap_pct      INTEGER NOT NULL DEFAULT 0 CHECK (ld_cap_pct >= 0),
  tc_text         TEXT,
  documents_required TEXT,
  approved_makes  TEXT,
  total_basic     INTEGER NOT NULL DEFAULT 0 CHECK (total_basic >= 0),
  total_freight   INTEGER NOT NULL DEFAULT 0 CHECK (total_freight >= 0),
  total_tax       INTEGER NOT NULL DEFAULT 0 CHECK (total_tax >= 0),
  total_amount    INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  variance_flag   INTEGER NOT NULL DEFAULT 0 CHECK (variance_flag IN (0, 1)),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CLOSED', 'CANCELLED')),
  amendment_no    INTEGER NOT NULL DEFAULT 0 CHECK (amendment_no >= 0),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  approved_by     TEXT,
  approved_at     TEXT,
  sent_at         TEXT,
  sent_status     TEXT,
  sent_note       TEXT,
  ack_token_hash  TEXT,
  ack_expires     TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  close_reason    TEXT,
  closed_at       TEXT,
  cancel_reason   TEXT,
  overdue_notified_on TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_po_doc ON proc_purchase_orders (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_po_token ON proc_purchase_orders (ack_token_hash) WHERE ack_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_proc_po_company ON proc_purchase_orders (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_po_project ON proc_purchase_orders (org_project_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_po_vendor ON proc_purchase_orders (vendor_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_po_cs ON proc_purchase_orders (cs_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_site ON proc_purchase_orders (po_site_id);

CREATE TABLE IF NOT EXISTS proc_po_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  po_id           INTEGER NOT NULL REFERENCES proc_purchase_orders (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  pr_line_id      INTEGER REFERENCES proc_pr_lines (id),
  cs_line_id      INTEGER REFERENCES proc_cs_lines (id),
  item_id         INTEGER REFERENCES mdm_items (id),
  description     TEXT    NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  uom             TEXT    NOT NULL,
  rate            INTEGER NOT NULL DEFAULT 0 CHECK (rate >= 0),
  discount_pct    INTEGER NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 1000000),
  tax_code        TEXT,
  gst_pct         INTEGER NOT NULL DEFAULT 0 CHECK (gst_pct >= 0),
  basic_amount    INTEGER NOT NULL DEFAULT 0 CHECK (basic_amount >= 0),
  freight_amount  INTEGER NOT NULL DEFAULT 0 CHECK (freight_amount >= 0),
  cgst_amount     INTEGER NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0),
  sgst_amount     INTEGER NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0),
  igst_amount     INTEGER NOT NULL DEFAULT 0 CHECK (igst_amount >= 0),
  tax_amount      INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_amount     INTEGER NOT NULL DEFAULT 0 CHECK (line_amount >= 0),
  cs_rate         INTEGER,
  benchmark_rate  INTEGER,
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  delivery_site_id INTEGER REFERENCES org_sites (id),
  received_qty    INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  accepted_qty    INTEGER NOT NULL DEFAULT 0 CHECK (accepted_qty >= 0),
  invoiced_qty    INTEGER NOT NULL DEFAULT 0 CHECK (invoiced_qty >= 0),
  short_closed_qty INTEGER NOT NULL DEFAULT 0 CHECK (short_closed_qty >= 0),
  balance_qty     INTEGER NOT NULL DEFAULT 0 CHECK (balance_qty >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_po_lines_no ON proc_po_lines (po_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proc_po_lines_company ON proc_po_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_lines_pr ON proc_po_lines (pr_line_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_lines_cs ON proc_po_lines (cs_line_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_lines_item ON proc_po_lines (item_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_lines_wbs ON proc_po_lines (wbs_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_lines_cost_code ON proc_po_lines (cost_code_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_lines_site ON proc_po_lines (delivery_site_id);

CREATE TABLE IF NOT EXISTS proc_po_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  po_id           INTEGER NOT NULL REFERENCES proc_purchase_orders (id),
  po_line_id      INTEGER NOT NULL REFERENCES proc_po_lines (id),
  due_date        TEXT    NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  received_qty    INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
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
CREATE INDEX IF NOT EXISTS ix_proc_po_sched_company ON proc_po_schedules (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_sched_po ON proc_po_schedules (po_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_sched_line ON proc_po_schedules (po_line_id, due_date);
CREATE INDEX IF NOT EXISTS ix_proc_po_sched_due ON proc_po_schedules (due_date);

CREATE TABLE IF NOT EXISTS proc_po_amendments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  po_id           INTEGER NOT NULL REFERENCES proc_purchase_orders (id),
  kind            TEXT    NOT NULL DEFAULT 'AMEND' CHECK (kind IN ('AMEND', 'SHORT_CLOSE', 'CANCEL')),
  amendment_no    INTEGER NOT NULL DEFAULT 0 CHECK (amendment_no >= 0),
  reason          TEXT    NOT NULL,
  changes_json    TEXT,
  before_json     TEXT,
  after_json      TEXT,
  delta_amount    INTEGER NOT NULL DEFAULT 0,
  new_total       INTEGER NOT NULL DEFAULT 0 CHECK (new_total >= 0),
  rate_increase   INTEGER NOT NULL DEFAULT 0 CHECK (rate_increase IN (0, 1)),
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
CREATE INDEX IF NOT EXISTS ix_proc_po_amend_company ON proc_po_amendments (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_amend_po ON proc_po_amendments (po_id, status);

CREATE TABLE IF NOT EXISTS proc_dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  po_id           INTEGER NOT NULL REFERENCES proc_purchase_orders (id),
  asn_no          TEXT    NOT NULL COLLATE NOCASE,
  vendor_invoice_no TEXT,
  lr_no           TEXT,
  vehicle_no      TEXT,
  eway_bill_no    TEXT,
  dispatch_date   TEXT    NOT NULL,
  expected_arrival TEXT,
  lines_json      TEXT    NOT NULL,
  entered_via     TEXT    NOT NULL DEFAULT 'BUYER' CHECK (entered_via IN ('BUYER', 'VENDOR')),
  entered_by      TEXT,
  status          TEXT    NOT NULL DEFAULT 'DISPATCHED' CHECK (status IN ('DISPATCHED', 'RECEIVED', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_dispatch_no ON proc_dispatches (company_id, asn_no);
CREATE INDEX IF NOT EXISTS ix_proc_dispatch_po ON proc_dispatches (po_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_dispatch_arrival ON proc_dispatches (expected_arrival);

CREATE TABLE IF NOT EXISTS proc_po_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  po_id           INTEGER NOT NULL REFERENCES proc_purchase_orders (id),
  po_line_id      INTEGER NOT NULL REFERENCES proc_po_lines (id),
  grn_ref         TEXT    NOT NULL,
  received_on     TEXT    NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  accepted_qty    INTEGER NOT NULL CHECK (accepted_qty >= 0),
  on_time         INTEGER NOT NULL DEFAULT 1 CHECK (on_time IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_po_receipts ON proc_po_receipts (company_id, grn_ref, po_line_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_receipts_po ON proc_po_receipts (po_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_receipts_line ON proc_po_receipts (po_line_id);

CREATE TABLE IF NOT EXISTS proc_po_advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  po_id           INTEGER NOT NULL REFERENCES proc_purchase_orders (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  advance_amount  INTEGER NOT NULL CHECK (advance_amount > 0),
  needed_by       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_po_adv_doc ON proc_po_advances (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_proc_po_adv_po ON proc_po_advances (po_id, status);
