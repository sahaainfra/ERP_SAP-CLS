-- Part 15.01: material requests (site indents) and purchase requisitions, the controlled entry point of procurement.
-- proc_material_requests / proc_mr_lines: what a site needs, against a work authorisation and a WBS node, with the way each line is met (issue from stock, transfer, purchase).
-- proc_requisitions / proc_pr_lines: what is to be bought, with the estimated rate, the checks (stock, budget, duplicates) and the approval by band; proc_pr_sources: the trace from each requisition line to the material request lines it consolidates.
-- proc_stock_levels: the free stock of an item in a store, as the stock module (16.01) will keep it; until that part exists it is filled through the ingest route and read only by the stock check and the availability panel.

CREATE TABLE IF NOT EXISTS proc_material_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  mr_site_id      INTEGER NOT NULL REFERENCES org_sites (id),
  requested_by    TEXT    NOT NULL,
  required_by     TEXT    NOT NULL,
  wa_id           INTEGER REFERENCES site_work_authorisations (id),
  activity_id     INTEGER REFERENCES plan_activities (id),
  priority        TEXT    NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  purpose         TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  parent_id       INTEGER REFERENCES proc_material_requests (id),
  workflow_instance_id INTEGER,
  submitted_at    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_mr_doc ON proc_material_requests (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_proc_mr_company ON proc_material_requests (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_mr_project ON proc_material_requests (org_project_id, status, required_by);
CREATE INDEX IF NOT EXISTS ix_proc_mr_site ON proc_material_requests (mr_site_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_mr_wa ON proc_material_requests (wa_id);
CREATE INDEX IF NOT EXISTS ix_proc_mr_activity ON proc_material_requests (activity_id);
CREATE INDEX IF NOT EXISTS ix_proc_mr_parent ON proc_material_requests (parent_id);

CREATE TABLE IF NOT EXISTS proc_mr_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  mr_id           INTEGER NOT NULL REFERENCES proc_material_requests (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  uom             TEXT    NOT NULL,
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  fulfilment_mode TEXT    NOT NULL DEFAULT 'NONE' CHECK (fulfilment_mode IN ('NONE', 'ISSUE', 'TRANSFER', 'PR', 'MIXED')),
  issue_qty       INTEGER NOT NULL DEFAULT 0 CHECK (issue_qty >= 0),
  transfer_qty    INTEGER NOT NULL DEFAULT 0 CHECK (transfer_qty >= 0),
  pr_qty          INTEGER NOT NULL DEFAULT 0 CHECK (pr_qty >= 0),
  fulfilled_qty   INTEGER NOT NULL DEFAULT 0 CHECK (fulfilled_qty >= 0),
  from_store_code TEXT,
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
  CHECK (issue_qty + transfer_qty + pr_qty <= qty)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_mr_lines_no ON proc_mr_lines (mr_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proc_mr_lines_company ON proc_mr_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_mr_lines_item ON proc_mr_lines (item_id);
CREATE INDEX IF NOT EXISTS ix_proc_mr_lines_wbs ON proc_mr_lines (wbs_id);
CREATE INDEX IF NOT EXISTS ix_proc_mr_lines_code ON proc_mr_lines (cost_code_id);

CREATE TABLE IF NOT EXISTS proc_requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  pr_site_id      INTEGER REFERENCES org_sites (id),
  pr_source       TEXT    NOT NULL CHECK (pr_source IN ('MR', 'MRP', 'DIRECT')),
  direct_reason   TEXT,
  requested_by    TEXT    NOT NULL,
  required_by     TEXT    NOT NULL,
  priority        TEXT    NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  purpose         TEXT,
  total_amount    INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  budget_check_status TEXT NOT NULL DEFAULT 'NOT_CHECKED' CHECK (budget_check_status IN ('NOT_CHECKED', 'OK', 'WARNING', 'BLOCK')),
  checks_json     TEXT,
  is_emergency    INTEGER NOT NULL DEFAULT 0 CHECK (is_emergency IN (0, 1)),
  emergency_reason TEXT,
  regularise_by   TEXT,
  regularised_at  TEXT,
  overdue_notified INTEGER NOT NULL DEFAULT 0 CHECK (overdue_notified IN (0, 1)),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'EMERGENCY', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  parent_id       INTEGER REFERENCES proc_requisitions (id),
  root_id         INTEGER,
  workflow_instance_id INTEGER,
  submitted_at    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  cancel_reason   TEXT,
  closed_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_pr_doc ON proc_requisitions (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_proc_pr_company ON proc_requisitions (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_pr_project ON proc_requisitions (org_project_id, status, required_by);
CREATE INDEX IF NOT EXISTS ix_proc_pr_site ON proc_requisitions (pr_site_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_pr_parent ON proc_requisitions (parent_id);
CREATE INDEX IF NOT EXISTS ix_proc_pr_emergency ON proc_requisitions (company_id, status, regularise_by) WHERE is_emergency = 1;

CREATE TABLE IF NOT EXISTS proc_pr_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  pr_id           INTEGER NOT NULL REFERENCES proc_requisitions (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  item_id         INTEGER REFERENCES mdm_items (id),
  service_desc    TEXT,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  uom             TEXT    NOT NULL,
  est_rate        INTEGER NOT NULL DEFAULT 0 CHECK (est_rate >= 0),
  est_amount      INTEGER NOT NULL DEFAULT 0 CHECK (est_amount >= 0),
  valued_from     TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (valued_from IN ('RATE_CONTRACT', 'LAST_PO', 'BUDGET', 'STANDARD', 'MANUAL')),
  required_by     TEXT    NOT NULL,
  delivery_site_id INTEGER REFERENCES org_sites (id),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  spec            TEXT,
  preferred_vendor_id INTEGER REFERENCES mdm_partners (id),
  approved_makes  TEXT,
  ordered_qty     INTEGER NOT NULL DEFAULT 0 CHECK (ordered_qty >= 0),
  balance_qty     INTEGER NOT NULL DEFAULT 0 CHECK (balance_qty >= 0),
  closed_qty      INTEGER NOT NULL DEFAULT 0 CHECK (closed_qty >= 0),
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
  CHECK (item_id IS NOT NULL OR (service_desc IS NOT NULL AND service_desc <> '')),
  CHECK (ordered_qty + closed_qty <= qty)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_pr_lines_no ON proc_pr_lines (pr_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proc_pr_lines_company ON proc_pr_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_pr_lines_item ON proc_pr_lines (item_id, delivery_site_id);
CREATE INDEX IF NOT EXISTS ix_proc_pr_lines_site ON proc_pr_lines (delivery_site_id);
CREATE INDEX IF NOT EXISTS ix_proc_pr_lines_wbs ON proc_pr_lines (wbs_id);
CREATE INDEX IF NOT EXISTS ix_proc_pr_lines_code ON proc_pr_lines (cost_code_id);
CREATE INDEX IF NOT EXISTS ix_proc_pr_lines_vendor ON proc_pr_lines (preferred_vendor_id);

CREATE TABLE IF NOT EXISTS proc_pr_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  pr_line_id      INTEGER NOT NULL REFERENCES proc_pr_lines (id),
  mr_line_id      INTEGER NOT NULL REFERENCES proc_mr_lines (id),
  qty             INTEGER NOT NULL CHECK (qty > 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_pr_sources ON proc_pr_sources (pr_line_id, mr_line_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proc_pr_sources_company ON proc_pr_sources (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_pr_sources_mr ON proc_pr_sources (mr_line_id);

CREATE TABLE IF NOT EXISTS proc_stock_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  store_code      TEXT    NOT NULL,
  store_name      TEXT    NOT NULL,
  store_kind      TEXT    NOT NULL CHECK (store_kind IN ('SITE', 'NEARBY', 'CENTRAL')),
  store_site_id   INTEGER REFERENCES org_sites (id),
  free_qty        INTEGER NOT NULL DEFAULT 0 CHECK (free_qty >= 0),
  as_of           TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_stock_levels ON proc_stock_levels (company_id, item_id, store_code);
CREATE INDEX IF NOT EXISTS ix_proc_stock_levels_item ON proc_stock_levels (item_id, store_kind);
CREATE INDEX IF NOT EXISTS ix_proc_stock_levels_site ON proc_stock_levels (store_site_id);
