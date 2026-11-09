-- Part 12.02: budget revisions, transfers and contingency drawdown (module bud, tables bud_change*).
-- Amounts in paise (deltas are signed), quantities x 1 000, rates x 10 000, percentages x 10 000.
-- bud_changes: a request to change the approved budget of a project: a revision (variation, scope change, rate escalation, re-estimate), a transfer between lines (nets to zero), a contingency drawdown against a realised risk (10.06) or a draft from an approved variation (21.05); approved, it makes a new approved version of the budget.
-- bud_change_lines: the lines a change touches (an existing line of the budget, or a new one) with the values before and the signed deltas.
CREATE TABLE IF NOT EXISTS bud_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  budget_id       INTEGER NOT NULL REFERENCES bud_budgets (id),
  change_type     TEXT    NOT NULL CHECK (change_type IN ('REVISION', 'TRANSFER', 'DRAWDOWN', 'VARIATION')),
  reason_code     TEXT    NOT NULL CHECK (reason_code IN ('VARIATION', 'SCOPE_CHANGE', 'RATE_ESCALATION', 'RE_ESTIMATE', 'TRANSFER', 'RISK_REALISED')),
  title           TEXT    NOT NULL,
  justification   TEXT,
  risk_id         INTEGER REFERENCES proj_risks (id),
  variation_id    INTEGER,
  variation_ref   TEXT,
  budget_total_before INTEGER NOT NULL DEFAULT 0 CHECK (budget_total_before >= 0),
  total_delta     INTEGER NOT NULL DEFAULT 0,
  moved_amount    INTEGER NOT NULL DEFAULT 0 CHECK (moved_amount >= 0),
  pct_of_budget   INTEGER NOT NULL DEFAULT 0 CHECK (pct_of_budget >= 0),
  margin_before   INTEGER NOT NULL DEFAULT 0,
  margin_after    INTEGER NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  result_budget_id INTEGER REFERENCES bud_budgets (id),
  amends_change_id INTEGER REFERENCES bud_changes (id),
  approved_at     TEXT,
  approved_by     TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_changes_doc ON bud_changes (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_changes_variation ON bud_changes (org_project_id, variation_id) WHERE variation_id IS NOT NULL AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED');
CREATE INDEX IF NOT EXISTS ix_bud_changes_company_id ON bud_changes (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_changes_status ON bud_changes (company_id, status);
CREATE INDEX IF NOT EXISTS ix_bud_changes_project ON bud_changes (org_project_id, status);
CREATE INDEX IF NOT EXISTS ix_bud_changes_budget ON bud_changes (budget_id);
CREATE INDEX IF NOT EXISTS ix_bud_changes_risk ON bud_changes (risk_id);
CREATE INDEX IF NOT EXISTS ix_bud_changes_result ON bud_changes (result_budget_id);
CREATE INDEX IF NOT EXISTS ix_bud_changes_amends ON bud_changes (amends_change_id);

CREATE TABLE IF NOT EXISTS bud_change_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  change_id       INTEGER NOT NULL REFERENCES bud_changes (id),
  line_id         INTEGER REFERENCES bud_lines (id),
  line_kind       TEXT    NOT NULL CHECK (line_kind IN ('DIRECT', 'OVERHEAD', 'CONTINGENCY', 'RESERVE')),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  resource_type   TEXT    NOT NULL DEFAULT 'OTHER' CHECK (resource_type IN ('MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER')),
  resource_name   TEXT    NOT NULL,
  uom             TEXT,
  qty_before      INTEGER NOT NULL DEFAULT 0 CHECK (qty_before >= 0),
  amount_before   INTEGER NOT NULL DEFAULT 0 CHECK (amount_before >= 0),
  qty_delta       INTEGER NOT NULL DEFAULT 0,
  amount_delta    INTEGER NOT NULL DEFAULT 0,
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
  remarks     TEXT,
  CHECK (qty_before + qty_delta >= 0 AND amount_before + amount_delta >= 0)
);
CREATE INDEX IF NOT EXISTS ix_bud_change_lines_company_id ON bud_change_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_change_lines_change ON bud_change_lines (change_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_bud_change_lines_line ON bud_change_lines (line_id);
CREATE INDEX IF NOT EXISTS ix_bud_change_lines_wbs ON bud_change_lines (wbs_id);
CREATE INDEX IF NOT EXISTS ix_bud_change_lines_code ON bud_change_lines (cost_code_id);
