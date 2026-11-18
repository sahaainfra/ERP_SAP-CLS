-- Part 23.08: GST reconciliation, ITC review and TDS compliance. gst_2b_imports / gst_2b_lines: a GSTR-2B statement imported (JSON, Excel/CSV or the GSP) and each of
-- its documents matched to the purchase register (the AP bills of 23.03): matched, a mismatch of amount, date or number, or missing in the books; its owner, follow-ups
-- with the vendor and resolution. gst_recon_followups: each follow-up. gst_itc_reviews / gst_itc_review_lines: the ITC to claim for a month, invoice by invoice
-- (eligible, blocked under s.17(5), held as not in 2B, reversed for a vendor unpaid beyond 180 days, claimed by a reviewer's override with its reason), approved by the
-- accounts manager and the CFO; the reversal posted. gst_return_filings: GSTR-1 and GSTR-3B prepared and filed per month. tds_returns: the quarterly TDS statement
-- (26Q up to March 2026, Form 140 after) with its challans. tds_26as_lines: Form 26AS / AIS lines matched to the TDS deducted by clients.

CREATE TABLE IF NOT EXISTS gst_2b_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no       TEXT    NOT NULL,
  period       TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  gstin        TEXT    NOT NULL,
  file_name    TEXT    NOT NULL,
  file_format  TEXT    NOT NULL CHECK (file_format IN ('JSON', 'CSV', 'GSP')),
  lines_count  INTEGER NOT NULL DEFAULT 0 CHECK (lines_count >= 0),
  duplicates_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicates_count >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_gst_2b_imports_doc ON gst_2b_imports (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_gst_2b_imports_period ON gst_2b_imports (company_id, period);

CREATE TABLE IF NOT EXISTS gst_2b_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  import_id      INTEGER NOT NULL REFERENCES gst_2b_imports (id),
  period         TEXT    NOT NULL,
  line_hash      TEXT    NOT NULL,
  supplier_gstin TEXT    NOT NULL,
  supplier_name  TEXT,
  doc_type       TEXT    NOT NULL DEFAULT 'INV' CHECK (doc_type IN ('INV', 'CRN', 'DBN')),
  invoice_no     TEXT    NOT NULL,
  invoice_date   TEXT    NOT NULL,
  pos            TEXT,
  reverse_charge INTEGER NOT NULL DEFAULT 0 CHECK (reverse_charge IN (0, 1)),
  rate_pct       INTEGER NOT NULL DEFAULT 0 CHECK (rate_pct >= 0),
  taxable_paise  INTEGER NOT NULL DEFAULT 0,
  igst_paise     INTEGER NOT NULL DEFAULT 0,
  cgst_paise     INTEGER NOT NULL DEFAULT 0,
  sgst_paise     INTEGER NOT NULL DEFAULT 0,
  cess_paise     INTEGER NOT NULL DEFAULT 0,
  itc_available  INTEGER NOT NULL DEFAULT 1 CHECK (itc_available IN (0, 1)),
  match_status   TEXT    NOT NULL DEFAULT 'MISSING_IN_BOOKS' CHECK (match_status IN ('MATCHED', 'MISMATCH_AMOUNT', 'MISMATCH_DATE', 'MISMATCH_NUMBER', 'MISSING_IN_BOOKS')),
  matched_bill_id INTEGER REFERENCES ap_bills (id),
  match_note     TEXT,
  books_tax_paise INTEGER,
  diff_paise     INTEGER NOT NULL DEFAULT 0,
  owner          TEXT,
  resolution_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (resolution_status IN ('OPEN', 'FOLLOW_UP', 'RESOLVED', 'ACCEPTED')),
  resolution_note TEXT,
  resolved_by    TEXT,
  resolved_at    TEXT,
  followups_count INTEGER NOT NULL DEFAULT 0 CHECK (followups_count >= 0),
  next_followup  TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_gst_2b_lines_hash ON gst_2b_lines (company_id, line_hash);
CREATE INDEX IF NOT EXISTS ix_gst_2b_lines_list ON gst_2b_lines (company_id, period, match_status);
CREATE INDEX IF NOT EXISTS ix_gst_2b_lines_supplier ON gst_2b_lines (company_id, supplier_gstin, invoice_date);
CREATE INDEX IF NOT EXISTS ix_gst_2b_lines_import ON gst_2b_lines (import_id);
CREATE INDEX IF NOT EXISTS ix_gst_2b_lines_bill ON gst_2b_lines (matched_bill_id);
CREATE INDEX IF NOT EXISTS ix_gst_2b_lines_owner ON gst_2b_lines (company_id, owner, resolution_status);

CREATE TABLE IF NOT EXISTS gst_recon_followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  line_id      INTEGER REFERENCES gst_2b_lines (id),
  bill_id      INTEGER REFERENCES ap_bills (id),
  partner_id   INTEGER REFERENCES mdm_partners (id),
  channel      TEXT    NOT NULL CHECK (channel IN ('EMAIL', 'PORTAL', 'CALL', 'LETTER')),
  note         TEXT    NOT NULL,
  next_date    TEXT,
  by_user      TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_gst_recon_followups_line ON gst_recon_followups (line_id);
CREATE INDEX IF NOT EXISTS ix_gst_recon_followups_bill ON gst_recon_followups (bill_id);
CREATE INDEX IF NOT EXISTS ix_gst_recon_followups_partner ON gst_recon_followups (partner_id);

CREATE TABLE IF NOT EXISTS gst_itc_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  eligible_paise  INTEGER NOT NULL DEFAULT 0 CHECK (eligible_paise >= 0),
  blocked_paise   INTEGER NOT NULL DEFAULT 0 CHECK (blocked_paise >= 0),
  held_paise      INTEGER NOT NULL DEFAULT 0 CHECK (held_paise >= 0),
  reversed_paise  INTEGER NOT NULL DEFAULT 0 CHECK (reversed_paise >= 0),
  override_paise  INTEGER NOT NULL DEFAULT 0 CHECK (override_paise >= 0),
  claimable_paise INTEGER NOT NULL DEFAULT 0 CHECK (claimable_paise >= 0),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  journal_id      INTEGER REFERENCES fin_journals (id),
  amends_id       INTEGER REFERENCES gst_itc_reviews (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_gst_itc_reviews_doc ON gst_itc_reviews (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_gst_itc_reviews_open ON gst_itc_reviews (company_id, period) WHERE status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_gst_itc_reviews_list ON gst_itc_reviews (company_id, status, period);
CREATE INDEX IF NOT EXISTS ix_gst_itc_reviews_wf ON gst_itc_reviews (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_gst_itc_reviews_journal ON gst_itc_reviews (journal_id);
CREATE INDEX IF NOT EXISTS ix_gst_itc_reviews_amends ON gst_itc_reviews (amends_id);

CREATE TABLE IF NOT EXISTS gst_itc_review_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  review_id      INTEGER NOT NULL REFERENCES gst_itc_reviews (id),
  bill_id        INTEGER REFERENCES ap_bills (id),
  line_2b_id     INTEGER REFERENCES gst_2b_lines (id),
  supplier_gstin TEXT,
  supplier_name  TEXT,
  invoice_no     TEXT,
  invoice_date   TEXT,
  taxable_paise  INTEGER NOT NULL DEFAULT 0,
  tax_paise      INTEGER NOT NULL DEFAULT 0,
  decision       TEXT    NOT NULL CHECK (decision IN ('ELIGIBLE', 'BLOCKED_17_5', 'HELD_NOT_IN_2B', 'HELD_MISMATCH', 'REVERSED_UNPAID_180', 'INELIGIBLE_2B', 'OVERRIDE_CLAIM')),
  reason         TEXT,
  claim_paise    INTEGER NOT NULL DEFAULT 0,
  reverse_paise  INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS ix_gst_itc_review_lines_review ON gst_itc_review_lines (review_id, decision);
CREATE INDEX IF NOT EXISTS ix_gst_itc_review_lines_bill ON gst_itc_review_lines (bill_id);
CREATE INDEX IF NOT EXISTS ix_gst_itc_review_lines_2b ON gst_itc_review_lines (line_2b_id);

CREATE TABLE IF NOT EXISTS gst_return_filings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  return_type  TEXT    NOT NULL CHECK (return_type IN ('GSTR1', 'GSTR3B')),
  period       TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  gstin        TEXT    NOT NULL,
  data_json    TEXT    NOT NULL DEFAULT '{}',
  filing_status TEXT   NOT NULL DEFAULT 'PREPARED' CHECK (filing_status IN ('PREPARED', 'FILED')),
  arn          TEXT,
  filed_on     TEXT,
  filed_by     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_gst_return_filings ON gst_return_filings (company_id, return_type, period, gstin);
CREATE INDEX IF NOT EXISTS ix_gst_return_filings_status ON gst_return_filings (company_id, filing_status);

CREATE TABLE IF NOT EXISTS tds_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no       TEXT    NOT NULL,
  quarter      TEXT    NOT NULL CHECK (quarter GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-Q[1-4]'),
  form         TEXT    NOT NULL,
  data_json    TEXT    NOT NULL DEFAULT '{}',
  challans_json TEXT   NOT NULL DEFAULT '[]',
  deducted_paise INTEGER NOT NULL DEFAULT 0 CHECK (deducted_paise >= 0),
  deposited_paise INTEGER NOT NULL DEFAULT 0 CHECK (deposited_paise >= 0),
  return_status TEXT   NOT NULL DEFAULT 'DRAFT' CHECK (return_status IN ('DRAFT', 'PREPARED', 'FILED')),
  token_no     TEXT,
  filed_on     TEXT,
  filed_by     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tds_returns_doc ON tds_returns (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tds_returns_quarter ON tds_returns (company_id, form, quarter);
CREATE INDEX IF NOT EXISTS ix_tds_returns_status ON tds_returns (company_id, return_status);

CREATE TABLE IF NOT EXISTS tds_26as_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  fy           TEXT    NOT NULL,
  line_hash    TEXT    NOT NULL,
  deductor_tan TEXT    NOT NULL,
  deductor_name TEXT,
  section      TEXT,
  txn_date     TEXT    NOT NULL,
  amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  tds_paise    INTEGER NOT NULL DEFAULT 0 CHECK (tds_paise >= 0),
  matched_receipt_id INTEGER REFERENCES ar_receipts (id),
  match_status TEXT    NOT NULL DEFAULT 'UNMATCHED' CHECK (match_status IN ('MATCHED', 'UNMATCHED', 'DIFFERENCE')),
  diff_paise   INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tds_26as_lines_hash ON tds_26as_lines (company_id, line_hash);
CREATE INDEX IF NOT EXISTS ix_tds_26as_lines_fy ON tds_26as_lines (company_id, fy, match_status);
CREATE INDEX IF NOT EXISTS ix_tds_26as_lines_receipt ON tds_26as_lines (matched_receipt_id);
