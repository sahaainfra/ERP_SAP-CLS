-- Part 21.03: subcontract work orders (item rate, labour rate, lump sum; approval-controlled) with their items (back-to-back mapping to the client BOQ), free-issue terms and amendments (approval-controlled).
CREATE TABLE IF NOT EXISTS ctr_work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  wo_no           TEXT    NOT NULL COLLATE NOCASE,
  wo_type         TEXT    NOT NULL CHECK (wo_type IN ('ITEM_RATE', 'LABOUR_RATE', 'LUMP_SUM')),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  contract_id     INTEGER REFERENCES ctr_contracts (id),
  subcontractor_id INTEGER NOT NULL REFERENCES mdm_partners (id),
  work_package_id INTEGER REFERENCES proj_work_packages (id),
  cs_id           INTEGER REFERENCES proc_comparative_statements (id),
  selection_kind  TEXT    NOT NULL DEFAULT 'NEGOTIATED' CHECK (selection_kind IN ('CS', 'NEGOTIATED')),
  justification   TEXT,
  title           TEXT    NOT NULL,
  scope_text      TEXT,
  start_date      TEXT    NOT NULL,
  end_date        TEXT    NOT NULL,
  value_paise     INTEGER NOT NULL DEFAULT 0 CHECK (value_paise >= 0),
  retention_bp    INTEGER NOT NULL DEFAULT 0 CHECK (retention_bp BETWEEN 0 AND 10000),
  sd_bp           INTEGER NOT NULL DEFAULT 0 CHECK (sd_bp BETWEEN 0 AND 10000),
  advance_bp      INTEGER NOT NULL DEFAULT 0 CHECK (advance_bp BETWEEN 0 AND 10000),
  advance_recovery_bp INTEGER NOT NULL DEFAULT 0 CHECK (advance_recovery_bp BETWEEN 0 AND 10000),
  tds_section     TEXT,
  gst_mode        TEXT    NOT NULL DEFAULT 'FORWARD' CHECK (gst_mode IN ('FORWARD', 'RCM', 'EXEMPT')),
  gst_bp          INTEGER NOT NULL DEFAULT 1800 CHECK (gst_bp BETWEEN 0 AND 10000),
  payment_days    INTEGER NOT NULL DEFAULT 30 CHECK (payment_days >= 0),
  ld_bp           INTEGER NOT NULL DEFAULT 0 CHECK (ld_bp BETWEEN 0 AND 10000),
  ld_cap_bp       INTEGER NOT NULL DEFAULT 0 CHECK (ld_cap_bp BETWEEN 0 AND 10000),
  safety_penalty_paise INTEGER NOT NULL DEFAULT 0 CHECK (safety_penalty_paise >= 0),
  terms_json      TEXT    NOT NULL DEFAULT '{}',
  negative_margin INTEGER NOT NULL DEFAULT 0 CHECK (negative_margin IN (0, 1)),
  over_budget     INTEGER NOT NULL DEFAULT 0 CHECK (over_budget IN (0, 1)),
  amendment_no    INTEGER NOT NULL DEFAULT 0 CHECK (amendment_no >= 0),
  wo_state        TEXT    NOT NULL DEFAULT 'PREPARING' CHECK (wo_state IN ('PREPARING', 'ISSUED', 'ACCEPTED', 'CLOSED')),
  accepted_by     TEXT,
  accepted_at     TEXT,
  acceptance_ref  TEXT,
  closed_on       TEXT,
  final_bill_ref  TEXT,
  close_note      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_wo_doc ON ctr_work_orders (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_wo_no ON ctr_work_orders (company_id, wo_no);
CREATE INDEX IF NOT EXISTS ix_ctr_work_orders_org_project_id ON ctr_work_orders (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctr_work_orders_org_site_id ON ctr_work_orders (org_site_id);
CREATE INDEX IF NOT EXISTS ix_ctr_work_orders_contract_id ON ctr_work_orders (contract_id);
CREATE INDEX IF NOT EXISTS ix_ctr_work_orders_subcontractor_id ON ctr_work_orders (subcontractor_id);
CREATE INDEX IF NOT EXISTS ix_ctr_work_orders_work_package_id ON ctr_work_orders (work_package_id);
CREATE INDEX IF NOT EXISTS ix_ctr_work_orders_cs_id ON ctr_work_orders (cs_id);
CREATE INDEX IF NOT EXISTS ix_ctr_wo_state ON ctr_work_orders (company_id, wo_state, end_date);
CREATE TABLE IF NOT EXISTS ctr_wo_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  wo_id           INTEGER NOT NULL REFERENCES ctr_work_orders (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  item_kind       TEXT    NOT NULL DEFAULT 'BOQ' CHECK (item_kind IN ('BOQ', 'CUSTOM', 'MILESTONE')),
  boq_line_id     INTEGER REFERENCES proj_boq_lines (id),
  description     TEXT    NOT NULL,
  uom             TEXT,
  qty_th          INTEGER NOT NULL DEFAULT 0 CHECK (qty_th >= 0),
  rate_x4         INTEGER NOT NULL DEFAULT 0 CHECK (rate_x4 >= 0),
  amount_paise    INTEGER NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  client_boq_line_id INTEGER REFERENCES proj_boq_lines (id),
  client_rate_x4 INTEGER NOT NULL DEFAULT 0 CHECK (client_rate_x4 >= 0),
  due_date        TEXT,
  executed_qty_th INTEGER NOT NULL DEFAULT 0 CHECK (executed_qty_th >= 0),
  billed_qty_th   INTEGER NOT NULL DEFAULT 0 CHECK (billed_qty_th >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_wo_item_line ON ctr_wo_items (wo_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ctr_wo_items_company_id ON ctr_wo_items (company_id);
CREATE INDEX IF NOT EXISTS ix_ctr_wo_items_boq_line_id ON ctr_wo_items (boq_line_id);
CREATE INDEX IF NOT EXISTS ix_ctr_wo_items_wbs_id ON ctr_wo_items (wbs_id);
CREATE INDEX IF NOT EXISTS ix_ctr_wo_items_client_boq_line_id ON ctr_wo_items (client_boq_line_id);
CREATE TABLE IF NOT EXISTS ctr_wo_free_issue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  wo_id           INTEGER NOT NULL REFERENCES ctr_work_orders (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  uom             TEXT,
  norm_th         INTEGER NOT NULL DEFAULT 0 CHECK (norm_th >= 0),
  wastage_bp      INTEGER NOT NULL DEFAULT 0 CHECK (wastage_bp BETWEEN 0 AND 10000),
  chargeable_rate_x4 INTEGER NOT NULL DEFAULT 0 CHECK (chargeable_rate_x4 >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_wo_fi ON ctr_wo_free_issue (wo_id, item_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ctr_wo_free_issue_company_id ON ctr_wo_free_issue (company_id);
CREATE INDEX IF NOT EXISTS ix_ctr_wo_free_issue_item_id ON ctr_wo_free_issue (item_id);
CREATE TABLE IF NOT EXISTS ctr_wo_amendments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  wo_id           INTEGER NOT NULL REFERENCES ctr_work_orders (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  amendment_no    INTEGER NOT NULL CHECK (amendment_no >= 1),
  description     TEXT    NOT NULL,
  changes_json    TEXT    NOT NULL DEFAULT '[]',
  new_end_date    TEXT,
  delta_paise     INTEGER NOT NULL DEFAULT 0,
  negative_margin INTEGER NOT NULL DEFAULT 0 CHECK (negative_margin IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_woa_doc ON ctr_wo_amendments (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_ctr_wo_amendments_wo_id ON ctr_wo_amendments (wo_id);
CREATE INDEX IF NOT EXISTS ix_ctr_wo_amendments_org_project_id ON ctr_wo_amendments (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctr_wo_amendments_org_site_id ON ctr_wo_amendments (org_site_id);
