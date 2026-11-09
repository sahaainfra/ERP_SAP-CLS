-- Part 07.12: employee advances, expense claims and travel (module hr). Money is kept in paise (whole minor units, ADR-14).
-- exp_policies: limits by grade, category and city tier (per-diem, mileage rate, receipt threshold), effective-dated, activated by a second person. exp_travel_requests: a trip asked for approval.
-- exp_advances: salary, travel and imprest advances. exp_advance_recoveries: the planned instalments (payroll) and the actual recoveries (settlement against a claim, payroll, manual).
-- exp_claims and exp_claim_lines: the claim with its lines, GST details, bill photo, project and cost code, the policy flag of each line and the settlement against an advance.

CREATE TABLE IF NOT EXISTS exp_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  grade          TEXT    NOT NULL DEFAULT '*',
  category       TEXT    NOT NULL DEFAULT '*',
  city_tier      TEXT    NOT NULL DEFAULT '*',
  limit_minor    INTEGER NOT NULL DEFAULT 0 CHECK (limit_minor >= 0),
  per_diem_minor INTEGER NOT NULL DEFAULT 0 CHECK (per_diem_minor >= 0),
  mileage_rate_minor INTEGER NOT NULL DEFAULT 0 CHECK (mileage_rate_minor >= 0),
  receipt_above_minor INTEGER CHECK (receipt_above_minor IS NULL OR receipt_above_minor >= 0),
  effective_from TEXT    NOT NULL,
  effective_to   TEXT,
  policy_status  TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (policy_status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  activated_by   TEXT,
  activated_at   TEXT,
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
CREATE INDEX IF NOT EXISTS ix_exp_policies_company_id ON exp_policies (company_id);
CREATE INDEX IF NOT EXISTS ix_exp_policies_lookup ON exp_policies (company_id, policy_status, category, grade, city_tier, effective_from);
CREATE INDEX IF NOT EXISTS ix_exp_policies_project ON exp_policies (project_id);
CREATE INDEX IF NOT EXISTS ix_exp_policies_site ON exp_policies (site_id);

CREATE TABLE IF NOT EXISTS exp_travel_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  purpose        TEXT    NOT NULL,
  from_place     TEXT    NOT NULL,
  to_place       TEXT    NOT NULL,
  start_date     TEXT    NOT NULL,
  end_date       TEXT    NOT NULL,
  mode           TEXT    NOT NULL DEFAULT 'TRAIN' CHECK (mode IN ('TRAIN', 'BUS', 'FLIGHT', 'CAR', 'BIKE', 'SITE_VEHICLE', 'OTHER')),
  est_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (est_cost_minor >= 0),
  advance_minor  INTEGER NOT NULL DEFAULT 0 CHECK (advance_minor >= 0),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_exp_travel_doc ON exp_travel_requests (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_exp_travel_company_id ON exp_travel_requests (company_id);
CREATE INDEX IF NOT EXISTS ix_exp_travel_employee ON exp_travel_requests (employee_id, status);
CREATE INDEX IF NOT EXISTS ix_exp_travel_status ON exp_travel_requests (company_id, status);
CREATE INDEX IF NOT EXISTS ix_exp_travel_project ON exp_travel_requests (project_id);
CREATE INDEX IF NOT EXISTS ix_exp_travel_site ON exp_travel_requests (site_id);

CREATE TABLE IF NOT EXISTS exp_advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  advance_type   TEXT    NOT NULL CHECK (advance_type IN ('SALARY', 'TRAVEL', 'IMPREST')),
  amount_minor   INTEGER NOT NULL CHECK (amount_minor > 0),
  purpose        TEXT    NOT NULL,
  recovery_mode  TEXT    NOT NULL DEFAULT 'SETTLEMENT' CHECK (recovery_mode IN ('PAYROLL', 'SETTLEMENT')),
  instalments    INTEGER NOT NULL DEFAULT 1 CHECK (instalments BETWEEN 1 AND 36),
  balance_minor  INTEGER NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  travel_request_id INTEGER REFERENCES exp_travel_requests (id),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'DISBURSED', 'CLOSED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  disbursed_at   TEXT,
  disbursed_by   TEXT,
  disbursed_ref  TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_exp_advances_doc ON exp_advances (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_exp_advances_company_id ON exp_advances (company_id);
CREATE INDEX IF NOT EXISTS ix_exp_advances_employee ON exp_advances (employee_id, status);
CREATE INDEX IF NOT EXISTS ix_exp_advances_status ON exp_advances (company_id, status);
CREATE INDEX IF NOT EXISTS ix_exp_advances_travel ON exp_advances (travel_request_id);
CREATE INDEX IF NOT EXISTS ix_exp_advances_project ON exp_advances (project_id);
CREATE INDEX IF NOT EXISTS ix_exp_advances_site ON exp_advances (site_id);

CREATE TABLE IF NOT EXISTS exp_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  period_from    TEXT    NOT NULL,
  period_to      TEXT    NOT NULL,
  purpose        TEXT    NOT NULL,
  city_tier      TEXT    NOT NULL DEFAULT 'T2' CHECK (city_tier IN ('T1', 'T2', 'T3')),
  travel_request_id INTEGER REFERENCES exp_travel_requests (id),
  advance_id     INTEGER REFERENCES exp_advances (id),
  total_minor    INTEGER NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  gst_minor      INTEGER NOT NULL DEFAULT 0 CHECK (gst_minor >= 0),
  advance_adjusted_minor INTEGER NOT NULL DEFAULT 0 CHECK (advance_adjusted_minor >= 0),
  net_payable_minor INTEGER NOT NULL DEFAULT 0 CHECK (net_payable_minor >= 0),
  recoverable_minor INTEGER NOT NULL DEFAULT 0 CHECK (recoverable_minor >= 0),
  flag_count     INTEGER NOT NULL DEFAULT 0,
  level          INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'PASSED', 'PAID', 'RETURNED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  approved_at    TEXT,
  passed_by      TEXT,
  passed_at      TEXT,
  paid_at        TEXT,
  paid_ref       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_exp_claims_doc ON exp_claims (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_exp_claims_company_id ON exp_claims (company_id);
CREATE INDEX IF NOT EXISTS ix_exp_claims_employee ON exp_claims (employee_id, status);
CREATE INDEX IF NOT EXISTS ix_exp_claims_status ON exp_claims (company_id, status);
CREATE INDEX IF NOT EXISTS ix_exp_claims_travel ON exp_claims (travel_request_id);
CREATE INDEX IF NOT EXISTS ix_exp_claims_advance ON exp_claims (advance_id);
CREATE INDEX IF NOT EXISTS ix_exp_claims_project ON exp_claims (project_id);
CREATE INDEX IF NOT EXISTS ix_exp_claims_site ON exp_claims (site_id);

CREATE TABLE IF NOT EXISTS exp_claim_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  claim_id       INTEGER NOT NULL REFERENCES exp_claims (id),
  line_no        INTEGER NOT NULL,
  category       TEXT    NOT NULL CHECK (category IN ('TRAVEL', 'LODGING', 'FOOD', 'LOCAL_CONVEYANCE', 'SITE_PURCHASE', 'PER_DIEM', 'MILEAGE', 'OTHER')),
  spend_date     TEXT    NOT NULL,
  description    TEXT    NOT NULL,
  amount_minor   INTEGER NOT NULL CHECK (amount_minor >= 0),
  gst_minor      INTEGER NOT NULL DEFAULT 0 CHECK (gst_minor >= 0),
  vendor_name    TEXT,
  vendor_gstin   TEXT,
  invoice_no     TEXT,
  file_id        INTEGER,
  cost_code_id   INTEGER REFERENCES fin_cost_codes (id),
  km             INTEGER,
  days           INTEGER,
  limit_minor    INTEGER,
  policy_flag    TEXT    NOT NULL DEFAULT 'NONE' CHECK (policy_flag IN ('NONE', 'OVER_LIMIT', 'NO_RECEIPT', 'DUPLICATE', 'OLD')),
  flag_text      TEXT,
  justification  TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_exp_claim_lines_no ON exp_claim_lines (claim_id, line_no);
CREATE INDEX IF NOT EXISTS ix_exp_claim_lines_company_id ON exp_claim_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_exp_claim_lines_duplicate ON exp_claim_lines (company_id, invoice_no, amount_minor);
CREATE INDEX IF NOT EXISTS ix_exp_claim_lines_cost_code ON exp_claim_lines (cost_code_id);
CREATE INDEX IF NOT EXISTS ix_exp_claim_lines_file ON exp_claim_lines (file_id);
CREATE INDEX IF NOT EXISTS ix_exp_claim_lines_project ON exp_claim_lines (project_id);
CREATE INDEX IF NOT EXISTS ix_exp_claim_lines_site ON exp_claim_lines (site_id);

CREATE TABLE IF NOT EXISTS exp_advance_recoveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  advance_id     INTEGER NOT NULL REFERENCES exp_advances (id),
  claim_id       INTEGER REFERENCES exp_claims (id),
  kind           TEXT    NOT NULL CHECK (kind IN ('SETTLEMENT', 'PAYROLL', 'MANUAL')),
  rec_status     TEXT    NOT NULL DEFAULT 'DONE' CHECK (rec_status IN ('PLANNED', 'DONE', 'REVERSED')),
  due_month      TEXT,
  amount_minor   INTEGER NOT NULL CHECK (amount_minor >= 0),
  done_on        TEXT,
  reference      TEXT,
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
CREATE INDEX IF NOT EXISTS ix_exp_recoveries_company_id ON exp_advance_recoveries (company_id);
CREATE INDEX IF NOT EXISTS ix_exp_recoveries_advance ON exp_advance_recoveries (advance_id);
CREATE INDEX IF NOT EXISTS ix_exp_recoveries_claim ON exp_advance_recoveries (claim_id);
CREATE INDEX IF NOT EXISTS ix_exp_recoveries_due ON exp_advance_recoveries (company_id, rec_status, due_month);
CREATE INDEX IF NOT EXISTS ix_exp_recoveries_project ON exp_advance_recoveries (project_id);
CREATE INDEX IF NOT EXISTS ix_exp_recoveries_site ON exp_advance_recoveries (site_id);
