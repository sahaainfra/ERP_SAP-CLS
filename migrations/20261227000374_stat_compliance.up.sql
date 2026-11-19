-- Part 24.04: statutory compliance. stat_filings: a statutory payment of a period (ECR, ESI, PT, LWF, TDS deposit, BOCW cess) prepared by payroll and approved
-- ACCMGR -> CFO (PAY_STAT_FILING), then recorded with its challan. stat_registers: a generated return or register (ECR and ESI files, PT and LWF reports, the
-- quarterly TDS statement, the Form 16 / 130 batch, labour registers per site), kept with its content and checksum. stat_rules: the statutory due dates and
-- numbers as effective-dated master data (never constants), with the legal reference; a rule not yet confirmed against the notification is TO_CONFIRM.
-- stat_bocw_months: the BOCW cess of a project for a month on its construction cost (1 % by default), linked to the filing that pays it.
CREATE TABLE IF NOT EXISTS stat_filings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  filing_type     TEXT    NOT NULL CHECK (filing_type IN ('ECR', 'ESI', 'PT', 'LWF', 'TDS_MONTHLY', 'BOCW')),
  period          TEXT    NOT NULL,
  state_code      TEXT    NOT NULL DEFAULT 'ALL',
  due_date        TEXT    NOT NULL,
  amount_paise    INTEGER NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  source_run_id   INTEGER REFERENCES pay_runs (id),
  register_id     INTEGER REFERENCES stat_registers (id),
  challan_ref     TEXT,
  challan_date    TEXT,
  paid_on         TEXT,
  payment_ref     TEXT,
  approved_amount_paise INTEGER CHECK (approved_amount_paise IS NULL OR approved_amount_paise >= 0),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  amends_id       INTEGER REFERENCES stat_filings (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_stat_filings_doc ON stat_filings (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stat_filings_period ON stat_filings (company_id, filing_type, period, state_code) WHERE status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_stat_filings_list ON stat_filings (company_id, filing_type, due_date, status);
CREATE INDEX IF NOT EXISTS ix_stat_filings_source_run_id ON stat_filings (source_run_id);
CREATE INDEX IF NOT EXISTS ix_stat_filings_register_id ON stat_filings (register_id);
CREATE INDEX IF NOT EXISTS ix_stat_filings_wf ON stat_filings (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_stat_filings_amends ON stat_filings (amends_id);

CREATE TABLE IF NOT EXISTS stat_registers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  register_type   TEXT    NOT NULL CHECK (register_type IN ('ECR_FILE', 'ESI_FILE', 'PT_REPORT', 'LWF_REPORT', 'TDS_24Q_FILE', 'FORM16_BATCH', 'WORKMEN_REGISTER', 'OVERTIME_REGISTER', 'DEDUCTION_REGISTER', 'ADVANCE_REGISTER')),
  period          TEXT    NOT NULL,
  state_code      TEXT,
  org_site_id     INTEGER REFERENCES org_sites (id),
  source_run_id   INTEGER REFERENCES pay_runs (id),
  row_count       INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  amount_paise    INTEGER CHECK (amount_paise IS NULL OR amount_paise >= 0),
  file_name       TEXT    NOT NULL,
  content_type    TEXT    NOT NULL,
  content         TEXT    NOT NULL,
  checksum        TEXT    NOT NULL,
  generated_at   TEXT    NOT NULL,
  generated_by    TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_stat_registers_list ON stat_registers (company_id, register_type, period);
CREATE INDEX IF NOT EXISTS ix_stat_registers_site_id ON stat_registers (org_site_id);
CREATE INDEX IF NOT EXISTS ix_stat_registers_source_run_id ON stat_registers (source_run_id);

CREATE TABLE IF NOT EXISTS stat_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER REFERENCES org_companies (id),
  rule_type       TEXT    NOT NULL CHECK (rule_type IN ('ECR', 'ESI', 'PT', 'LWF', 'TDS_MONTHLY', 'TDS_MONTHLY_MAR', 'TDS_24Q_Q1', 'TDS_24Q_Q2', 'TDS_24Q_Q3', 'TDS_24Q_Q4', 'FORM16', 'BOCW', 'GRATUITY_CAP', 'BOCW_RATE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_stat_rules_key ON stat_rules (COALESCE(company_id, 0), rule_type, state_code, effective_from) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_stat_rules_type ON stat_rules (rule_type, state_code, effective_from);

CREATE TABLE IF NOT EXISTS stat_bocw_months (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  construction_cost_paise INTEGER NOT NULL DEFAULT 0 CHECK (construction_cost_paise >= 0),
  source_note     TEXT    NOT NULL,
  cess_rate_bp    INTEGER NOT NULL DEFAULT 100 CHECK (cess_rate_bp BETWEEN 0 AND 10000),
  cess_paise      INTEGER NOT NULL DEFAULT 0 CHECK (cess_paise >= 0),
  cess_status     TEXT    NOT NULL DEFAULT 'OPEN' CHECK (cess_status IN ('OPEN', 'DUE', 'PAID')),
  filing_id       INTEGER REFERENCES stat_filings (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_stat_bocw_months ON stat_bocw_months (company_id, org_project_id, period) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_stat_bocw_months_filing_id ON stat_bocw_months (filing_id);
CREATE INDEX IF NOT EXISTS ix_stat_bocw_months_period ON stat_bocw_months (company_id, period, cess_status);
CREATE INDEX IF NOT EXISTS ix_stat_bocw_months_project ON stat_bocw_months (org_project_id);
CREATE INDEX IF NOT EXISTS ix_stat_rules_company_id ON stat_rules (company_id);
