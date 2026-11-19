-- Part 24.05: payroll posting, payslips, bank transfers and full-and-final settlement.
-- pay_fnf: the full-and-final settlement of a separated employee (approval-controlled, workflow PAY_FNF: PAY -> HRMGR -> CFO), computed from the inputs that
--   exit (07.13) released after the clearance (BR-01): last salary, leave encashment, notice pay or recovery, gratuity, bonus, recoveries and TDS.
-- pay_payslips: the payslip of an employee for a payroll run, generated from the template library (04.11) as a password-protected PDF, sent by e-mail and
--   seen in self-service (07.09).
-- pay_transfers / pay_transfer_lines: a salary payment to the bank: the net pay of a locked run (or of a released hold, or of a settlement) in the bank file of
--   the company's bank account (23.04 templates), released by a person other than its preparer, posted, then confirmed line by line with the UTR.
-- pay_fnf_rules: the dated rules of the settlement (due date, gratuity eligibility, tax exemptions), master data with the legal reference, never constants.
CREATE TABLE IF NOT EXISTS pay_fnf (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  employee_id     INTEGER NOT NULL REFERENCES hr_employees (id),
  separation_id   INTEGER NOT NULL REFERENCES hr_separations (id),
  last_working_day TEXT   NOT NULL,
  due_date        TEXT,
  inputs_json     TEXT    NOT NULL DEFAULT '{}',
  components_json TEXT    NOT NULL DEFAULT '[]',
  adjustments_json TEXT   NOT NULL DEFAULT '[]',
  working_json    TEXT    NOT NULL DEFAULT '{}',
  bonus_rate_bp   INTEGER CHECK (bonus_rate_bp IS NULL OR bonus_rate_bp >= 0),
  gross_paise     INTEGER NOT NULL DEFAULT 0 CHECK (gross_paise >= 0),
  deductions_paise INTEGER NOT NULL DEFAULT 0 CHECK (deductions_paise >= 0),
  tds_paise       INTEGER NOT NULL DEFAULT 0 CHECK (tds_paise >= 0),
  net_paise       INTEGER NOT NULL DEFAULT 0,
  payable_paise   INTEGER NOT NULL DEFAULT 0 CHECK (payable_paise >= 0),
  recoverable_paise INTEGER NOT NULL DEFAULT 0 CHECK (recoverable_paise >= 0),
  computed_at     TEXT,
  pay_status      TEXT    NOT NULL DEFAULT 'UNPAID' CHECK (pay_status IN ('UNPAID', 'IN_TRANSFER', 'PAID', 'RECOVERABLE', 'NIL')),
  paid_on         TEXT,
  late            INTEGER NOT NULL DEFAULT 0 CHECK (late IN (0, 1)),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  amends_id       INTEGER REFERENCES pay_fnf (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_fnf_doc ON pay_fnf (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_fnf_separation ON pay_fnf (company_id, separation_id) WHERE amends_id IS NULL AND status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_fnf_list ON pay_fnf (company_id, status, last_working_day);
CREATE INDEX IF NOT EXISTS ix_pay_fnf_employee_id ON pay_fnf (employee_id);
CREATE INDEX IF NOT EXISTS ix_pay_fnf_separation_id ON pay_fnf (separation_id);
CREATE INDEX IF NOT EXISTS ix_pay_fnf_amends_id ON pay_fnf (amends_id);
CREATE INDEX IF NOT EXISTS ix_pay_fnf_wf ON pay_fnf (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_pay_fnf_pay ON pay_fnf (company_id, pay_status);

CREATE TABLE IF NOT EXISTS pay_payslips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  run_id          INTEGER NOT NULL REFERENCES pay_runs (id),
  run_line_id     INTEGER REFERENCES pay_run_lines (id),
  employee_id     INTEGER NOT NULL REFERENCES hr_employees (id),
  period          TEXT    NOT NULL,
  lang            TEXT    NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'hi')),
  generated_doc_id INTEGER REFERENCES tpl_generated_docs (id),
  file_id         INTEGER REFERENCES core_files (id),
  net_paise       INTEGER NOT NULL DEFAULT 0,
  protected       INTEGER NOT NULL DEFAULT 1 CHECK (protected IN (0, 1)),
  email_status    TEXT    NOT NULL DEFAULT 'NOT_SENT' CHECK (email_status IN ('NOT_SENT', 'QUEUED', 'SENT', 'BLOCKED', 'NO_ADDRESS', 'FAILED')),
  email_to        TEXT,
  email_error     TEXT,
  emailed_at      TEXT,
  delivery_id     INTEGER,
  viewed_at       TEXT,
  view_count      INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  slip_status     TEXT    NOT NULL DEFAULT 'GENERATED' CHECK (slip_status IN ('GENERATED', 'SUPERSEDED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_payslips_current ON pay_payslips (run_id, employee_id) WHERE slip_status = 'GENERATED' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_payslips_list ON pay_payslips (company_id, period, email_status);
CREATE INDEX IF NOT EXISTS ix_pay_payslips_run_id ON pay_payslips (run_id);
CREATE INDEX IF NOT EXISTS ix_pay_payslips_run_line_id ON pay_payslips (run_line_id);
CREATE INDEX IF NOT EXISTS ix_pay_payslips_employee_id ON pay_payslips (employee_id, period);
CREATE INDEX IF NOT EXISTS ix_pay_payslips_generated_doc_id ON pay_payslips (generated_doc_id);
CREATE INDEX IF NOT EXISTS ix_pay_payslips_file_id ON pay_payslips (file_id);

CREATE TABLE IF NOT EXISTS pay_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  source_kind     TEXT    NOT NULL CHECK (source_kind IN ('PAY_RUN', 'HELD_RELEASE', 'FNF')),
  run_id          INTEGER REFERENCES pay_runs (id),
  fnf_id          INTEGER REFERENCES pay_fnf (id),
  bank_account_id INTEGER NOT NULL REFERENCES fin_bank_accounts (id),
  pay_mode        TEXT    NOT NULL DEFAULT 'NEFT' CHECK (pay_mode IN ('NEFT', 'RTGS', 'IMPS')),
  pay_date        TEXT    NOT NULL,
  lines_count     INTEGER NOT NULL DEFAULT 0 CHECK (lines_count >= 0),
  total_paise     INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  paid_paise      INTEGER NOT NULL DEFAULT 0 CHECK (paid_paise >= 0),
  file_name       TEXT,
  file_text       TEXT,
  file_hash       TEXT,
  transfer_status TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (transfer_status IN ('DRAFT', 'RELEASED', 'PART_CONFIRMED', 'CONFIRMED', 'CANCELLED')),
  prepared_by     TEXT,
  released_by     TEXT,
  released_at     TEXT,
  journal_id      INTEGER REFERENCES fin_journals (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_transfers_doc ON pay_transfers (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_pay_transfers_list ON pay_transfers (company_id, transfer_status, pay_date);
CREATE INDEX IF NOT EXISTS ix_pay_transfers_run_id ON pay_transfers (run_id);
CREATE INDEX IF NOT EXISTS ix_pay_transfers_fnf_id ON pay_transfers (fnf_id);
CREATE INDEX IF NOT EXISTS ix_pay_transfers_bank_account_id ON pay_transfers (bank_account_id);
CREATE INDEX IF NOT EXISTS ix_pay_transfers_journal_id ON pay_transfers (journal_id);

CREATE TABLE IF NOT EXISTS pay_transfer_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  transfer_id     INTEGER NOT NULL REFERENCES pay_transfers (id),
  employee_id     INTEGER NOT NULL REFERENCES hr_employees (id),
  run_line_id     INTEGER REFERENCES pay_run_lines (id),
  fnf_id          INTEGER REFERENCES pay_fnf (id),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  employee_bank_id INTEGER REFERENCES hr_employee_banks (id),
  bank_last4      TEXT,
  bank_ifsc       TEXT,
  account_name    TEXT,
  name_match      TEXT    NOT NULL DEFAULT 'UNCHECKED' CHECK (name_match IN ('MATCH', 'MISMATCH', 'UNCHECKED')),
  line_status     TEXT    NOT NULL DEFAULT 'INCLUDED' CHECK (line_status IN ('INCLUDED', 'PAID', 'FAILED', 'REMOVED')),
  utr             TEXT,
  paid_on         TEXT,
  failure_reason  TEXT,
  reversal_journal_id INTEGER REFERENCES fin_journals (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_transfer_lines_run_line ON pay_transfer_lines (run_line_id) WHERE run_line_id IS NOT NULL AND line_status IN ('INCLUDED', 'PAID') AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_transfer_lines_fnf ON pay_transfer_lines (fnf_id) WHERE fnf_id IS NOT NULL AND line_status IN ('INCLUDED', 'PAID') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_transfer_lines_transfer_id ON pay_transfer_lines (transfer_id, line_status);
CREATE INDEX IF NOT EXISTS ix_pay_transfer_lines_company_id ON pay_transfer_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_pay_transfer_lines_employee_id ON pay_transfer_lines (employee_id);
CREATE INDEX IF NOT EXISTS ix_pay_transfer_lines_employee_bank_id ON pay_transfer_lines (employee_bank_id);
CREATE INDEX IF NOT EXISTS ix_pay_transfer_lines_reversal ON pay_transfer_lines (reversal_journal_id);

CREATE TABLE IF NOT EXISTS pay_fnf_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER REFERENCES org_companies (id),
  rule_type       TEXT    NOT NULL CHECK (rule_type IN ('FNF_DUE', 'GRATUITY_ELIGIBILITY', 'GRATUITY_EXEMPT', 'LEAVE_ENC_EXEMPT', 'FNF_BASIS')),
  state_code      TEXT    NOT NULL DEFAULT 'ALL',
  params_json     TEXT    NOT NULL DEFAULT '{}',
  effective_from  TEXT    NOT NULL,
  effective_to    TEXT,
  legal_ref       TEXT,
  rule_status     TEXT    NOT NULL DEFAULT 'APPROVED' CHECK (rule_status IN ('APPROVED', 'TO_CONFIRM')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_fnf_rules ON pay_fnf_rules (COALESCE(company_id, 0), rule_type, state_code, effective_from) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_fnf_rules_company_id ON pay_fnf_rules (company_id);
