-- Part 23.05: accounts receivable. ar_invoices: a receivable — made by itself from an issued tax invoice (22.04, already approved there) or typed for other income
-- (scrap sale, hire-out, rent; approved by the accounts manager and posted); what was received, deducted by the client, credited and written off against it.
-- ar_receipts: money received from a client with what the client deducted (TDS, GST-TDS, retention, other), posted when entered; the part not allocated is on account.
-- ar_allocations: a receipt set against an invoice. ar_credit_notes: a credit note (rate revision, dispute) with its GST, approved (accounts manager; CFO above ₹5 lakh)
-- and posted. ar_writeoffs: a receivable written off (accounts manager, CFO, director). ar_followups: the collection log of an invoice (calls, letters, promises).

CREATE TABLE IF NOT EXISTS ar_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  inv_source      TEXT    NOT NULL CHECK (inv_source IN ('TAX_INVOICE', 'OTHER_INCOME')),
  source_ref      TEXT,
  org_project_id  INTEGER REFERENCES org_projects (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  contract_id     INTEGER REFERENCES ctr_contracts (id),
  income_kind     TEXT    CHECK (income_kind IS NULL OR income_kind IN ('SCRAP', 'HIRE_OUT', 'RENT', 'OTHER')),
  income_account_id INTEGER REFERENCES fin_accounts (id),
  description     TEXT,
  invoice_no      TEXT,
  invoice_date    TEXT    NOT NULL,
  due_date        TEXT    NOT NULL,
  taxable_paise   INTEGER NOT NULL DEFAULT 0 CHECK (taxable_paise >= 0),
  gst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (gst_paise >= 0),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise >= 0),
  received_paise  INTEGER NOT NULL DEFAULT 0 CHECK (received_paise >= 0),
  credited_paise  INTEGER NOT NULL DEFAULT 0 CHECK (credited_paise >= 0),
  written_off_paise INTEGER NOT NULL DEFAULT 0 CHECK (written_off_paise >= 0),
  interest_bp     INTEGER NOT NULL DEFAULT 0 CHECK (interest_bp >= 0),
  promised_date   TEXT,
  last_followup_at TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  journal_id      INTEGER REFERENCES fin_journals (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ar_invoices_doc ON ar_invoices (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ar_invoices_source ON ar_invoices (company_id, inv_source, source_ref) WHERE source_ref IS NOT NULL AND status != 'CANCELLED';
CREATE INDEX IF NOT EXISTS ix_ar_invoices_list ON ar_invoices (company_id, status, due_date);
CREATE INDEX IF NOT EXISTS ix_ar_invoices_partner ON ar_invoices (partner_id, status, due_date);
CREATE INDEX IF NOT EXISTS ix_ar_invoices_project ON ar_invoices (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ar_invoices_contract ON ar_invoices (contract_id);
CREATE INDEX IF NOT EXISTS ix_ar_invoices_income ON ar_invoices (income_account_id);
CREATE INDEX IF NOT EXISTS ix_ar_invoices_journal ON ar_invoices (journal_id);
CREATE INDEX IF NOT EXISTS ix_ar_invoices_wf ON ar_invoices (workflow_instance_id);

CREATE TABLE IF NOT EXISTS ar_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  receipt_date    TEXT    NOT NULL,
  bank_account_id INTEGER NOT NULL REFERENCES fin_bank_accounts (id),
  reference       TEXT,
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  tds_paise       INTEGER NOT NULL DEFAULT 0 CHECK (tds_paise >= 0),
  gst_tds_paise   INTEGER NOT NULL DEFAULT 0 CHECK (gst_tds_paise >= 0),
  retention_paise INTEGER NOT NULL DEFAULT 0 CHECK (retention_paise >= 0),
  other_ded_paise INTEGER NOT NULL DEFAULT 0 CHECK (other_ded_paise >= 0),
  other_ded_json  TEXT    NOT NULL DEFAULT '[]',
  allocated_paise INTEGER NOT NULL DEFAULT 0 CHECK (allocated_paise >= 0),
  unallocated_paise INTEGER NOT NULL DEFAULT 0 CHECK (unallocated_paise >= 0),
  tds_section     TEXT,
  tds_quarter     TEXT,
  tds_matched_26as INTEGER NOT NULL DEFAULT 0 CHECK (tds_matched_26as IN (0, 1)),
  org_project_id  INTEGER REFERENCES org_projects (id),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  journal_id      INTEGER REFERENCES fin_journals (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ar_receipts_doc ON ar_receipts (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_ar_receipts_list ON ar_receipts (company_id, status, receipt_date);
CREATE INDEX IF NOT EXISTS ix_ar_receipts_partner ON ar_receipts (partner_id, receipt_date);
CREATE INDEX IF NOT EXISTS ix_ar_receipts_bank ON ar_receipts (bank_account_id);
CREATE INDEX IF NOT EXISTS ix_ar_receipts_project ON ar_receipts (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ar_receipts_journal ON ar_receipts (journal_id);
CREATE INDEX IF NOT EXISTS ix_ar_receipts_wf ON ar_receipts (workflow_instance_id);

CREATE TABLE IF NOT EXISTS ar_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  receipt_id      INTEGER NOT NULL REFERENCES ar_receipts (id),
  invoice_id      INTEGER NOT NULL REFERENCES ar_invoices (id),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  allocated_on    TEXT    NOT NULL,
  alloc_status    TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (alloc_status IN ('ACTIVE', 'REVERSED')),
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
CREATE INDEX IF NOT EXISTS ix_ar_allocations_receipt ON ar_allocations (receipt_id, alloc_status);
CREATE INDEX IF NOT EXISTS ix_ar_allocations_invoice ON ar_allocations (invoice_id, alloc_status);
CREATE INDEX IF NOT EXISTS ix_ar_allocations_company ON ar_allocations (company_id, alloc_status);

CREATE TABLE IF NOT EXISTS ar_credit_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  invoice_id      INTEGER NOT NULL REFERENCES ar_invoices (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  reason          TEXT    NOT NULL CHECK (reason IN ('RATE_REVISION', 'DISPUTE', 'QUANTITY', 'OTHER')),
  note_date       TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  taxable_paise   INTEGER NOT NULL CHECK (taxable_paise > 0),
  cgst_paise      INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise      INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise      INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  total_paise     INTEGER NOT NULL CHECK (total_paise > 0),
  irn_required    INTEGER NOT NULL DEFAULT 0 CHECK (irn_required IN (0, 1)),
  irn_due_date    TEXT,
  irn             TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  journal_id      INTEGER REFERENCES fin_journals (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ar_credit_notes_doc ON ar_credit_notes (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_ar_credit_notes_list ON ar_credit_notes (company_id, status, note_date);
CREATE INDEX IF NOT EXISTS ix_ar_credit_notes_invoice ON ar_credit_notes (invoice_id);
CREATE INDEX IF NOT EXISTS ix_ar_credit_notes_partner ON ar_credit_notes (partner_id);
CREATE INDEX IF NOT EXISTS ix_ar_credit_notes_project ON ar_credit_notes (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ar_credit_notes_journal ON ar_credit_notes (journal_id);
CREATE INDEX IF NOT EXISTS ix_ar_credit_notes_wf ON ar_credit_notes (workflow_instance_id);

CREATE TABLE IF NOT EXISTS ar_writeoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  invoice_id      INTEGER NOT NULL REFERENCES ar_invoices (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  reason          TEXT    NOT NULL,
  writeoff_date   TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  journal_id      INTEGER REFERENCES fin_journals (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ar_writeoffs_doc ON ar_writeoffs (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_ar_writeoffs_list ON ar_writeoffs (company_id, status);
CREATE INDEX IF NOT EXISTS ix_ar_writeoffs_invoice ON ar_writeoffs (invoice_id);
CREATE INDEX IF NOT EXISTS ix_ar_writeoffs_partner ON ar_writeoffs (partner_id);
CREATE INDEX IF NOT EXISTS ix_ar_writeoffs_project ON ar_writeoffs (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ar_writeoffs_journal ON ar_writeoffs (journal_id);
CREATE INDEX IF NOT EXISTS ix_ar_writeoffs_wf ON ar_writeoffs (workflow_instance_id);

CREATE TABLE IF NOT EXISTS ar_followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  invoice_id      INTEGER NOT NULL REFERENCES ar_invoices (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  followup_date   TEXT    NOT NULL,
  action          TEXT    NOT NULL CHECK (action IN ('CALL', 'EMAIL', 'VISIT', 'LETTER', 'REMINDER', 'ESCALATION')),
  notes           TEXT    NOT NULL,
  contact_person  TEXT,
  promised_date   TEXT,
  promised_paise  INTEGER CHECK (promised_paise IS NULL OR promised_paise > 0),
  next_date       TEXT,
  by_user         TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_ar_followups_invoice ON ar_followups (invoice_id, followup_date);
CREATE INDEX IF NOT EXISTS ix_ar_followups_partner ON ar_followups (partner_id);
CREATE INDEX IF NOT EXISTS ix_ar_followups_project ON ar_followups (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ar_followups_company ON ar_followups (company_id, promised_date);
