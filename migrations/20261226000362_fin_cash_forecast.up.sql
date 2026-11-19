-- Part 23.13: the 13-week cash forecast of a company (approval-controlled, ACCMGR → CFO) with its lines by week, category and project, each from its source
-- module or entered as an adjustment with its reason (BR-01); the bank facilities not held elsewhere (term loans with their instalments, other limits); the
-- suppliers marked critical for payment priority.
CREATE TABLE IF NOT EXISTS cf_forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  week_start      TEXT    NOT NULL CHECK (week_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  weeks           INTEGER NOT NULL DEFAULT 13 CHECK (weeks BETWEEN 1 AND 52),
  opening_paise   INTEGER NOT NULL DEFAULT 0,
  inflow_paise    INTEGER NOT NULL DEFAULT 0 CHECK (inflow_paise >= 0),
  outflow_paise   INTEGER NOT NULL DEFAULT 0 CHECK (outflow_paise >= 0),
  closing_paise   INTEGER NOT NULL DEFAULT 0,
  lowest_paise    INTEGER NOT NULL DEFAULT 0,
  lowest_week     TEXT,
  sources_json    TEXT    NOT NULL DEFAULT '[]',
  commentary      TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  amends_id       INTEGER REFERENCES cf_forecasts (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_cf_forecasts_doc ON cf_forecasts (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cf_forecasts_open ON cf_forecasts (company_id, week_start) WHERE status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_cf_forecasts_list ON cf_forecasts (company_id, week_start, status);
CREATE INDEX IF NOT EXISTS ix_cf_forecasts_wf ON cf_forecasts (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_cf_forecasts_amends ON cf_forecasts (amends_id);

CREATE TABLE IF NOT EXISTS cf_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  forecast_id     INTEGER NOT NULL REFERENCES cf_forecasts (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  category        TEXT    NOT NULL CHECK (category IN ('AR_OPEN', 'BILLS_PENDING', 'UNBILLED', 'RETENTION', 'ADVANCE_IN', 'OTHER_IN', 'AP_DUE', 'COMMITMENTS', 'PAYROLL', 'STATUTORY', 'LOAN_EMI', 'CAPEX', 'OVERHEADS', 'OTHER_OUT')),
  week_start      TEXT    NOT NULL,
  due_date        TEXT,
  inflow_paise    INTEGER NOT NULL DEFAULT 0 CHECK (inflow_paise >= 0),
  outflow_paise   INTEGER NOT NULL DEFAULT 0 CHECK (outflow_paise >= 0),
  source          TEXT    NOT NULL DEFAULT 'SOURCE' CHECK (source IN ('SOURCE', 'MANUAL')),
  source_doc      TEXT,
  counterparty    TEXT,
  confidence      TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  reason          TEXT,
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
CREATE INDEX IF NOT EXISTS ix_cf_lines_forecast ON cf_lines (forecast_id, week_start);
CREATE INDEX IF NOT EXISTS ix_cf_lines_project ON cf_lines (org_project_id);
CREATE INDEX IF NOT EXISTS ix_cf_lines_company ON cf_lines (company_id);

CREATE TABLE IF NOT EXISTS cf_bank_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  bank_account_id INTEGER REFERENCES fin_bank_accounts (id),
  bank_name       TEXT    NOT NULL,
  limit_type      TEXT    NOT NULL CHECK (limit_type IN ('TERM_LOAN', 'CASH_CREDIT', 'OVERDRAFT', 'BG', 'LC', 'OTHER')),
  limit_paise     INTEGER NOT NULL CHECK (limit_paise > 0),
  utilised_paise  INTEGER NOT NULL DEFAULT 0 CHECK (utilised_paise >= 0),
  emi_paise       INTEGER NOT NULL DEFAULT 0 CHECK (emi_paise >= 0),
  emi_day         INTEGER CHECK (emi_day IS NULL OR emi_day BETWEEN 1 AND 28),
  start_date      TEXT,
  end_date        TEXT,
  limit_status    TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (limit_status IN ('ACTIVE', 'CLOSED')),
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
CREATE INDEX IF NOT EXISTS ix_cf_bank_limits_company ON cf_bank_limits (company_id, limit_type);
CREATE INDEX IF NOT EXISTS ix_cf_bank_limits_bank ON cf_bank_limits (bank_account_id);

CREATE TABLE IF NOT EXISTS cf_priority_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  reason          TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_cf_priority_partners ON cf_priority_partners (company_id, partner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_cf_priority_partners_partner ON cf_priority_partners (partner_id);
