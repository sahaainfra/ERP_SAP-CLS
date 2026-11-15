-- Part 22.04: the certification of a client bill by the client (approval-controlled), the GST tax invoice (approval-controlled, gapless numbering per GSTIN per financial year) and the counters of that numbering.
CREATE TABLE IF NOT EXISTS bill_certifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  cert_no         TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  contract_id     INTEGER NOT NULL REFERENCES ctr_contracts (id),
  bill_id         INTEGER NOT NULL REFERENCES bill_client_bills (id),
  cert_date       TEXT    NOT NULL,
  submitted_gross_paise INTEGER NOT NULL DEFAULT 0,
  submitted_net_paise INTEGER NOT NULL DEFAULT 0,
  certified_gross_paise INTEGER NOT NULL DEFAULT 0 CHECK (certified_gross_paise >= 0),
  certified_escalation_paise INTEGER NOT NULL DEFAULT 0,
  certified_taxable_paise INTEGER NOT NULL DEFAULT 0 CHECK (certified_taxable_paise >= 0),
  certified_gst_paise INTEGER NOT NULL DEFAULT 0 CHECK (certified_gst_paise >= 0),
  certified_gst_json TEXT NOT NULL DEFAULT '{}',
  certified_deductions_json TEXT NOT NULL DEFAULT '[]',
  certified_deductions_paise INTEGER NOT NULL DEFAULT 0 CHECK (certified_deductions_paise >= 0),
  certified_net_paise INTEGER NOT NULL DEFAULT 0,
  diff_gross_paise INTEGER NOT NULL DEFAULT 0,
  diff_net_paise  INTEGER NOT NULL DEFAULT 0,
  diff_pct_bp     INTEGER NOT NULL DEFAULT 0,
  big_diff        INTEGER NOT NULL DEFAULT 0 CHECK (big_diff IN (0, 1)),
  items_json      TEXT    NOT NULL DEFAULT '[]',
  disputed_paise  INTEGER NOT NULL DEFAULT 0 CHECK (disputed_paise >= 0),
  due_date        TEXT,
  file_ref        TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_cert_doc ON bill_certifications (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_cert_bill ON bill_certifications (bill_id) WHERE deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED');
CREATE INDEX IF NOT EXISTS ix_bill_certifications_org_project_id ON bill_certifications (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_certifications_org_site_id ON bill_certifications (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bill_certifications_contract_id ON bill_certifications (contract_id);
CREATE INDEX IF NOT EXISTS ix_bill_cert_status ON bill_certifications (company_id, org_project_id, status, cert_date);

CREATE TABLE IF NOT EXISTS bill_tax_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  invoice_no      TEXT    COLLATE NOCASE,
  invoice_date    TEXT,
  fy              TEXT,
  seq_no          INTEGER CHECK (seq_no IS NULL OR seq_no >= 1),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  contract_id     INTEGER NOT NULL REFERENCES ctr_contracts (id),
  bill_id         INTEGER NOT NULL REFERENCES bill_client_bills (id),
  certification_id INTEGER REFERENCES bill_certifications (id),
  gstin_from      TEXT    NOT NULL CHECK (length(gstin_from) = 15),
  gstin_to        TEXT    NOT NULL CHECK (length(gstin_to) = 15),
  place_state     TEXT    NOT NULL,
  supply          TEXT    NOT NULL CHECK (supply IN ('intra', 'inter')),
  sac_code        TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  taxable_paise   INTEGER NOT NULL CHECK (taxable_paise >= 0),
  gst_pct_bp      INTEGER NOT NULL DEFAULT 0 CHECK (gst_pct_bp BETWEEN 0 AND 10000),
  cgst_paise      INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise      INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise      INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  total_paise     INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  due_date        TEXT,
  irn_state       TEXT    NOT NULL DEFAULT 'NONE' CHECK (irn_state IN ('NONE', 'PENDING', 'GENERATED', 'FAILED')),
  irn             TEXT,
  ack_no          TEXT,
  ack_date        TEXT,
  ar_state        TEXT    NOT NULL DEFAULT 'NOT_HANDED' CHECK (ar_state IN ('NOT_HANDED', 'HANDED', 'LINKED')),
  ar_ref          TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_ti_doc ON bill_tax_invoices (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_ti_no ON bill_tax_invoices (company_id, gstin_from, invoice_no) WHERE invoice_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_ti_seq ON bill_tax_invoices (company_id, gstin_from, fy, seq_no) WHERE seq_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_ti_bill ON bill_tax_invoices (bill_id) WHERE deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED');
CREATE INDEX IF NOT EXISTS ix_bill_tax_invoices_org_project_id ON bill_tax_invoices (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_tax_invoices_org_site_id ON bill_tax_invoices (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bill_tax_invoices_contract_id ON bill_tax_invoices (contract_id);
CREATE INDEX IF NOT EXISTS ix_bill_tax_invoices_certification_id ON bill_tax_invoices (certification_id);
CREATE INDEX IF NOT EXISTS ix_bill_ti_status ON bill_tax_invoices (company_id, org_project_id, status, invoice_date);

CREATE TABLE IF NOT EXISTS bill_invoice_counters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  gstin           TEXT    NOT NULL CHECK (length(gstin) = 15),
  fy              TEXT    NOT NULL,
  last_seq        INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_ic_key ON bill_invoice_counters (company_id, gstin, fy);
