-- Part 23.06: cash and bank. fin_bank_account_profiles: what a company bank account is (current, cash credit, overdraft, escrow, deposit), whom it serves (the company,
-- a branch, a project) and its opening balance for reconciliation. fin_bank_statement_imports / fin_bank_statements: a statement imported (CSV or MT940) and its lines,
-- each matched to the payment, receipt, transfer or replenishment it is, or posted as a bank charge or interest, or set aside. fin_bank_recons: a reconciliation
-- statement (BRS) signed off by the accounts manager. fin_imprests: the petty cash or site imprest of a custodian (limit, balance). fin_imprest_vouchers: an expense
-- paid from it, with its bill photo and cost allocation (above ₹10,000 approved by the construction manager). fin_imprest_replenishments: the approved vouchers paid
-- back to the custodian (site accountant → project manager → accounts manager). fin_cash_counts: a count of the cash in hand. fin_contras: cash deposited or
-- withdrawn, or money moved between bank accounts (approved by the accounts manager).

CREATE TABLE IF NOT EXISTS fin_bank_account_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  bank_account_id INTEGER NOT NULL REFERENCES fin_bank_accounts (id),
  account_kind    TEXT    NOT NULL DEFAULT 'CURRENT' CHECK (account_kind IN ('CURRENT', 'CASH_CREDIT', 'OVERDRAFT', 'ESCROW', 'DEPOSIT')),
  scope_kind      TEXT    NOT NULL DEFAULT 'COMPANY' CHECK (scope_kind IN ('COMPANY', 'BRANCH', 'PROJECT')),
  branch_id       INTEGER REFERENCES org_branches (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  escrow_purpose  TEXT,
  od_limit_paise  INTEGER NOT NULL DEFAULT 0 CHECK (od_limit_paise >= 0),
  opening_date    TEXT,
  opening_paise   INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_bank_profiles_account ON fin_bank_account_profiles (bank_account_id);
CREATE INDEX IF NOT EXISTS ix_fin_bank_profiles_company ON fin_bank_account_profiles (company_id, account_kind);
CREATE INDEX IF NOT EXISTS ix_fin_bank_profiles_branch ON fin_bank_account_profiles (branch_id);
CREATE INDEX IF NOT EXISTS ix_fin_bank_profiles_project ON fin_bank_account_profiles (org_project_id);

CREATE TABLE IF NOT EXISTS fin_bank_statement_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  bank_account_id INTEGER NOT NULL REFERENCES fin_bank_accounts (id),
  file_name       TEXT    NOT NULL,
  file_format     TEXT    NOT NULL CHECK (file_format IN ('CSV', 'MT940')),
  from_date       TEXT    NOT NULL,
  to_date         TEXT    NOT NULL,
  opening_paise   INTEGER,
  closing_paise   INTEGER,
  lines_count     INTEGER NOT NULL DEFAULT 0 CHECK (lines_count >= 0),
  duplicates_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicates_count >= 0),
  matched_count   INTEGER NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_bank_imports_doc ON fin_bank_statement_imports (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_fin_bank_imports_account ON fin_bank_statement_imports (bank_account_id, to_date);

CREATE TABLE IF NOT EXISTS fin_bank_statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  import_id       INTEGER NOT NULL REFERENCES fin_bank_statement_imports (id),
  bank_account_id INTEGER NOT NULL REFERENCES fin_bank_accounts (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  txn_date        TEXT    NOT NULL,
  value_date      TEXT,
  description     TEXT    NOT NULL DEFAULT '',
  ref             TEXT,
  cheque_no       TEXT,
  debit_paise     INTEGER NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),
  credit_paise    INTEGER NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  balance_paise   INTEGER,
  line_hash       TEXT    NOT NULL,
  match_status    TEXT    NOT NULL DEFAULT 'UNMATCHED' CHECK (match_status IN ('UNMATCHED', 'AUTO', 'MANUAL', 'POSTED', 'IGNORED')),
  matched_entity  TEXT    CHECK (matched_entity IS NULL OR matched_entity IN ('pmt_payments', 'ar_receipts', 'fin_contras', 'fin_imprest_replenishments', 'fin_journals')),
  matched_id      INTEGER,
  match_rule      TEXT,
  matched_by      TEXT,
  matched_at      TEXT,
  journal_id      INTEGER REFERENCES fin_journals (id),
  ignore_reason   TEXT,
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
  CHECK ((debit_paise > 0) <> (credit_paise > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_bank_statements_hash ON fin_bank_statements (bank_account_id, line_hash);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_bank_statements_match ON fin_bank_statements (matched_entity, matched_id) WHERE matched_id IS NOT NULL AND match_status IN ('AUTO', 'MANUAL');
CREATE INDEX IF NOT EXISTS ix_fin_bank_statements_queue ON fin_bank_statements (bank_account_id, match_status, txn_date);
CREATE INDEX IF NOT EXISTS ix_fin_bank_statements_import ON fin_bank_statements (import_id);
CREATE INDEX IF NOT EXISTS ix_fin_bank_statements_company ON fin_bank_statements (company_id, match_status);
CREATE INDEX IF NOT EXISTS ix_fin_bank_statements_journal ON fin_bank_statements (journal_id);

CREATE TABLE IF NOT EXISTS fin_bank_recons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  bank_account_id INTEGER NOT NULL REFERENCES fin_bank_accounts (id),
  as_of           TEXT    NOT NULL,
  book_paise      INTEGER NOT NULL,
  bank_paise      INTEGER NOT NULL,
  unpresented_paise INTEGER NOT NULL DEFAULT 0,
  uncredited_paise INTEGER NOT NULL DEFAULT 0,
  bank_only_dr_paise INTEGER NOT NULL DEFAULT 0,
  bank_only_cr_paise INTEGER NOT NULL DEFAULT 0,
  difference_paise INTEGER NOT NULL DEFAULT 0,
  signed_by       TEXT    NOT NULL,
  signed_at       TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_bank_recons_date ON fin_bank_recons (bank_account_id, as_of) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fin_bank_recons_company ON fin_bank_recons (company_id, as_of);

CREATE TABLE IF NOT EXISTS fin_imprests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  imprest_kind    TEXT    NOT NULL DEFAULT 'SITE' CHECK (imprest_kind IN ('SITE', 'OFFICE')),
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  custodian       TEXT    NOT NULL,
  gl_account_id   INTEGER NOT NULL REFERENCES fin_accounts (id),
  limit_paise     INTEGER NOT NULL CHECK (limit_paise > 0),
  balance_paise   INTEGER NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
  imprest_status  TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (imprest_status IN ('ACTIVE', 'CLOSED')),
  last_count_at   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_imprests_doc ON fin_imprests (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_fin_imprests_custodian ON fin_imprests (company_id, custodian, imprest_status);
CREATE INDEX IF NOT EXISTS ix_fin_imprests_project ON fin_imprests (org_project_id);
CREATE INDEX IF NOT EXISTS ix_fin_imprests_site ON fin_imprests (org_site_id);
CREATE INDEX IF NOT EXISTS ix_fin_imprests_gl ON fin_imprests (gl_account_id);

CREATE TABLE IF NOT EXISTS fin_imprest_replenishments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  imprest_id      INTEGER NOT NULL REFERENCES fin_imprests (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  bank_account_id INTEGER NOT NULL REFERENCES fin_bank_accounts (id),
  vouchers_json   TEXT    NOT NULL DEFAULT '[]',
  vouchers_count  INTEGER NOT NULL DEFAULT 0 CHECK (vouchers_count >= 0),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  paid_on         TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_imprest_repl_doc ON fin_imprest_replenishments (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_repl_imprest ON fin_imprest_replenishments (imprest_id, status);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_repl_list ON fin_imprest_replenishments (company_id, status);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_repl_project ON fin_imprest_replenishments (org_project_id);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_repl_site ON fin_imprest_replenishments (org_site_id);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_repl_bank ON fin_imprest_replenishments (bank_account_id);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_repl_journal ON fin_imprest_replenishments (journal_id);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_repl_wf ON fin_imprest_replenishments (workflow_instance_id);

CREATE TABLE IF NOT EXISTS fin_imprest_vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  imprest_id      INTEGER NOT NULL REFERENCES fin_imprests (id),
  voucher_date    TEXT    NOT NULL,
  payee           TEXT    NOT NULL,
  category        TEXT    NOT NULL CHECK (category IN ('MATERIAL', 'TRANSPORT', 'FOOD', 'REPAIRS', 'SITE_EXPENSE', 'TRAVEL', 'POSTAGE', 'OTHER')),
  description     TEXT    NOT NULL,
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  gst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (gst_paise >= 0),
  total_paise     INTEGER NOT NULL CHECK (total_paise > 0),
  expense_account_id INTEGER NOT NULL REFERENCES fin_accounts (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  wbs_id          INTEGER,
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  replenishment_id INTEGER REFERENCES fin_imprest_replenishments (id),
  client_ref      TEXT,
  lat             REAL,
  lng             REAL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_imprest_vouchers_doc ON fin_imprest_vouchers (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_imprest_vouchers_client ON fin_imprest_vouchers (company_id, client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_fin_imprest_vouchers_imprest ON fin_imprest_vouchers (imprest_id, status, replenishment_id);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_vouchers_list ON fin_imprest_vouchers (company_id, status, voucher_date);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_vouchers_expense ON fin_imprest_vouchers (expense_account_id);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_vouchers_cost ON fin_imprest_vouchers (cost_code_id);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_vouchers_project ON fin_imprest_vouchers (org_project_id);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_vouchers_site ON fin_imprest_vouchers (org_site_id);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_vouchers_repl ON fin_imprest_vouchers (replenishment_id);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_vouchers_journal ON fin_imprest_vouchers (journal_id);
CREATE INDEX IF NOT EXISTS ix_fin_imprest_vouchers_wf ON fin_imprest_vouchers (workflow_instance_id);

CREATE TABLE IF NOT EXISTS fin_cash_counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  imprest_id      INTEGER NOT NULL REFERENCES fin_imprests (id),
  count_date      TEXT    NOT NULL,
  denominations_json TEXT NOT NULL DEFAULT '{}',
  counted_paise   INTEGER NOT NULL CHECK (counted_paise >= 0),
  book_paise      INTEGER NOT NULL,
  difference_paise INTEGER NOT NULL,
  counted_by      TEXT    NOT NULL,
  witness         TEXT,
  note            TEXT,
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
CREATE INDEX IF NOT EXISTS ix_fin_cash_counts_imprest ON fin_cash_counts (imprest_id, count_date);
CREATE INDEX IF NOT EXISTS ix_fin_cash_counts_company ON fin_cash_counts (company_id, count_date);

CREATE TABLE IF NOT EXISTS fin_contras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  contra_kind     TEXT    NOT NULL CHECK (contra_kind IN ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER')),
  contra_date     TEXT    NOT NULL,
  from_bank_id    INTEGER REFERENCES fin_bank_accounts (id),
  from_imprest_id INTEGER REFERENCES fin_imprests (id),
  to_bank_id      INTEGER REFERENCES fin_bank_accounts (id),
  to_imprest_id   INTEGER REFERENCES fin_imprests (id),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  reference       TEXT,
  purpose         TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_contras_doc ON fin_contras (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_fin_contras_list ON fin_contras (company_id, status, contra_date);
CREATE INDEX IF NOT EXISTS ix_fin_contras_from_bank ON fin_contras (from_bank_id);
CREATE INDEX IF NOT EXISTS ix_fin_contras_to_bank ON fin_contras (to_bank_id);
CREATE INDEX IF NOT EXISTS ix_fin_contras_from_imprest ON fin_contras (from_imprest_id);
CREATE INDEX IF NOT EXISTS ix_fin_contras_to_imprest ON fin_contras (to_imprest_id);
CREATE INDEX IF NOT EXISTS ix_fin_contras_journal ON fin_contras (journal_id);
CREATE INDEX IF NOT EXISTS ix_fin_contras_wf ON fin_contras (workflow_instance_id);
