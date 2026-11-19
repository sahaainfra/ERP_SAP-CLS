-- Part 24.03: labour wages and contract labour payroll. pay_wage_runs (approval-controlled, SACC -> PM -> HRMGR): the wages of the direct (departmental)
-- labour of a site for a weekly, fortnightly or monthly cycle; the approval locks it, then each worker is paid (bank or cash) and acknowledges.
-- pay_wage_lines: one worker's wages — days and overtime from the labour punches (07.06), the piece quantity from measurements (22.01), the rate (the higher of
-- the contract rate and the state minimum wage, 07.08), allowances, deductions, PF/ESI, net, the checks raised, payment and acknowledgement. Quantities are
-- thousandths (days, hours, piece quantity), money is paise. pay_contractor_wage_checks: the principal employer's verification of a labour contractor's wage
-- sheet for a month against the attendance (CLRA): the sheet, the proof of payment, the variances, the verifier's decision and a hold on the contractor's payments.
CREATE TABLE IF NOT EXISTS pay_wage_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  contractor_id   INTEGER NOT NULL REFERENCES mdm_partners (id),
  cycle           TEXT    NOT NULL CHECK (cycle IN ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY')),
  period_from     TEXT    NOT NULL,
  period_to       TEXT    NOT NULL CHECK (period_to >= period_from),
  pay_due_on      TEXT    NOT NULL,
  state_code      TEXT,
  workers_count   INTEGER NOT NULL DEFAULT 0 CHECK (workers_count >= 0),
  days_milli      INTEGER NOT NULL DEFAULT 0 CHECK (days_milli >= 0),
  ot_milli        INTEGER NOT NULL DEFAULT 0 CHECK (ot_milli >= 0),
  gross_paise     INTEGER NOT NULL DEFAULT 0 CHECK (gross_paise >= 0),
  deductions_paise INTEGER NOT NULL DEFAULT 0 CHECK (deductions_paise >= 0),
  employer_paise  INTEGER NOT NULL DEFAULT 0 CHECK (employer_paise >= 0),
  net_paise       INTEGER NOT NULL DEFAULT 0,
  flags_count     INTEGER NOT NULL DEFAULT 0,
  blocking_count  INTEGER NOT NULL DEFAULT 0,
  paid_count      INTEGER NOT NULL DEFAULT 0,
  acked_count     INTEGER NOT NULL DEFAULT 0,
  computed_at     TEXT,
  locked_at       TEXT,
  disbursed_at    TEXT,
  summary_json    TEXT    NOT NULL DEFAULT '{}',
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  amends_id       INTEGER REFERENCES pay_wage_runs (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_wage_runs_doc ON pay_wage_runs (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_pay_wage_runs_list ON pay_wage_runs (company_id, org_project_id, org_site_id, period_from, status);
CREATE INDEX IF NOT EXISTS ix_pay_wage_runs_site ON pay_wage_runs (org_site_id, contractor_id, period_from, period_to);
CREATE INDEX IF NOT EXISTS ix_pay_wage_runs_org_project_id ON pay_wage_runs (org_project_id);
CREATE INDEX IF NOT EXISTS ix_pay_wage_runs_contractor_id ON pay_wage_runs (contractor_id);
CREATE INDEX IF NOT EXISTS ix_pay_wage_runs_wf ON pay_wage_runs (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_pay_wage_runs_amends ON pay_wage_runs (amends_id);

CREATE TABLE IF NOT EXISTS pay_wage_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  run_id          INTEGER NOT NULL REFERENCES pay_wage_runs (id),
  worker_id       INTEGER NOT NULL REFERENCES lab_workers (id),
  trade_code      TEXT,
  skill_category  TEXT,
  pay_basis       TEXT    NOT NULL DEFAULT 'DAILY' CHECK (pay_basis IN ('DAILY', 'PIECE')),
  days_milli      INTEGER NOT NULL DEFAULT 0 CHECK (days_milli >= 0),
  ot_milli        INTEGER NOT NULL DEFAULT 0 CHECK (ot_milli >= 0),
  piece_qty_milli INTEGER NOT NULL DEFAULT 0 CHECK (piece_qty_milli >= 0),
  piece_uom       TEXT,
  piece_rate_paise INTEGER CHECK (piece_rate_paise IS NULL OR piece_rate_paise >= 0),
  piece_source_json TEXT  NOT NULL DEFAULT '[]',
  rate_paise      INTEGER NOT NULL DEFAULT 0 CHECK (rate_paise >= 0),
  min_rate_paise  INTEGER CHECK (min_rate_paise IS NULL OR min_rate_paise >= 0),
  wage_source     TEXT,
  rate_override_paise INTEGER CHECK (rate_override_paise IS NULL OR rate_override_paise >= 0),
  ot_rate_paise   INTEGER NOT NULL DEFAULT 0 CHECK (ot_rate_paise >= 0),
  basic_paise     INTEGER NOT NULL DEFAULT 0 CHECK (basic_paise >= 0),
  ot_paise        INTEGER NOT NULL DEFAULT 0 CHECK (ot_paise >= 0),
  piece_paise     INTEGER NOT NULL DEFAULT 0 CHECK (piece_paise >= 0),
  topup_paise     INTEGER NOT NULL DEFAULT 0 CHECK (topup_paise >= 0),
  allowances_paise INTEGER NOT NULL DEFAULT 0 CHECK (allowances_paise >= 0),
  gross_paise     INTEGER NOT NULL DEFAULT 0 CHECK (gross_paise >= 0),
  advance_paise   INTEGER NOT NULL DEFAULT 0 CHECK (advance_paise >= 0),
  canteen_paise   INTEGER NOT NULL DEFAULT 0 CHECK (canteen_paise >= 0),
  other_ded_paise INTEGER NOT NULL DEFAULT 0 CHECK (other_ded_paise >= 0),
  pf_paise        INTEGER NOT NULL DEFAULT 0 CHECK (pf_paise >= 0),
  esi_paise       INTEGER NOT NULL DEFAULT 0 CHECK (esi_paise >= 0),
  deductions_paise INTEGER NOT NULL DEFAULT 0 CHECK (deductions_paise >= 0),
  employer_paise  INTEGER NOT NULL DEFAULT 0 CHECK (employer_paise >= 0),
  net_paise       INTEGER NOT NULL DEFAULT 0,
  days_json       TEXT    NOT NULL DEFAULT '[]',
  adjust_json     TEXT    NOT NULL DEFAULT '[]',
  flags_json      TEXT    NOT NULL DEFAULT '[]',
  paid_mode       TEXT    CHECK (paid_mode IS NULL OR paid_mode IN ('BANK', 'CASH')),
  paid_on         TEXT,
  paid_ref        TEXT,
  paid_by         TEXT,
  ack_status      TEXT    NOT NULL DEFAULT 'PENDING' CHECK (ack_status IN ('PENDING', 'ACKNOWLEDGED', 'DISPUTED')),
  ack_method      TEXT    CHECK (ack_method IS NULL OR ack_method IN ('CARD', 'PHOTO')),
  ack_file_id     INTEGER REFERENCES core_files (id),
  ack_by          TEXT,
  ack_at          TEXT,
  ack_note        TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_wage_lines_worker ON pay_wage_lines (run_id, worker_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_wage_lines_run_id ON pay_wage_lines (run_id);
CREATE INDEX IF NOT EXISTS ix_pay_wage_lines_company_id ON pay_wage_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_pay_wage_lines_worker_id ON pay_wage_lines (worker_id);
CREATE INDEX IF NOT EXISTS ix_pay_wage_lines_ack_file_id ON pay_wage_lines (ack_file_id);

CREATE TABLE IF NOT EXISTS pay_contractor_wage_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  contractor_id   INTEGER NOT NULL REFERENCES mdm_partners (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  pay_due_on      TEXT    NOT NULL,
  verify_due_on   TEXT    NOT NULL,
  state_code      TEXT,
  workers_count   INTEGER NOT NULL DEFAULT 0 CHECK (workers_count >= 0),
  attendance_days_milli INTEGER NOT NULL DEFAULT 0 CHECK (attendance_days_milli >= 0),
  sheet_days_milli INTEGER NOT NULL DEFAULT 0 CHECK (sheet_days_milli >= 0),
  sheet_gross_paise INTEGER NOT NULL DEFAULT 0 CHECK (sheet_gross_paise >= 0),
  sheet_net_paise INTEGER NOT NULL DEFAULT 0 CHECK (sheet_net_paise >= 0),
  sheet_json      TEXT    NOT NULL DEFAULT '[]',
  wage_sheet_file_id INTEGER REFERENCES core_files (id),
  proof_file_id   INTEGER REFERENCES core_files (id),
  variances_json  TEXT    NOT NULL DEFAULT '[]',
  variance_count  INTEGER NOT NULL DEFAULT 0 CHECK (variance_count >= 0),
  blocking_count  INTEGER NOT NULL DEFAULT 0 CHECK (blocking_count >= 0),
  check_status    TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (check_status IN ('DRAFT', 'SUBMITTED', 'VERIFIED', 'RETURNED', 'VARIANCE')),
  hold_requested  INTEGER NOT NULL DEFAULT 0 CHECK (hold_requested IN (0, 1)),
  submitted_by    TEXT,
  submitted_at    TEXT,
  verified_by     TEXT,
  verified_at     TEXT,
  decision_note   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_contractor_wage_checks_doc ON pay_contractor_wage_checks (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_contractor_wage_checks_key ON pay_contractor_wage_checks (company_id, contractor_id, org_project_id, COALESCE(org_site_id, 0), period) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pay_contractor_wage_checks_list ON pay_contractor_wage_checks (company_id, check_status, verify_due_on);
CREATE INDEX IF NOT EXISTS ix_pay_contractor_wage_checks_contractor_id ON pay_contractor_wage_checks (contractor_id, org_project_id, hold_requested);
CREATE INDEX IF NOT EXISTS ix_pay_contractor_wage_checks_org_project_id ON pay_contractor_wage_checks (org_project_id);
CREATE INDEX IF NOT EXISTS ix_pay_contractor_wage_checks_org_site_id ON pay_contractor_wage_checks (org_site_id);
CREATE INDEX IF NOT EXISTS ix_pay_contractor_wage_checks_wage_sheet_file_id ON pay_contractor_wage_checks (wage_sheet_file_id);
CREATE INDEX IF NOT EXISTS ix_pay_contractor_wage_checks_proof_file_id ON pay_contractor_wage_checks (proof_file_id);
