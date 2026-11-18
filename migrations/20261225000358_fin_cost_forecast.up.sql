-- Part 23.11: the cost forecast of a project for a month (versioned, approval-controlled): lines by WBS and cost code with budget, committed, actual, accrued,
-- the method of the estimate to complete and its amount, the estimate at completion and the variance; the risk allowance, pending variations, confidence and the
-- commentary; one approved forecast a project and month (BR-01).
CREATE TABLE IF NOT EXISTS fc_forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  period_id       INTEGER REFERENCES core_periods (id),
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  budget_paise    INTEGER NOT NULL DEFAULT 0 CHECK (budget_paise >= 0),
  committed_paise INTEGER NOT NULL DEFAULT 0 CHECK (committed_paise >= 0),
  actual_paise    INTEGER NOT NULL DEFAULT 0,
  accrued_paise   INTEGER NOT NULL DEFAULT 0 CHECK (accrued_paise >= 0),
  etc_paise       INTEGER NOT NULL DEFAULT 0 CHECK (etc_paise >= 0),
  lines_eac_paise INTEGER NOT NULL DEFAULT 0,
  risk_allowance_paise INTEGER NOT NULL DEFAULT 0 CHECK (risk_allowance_paise >= 0),
  pending_var_cost_paise INTEGER NOT NULL DEFAULT 0 CHECK (pending_var_cost_paise >= 0),
  pending_var_note TEXT,
  eac_total_paise INTEGER NOT NULL DEFAULT 0,
  vac_total_paise INTEGER NOT NULL DEFAULT 0,
  contract_revenue_paise INTEGER NOT NULL DEFAULT 0 CHECK (contract_revenue_paise >= 0),
  loss_making     INTEGER NOT NULL DEFAULT 0 CHECK (loss_making IN (0, 1)),
  confidence      TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  commentary      TEXT,
  prev_forecast_id INTEGER REFERENCES fc_forecasts (id),
  bridge_json     TEXT    NOT NULL DEFAULT '[]',
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  amends_id       INTEGER REFERENCES fc_forecasts (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fc_forecasts_doc ON fc_forecasts (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fc_forecasts_open ON fc_forecasts (org_project_id, period) WHERE status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fc_forecasts_list ON fc_forecasts (company_id, period, status);
CREATE INDEX IF NOT EXISTS ix_fc_forecasts_project ON fc_forecasts (org_project_id, period, status);
CREATE INDEX IF NOT EXISTS ix_fc_forecasts_period ON fc_forecasts (period_id);
CREATE INDEX IF NOT EXISTS ix_fc_forecasts_wf ON fc_forecasts (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_fc_forecasts_prev ON fc_forecasts (prev_forecast_id);
CREATE INDEX IF NOT EXISTS ix_fc_forecasts_amends ON fc_forecasts (amends_id);

CREATE TABLE IF NOT EXISTS fc_forecast_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  forecast_id     INTEGER NOT NULL REFERENCES fc_forecasts (id),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  line_label      TEXT    NOT NULL,
  budget_paise    INTEGER NOT NULL DEFAULT 0 CHECK (budget_paise >= 0),
  budget_qty_milli INTEGER NOT NULL DEFAULT 0 CHECK (budget_qty_milli >= 0),
  committed_paise INTEGER NOT NULL DEFAULT 0 CHECK (committed_paise >= 0),
  actual_paise    INTEGER NOT NULL DEFAULT 0,
  actual_qty_milli INTEGER NOT NULL DEFAULT 0,
  earned_paise    INTEGER NOT NULL DEFAULT 0 CHECK (earned_paise >= 0),
  accrued_paise   INTEGER NOT NULL DEFAULT 0 CHECK (accrued_paise >= 0),
  etc_method      TEXT    NOT NULL DEFAULT 'REMAINING_BUDGET' CHECK (etc_method IN ('REMAINING_BUDGET', 'CPI', 'BOTTOM_UP', 'COMMITTED_PLUS', 'MANUAL')),
  remaining_qty_milli INTEGER CHECK (remaining_qty_milli IS NULL OR remaining_qty_milli >= 0),
  rate_x100       INTEGER CHECK (rate_x100 IS NULL OR rate_x100 >= 0),
  manual_paise    INTEGER CHECK (manual_paise IS NULL OR manual_paise >= 0),
  etc_paise       INTEGER NOT NULL DEFAULT 0 CHECK (etc_paise >= 0),
  eac_paise       INTEGER NOT NULL DEFAULT 0,
  vac_paise       INTEGER NOT NULL DEFAULT 0,
  method_note     TEXT,
  notes           TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fc_forecast_lines_key ON fc_forecast_lines (forecast_id, COALESCE(wbs_id, 0), COALESCE(cost_code_id, 0)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fc_forecast_lines_forecast ON fc_forecast_lines (forecast_id);
CREATE INDEX IF NOT EXISTS ix_fc_forecast_lines_wbs ON fc_forecast_lines (wbs_id);
CREATE INDEX IF NOT EXISTS ix_fc_forecast_lines_code ON fc_forecast_lines (cost_code_id);
CREATE INDEX IF NOT EXISTS ix_fc_forecast_lines_company ON fc_forecast_lines (company_id);
