-- Part 22.06: the vendor invoice (approval-controlled) registered against a purchase order, a service order's service entry or a hire bill, its lines and the result of the three-way (or two-way) match.
CREATE TABLE IF NOT EXISTS bill_vendor_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  vendor_id       INTEGER NOT NULL REFERENCES mdm_partners (id),
  invoice_kind    TEXT    NOT NULL DEFAULT 'PO' CHECK (invoice_kind IN ('PO', 'SERVICE', 'HIRE')),
  po_id           INTEGER REFERENCES proc_purchase_orders (id),
  so_id           INTEGER REFERENCES proc_service_orders (id),
  service_entry_id INTEGER REFERENCES proc_service_entries (id),
  hire_bill_id    INTEGER REFERENCES plt_hire_bills (id),
  vendor_gstin    TEXT    CHECK (vendor_gstin IS NULL OR length(vendor_gstin) = 15),
  invoice_no      TEXT    NOT NULL COLLATE NOCASE,
  invoice_date    TEXT    NOT NULL,
  fy              TEXT    NOT NULL,
  source          TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'PORTAL', 'EMAIL', 'OCR')),
  taxable_paise   INTEGER NOT NULL DEFAULT 0 CHECK (taxable_paise >= 0),
  tax_paise       INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  total_paise     INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  declared_total_paise INTEGER CHECK (declared_total_paise IS NULL OR declared_total_paise >= 0),
  debit_paise     INTEGER NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),
  payable_paise   INTEGER NOT NULL DEFAULT 0 CHECK (payable_paise >= 0),
  irn             TEXT,
  irn_checked     INTEGER NOT NULL DEFAULT 0 CHECK (irn_checked IN (0, 1)),
  due_date        TEXT,
  match_status    TEXT    NOT NULL DEFAULT 'NOT_MATCHED' CHECK (match_status IN ('NOT_MATCHED', 'MATCHED', 'EXCEPTION', 'RESOLVED', 'OVERRIDDEN')),
  exceptions_json TEXT    NOT NULL DEFAULT '[]',
  override_reason TEXT,
  resolution_json TEXT    NOT NULL DEFAULT '{}',
  blocked         INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
  price_exception INTEGER NOT NULL DEFAULT 0 CHECK (price_exception IN (0, 1)),
  variance_paise  INTEGER NOT NULL DEFAULT 0 CHECK (variance_paise >= 0),
  matched_at      TEXT,
  ap_state        TEXT    NOT NULL DEFAULT 'NOT_HANDED' CHECK (ap_state IN ('NOT_HANDED', 'HANDED', 'LINKED')),
  ap_ref          TEXT,
  notes           TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_vi_doc ON bill_vendor_invoices (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_vi_dup ON bill_vendor_invoices (company_id, vendor_id, invoice_no, fy) WHERE deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED');
CREATE INDEX IF NOT EXISTS ix_bill_vendor_invoices_org_project_id ON bill_vendor_invoices (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_vendor_invoices_org_site_id ON bill_vendor_invoices (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bill_vendor_invoices_vendor_id ON bill_vendor_invoices (vendor_id);
CREATE INDEX IF NOT EXISTS ix_bill_vendor_invoices_po_id ON bill_vendor_invoices (po_id);
CREATE INDEX IF NOT EXISTS ix_bill_vendor_invoices_so_id ON bill_vendor_invoices (so_id);
CREATE INDEX IF NOT EXISTS ix_bill_vendor_invoices_service_entry_id ON bill_vendor_invoices (service_entry_id);
CREATE INDEX IF NOT EXISTS ix_bill_vendor_invoices_hire_bill_id ON bill_vendor_invoices (hire_bill_id);
CREATE INDEX IF NOT EXISTS ix_bill_vi_status ON bill_vendor_invoices (company_id, org_project_id, status, match_status);
CREATE INDEX IF NOT EXISTS ix_bill_vi_date ON bill_vendor_invoices (company_id, invoice_date);

CREATE TABLE IF NOT EXISTS bill_vendor_invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  invoice_id      INTEGER NOT NULL REFERENCES bill_vendor_invoices (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  po_line_id      INTEGER REFERENCES proc_po_lines (id),
  item_id         INTEGER REFERENCES mdm_items (id),
  description     TEXT    NOT NULL,
  uom             TEXT,
  hsn             TEXT,
  qty_th          INTEGER NOT NULL DEFAULT 0 CHECK (qty_th >= 0),
  rate_paise      INTEGER NOT NULL DEFAULT 0 CHECK (rate_paise >= 0),
  gst_pct_bp      INTEGER NOT NULL DEFAULT 0 CHECK (gst_pct_bp BETWEEN 0 AND 10000),
  taxable_paise   INTEGER NOT NULL DEFAULT 0 CHECK (taxable_paise >= 0),
  tax_paise       INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  amount_paise    INTEGER NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  grn_qty_th      INTEGER,
  invoiced_before_th INTEGER,
  po_rate_paise   INTEGER,
  match_result    TEXT    NOT NULL DEFAULT 'NOT_MATCHED' CHECK (match_result IN ('NOT_MATCHED', 'OK', 'EXCEPTION')),
  match_json      TEXT    NOT NULL DEFAULT '[]',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_vil_line ON bill_vendor_invoice_lines (invoice_id, line_no);
CREATE INDEX IF NOT EXISTS ix_bill_vendor_invoice_lines_company_id ON bill_vendor_invoice_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_bill_vendor_invoice_lines_invoice_id ON bill_vendor_invoice_lines (invoice_id);
CREATE INDEX IF NOT EXISTS ix_bill_vendor_invoice_lines_po_line_id ON bill_vendor_invoice_lines (po_line_id);
CREATE INDEX IF NOT EXISTS ix_bill_vendor_invoice_lines_item_id ON bill_vendor_invoice_lines (item_id);
