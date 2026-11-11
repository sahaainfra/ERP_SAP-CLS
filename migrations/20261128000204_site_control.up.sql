-- Part 14.07: the project control engine.
-- ctl_facts: the one fact store of control, a row for each project, WBS node, cost code, resource type and period: planned, budgeted, committed, actual, earned, certified, billed and forecast quantities and cost. The rows are derived
--   from the owners of each value (budget 12.01, commitments and actuals 12.03, progress 14.05); nothing is entered here (BR-01). period_key '' holds the standing measures (budget, planned, committed, earned), 'YYYY-MM' the flows (actual, billed).
-- ctl_unallocated: an actual cost that came without a WBS node or a cost code, waiting to be allocated (the allocation is approved; the ledger row of 12.03 is never changed).
-- ctl_recon_runs: each reconciliation of the facts against the source ledgers, nightly or on request, with the differences found.

CREATE TABLE IF NOT EXISTS ctl_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  resource_type   TEXT    NOT NULL DEFAULT 'OTHER' CHECK (resource_type IN ('MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER')),
  period_key      TEXT    NOT NULL DEFAULT '',
  planned_qty     INTEGER NOT NULL DEFAULT 0 CHECK (planned_qty >= 0),
  planned_cost    INTEGER NOT NULL DEFAULT 0 CHECK (planned_cost >= 0),
  budget_qty      INTEGER NOT NULL DEFAULT 0 CHECK (budget_qty >= 0),
  budget_cost     INTEGER NOT NULL DEFAULT 0 CHECK (budget_cost >= 0),
  committed_cost  INTEGER NOT NULL DEFAULT 0 CHECK (committed_cost >= 0),
  actual_qty      INTEGER NOT NULL DEFAULT 0 CHECK (actual_qty >= 0),
  actual_cost     INTEGER NOT NULL DEFAULT 0,
  earned_cost     INTEGER NOT NULL DEFAULT 0 CHECK (earned_cost >= 0),
  certified_value INTEGER NOT NULL DEFAULT 0 CHECK (certified_value >= 0),
  billed_value    INTEGER NOT NULL DEFAULT 0 CHECK (billed_value >= 0),
  forecast_cost   INTEGER CHECK (forecast_cost IS NULL OR forecast_cost >= 0),
  refreshed_at    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctl_facts_key ON ctl_facts (org_project_id, COALESCE(wbs_id, 0), COALESCE(cost_code_id, 0), resource_type, period_key);
CREATE INDEX IF NOT EXISTS ix_ctl_facts_company ON ctl_facts (company_id, org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctl_facts_wbs ON ctl_facts (wbs_id);
CREATE INDEX IF NOT EXISTS ix_ctl_facts_code ON ctl_facts (cost_code_id);
CREATE INDEX IF NOT EXISTS ix_ctl_facts_period ON ctl_facts (org_project_id, period_key);

CREATE TABLE IF NOT EXISTS ctl_unallocated (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  src_type        TEXT    NOT NULL,
  src_id          TEXT    NOT NULL,
  src_line_id     TEXT    NOT NULL DEFAULT '',
  doc_ref         TEXT,
  vendor_name     TEXT,
  description     TEXT,
  resource_type   TEXT    NOT NULL DEFAULT 'OTHER' CHECK (resource_type IN ('MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER')),
  amount          INTEGER NOT NULL DEFAULT 0,
  qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  actual_date     TEXT    NOT NULL,
  reason          TEXT    NOT NULL CHECK (reason IN ('NO_WBS', 'NO_COST_CODE', 'NO_WBS_NO_COST_CODE')),
  status          TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SUBMITTED', 'ALLOCATED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLEARED')),
  alloc_wbs_id    INTEGER REFERENCES proj_wbs (id),
  alloc_cost_code_id INTEGER REFERENCES fin_cost_codes (id),
  allocated_to_json TEXT,
  note            TEXT,
  workflow_instance_id INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctl_unallocated_src ON ctl_unallocated (company_id, src_type, src_id, src_line_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ctl_unallocated_company ON ctl_unallocated (company_id, status);
CREATE INDEX IF NOT EXISTS ix_ctl_unallocated_project ON ctl_unallocated (org_project_id, status);
CREATE INDEX IF NOT EXISTS ix_ctl_unallocated_wbs ON ctl_unallocated (alloc_wbs_id);
CREATE INDEX IF NOT EXISTS ix_ctl_unallocated_code ON ctl_unallocated (alloc_cost_code_id);

CREATE TABLE IF NOT EXISTS ctl_recon_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  run_kind        TEXT    NOT NULL CHECK (run_kind IN ('NIGHTLY', 'MANUAL')),
  status          TEXT    NOT NULL CHECK (status IN ('CLEAN', 'DIFFERENCES')),
  tolerance       INTEGER NOT NULL DEFAULT 0 CHECK (tolerance >= 0),
  checked         INTEGER NOT NULL DEFAULT 0,
  diff_count      INTEGER NOT NULL DEFAULT 0,
  diff_json       TEXT,
  run_at          TEXT    NOT NULL,
  run_by          TEXT,
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
CREATE INDEX IF NOT EXISTS ix_ctl_recon_runs_company ON ctl_recon_runs (company_id, org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctl_recon_runs_project ON ctl_recon_runs (org_project_id, run_at);
