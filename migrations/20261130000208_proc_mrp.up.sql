-- Part 15.02: material demand planning and MRP.
-- proc_mrp_runs: a run of the material requirements of a project over a horizon of weeks (on demand or weekly), with its parameters and the figures of what it found.
-- proc_mrp_lines: its result, one line for each item and week: gross requirement, free stock, open orders, in transit, open requisitions, safety stock, net requirement, the quantity proposed, order-by and required-by dates, and the activities behind it.
-- proc_mrp_proposals: what the run proposes to buy, for the planner to accept (a draft requisition), change or reject with a reason; MRP never makes an approved requisition (BR-01).
-- proc_item_params: how an item is planned (lead time, minimum order and pack size, safety stock, long-lead, supplier capacity), changed by a maker and approved by a checker.
-- proc_open_supply: what is on order or on the way, by item and expected date, as the purchase order and stock parts (15.05, 16.x) will keep it; until then it is loaded through the ingest route.

CREATE TABLE IF NOT EXISTS proc_mrp_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  run_kind        TEXT    NOT NULL DEFAULT 'ON_DEMAND' CHECK (run_kind IN ('ON_DEMAND', 'SCHEDULED')),
  horizon_weeks   INTEGER NOT NULL DEFAULT 12 CHECK (horizon_weeks >= 1 AND horizon_weeks <= 52),
  buffer_days     INTEGER NOT NULL DEFAULT 3 CHECK (buffer_days >= 0 AND buffer_days <= 60),
  include_mto     INTEGER NOT NULL DEFAULT 1 CHECK (include_mto IN (0, 1)),
  parameters_json TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COMPLETED', 'CLOSED', 'CANCELLED', 'SUPERSEDED')),
  schedule_id     INTEGER REFERENCES plan_schedules (id),
  run_at          TEXT,
  run_by          TEXT,
  item_count      INTEGER NOT NULL DEFAULT 0,
  shortage_count  INTEGER NOT NULL DEFAULT 0,
  proposal_count  INTEGER NOT NULL DEFAULT 0,
  warnings_json   TEXT,
  revision_no     INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  parent_id       INTEGER REFERENCES proc_mrp_runs (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_mrp_runs_doc ON proc_mrp_runs (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_proc_mrp_runs_company ON proc_mrp_runs (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_mrp_runs_project ON proc_mrp_runs (org_project_id, status, run_at);
CREATE INDEX IF NOT EXISTS ix_proc_mrp_runs_schedule ON proc_mrp_runs (schedule_id);
CREATE INDEX IF NOT EXISTS ix_proc_mrp_runs_parent ON proc_mrp_runs (parent_id);

CREATE TABLE IF NOT EXISTS proc_mrp_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  run_id          INTEGER NOT NULL REFERENCES proc_mrp_runs (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  week_start      TEXT    NOT NULL,
  gross_req       INTEGER NOT NULL DEFAULT 0 CHECK (gross_req >= 0),
  free_stock      INTEGER NOT NULL DEFAULT 0 CHECK (free_stock >= 0),
  open_po         INTEGER NOT NULL DEFAULT 0 CHECK (open_po >= 0),
  in_transit      INTEGER NOT NULL DEFAULT 0 CHECK (in_transit >= 0),
  open_pr         INTEGER NOT NULL DEFAULT 0 CHECK (open_pr >= 0),
  safety_stock    INTEGER NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
  net_req         INTEGER NOT NULL DEFAULT 0 CHECK (net_req >= 0),
  proposed_qty    INTEGER NOT NULL DEFAULT 0 CHECK (proposed_qty >= 0),
  projected_end   INTEGER NOT NULL DEFAULT 0,
  required_by     TEXT,
  order_by        TEXT,
  late            INTEGER NOT NULL DEFAULT 0 CHECK (late IN (0, 1)),
  source_activities_json TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_mrp_lines ON proc_mrp_lines (run_id, item_id, week_start);
CREATE INDEX IF NOT EXISTS ix_proc_mrp_lines_company ON proc_mrp_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_mrp_lines_item ON proc_mrp_lines (item_id);

CREATE TABLE IF NOT EXISTS proc_mrp_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  run_id          INTEGER NOT NULL REFERENCES proc_mrp_runs (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  uom             TEXT    NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  proposed_qty    INTEGER NOT NULL CHECK (proposed_qty > 0),
  required_by     TEXT    NOT NULL,
  order_by        TEXT    NOT NULL,
  late            INTEGER NOT NULL DEFAULT 0 CHECK (late IN (0, 1)),
  long_lead       INTEGER NOT NULL DEFAULT 0 CHECK (long_lead IN (0, 1)),
  lead_days       INTEGER NOT NULL DEFAULT 0,
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  alternates_json TEXT,
  substitute_item_id INTEGER REFERENCES mdm_items (id),
  decision        TEXT    NOT NULL DEFAULT 'OPEN' CHECK (decision IN ('OPEN', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
  decided_by      TEXT,
  decided_at      TEXT,
  reason          TEXT,
  modified        INTEGER NOT NULL DEFAULT 0 CHECK (modified IN (0, 1)),
  pr_id           INTEGER REFERENCES proc_requisitions (id),
  source_activities_json TEXT,
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
CREATE INDEX IF NOT EXISTS ix_proc_mrp_proposals_company ON proc_mrp_proposals (company_id, decision);
CREATE INDEX IF NOT EXISTS ix_proc_mrp_proposals_run ON proc_mrp_proposals (run_id, decision);
CREATE INDEX IF NOT EXISTS ix_proc_mrp_proposals_project ON proc_mrp_proposals (org_project_id, decision, order_by);
CREATE INDEX IF NOT EXISTS ix_proc_mrp_proposals_item ON proc_mrp_proposals (item_id);
CREATE INDEX IF NOT EXISTS ix_proc_mrp_proposals_pr ON proc_mrp_proposals (pr_id);
CREATE INDEX IF NOT EXISTS ix_proc_mrp_proposals_vendor ON proc_mrp_proposals (vendor_id);
CREATE INDEX IF NOT EXISTS ix_proc_mrp_proposals_sub ON proc_mrp_proposals (substitute_item_id);

CREATE TABLE IF NOT EXISTS proc_item_params (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  lead_time_days  INTEGER NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0 AND lead_time_days <= 730),
  moq             INTEGER NOT NULL DEFAULT 0 CHECK (moq >= 0),
  pack_size       INTEGER NOT NULL DEFAULT 0 CHECK (pack_size >= 0),
  safety_stock    INTEGER NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
  long_lead       INTEGER NOT NULL DEFAULT 0 CHECK (long_lead IN (0, 1)),
  capacity_note   TEXT,
  effective_from  TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_item_params_live ON proc_item_params (company_id, item_id, COALESCE(vendor_id, 0), effective_from) WHERE status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proc_item_params_company ON proc_item_params (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_item_params_item ON proc_item_params (item_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_item_params_vendor ON proc_item_params (vendor_id);

CREATE TABLE IF NOT EXISTS proc_open_supply (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  supply_kind     TEXT    NOT NULL CHECK (supply_kind IN ('PO', 'TRANSIT')),
  doc_ref         TEXT    NOT NULL,
  balance_qty     INTEGER NOT NULL DEFAULT 0 CHECK (balance_qty >= 0),
  expected_on     TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_open_supply ON proc_open_supply (company_id, org_project_id, item_id, supply_kind, doc_ref);
CREATE INDEX IF NOT EXISTS ix_proc_open_supply_item ON proc_open_supply (item_id, expected_on);
CREATE INDEX IF NOT EXISTS ix_proc_open_supply_project ON proc_open_supply (org_project_id);
