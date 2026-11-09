-- Part 12.04: head-office and department overhead budgets (module bud). Amounts in paise, percentages x 10 000.
-- bud_dept_budgets: the budget of one cost centre (department) for one financial year, in versions; approved by the department head, the CFO and the director, then locked and changed only by a new version.
-- bud_dept_lines: the budget by GL account and month (a period of the financial year).
-- bud_dept_actuals: the actual cost of the general ledger (part 23 publishes it) by cost centre, account and month, consumed once per source line.
-- bud_alloc_rules: how a pool of overhead is shared over the projects (by revenue, by direct cost or by fixed percentages); a rule is drafted by one person and activated by another.
-- bud_alloc_runs, bud_alloc_lines: an allocation of a pool to the projects for a range of months; the lines add up to the pool exactly (the rounding residual goes to the largest share); part 23.10 reads the lines as the overhead pool of a project.
CREATE TABLE IF NOT EXISTS bud_dept_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  fy_id           INTEGER NOT NULL REFERENCES core_financial_years (id),
  cost_centre_id  INTEGER NOT NULL REFERENCES org_cost_centres (id),
  department_id   INTEGER REFERENCES org_departments (id),
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  vtype           TEXT    NOT NULL DEFAULT 'ORIGINAL' CHECK (vtype IN ('ORIGINAL', 'REVISED')),
  name            TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  total_amount    INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  lines_count     INTEGER NOT NULL DEFAULT 0 CHECK (lines_count >= 0),
  parent_budget_id INTEGER REFERENCES bud_dept_budgets (id),
  reason          TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  locked_at       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_dept_budgets_doc ON bud_dept_budgets (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_dept_budgets_version ON bud_dept_budgets (company_id, fy_id, cost_centre_id, version_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_dept_budgets_inforce ON bud_dept_budgets (company_id, fy_id, cost_centre_id) WHERE status = 'APPROVED' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_dept_budgets_open ON bud_dept_budgets (company_id, fy_id, cost_centre_id) WHERE status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bud_dept_budgets_company_id ON bud_dept_budgets (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_dept_budgets_fy ON bud_dept_budgets (fy_id);
CREATE INDEX IF NOT EXISTS ix_bud_dept_budgets_cc ON bud_dept_budgets (cost_centre_id);
CREATE INDEX IF NOT EXISTS ix_bud_dept_budgets_dept ON bud_dept_budgets (department_id);
CREATE INDEX IF NOT EXISTS ix_bud_dept_budgets_parent ON bud_dept_budgets (parent_budget_id);
CREATE INDEX IF NOT EXISTS ix_bud_dept_budgets_status ON bud_dept_budgets (company_id, status);

CREATE TABLE IF NOT EXISTS bud_dept_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  budget_id       INTEGER NOT NULL REFERENCES bud_dept_budgets (id),
  account_id      INTEGER NOT NULL REFERENCES fin_accounts (id),
  period_id       INTEGER NOT NULL REFERENCES core_periods (id),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  note            TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_dept_lines_cell ON bud_dept_lines (budget_id, account_id, period_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bud_dept_lines_company_id ON bud_dept_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_dept_lines_budget ON bud_dept_lines (budget_id);
CREATE INDEX IF NOT EXISTS ix_bud_dept_lines_account ON bud_dept_lines (account_id);
CREATE INDEX IF NOT EXISTS ix_bud_dept_lines_period ON bud_dept_lines (period_id);

CREATE TABLE IF NOT EXISTS bud_dept_actuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  fy_id           INTEGER NOT NULL REFERENCES core_financial_years (id),
  period_id       INTEGER NOT NULL REFERENCES core_periods (id),
  cost_centre_id  INTEGER NOT NULL REFERENCES org_cost_centres (id),
  account_id      INTEGER NOT NULL REFERENCES fin_accounts (id),
  amount          INTEGER NOT NULL,
  src_type        TEXT    NOT NULL,
  src_id          TEXT    NOT NULL,
  src_line_id     TEXT    NOT NULL DEFAULT '',
  doc_ref         TEXT,
  narration       TEXT,
  posted_date     TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
  reversed_at     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_dept_actuals_src ON bud_dept_actuals (company_id, src_type, src_id, src_line_id);
CREATE INDEX IF NOT EXISTS ix_bud_dept_actuals_company_id ON bud_dept_actuals (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_dept_actuals_fy ON bud_dept_actuals (fy_id, cost_centre_id, status);
CREATE INDEX IF NOT EXISTS ix_bud_dept_actuals_period ON bud_dept_actuals (period_id);
CREATE INDEX IF NOT EXISTS ix_bud_dept_actuals_cc ON bud_dept_actuals (cost_centre_id);
CREATE INDEX IF NOT EXISTS ix_bud_dept_actuals_account ON bud_dept_actuals (account_id);

CREATE TABLE IF NOT EXISTS bud_alloc_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  fy_id           INTEGER NOT NULL REFERENCES core_financial_years (id),
  name            TEXT    NOT NULL,
  basis           TEXT    NOT NULL CHECK (basis IN ('REVENUE', 'DIRECT_COST', 'FIXED_PCT')),
  rules_json      TEXT    NOT NULL DEFAULT '{}',
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'CANCELLED')),
  reason          TEXT,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_alloc_rules_doc ON bud_alloc_rules (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_alloc_rules_name ON bud_alloc_rules (company_id, fy_id, name) WHERE status IN ('DRAFT', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bud_alloc_rules_company_id ON bud_alloc_rules (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_alloc_rules_fy ON bud_alloc_rules (fy_id, status);

CREATE TABLE IF NOT EXISTS bud_alloc_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  fy_id           INTEGER NOT NULL REFERENCES core_financial_years (id),
  rule_id         INTEGER NOT NULL REFERENCES bud_alloc_rules (id),
  basis           TEXT    NOT NULL CHECK (basis IN ('REVENUE', 'DIRECT_COST', 'FIXED_PCT')),
  from_period_id  INTEGER NOT NULL REFERENCES core_periods (id),
  to_period_id    INTEGER NOT NULL REFERENCES core_periods (id),
  pool_source     TEXT    NOT NULL CHECK (pool_source IN ('BUDGET', 'ACTUAL')),
  basis_source    TEXT,
  pool_amount     INTEGER NOT NULL CHECK (pool_amount >= 0),
  allocated_amount INTEGER NOT NULL CHECK (allocated_amount >= 0),
  projects_count  INTEGER NOT NULL DEFAULT 0,
  pool_json       TEXT    NOT NULL DEFAULT '[]',
  status          TEXT    NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
  run_by          TEXT,
  reversed_by     TEXT,
  reversed_at     TEXT,
  reverse_reason  TEXT,
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
  CHECK (allocated_amount = pool_amount)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_alloc_runs_doc ON bud_alloc_runs (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_alloc_runs_once ON bud_alloc_runs (company_id, rule_id, from_period_id, to_period_id, pool_source) WHERE status = 'POSTED' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bud_alloc_runs_company_id ON bud_alloc_runs (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_alloc_runs_fy ON bud_alloc_runs (fy_id);
CREATE INDEX IF NOT EXISTS ix_bud_alloc_runs_rule ON bud_alloc_runs (rule_id);
CREATE INDEX IF NOT EXISTS ix_bud_alloc_runs_from ON bud_alloc_runs (from_period_id);
CREATE INDEX IF NOT EXISTS ix_bud_alloc_runs_to ON bud_alloc_runs (to_period_id);

CREATE TABLE IF NOT EXISTS bud_alloc_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  run_id          INTEGER NOT NULL REFERENCES bud_alloc_runs (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  basis_value     INTEGER NOT NULL DEFAULT 0 CHECK (basis_value >= 0),
  share           INTEGER NOT NULL DEFAULT 0 CHECK (share >= 0),
  amount          INTEGER NOT NULL CHECK (amount >= 0),
  residual        INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_alloc_lines_run_project ON bud_alloc_lines (run_id, org_project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bud_alloc_lines_company_id ON bud_alloc_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_alloc_lines_run ON bud_alloc_lines (run_id);
CREATE INDEX IF NOT EXISTS ix_bud_alloc_lines_project ON bud_alloc_lines (org_project_id);
