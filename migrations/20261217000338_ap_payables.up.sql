-- Part 23.03: accounts payable. ap_bills: the payable of a vendor, subcontractor or employee — made from a matched vendor invoice (22.06), an approved subcontractor bill
-- (22.05), a passed expense claim (07.12) or typed as a direct expense bill (approved: department head, accounts manager, CFO above the limit); its TDS (section, Act,
-- rate, base, amount, certificate form, payment code, lower-deduction certificate), its due date and the MSME due date (Section 43B(h)), what was set against it and
-- paid, a hold. ap_debit_notes: debit notes (return to vendor, rate difference, back-charge, penalty) and credit notes received from vendors, approved by the accounts
-- manager. ap_bill_adjustments: an advance or a debit note set against a bill. Money is integer paise; the TDS rate is in hundredths of a basis point (10000 = 1 %).

CREATE TABLE IF NOT EXISTS ap_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  bill_source     TEXT    NOT NULL CHECK (bill_source IN ('VENDOR_INVOICE', 'SUB_BILL', 'EXPENSE_CLAIM', 'HIRE_BILL', 'DIRECT')),
  source_ref      TEXT,
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  partner_id      INTEGER REFERENCES mdm_partners (id),
  employee_id     INTEGER REFERENCES hr_employees (id),
  payee_name      TEXT    NOT NULL,
  bill_no         TEXT,
  bill_date       TEXT    NOT NULL,
  due_date        TEXT    NOT NULL,
  msme            INTEGER NOT NULL DEFAULT 0 CHECK (msme IN (0, 1)),
  msme_due_date   TEXT,
  description     TEXT,
  expense_account_id INTEGER REFERENCES fin_accounts (id),
  gross_paise     INTEGER NOT NULL DEFAULT 0 CHECK (gross_paise >= 0),
  gst_input_paise INTEGER NOT NULL DEFAULT 0 CHECK (gst_input_paise >= 0),
  total_paise     INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  tds_nature      TEXT,
  tds_section     TEXT,
  tds_act         TEXT,
  tds_rate        INTEGER NOT NULL DEFAULT 0 CHECK (tds_rate >= 0),
  tds_base_paise  INTEGER NOT NULL DEFAULT 0 CHECK (tds_base_paise >= 0),
  tds_paise       INTEGER NOT NULL DEFAULT 0 CHECK (tds_paise >= 0),
  tds_payment_code TEXT,
  tds_certificate TEXT,
  tds_basis       TEXT,
  ldc_no          TEXT,
  net_payable_paise INTEGER NOT NULL DEFAULT 0 CHECK (net_payable_paise >= 0),
  adjusted_paise  INTEGER NOT NULL DEFAULT 0 CHECK (adjusted_paise >= 0),
  paid_paise      INTEGER NOT NULL DEFAULT 0 CHECK (paid_paise >= 0),
  hold_reason     TEXT,
  hold_by         TEXT,
  hold_at         TEXT,
  journal_id      INTEGER REFERENCES fin_journals (id),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
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
  CHECK (partner_id IS NOT NULL OR employee_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ap_bills_doc ON ap_bills (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ap_bills_source ON ap_bills (company_id, bill_source, source_ref) WHERE source_ref IS NOT NULL AND status != 'CANCELLED';
CREATE INDEX IF NOT EXISTS ix_ap_bills_list ON ap_bills (company_id, status, due_date);
CREATE INDEX IF NOT EXISTS ix_ap_bills_partner ON ap_bills (partner_id, bill_date);
CREATE INDEX IF NOT EXISTS ix_ap_bills_tds ON ap_bills (company_id, partner_id, tds_nature, bill_date);
CREATE INDEX IF NOT EXISTS ix_ap_bills_msme ON ap_bills (company_id, msme, msme_due_date);
CREATE INDEX IF NOT EXISTS ix_ap_bills_project ON ap_bills (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ap_bills_site ON ap_bills (org_site_id);
CREATE INDEX IF NOT EXISTS ix_ap_bills_employee ON ap_bills (employee_id);
CREATE INDEX IF NOT EXISTS ix_ap_bills_account ON ap_bills (expense_account_id);
CREATE INDEX IF NOT EXISTS ix_ap_bills_journal ON ap_bills (journal_id);
CREATE INDEX IF NOT EXISTS ix_ap_bills_wf ON ap_bills (workflow_instance_id);

CREATE TABLE IF NOT EXISTS ap_debit_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  note_kind       TEXT    NOT NULL DEFAULT 'DEBIT' CHECK (note_kind IN ('DEBIT', 'VENDOR_CREDIT')),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  reference_type  TEXT    CHECK (reference_type IS NULL OR reference_type IN ('AP_BILL', 'INV_RTV', 'VENDOR_INVOICE', 'OTHER')),
  reference_id    TEXT,
  bill_id         INTEGER REFERENCES ap_bills (id),
  reason          TEXT    NOT NULL CHECK (reason IN ('RTV', 'RATE_DIFFERENCE', 'BACK_CHARGE', 'PENALTY', 'SHORT_SUPPLY', 'OTHER')),
  note_date       TEXT    NOT NULL,
  vendor_note_no  TEXT,
  description     TEXT    NOT NULL,
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  gst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (gst_paise >= 0),
  total_paise     INTEGER NOT NULL CHECK (total_paise > 0),
  credit_account_id INTEGER REFERENCES fin_accounts (id),
  journal_id      INTEGER REFERENCES fin_journals (id),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ap_debit_notes_doc ON ap_debit_notes (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_ap_debit_notes_list ON ap_debit_notes (company_id, status, note_date);
CREATE INDEX IF NOT EXISTS ix_ap_debit_notes_partner ON ap_debit_notes (partner_id);
CREATE INDEX IF NOT EXISTS ix_ap_debit_notes_project ON ap_debit_notes (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ap_debit_notes_bill ON ap_debit_notes (bill_id);
CREATE INDEX IF NOT EXISTS ix_ap_debit_notes_account ON ap_debit_notes (credit_account_id);
CREATE INDEX IF NOT EXISTS ix_ap_debit_notes_journal ON ap_debit_notes (journal_id);
CREATE INDEX IF NOT EXISTS ix_ap_debit_notes_wf ON ap_debit_notes (workflow_instance_id);

CREATE TABLE IF NOT EXISTS ap_bill_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  bill_id         INTEGER NOT NULL REFERENCES ap_bills (id),
  adj_kind        TEXT    NOT NULL CHECK (adj_kind IN ('ADVANCE', 'DEBIT_NOTE')),
  ref_id          INTEGER NOT NULL,
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  adjusted_on     TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_ap_bill_adjustments_bill ON ap_bill_adjustments (bill_id);
CREATE INDEX IF NOT EXISTS ix_ap_bill_adjustments_company ON ap_bill_adjustments (company_id, adj_kind, ref_id);
CREATE INDEX IF NOT EXISTS ix_ap_bill_adjustments_journal ON ap_bill_adjustments (journal_id);
