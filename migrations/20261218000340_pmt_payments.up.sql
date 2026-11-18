-- Part 23.04: payments. fin_bank_accounts: the company's own bank accounts (the account number encrypted, the ledger account it posts to, the bank file template
-- and the cheque series). pmt_proposals: a payment proposal — the bank account, the mode, the date, its lines; approved by band (accounts manager, CFO above ₹10 lakh,
-- director above ₹1 crore), then released (the bank file or the cheques) by a third person and confirmed (UTR or cheque). pmt_proposal_lines: a bill, an advance or an
-- on-account payment of a vendor or subcontractor. pmt_payments: one payment per line of a released proposal, with its UTR or cheque, its status, its journal and its advice.

CREATE TABLE IF NOT EXISTS fin_bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  bank_name       TEXT    NOT NULL,
  ifsc            TEXT    NOT NULL,
  account_no_enc  TEXT    NOT NULL,
  account_last4   TEXT    NOT NULL,
  gl_account_id   INTEGER NOT NULL REFERENCES fin_accounts (id),
  file_format     TEXT    NOT NULL DEFAULT 'GENERIC_CSV',
  file_template_json TEXT NOT NULL DEFAULT '{}',
  cheque_next_no  INTEGER,
  cheque_last_no  INTEGER,
  acct_status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (acct_status IN ('ACTIVE', 'BLOCKED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_bank_accounts_code ON fin_bank_accounts (company_id, code);
CREATE INDEX IF NOT EXISTS ix_fin_bank_accounts_gl ON fin_bank_accounts (gl_account_id);

CREATE TABLE IF NOT EXISTS pmt_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  bank_account_id INTEGER NOT NULL REFERENCES fin_bank_accounts (id),
  pay_mode        TEXT    NOT NULL CHECK (pay_mode IN ('NEFT', 'RTGS', 'IMPS', 'CHEQUE')),
  pay_date        TEXT    NOT NULL,
  purpose         TEXT,
  total_paise     INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  lines_count     INTEGER NOT NULL DEFAULT 0 CHECK (lines_count >= 0),
  run_status      TEXT    NOT NULL DEFAULT 'NONE' CHECK (run_status IN ('NONE', 'RELEASED', 'CONFIRMED', 'PART_CONFIRMED')),
  released_by     TEXT,
  released_at     TEXT,
  file_name       TEXT,
  file_hash       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pmt_proposals_doc ON pmt_proposals (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_pmt_proposals_list ON pmt_proposals (company_id, status, pay_date);
CREATE INDEX IF NOT EXISTS ix_pmt_proposals_bank ON pmt_proposals (bank_account_id);
CREATE INDEX IF NOT EXISTS ix_pmt_proposals_wf ON pmt_proposals (workflow_instance_id);

CREATE TABLE IF NOT EXISTS pmt_proposal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  proposal_id     INTEGER NOT NULL REFERENCES pmt_proposals (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  line_kind       TEXT    NOT NULL CHECK (line_kind IN ('BILL', 'ADVANCE', 'ON_ACCOUNT')),
  ap_bill_id      INTEGER REFERENCES ap_bills (id),
  advance_id      INTEGER REFERENCES bill_advances (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  payee_name      TEXT    NOT NULL,
  partner_bank_id INTEGER REFERENCES mdm_partner_banks (id),
  bank_last4      TEXT,
  bank_ifsc       TEXT,
  bank_account_name TEXT,
  name_match      TEXT    NOT NULL DEFAULT 'UNCHECKED' CHECK (name_match IN ('OK', 'MISMATCH', 'UNCHECKED')),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  tds_paise       INTEGER NOT NULL DEFAULT 0 CHECK (tds_paise >= 0),
  purpose         TEXT,
  line_status     TEXT    NOT NULL DEFAULT 'PROPOSED' CHECK (line_status IN ('PROPOSED', 'RELEASED', 'PAID', 'FAILED', 'REMOVED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pmt_lines_no ON pmt_proposal_lines (proposal_id, line_no);
CREATE INDEX IF NOT EXISTS ix_pmt_lines_bill ON pmt_proposal_lines (ap_bill_id, line_status);
CREATE INDEX IF NOT EXISTS ix_pmt_lines_partner ON pmt_proposal_lines (partner_id);
CREATE INDEX IF NOT EXISTS ix_pmt_lines_advance ON pmt_proposal_lines (advance_id, line_status);
CREATE INDEX IF NOT EXISTS ix_pmt_lines_bank ON pmt_proposal_lines (partner_bank_id);
CREATE INDEX IF NOT EXISTS ix_pmt_lines_company ON pmt_proposal_lines (company_id, line_status);

CREATE TABLE IF NOT EXISTS pmt_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  proposal_id     INTEGER NOT NULL REFERENCES pmt_proposals (id),
  line_id         INTEGER NOT NULL REFERENCES pmt_proposal_lines (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  payee_name      TEXT    NOT NULL,
  pay_mode        TEXT    NOT NULL CHECK (pay_mode IN ('NEFT', 'RTGS', 'IMPS', 'CHEQUE')),
  bank_account_id INTEGER NOT NULL REFERENCES fin_bank_accounts (id),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  utr             TEXT,
  cheque_no       TEXT,
  released_on     TEXT    NOT NULL,
  paid_on         TEXT,
  pay_status      TEXT    NOT NULL DEFAULT 'PENDING' CHECK (pay_status IN ('PENDING', 'PAID', 'FAILED', 'CANCELLED')),
  failure_reason  TEXT,
  journal_id      INTEGER REFERENCES fin_journals (id),
  advice_at       TEXT,
  advice_status   TEXT,
  advice_message_id INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pmt_payments_doc ON pmt_payments (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pmt_payments_line ON pmt_payments (line_id) WHERE pay_status != 'CANCELLED';
CREATE UNIQUE INDEX IF NOT EXISTS ux_pmt_payments_utr ON pmt_payments (company_id, utr) WHERE utr IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_pmt_payments_cheque ON pmt_payments (bank_account_id, cheque_no) WHERE cheque_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_pmt_payments_list ON pmt_payments (company_id, pay_status, paid_on);
CREATE INDEX IF NOT EXISTS ix_pmt_payments_proposal ON pmt_payments (proposal_id);
CREATE INDEX IF NOT EXISTS ix_pmt_payments_line_status ON pmt_payments (line_id, pay_status);
CREATE INDEX IF NOT EXISTS ix_pmt_payments_partner ON pmt_payments (partner_id, paid_on);
CREATE INDEX IF NOT EXISTS ix_pmt_payments_bank ON pmt_payments (bank_account_id, pay_status, released_on);
CREATE INDEX IF NOT EXISTS ix_pmt_payments_journal ON pmt_payments (journal_id);
