-- Part 23.01: the general ledger core. fin_journals: the voucher header (journal, payment, receipt, contra, purchase, sales, debit / credit note, opening balance), its life
-- (DRAFT, SUBMITTED, RETURNED, APPROVED = posted, REJECTED, CANCELLED), its source document, the reversal link both ways, accrual auto-reversal; fin_journal_lines: debit or
-- credit to one account with its dimensions (branch, project, site, WBS, cost centre, profit centre, department, cost code, partner, employee, equipment); fin_balances: the balance projection per account,
-- period and set of dimensions, written when a journal posts (BR-02: equal to the sum of the posted lines); fin_recurring_journals: the templates the recurring job turns into
-- journals. Amounts are integer paise, as everywhere in this database (05_GLOBAL_STANDARDS §4.2 NUMERIC(18,2) is held exactly as paise).

CREATE TABLE IF NOT EXISTS fin_journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  voucher_type    TEXT    NOT NULL CHECK (voucher_type IN ('JV', 'PV', 'RV', 'CV', 'PJ', 'SJ', 'DN', 'CN', 'OB')),
  voucher_no      TEXT,
  voucher_date    TEXT    NOT NULL,
  fy_id           INTEGER REFERENCES core_financial_years (id),
  period_id       INTEGER REFERENCES core_periods (id),
  kind            TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (kind IN ('MANUAL', 'RECURRING', 'ACCRUAL', 'REVERSAL', 'OPENING', 'ENGINE')),
  narration       TEXT    NOT NULL,
  total_paise     INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  auto_reverse_on TEXT,
  reversal_of_id  INTEGER REFERENCES fin_journals (id),
  reversed_by_id  INTEGER REFERENCES fin_journals (id),
  recurring_id    INTEGER,
  posted_at       TEXT,
  posted_by       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_journals_doc ON fin_journals (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_journals_voucher ON fin_journals (company_id, voucher_no) WHERE voucher_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_journals_source ON fin_journals (company_id, source_type, source_id) WHERE kind = 'ENGINE' AND status != 'CANCELLED';
CREATE INDEX IF NOT EXISTS ix_fin_journals_list ON fin_journals (company_id, status, voucher_date);
CREATE INDEX IF NOT EXISTS ix_fin_journals_type ON fin_journals (company_id, voucher_type, voucher_date);
CREATE INDEX IF NOT EXISTS ix_fin_journals_period ON fin_journals (period_id);
CREATE INDEX IF NOT EXISTS ix_fin_journals_fy ON fin_journals (fy_id);
CREATE INDEX IF NOT EXISTS ix_fin_journals_reversal ON fin_journals (reversal_of_id);
CREATE INDEX IF NOT EXISTS ix_fin_journals_reversed ON fin_journals (reversed_by_id);
CREATE INDEX IF NOT EXISTS ix_fin_journals_recurring ON fin_journals (recurring_id);
CREATE INDEX IF NOT EXISTS ix_fin_journals_auto ON fin_journals (company_id, auto_reverse_on) WHERE auto_reverse_on IS NOT NULL AND reversed_by_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_fin_journals_wf ON fin_journals (workflow_instance_id);

CREATE TABLE IF NOT EXISTS fin_journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  journal_id      INTEGER NOT NULL REFERENCES fin_journals (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  account_id      INTEGER NOT NULL REFERENCES fin_accounts (id),
  debit_paise     INTEGER NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),
  credit_paise    INTEGER NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  branch_id       INTEGER REFERENCES org_branches (id),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_centre_id  INTEGER REFERENCES org_cost_centres (id),
  profit_centre_id INTEGER REFERENCES org_cost_centres (id),
  department_id   INTEGER REFERENCES org_departments (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  partner_id      INTEGER REFERENCES mdm_partners (id),
  employee_id     INTEGER REFERENCES hr_employees (id),
  equipment_id    INTEGER REFERENCES plt_equipment (id),
  narration       TEXT,
  project_id  INTEGER REFERENCES org_projects (id),
  site_id     INTEGER REFERENCES org_sites (id),
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
  CHECK ((debit_paise > 0 AND credit_paise = 0) OR (credit_paise > 0 AND debit_paise = 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_journal_lines_no ON fin_journal_lines (journal_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fin_journal_lines_account ON fin_journal_lines (account_id, company_id, journal_id);
CREATE INDEX IF NOT EXISTS ix_fin_journal_lines_company ON fin_journal_lines (company_id, account_id);
CREATE INDEX IF NOT EXISTS ix_fin_journal_lines_project ON fin_journal_lines (project_id);
CREATE INDEX IF NOT EXISTS ix_fin_journal_lines_site ON fin_journal_lines (site_id);
CREATE INDEX IF NOT EXISTS ix_fin_journal_lines_branch ON fin_journal_lines (branch_id);
CREATE INDEX IF NOT EXISTS ix_fin_journal_lines_wbs ON fin_journal_lines (wbs_id);
CREATE INDEX IF NOT EXISTS ix_fin_journal_lines_cc ON fin_journal_lines (cost_centre_id);
CREATE INDEX IF NOT EXISTS ix_fin_journal_lines_code ON fin_journal_lines (cost_code_id);
CREATE INDEX IF NOT EXISTS ix_fin_journal_lines_pc ON fin_journal_lines (profit_centre_id);
CREATE INDEX IF NOT EXISTS ix_fin_journal_lines_dept ON fin_journal_lines (department_id);
CREATE INDEX IF NOT EXISTS ix_fin_journal_lines_partner ON fin_journal_lines (partner_id);
CREATE INDEX IF NOT EXISTS ix_fin_journal_lines_employee ON fin_journal_lines (employee_id);
CREATE INDEX IF NOT EXISTS ix_fin_journal_lines_equipment ON fin_journal_lines (equipment_id);

CREATE TABLE IF NOT EXISTS fin_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  account_id      INTEGER NOT NULL REFERENCES fin_accounts (id),
  period_id       INTEGER NOT NULL REFERENCES core_periods (id),
  dimension_hash  TEXT    NOT NULL,
  branch_id       INTEGER,
  cost_centre_id  INTEGER,
  debit_paise     INTEGER NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),
  credit_paise    INTEGER NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_balances_key ON fin_balances (company_id, account_id, period_id, dimension_hash);
CREATE INDEX IF NOT EXISTS ix_fin_balances_period ON fin_balances (period_id);
CREATE INDEX IF NOT EXISTS ix_fin_balances_account ON fin_balances (account_id);

CREATE TABLE IF NOT EXISTS fin_recurring_journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  voucher_type    TEXT    NOT NULL DEFAULT 'JV' CHECK (voucher_type IN ('JV', 'PV', 'RV', 'CV', 'PJ', 'SJ', 'DN', 'CN')),
  frequency       TEXT    NOT NULL CHECK (frequency IN ('MONTHLY', 'QUARTERLY', 'YEARLY')),
  day_of_month    INTEGER NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  next_run_on     TEXT    NOT NULL,
  end_on          TEXT,
  narration       TEXT    NOT NULL,
  lines_json      TEXT    NOT NULL DEFAULT '[]',
  total_paise     INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  rec_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (rec_status IN ('ACTIVE', 'PAUSED', 'ENDED')),
  runs            INTEGER NOT NULL DEFAULT 0 CHECK (runs >= 0),
  last_run_on     TEXT,
  owner_user      TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_recurring_doc ON fin_recurring_journals (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_fin_recurring_due ON fin_recurring_journals (rec_status, next_run_on);
