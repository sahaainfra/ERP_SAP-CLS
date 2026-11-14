-- Part 21.05: change requests (technical review, QS evaluation with rates from a documented basis; approval-controlled before they go to the client) and variation orders (approval-controlled) with their items.
CREATE TABLE IF NOT EXISTS ctr_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  cr_no           TEXT    NOT NULL COLLATE NOCASE,
  kind            TEXT    NOT NULL DEFAULT 'CLIENT' CHECK (kind IN ('CLIENT', 'SUBCONTRACT')),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  contract_id     INTEGER REFERENCES ctr_contracts (id),
  work_order_id   INTEGER REFERENCES ctr_work_orders (id),
  origin_type     TEXT    NOT NULL CHECK (origin_type IN ('CLIENT_INSTRUCTION', 'RFI', 'DESIGN_CHANGE', 'INTERNAL', 'QTY_DEVIATION', 'SUBCONTRACT')),
  origin_ref      TEXT,
  origin_id       INTEGER,
  title           TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  technical_review TEXT,
  technical_by    TEXT,
  technical_at    TEXT,
  qs_json         TEXT    NOT NULL DEFAULT '{}',
  value_claimed_paise INTEGER NOT NULL DEFAULT 0,
  time_claimed_days INTEGER NOT NULL DEFAULT 0 CHECK (time_claimed_days >= 0),
  cr_state        TEXT    NOT NULL DEFAULT 'PREPARING' CHECK (cr_state IN ('PREPARING', 'READY', 'WITH_CLIENT', 'APPROVED', 'REJECTED', 'DISPUTED', 'WITHDRAWN')),
  client_ref      TEXT,
  to_client_on    TEXT,
  response_on     TEXT,
  response_note   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_cr_doc ON ctr_change_requests (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_cr_no ON ctr_change_requests (company_id, cr_no);
CREATE INDEX IF NOT EXISTS ix_ctr_change_requests_org_project_id ON ctr_change_requests (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctr_change_requests_org_site_id ON ctr_change_requests (org_site_id);
CREATE INDEX IF NOT EXISTS ix_ctr_change_requests_contract_id ON ctr_change_requests (contract_id);
CREATE INDEX IF NOT EXISTS ix_ctr_change_requests_work_order_id ON ctr_change_requests (work_order_id);
CREATE INDEX IF NOT EXISTS ix_ctr_cr_state ON ctr_change_requests (company_id, cr_state);
CREATE TABLE IF NOT EXISTS ctr_variation_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  vo_no           TEXT    NOT NULL COLLATE NOCASE,
  kind            TEXT    NOT NULL DEFAULT 'CLIENT' CHECK (kind IN ('CLIENT', 'SUBCONTRACT')),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  contract_id     INTEGER REFERENCES ctr_contracts (id),
  work_order_id   INTEGER REFERENCES ctr_work_orders (id),
  cr_id           INTEGER NOT NULL REFERENCES ctr_change_requests (id),
  client_ref      TEXT,
  title           TEXT    NOT NULL,
  value_approved_paise INTEGER NOT NULL DEFAULT 0,
  time_approved_days INTEGER NOT NULL DEFAULT 0 CHECK (time_approved_days >= 0),
  approved_on     TEXT,
  vo_state        TEXT    NOT NULL DEFAULT 'RECORDED' CHECK (vo_state IN ('RECORDED', 'EFFECTIVE')),
  boq_version_id  INTEGER REFERENCES proj_boq_versions (id),
  outputs_json    TEXT    NOT NULL DEFAULT '{}',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_vo_doc ON ctr_variation_orders (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_vo_no ON ctr_variation_orders (company_id, vo_no);
CREATE INDEX IF NOT EXISTS ix_ctr_variation_orders_org_project_id ON ctr_variation_orders (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctr_variation_orders_org_site_id ON ctr_variation_orders (org_site_id);
CREATE INDEX IF NOT EXISTS ix_ctr_variation_orders_contract_id ON ctr_variation_orders (contract_id);
CREATE INDEX IF NOT EXISTS ix_ctr_variation_orders_work_order_id ON ctr_variation_orders (work_order_id);
CREATE INDEX IF NOT EXISTS ix_ctr_variation_orders_cr_id ON ctr_variation_orders (cr_id);
CREATE INDEX IF NOT EXISTS ix_ctr_variation_orders_boq_version_id ON ctr_variation_orders (boq_version_id);
CREATE TABLE IF NOT EXISTS ctr_vo_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  vo_id           INTEGER NOT NULL REFERENCES ctr_variation_orders (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  boq_line_id     INTEGER REFERENCES proj_boq_lines (id),
  wo_line_no      INTEGER,
  description     TEXT    NOT NULL,
  uom             TEXT,
  qty_change_th   INTEGER NOT NULL DEFAULT 0,
  rate_x4         INTEGER NOT NULL DEFAULT 0 CHECK (rate_x4 >= 0),
  amount_paise    INTEGER NOT NULL DEFAULT 0,
  basis_kind      TEXT    NOT NULL CHECK (basis_kind IN ('CONTRACT', 'SCHEDULE', 'ANALYSIS')),
  basis_ref       TEXT,
  analysis_id     INTEGER REFERENCES ra_analyses (id),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  is_extra        INTEGER NOT NULL DEFAULT 0 CHECK (is_extra IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_voi_line ON ctr_vo_items (vo_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ctr_vo_items_company_id ON ctr_vo_items (company_id);
CREATE INDEX IF NOT EXISTS ix_ctr_vo_items_boq_line_id ON ctr_vo_items (boq_line_id);
CREATE INDEX IF NOT EXISTS ix_ctr_vo_items_analysis_id ON ctr_vo_items (analysis_id);
CREATE INDEX IF NOT EXISTS ix_ctr_vo_items_wbs_id ON ctr_vo_items (wbs_id);
CREATE INDEX IF NOT EXISTS ix_ctr_vo_items_cost_code_id ON ctr_vo_items (cost_code_id);
