-- Part 23.12: the project P&L. The structure of the P&L (lines and the accounts and account groups each takes; configurable by company, the rows without a
-- company are the template) and the monthly snapshot of a project's P&L (actual of the month and to date, budget, forecast), frozen when the CFO approves it
-- and only when it ties to the general ledger (BR-01).
CREATE TABLE IF NOT EXISTS pl_structure (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER REFERENCES org_companies (id),
  line_code       TEXT    NOT NULL CHECK (line_code GLOB '[A-Z]*' AND length(line_code) <= 30),
  name            TEXT    NOT NULL,
  line_type       TEXT    NOT NULL CHECK (line_type IN ('REVENUE', 'COST', 'GROSS_PROFIT', 'OPERATING_PROFIT')),
  mapping_json    TEXT    NOT NULL DEFAULT '{}',
  catch_all       INTEGER NOT NULL DEFAULT 0 CHECK (catch_all IN (0, 1)),
  overhead        INTEGER NOT NULL DEFAULT 0 CHECK (overhead IN (0, 1)),
  sort            INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pl_structure_line ON pl_structure (COALESCE(company_id, 0), line_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pl_structure_company ON pl_structure (company_id, sort);

CREATE TABLE IF NOT EXISTS pl_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  period_id       INTEGER REFERENCES core_periods (id),
  lines_json      TEXT    NOT NULL DEFAULT '[]',
  revenue_paise   INTEGER NOT NULL DEFAULT 0,
  gross_profit_paise INTEGER NOT NULL DEFAULT 0,
  operating_profit_paise INTEGER NOT NULL DEFAULT 0,
  revenue_cum_paise INTEGER NOT NULL DEFAULT 0,
  operating_profit_cum_paise INTEGER NOT NULL DEFAULT 0,
  gl_total_paise  INTEGER NOT NULL DEFAULT 0,
  pl_total_paise  INTEGER NOT NULL DEFAULT 0,
  gl_lines_count  INTEGER NOT NULL DEFAULT 0,
  gl_max_line_id  INTEGER NOT NULL DEFAULT 0,
  budget_json     TEXT    NOT NULL DEFAULT '{}',
  forecast_json   TEXT    NOT NULL DEFAULT '{}',
  frozen_at       TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  amends_id       INTEGER REFERENCES pl_snapshots (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pl_snapshots_doc ON pl_snapshots (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pl_snapshots_open ON pl_snapshots (org_project_id, period) WHERE status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pl_snapshots_list ON pl_snapshots (company_id, period, status);
CREATE INDEX IF NOT EXISTS ix_pl_snapshots_project ON pl_snapshots (org_project_id, period, status);
CREATE INDEX IF NOT EXISTS ix_pl_snapshots_period ON pl_snapshots (period_id);
CREATE INDEX IF NOT EXISTS ix_pl_snapshots_wf ON pl_snapshots (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_pl_snapshots_amends ON pl_snapshots (amends_id);
