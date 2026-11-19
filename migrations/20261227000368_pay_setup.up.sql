-- Part 24.01: payroll set-up (module pay). pay_components: the pay components of a company (earnings, deductions, employer contributions, reimbursements) with
-- the method of each (fixed, percent of other components, formula of the calculation engine, the balance of the CTC, statutory, a monthly input), the tax,
-- PF, ESI and PT flags and the class under the Code on Wages; rows without a company are the template. pay_structures: a salary structure of a grade, its
-- components and their values, versioned. pay_assignments (approval-controlled, HRMGR -> CFO, the director for a senior grade): an employee's structure and CTC
-- from a date with the monthly breakup; a retro-dated revision computes its arrears (pay_arrears), paid by the next payroll run (24.02).
-- pay_statutory_params (approval-controlled, PAY -> CFO): effective-dated statutory rates, ceilings and slabs by state. pay_calendar: the payroll periods of a
-- company with their cut-offs and pay dates.
CREATE TABLE IF NOT EXISTS pay_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER REFERENCES org_companies (id),
  code            TEXT    NOT NULL CHECK (code GLOB '[A-Z]*' AND length(code) <= 20),
  name            TEXT    NOT NULL,
  comp_type       TEXT    NOT NULL CHECK (comp_type IN ('EARNING', 'DEDUCTION', 'EMPLOYER', 'REIMBURSEMENT')),
  calc_method     TEXT    NOT NULL CHECK (calc_method IN ('FIXED', 'PERCENT', 'FORMULA', 'BALANCE', 'STATUTORY', 'INPUT')),
  formula         TEXT,
  percent_bp      INTEGER CHECK (percent_bp IS NULL OR percent_bp >= 0),
  base_codes_json TEXT    NOT NULL DEFAULT '[]',
  statutory_code  TEXT,
  taxable         INTEGER NOT NULL DEFAULT 1 CHECK (taxable IN (0, 1)),
  pf_applicable   INTEGER NOT NULL DEFAULT 0 CHECK (pf_applicable IN (0, 1)),
  esi_applicable  INTEGER NOT NULL DEFAULT 0 CHECK (esi_applicable IN (0, 1)),
  pt_applicable   INTEGER NOT NULL DEFAULT 0 CHECK (pt_applicable IN (0, 1)),
  wage_class      TEXT    NOT NULL DEFAULT 'WAGES' CHECK (wage_class IN ('WAGES', 'EXCLUDED', 'NOT_REMUNERATION')),
  prorate         INTEGER NOT NULL DEFAULT 1 CHECK (prorate IN (0, 1)),
  sequence        INTEGER NOT NULL DEFAULT 100,
  gl_account_code TEXT,
  comp_status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (comp_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_components_code ON pay_components (COALESCE(company_id, 0), code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_components_list ON pay_components (company_id, comp_type, sequence);

CREATE TABLE IF NOT EXISTS pay_structures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  grade           TEXT,
  senior          INTEGER NOT NULL DEFAULT 0 CHECK (senior IN (0, 1)),
  components_json TEXT    NOT NULL DEFAULT '[]',
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  previous_id     INTEGER REFERENCES pay_structures (id),
  structure_status TEXT   NOT NULL DEFAULT 'ACTIVE' CHECK (structure_status IN ('ACTIVE', 'RETIRED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_structures_active ON pay_structures (company_id, code) WHERE structure_status = 'ACTIVE' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_structures_list ON pay_structures (company_id, grade, structure_status);
CREATE INDEX IF NOT EXISTS ix_pay_structures_prev ON pay_structures (previous_id);

CREATE TABLE IF NOT EXISTS pay_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  employee_id     INTEGER NOT NULL REFERENCES hr_employees (id),
  structure_id    INTEGER NOT NULL REFERENCES pay_structures (id),
  assignment_kind TEXT    NOT NULL DEFAULT 'NEW' CHECK (assignment_kind IN ('NEW', 'REVISION', 'PROMOTION', 'CORRECTION')),
  ctc_annual_paise INTEGER NOT NULL CHECK (ctc_annual_paise > 0),
  component_values_json TEXT NOT NULL DEFAULT '{}',
  overrides_json  TEXT    NOT NULL DEFAULT '{}',
  gross_monthly_paise INTEGER NOT NULL DEFAULT 0 CHECK (gross_monthly_paise >= 0),
  effective_from  TEXT    NOT NULL,
  effective_to    TEXT,
  reason          TEXT    NOT NULL,
  previous_id     INTEGER REFERENCES pay_assignments (id),
  rating          TEXT,
  increment_pct_bp INTEGER,
  arrears_paise   INTEGER NOT NULL DEFAULT 0,
    status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  amends_id       INTEGER REFERENCES pay_assignments (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_assignments_doc ON pay_assignments (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_assignments_open ON pay_assignments (employee_id) WHERE status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_assignments_list ON pay_assignments (company_id, status, effective_from);
CREATE INDEX IF NOT EXISTS ix_pay_assignments_employee ON pay_assignments (employee_id, effective_from);
CREATE INDEX IF NOT EXISTS ix_pay_assignments_structure ON pay_assignments (structure_id);
CREATE INDEX IF NOT EXISTS ix_pay_assignments_prev ON pay_assignments (previous_id);
CREATE INDEX IF NOT EXISTS ix_pay_assignments_wf ON pay_assignments (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_pay_assignments_amends ON pay_assignments (amends_id);

CREATE TABLE IF NOT EXISTS pay_arrears (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  assignment_id   INTEGER NOT NULL REFERENCES pay_assignments (id),
  employee_id     INTEGER NOT NULL REFERENCES hr_employees (id),
  arrear_month    TEXT    NOT NULL CHECK (arrear_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  component_code  TEXT    NOT NULL,
  days_factor     REAL    NOT NULL DEFAULT 1 CHECK (days_factor >= 0 AND days_factor <= 1),
  old_paise       INTEGER NOT NULL DEFAULT 0,
  new_paise       INTEGER NOT NULL DEFAULT 0,
  amount_paise    INTEGER NOT NULL,
  arrear_status   TEXT    NOT NULL DEFAULT 'PENDING' CHECK (arrear_status IN ('PENDING', 'PAID', 'CANCELLED')),
  paid_run_id     INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_pay_arrears_assignment ON pay_arrears (assignment_id);
CREATE INDEX IF NOT EXISTS ix_pay_arrears_employee ON pay_arrears (company_id, employee_id, arrear_status);
CREATE INDEX IF NOT EXISTS ix_pay_arrears_employee_id ON pay_arrears (employee_id);

CREATE TABLE IF NOT EXISTS pay_statutory_params (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  code            TEXT    NOT NULL CHECK (code IN ('PF', 'ESI', 'PT', 'LWF', 'GRATUITY', 'BONUS', 'TDS_NEW', 'TDS_OLD', 'OT', 'MIN_WAGE')),
  state_code      TEXT    NOT NULL DEFAULT 'ALL',
  params_json     TEXT    NOT NULL DEFAULT '{}',
  effective_from  TEXT    NOT NULL,
  effective_to    TEXT,
  legal_ref       TEXT,
    status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  amends_id       INTEGER REFERENCES pay_statutory_params (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_statutory_params_doc ON pay_statutory_params (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_pay_statutory_params_key ON pay_statutory_params (code, state_code, effective_from, status);
CREATE INDEX IF NOT EXISTS ix_pay_statutory_params_company ON pay_statutory_params (company_id, status);
CREATE INDEX IF NOT EXISTS ix_pay_statutory_params_wf ON pay_statutory_params (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_pay_statutory_params_amends ON pay_statutory_params (amends_id);

CREATE TABLE IF NOT EXISTS pay_calendar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  period_from     TEXT    NOT NULL,
  period_to       TEXT    NOT NULL,
  attendance_cutoff TEXT  NOT NULL,
  inputs_cutoff   TEXT    NOT NULL,
  pay_date        TEXT    NOT NULL,
  cal_status      TEXT    NOT NULL DEFAULT 'OPEN' CHECK (cal_status IN ('OPEN', 'PROCESSING', 'LOCKED', 'PAID')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_calendar_period ON pay_calendar (company_id, period) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_calendar_status ON pay_calendar (company_id, cal_status);
