-- Part 21.07: price variation formulas per contract (or subcontract work order), the documents of the index values used, escalation computations (approval-controlled) with their workings, and liquidated damages assessments.
CREATE TABLE IF NOT EXISTS ctr_pvc_formulas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  kind            TEXT    NOT NULL DEFAULT 'CLIENT' CHECK (kind IN ('CLIENT', 'SUBCONTRACT')),
  contract_id     INTEGER NOT NULL REFERENCES ctr_contracts (id),
  work_order_id   INTEGER REFERENCES ctr_work_orders (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  base_month      TEXT    NOT NULL CHECK (base_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  components_json TEXT    NOT NULL,
  exclusions_json TEXT    NOT NULL DEFAULT '[]',
  threshold_bp    INTEGER NOT NULL DEFAULT 0 CHECK (threshold_bp BETWEEN 0 AND 10000),
  cap_bp          INTEGER NOT NULL DEFAULT 0 CHECK (cap_bp BETWEEN 0 AND 100000),
  fixed_bp        INTEGER NOT NULL DEFAULT 0 CHECK (fixed_bp BETWEEN 0 AND 10000),
  formula_status  TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (formula_status IN ('ACTIVE', 'RETIRED')),
  clause_ref      TEXT,
  change_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_pvf_active ON ctr_pvc_formulas (company_id, contract_id, COALESCE(work_order_id, 0)) WHERE formula_status = 'ACTIVE' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ctr_pvc_formulas_contract_id ON ctr_pvc_formulas (contract_id);
CREATE INDEX IF NOT EXISTS ix_ctr_pvc_formulas_work_order_id ON ctr_pvc_formulas (work_order_id);
CREATE INDEX IF NOT EXISTS ix_ctr_pvc_formulas_org_project_id ON ctr_pvc_formulas (org_project_id);
CREATE TABLE IF NOT EXISTS ctr_pvc_index_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  index_code      TEXT    NOT NULL COLLATE NOCASE,
  period          TEXT    NOT NULL,
  document_ref    TEXT    NOT NULL,
  notified_on     TEXT,
  document_id     INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_pir_key ON ctr_pvc_index_refs (company_id, index_code, period) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ctr_pvc_index_refs_company_id ON ctr_pvc_index_refs (company_id);
CREATE TABLE IF NOT EXISTS ctr_escalation_calcs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  kind            TEXT    NOT NULL DEFAULT 'CLIENT' CHECK (kind IN ('CLIENT', 'SUBCONTRACT')),
  contract_id     INTEGER NOT NULL REFERENCES ctr_contracts (id),
  work_order_id   INTEGER REFERENCES ctr_work_orders (id),
  formula_id      INTEGER NOT NULL REFERENCES ctr_pvc_formulas (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  bill_ref        TEXT    NOT NULL,
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  r_value_paise   INTEGER NOT NULL CHECK (r_value_paise > 0),
  excluded_paise  INTEGER NOT NULL DEFAULT 0 CHECK (excluded_paise >= 0),
  exclusions_json TEXT    NOT NULL DEFAULT '[]',
  eligible_paise  INTEGER NOT NULL DEFAULT 0,
  components_json TEXT    NOT NULL DEFAULT '[]',
  trace_json      TEXT    NOT NULL DEFAULT '[]',
  net_bp          INTEGER NOT NULL DEFAULT 0,
  amount_paise    INTEGER NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  cancel_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_esc_doc ON ctr_escalation_calcs (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_esc_bill ON ctr_escalation_calcs (company_id, contract_id, COALESCE(work_order_id, 0), bill_ref) WHERE status NOT IN ('CANCELLED', 'REJECTED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ctr_escalation_calcs_contract_id ON ctr_escalation_calcs (contract_id);
CREATE INDEX IF NOT EXISTS ix_ctr_escalation_calcs_work_order_id ON ctr_escalation_calcs (work_order_id);
CREATE INDEX IF NOT EXISTS ix_ctr_escalation_calcs_formula_id ON ctr_escalation_calcs (formula_id);
CREATE INDEX IF NOT EXISTS ix_ctr_escalation_calcs_org_project_id ON ctr_escalation_calcs (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctr_escalation_calcs_org_site_id ON ctr_escalation_calcs (org_site_id);
CREATE TABLE IF NOT EXISTS ctr_ld_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  contract_id     INTEGER NOT NULL REFERENCES ctr_contracts (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  as_of           TEXT    NOT NULL,
  completion_date TEXT    NOT NULL,
  eot_days        INTEGER NOT NULL DEFAULT 0 CHECK (eot_days >= 0),
  effective_date  TEXT    NOT NULL,
  forecast_date   TEXT    NOT NULL,
  delay_days      INTEGER NOT NULL DEFAULT 0 CHECK (delay_days >= 0),
  ld_rate_bp      INTEGER NOT NULL DEFAULT 0,
  ld_basis        TEXT    NOT NULL,
  base_value_paise INTEGER NOT NULL DEFAULT 0,
  gross_paise     INTEGER NOT NULL DEFAULT 0 CHECK (gross_paise >= 0),
  cap_paise       INTEGER NOT NULL DEFAULT 0 CHECK (cap_paise >= 0),
  ld_paise        INTEGER NOT NULL DEFAULT 0 CHECK (ld_paise >= 0),
  capped          INTEGER NOT NULL DEFAULT 0 CHECK (capped IN (0, 1)),
  deducted_paise  INTEGER NOT NULL DEFAULT 0 CHECK (deducted_paise >= 0),
  deductions_json TEXT    NOT NULL DEFAULT '[]',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_ld_key ON ctr_ld_assessments (company_id, contract_id, as_of) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ctr_ld_assessments_contract_id ON ctr_ld_assessments (contract_id);
CREATE INDEX IF NOT EXISTS ix_ctr_ld_assessments_org_project_id ON ctr_ld_assessments (org_project_id);
