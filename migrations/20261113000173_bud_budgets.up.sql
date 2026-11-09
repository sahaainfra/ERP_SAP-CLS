-- Part 12.01: project budget preparation and approval (module bud, tables bud_*).
-- Amounts in paise, quantities x 1 000, rates x 10 000, percentages x 10 000.
-- bud_budgets: a budget of a project (the original, version 1, and its revisions) generated from the approved baseline pack and the BOQ norms, with its totals, the margin against the contract value and its approval; an approved budget is locked.
-- bud_lines: the lines of a budget: direct lines (WBS x cost code x resource with quantity, rate and amount, and the generated values kept beside the adjusted ones), overhead lines, contingency and management reserve (not allocated to a WBS).
-- bud_phasing: the budget of a line spread over months (manual, from the schedule, or an S-curve profile).
CREATE TABLE IF NOT EXISTS bud_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  vtype           TEXT    NOT NULL DEFAULT 'ORIGINAL' CHECK (vtype IN ('ORIGINAL', 'REVISED')),
  name            TEXT    NOT NULL,
  baseline_pack_id INTEGER REFERENCES proj_baseline_packs (id),
  boq_version_id  INTEGER REFERENCES proj_boq_versions (id),
  parent_budget_id INTEGER REFERENCES bud_budgets (id),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  contract_value  INTEGER NOT NULL DEFAULT 0 CHECK (contract_value >= 0),
  target_margin_pct INTEGER NOT NULL DEFAULT 0 CHECK (target_margin_pct >= 0),
  direct_total    INTEGER NOT NULL DEFAULT 0 CHECK (direct_total >= 0),
  overhead_total  INTEGER NOT NULL DEFAULT 0 CHECK (overhead_total >= 0),
  contingency_total INTEGER NOT NULL DEFAULT 0 CHECK (contingency_total >= 0),
  reserve_total   INTEGER NOT NULL DEFAULT 0 CHECK (reserve_total >= 0),
  total_amount    INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  baseline_cost   INTEGER NOT NULL DEFAULT 0 CHECK (baseline_cost >= 0),
  lines_count     INTEGER NOT NULL DEFAULT 0,
  phasing_method  TEXT    CHECK (phasing_method IS NULL OR phasing_method IN ('MANUAL', 'SCHEDULE', 'SCURVE')),
  generated_at    TEXT,
  approved_at     TEXT,
  approved_by     TEXT,
  locked_at       TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_budgets_doc ON bud_budgets (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_budgets_version ON bud_budgets (org_project_id, version_no) WHERE deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED');
CREATE INDEX IF NOT EXISTS ix_bud_budgets_company_id ON bud_budgets (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_budgets_status ON bud_budgets (company_id, status);
CREATE INDEX IF NOT EXISTS ix_bud_budgets_project ON bud_budgets (org_project_id, status);
CREATE INDEX IF NOT EXISTS ix_bud_budgets_pack ON bud_budgets (baseline_pack_id);
CREATE INDEX IF NOT EXISTS ix_bud_budgets_boq ON bud_budgets (boq_version_id);
CREATE INDEX IF NOT EXISTS ix_bud_budgets_parent ON bud_budgets (parent_budget_id);

CREATE TABLE IF NOT EXISTS bud_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  budget_id       INTEGER NOT NULL REFERENCES bud_budgets (id),
  line_kind       TEXT    NOT NULL CHECK (line_kind IN ('DIRECT', 'OVERHEAD', 'CONTINGENCY', 'RESERVE')),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  work_package_id INTEGER REFERENCES proj_work_packages (id),
  boq_line_id     INTEGER REFERENCES proj_boq_lines (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  cost_head_id    INTEGER REFERENCES fin_cost_heads (id),
  resource_type   TEXT    NOT NULL DEFAULT 'OTHER' CHECK (resource_type IN ('MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER')),
  resource_name   TEXT    NOT NULL,
  uom             TEXT,
  qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  rate            INTEGER NOT NULL DEFAULT 0 CHECK (rate >= 0),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  gen_qty         INTEGER,
  gen_rate        INTEGER,
  gen_amount      INTEGER,
  origin          TEXT    NOT NULL DEFAULT 'GENERATED' CHECK (origin IN ('GENERATED', 'MANUAL')),
  adjust_reason   TEXT,
  adjusted_by     TEXT,
  adjusted_at     TEXT,
  unrated         INTEGER NOT NULL DEFAULT 0 CHECK (unrated IN (0, 1)),
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
  CHECK (line_kind = 'DIRECT' OR wbs_id IS NULL OR line_kind = 'OVERHEAD')
);
CREATE INDEX IF NOT EXISTS ix_bud_lines_company_id ON bud_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_lines_budget ON bud_lines (budget_id, line_kind, sort_order);
CREATE INDEX IF NOT EXISTS ix_bud_lines_wbs ON bud_lines (wbs_id);
CREATE INDEX IF NOT EXISTS ix_bud_lines_wp ON bud_lines (work_package_id);
CREATE INDEX IF NOT EXISTS ix_bud_lines_boq ON bud_lines (boq_line_id);
CREATE INDEX IF NOT EXISTS ix_bud_lines_code ON bud_lines (cost_code_id);
CREATE INDEX IF NOT EXISTS ix_bud_lines_head ON bud_lines (cost_head_id);

CREATE TABLE IF NOT EXISTS bud_phasing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  budget_id       INTEGER NOT NULL REFERENCES bud_budgets (id),
  line_id         INTEGER NOT NULL REFERENCES bud_lines (id),
  period          TEXT    NOT NULL,
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  method          TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (method IN ('MANUAL', 'SCHEDULE', 'SCURVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_phasing ON bud_phasing (line_id, period) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bud_phasing_company_id ON bud_phasing (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_phasing_budget ON bud_phasing (budget_id, period);
