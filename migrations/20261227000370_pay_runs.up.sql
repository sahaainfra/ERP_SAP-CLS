-- Part 24.02: monthly staff payroll. pay_runs (approval-controlled, PAY -> HRMGR -> CFO): the run of a company (or a branch) for a period of the payroll
-- calendar, regular or supplementary, with its totals and the summary of its inputs; the approval locks it. pay_run_lines: one employee's result — days, LOP,
-- overtime, every component, gross, deductions, employer contributions, net, TDS, the checks raised, a hold with its reason and the cost by project and site.
-- pay_inputs: the variable inputs of a month (leave encashment, loss recoveries, incentives, recoveries) captured from their modules' events or entered by
-- payroll, applied once by a locked run. pay_tax_declarations: an employee's regime and investment declarations for a financial year with their proofs.
CREATE TABLE IF NOT EXISTS pay_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  period_id       INTEGER REFERENCES pay_calendar (id),
  run_type        TEXT    NOT NULL DEFAULT 'REGULAR' CHECK (run_type IN ('REGULAR', 'SUPPLEMENTARY')),
  branch_id       INTEGER REFERENCES org_branches (id),
  employees_count INTEGER NOT NULL DEFAULT 0 CHECK (employees_count >= 0),
  gross_paise     INTEGER NOT NULL DEFAULT 0,
  deductions_paise INTEGER NOT NULL DEFAULT 0,
  employer_paise  INTEGER NOT NULL DEFAULT 0,
  net_paise       INTEGER NOT NULL DEFAULT 0,
  tds_paise       INTEGER NOT NULL DEFAULT 0,
  held_count      INTEGER NOT NULL DEFAULT 0,
  flags_count     INTEGER NOT NULL DEFAULT 0,
  blocking_count  INTEGER NOT NULL DEFAULT 0,
  inputs_json     TEXT    NOT NULL DEFAULT '{}',
  computed_at     TEXT,
  locked_at       TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  amends_id       INTEGER REFERENCES pay_runs (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_runs_doc ON pay_runs (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_runs_regular ON pay_runs (company_id, period, COALESCE(branch_id, 0)) WHERE run_type = 'REGULAR' AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_runs_list ON pay_runs (company_id, period, status);
CREATE INDEX IF NOT EXISTS ix_pay_runs_period_id ON pay_runs (period_id);
CREATE INDEX IF NOT EXISTS ix_pay_runs_branch ON pay_runs (branch_id);
CREATE INDEX IF NOT EXISTS ix_pay_runs_wf ON pay_runs (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_pay_runs_amends ON pay_runs (amends_id);

CREATE TABLE IF NOT EXISTS pay_run_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  run_id          INTEGER NOT NULL REFERENCES pay_runs (id),
  employee_id     INTEGER NOT NULL REFERENCES hr_employees (id),
  assignment_id   INTEGER REFERENCES pay_assignments (id),
  days_in_month   INTEGER NOT NULL,
  payable_days    REAL    NOT NULL DEFAULT 0 CHECK (payable_days >= 0),
  paid_days       REAL    NOT NULL DEFAULT 0 CHECK (paid_days >= 0),
  lop_days        REAL    NOT NULL DEFAULT 0 CHECK (lop_days >= 0),
  ot_hours        REAL    NOT NULL DEFAULT 0 CHECK (ot_hours >= 0),
  components_json TEXT    NOT NULL DEFAULT '[]',
  gross_paise     INTEGER NOT NULL DEFAULT 0,
  taxable_paise   INTEGER NOT NULL DEFAULT 0,
  deductions_paise INTEGER NOT NULL DEFAULT 0,
  employer_paise  INTEGER NOT NULL DEFAULT 0,
  net_paise       INTEGER NOT NULL DEFAULT 0,
  tds_paise       INTEGER NOT NULL DEFAULT 0,
  tds_json        TEXT    NOT NULL DEFAULT '{}',
  wages_json      TEXT    NOT NULL DEFAULT '{}',
  flags_json      TEXT    NOT NULL DEFAULT '[]',
  hold            INTEGER NOT NULL DEFAULT 0 CHECK (hold IN (0, 1)),
  hold_reason     TEXT,
  hold_released_at TEXT,
  allocation_json TEXT    NOT NULL DEFAULT '[]',
  bank_ok         INTEGER NOT NULL DEFAULT 0 CHECK (bank_ok IN (0, 1)),
  payment_mode    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_run_lines_emp ON pay_run_lines (run_id, employee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_run_lines_run_id ON pay_run_lines (run_id);
CREATE INDEX IF NOT EXISTS ix_pay_run_lines_company_id ON pay_run_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_pay_run_lines_employee ON pay_run_lines (employee_id, company_id);
CREATE INDEX IF NOT EXISTS ix_pay_run_lines_assignment ON pay_run_lines (assignment_id);

CREATE TABLE IF NOT EXISTS pay_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id     INTEGER NOT NULL REFERENCES hr_employees (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  component_code  TEXT    NOT NULL,
  amount_paise    INTEGER CHECK (amount_paise IS NULL OR amount_paise >= 0),
  qty_milli       INTEGER CHECK (qty_milli IS NULL OR qty_milli >= 0),
  basis           TEXT    NOT NULL DEFAULT 'AMOUNT' CHECK (basis IN ('AMOUNT', 'DAYS_OF_WAGES')),
  note            TEXT,
  input_status    TEXT    NOT NULL DEFAULT 'PENDING' CHECK (input_status IN ('PENDING', 'APPLIED', 'CANCELLED')),
  run_id          INTEGER REFERENCES pay_runs (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_inputs_source ON pay_inputs (company_id, source_type, source_id) WHERE source_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_inputs_employee ON pay_inputs (employee_id, input_status, period);
CREATE INDEX IF NOT EXISTS ix_pay_inputs_company ON pay_inputs (company_id, period, input_status);
CREATE INDEX IF NOT EXISTS ix_pay_inputs_run_id ON pay_inputs (run_id);

CREATE TABLE IF NOT EXISTS pay_tax_declarations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id     INTEGER NOT NULL REFERENCES hr_employees (id),
  fy              TEXT    NOT NULL CHECK (fy GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  regime          TEXT    NOT NULL DEFAULT 'NEW' CHECK (regime IN ('NEW', 'OLD')),
  declarations_json TEXT  NOT NULL DEFAULT '{}',
  proofs_json     TEXT    NOT NULL DEFAULT '[]',
  verified_json   TEXT    NOT NULL DEFAULT '{}',
  decl_status     TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (decl_status IN ('DRAFT', 'SUBMITTED', 'VERIFIED', 'RETURNED')),
  submitted_at    TEXT,
  verified_by     TEXT,
  verified_at     TEXT,
  verify_note     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_tax_declarations_emp ON pay_tax_declarations (employee_id, fy) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_tax_declarations_company ON pay_tax_declarations (company_id, fy, decl_status);
