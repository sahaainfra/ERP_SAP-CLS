-- Part 12.03: budget check service and commitment ledger (module bud, tables bud_commitments, bud_commitment_log, bud_actuals, bud_check_config).
-- Amounts in paise, quantities x 1 000, percentages x 10 000.
-- bud_check_config: how strictly a stage (PR, PO, WO, other) is checked per cost head: off, warn or block, with a tolerance; a change is proposed, approved by a second person, and then takes effect on its date.
-- bud_commitments: what an approved PR, PO, WO, hire order or service order has committed against the budget (WBS x cost code x resource), how much has been consumed by actuals and how much released by short-close or cancellation.
-- bud_commitment_log: every movement of a commitment (created, amended, consumed, released, reversed) so that the ledger can always be reconciled.
-- bud_actuals: the actual cost posted by receipts, issues, bills, payroll and plant, linked to the commitment it consumed when there is one.
CREATE TABLE IF NOT EXISTS bud_check_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  cost_head_id    INTEGER REFERENCES fin_cost_heads (id),
  stage           TEXT    CHECK (stage IS NULL OR stage IN ('PR', 'PO', 'WO', 'OTHER')),
  mode            TEXT    NOT NULL CHECK (mode IN ('OFF', 'WARN', 'BLOCK')),
  tolerance_pct   INTEGER NOT NULL DEFAULT 0 CHECK (tolerance_pct >= 0 AND tolerance_pct <= 1000000),
  effective_from  TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'CANCELLED')),
  reason          TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_check_config_doc ON bud_check_config (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_check_config_open ON bud_check_config (company_id, COALESCE(cost_head_id, 0), COALESCE(stage, ''), effective_from) WHERE status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bud_check_config_company_id ON bud_check_config (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_check_config_head ON bud_check_config (cost_head_id);
CREATE INDEX IF NOT EXISTS ix_bud_check_config_status ON bud_check_config (company_id, status);

CREATE TABLE IF NOT EXISTS bud_commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  cost_head_id    INTEGER REFERENCES fin_cost_heads (id),
  resource_type   TEXT    NOT NULL DEFAULT 'OTHER' CHECK (resource_type IN ('MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER')),
  stage           TEXT    NOT NULL CHECK (stage IN ('PR', 'PO', 'WO', 'OTHER')),
  commit_type     TEXT,
  doc_ref         TEXT,
  vendor_ref      TEXT,
  vendor_name     TEXT,
  description     TEXT,
  qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  consumed_qty    INTEGER NOT NULL DEFAULT 0 CHECK (consumed_qty >= 0),
  consumed_amount INTEGER NOT NULL DEFAULT 0 CHECK (consumed_amount >= 0),
  released_amount INTEGER NOT NULL DEFAULT 0 CHECK (released_amount >= 0),
  status          TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIAL', 'CLOSED', 'CANCELLED')),
  commit_date     TEXT    NOT NULL,
  src_type        TEXT    NOT NULL,
  src_id          TEXT    NOT NULL,
  src_line_id     TEXT    NOT NULL DEFAULT '',
  exception_id    INTEGER,
  check_result    TEXT,
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
  CHECK (consumed_amount + released_amount <= amount)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_commitments_src ON bud_commitments (company_id, src_type, src_id, src_line_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bud_commitments_company_id ON bud_commitments (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_commitments_project ON bud_commitments (org_project_id, status);
CREATE INDEX IF NOT EXISTS ix_bud_commitments_wbs ON bud_commitments (wbs_id);
CREATE INDEX IF NOT EXISTS ix_bud_commitments_code ON bud_commitments (cost_code_id);
CREATE INDEX IF NOT EXISTS ix_bud_commitments_head ON bud_commitments (cost_head_id);
CREATE INDEX IF NOT EXISTS ix_bud_commitments_vendor ON bud_commitments (company_id, vendor_ref);

CREATE TABLE IF NOT EXISTS bud_commitment_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  commitment_id   INTEGER NOT NULL REFERENCES bud_commitments (id),
  action          TEXT    NOT NULL CHECK (action IN ('CREATED', 'AMENDED', 'CONSUMED', 'UNCONSUMED', 'SHORT_CLOSED', 'CANCELLED', 'REOPENED')),
  amount_delta    INTEGER NOT NULL DEFAULT 0,
  qty_delta       INTEGER NOT NULL DEFAULT 0,
  ref_type        TEXT,
  ref_id          TEXT,
  note            TEXT,
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
CREATE INDEX IF NOT EXISTS ix_bud_commitment_log_company_id ON bud_commitment_log (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_commitment_log_commitment ON bud_commitment_log (commitment_id, id);

CREATE TABLE IF NOT EXISTS bud_actuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  cost_head_id    INTEGER REFERENCES fin_cost_heads (id),
  resource_type   TEXT    NOT NULL DEFAULT 'OTHER' CHECK (resource_type IN ('MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER')),
  commitment_id   INTEGER REFERENCES bud_commitments (id),
  consumed_amount INTEGER NOT NULL DEFAULT 0 CHECK (consumed_amount >= 0),
  consumed_qty    INTEGER NOT NULL DEFAULT 0 CHECK (consumed_qty >= 0),
  doc_ref         TEXT,
  vendor_ref      TEXT,
  vendor_name     TEXT,
  description     TEXT,
  qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  actual_date     TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
  src_type        TEXT    NOT NULL,
  src_id          TEXT    NOT NULL,
  src_line_id     TEXT    NOT NULL DEFAULT '',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bud_actuals_src ON bud_actuals (company_id, src_type, src_id, src_line_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bud_actuals_company_id ON bud_actuals (company_id);
CREATE INDEX IF NOT EXISTS ix_bud_actuals_project ON bud_actuals (org_project_id, status, actual_date);
CREATE INDEX IF NOT EXISTS ix_bud_actuals_wbs ON bud_actuals (wbs_id);
CREATE INDEX IF NOT EXISTS ix_bud_actuals_code ON bud_actuals (cost_code_id);
CREATE INDEX IF NOT EXISTS ix_bud_actuals_head ON bud_actuals (cost_head_id);
CREATE INDEX IF NOT EXISTS ix_bud_actuals_commitment ON bud_actuals (commitment_id);
