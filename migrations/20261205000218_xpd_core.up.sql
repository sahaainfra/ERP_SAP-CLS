-- Part 15.07: expediting, vendor inspection and logistics of long-lead items (module proc, tables xpd_*).
-- xpd_expediting_plans / xpd_milestones: the plan of an order with its milestones (planned, forecast, actual dates), the required-on-site date and the risk against it.
-- xpd_inspections: inspections at the vendor's works (stage, final, third party) with results, punch points and the inspection release note (IRN).
-- xpd_shipments / xpd_shipment_events: packing, transport, e-way bill, over-dimensional cargo permits and the tracking events to site.

CREATE TABLE IF NOT EXISTS xpd_expediting_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  po_id           INTEGER NOT NULL REFERENCES proc_purchase_orders (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  required_on_site TEXT   NOT NULL,
  transit_days    INTEGER NOT NULL DEFAULT 7 CHECK (transit_days >= 0),
  long_lead       INTEGER NOT NULL DEFAULT 1 CHECK (long_lead IN (0, 1)),
  inspection_required INTEGER NOT NULL DEFAULT 0 CHECK (inspection_required IN (0, 1)),
  expediter       TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CLOSED', 'CANCELLED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  parent_id       INTEGER REFERENCES xpd_expediting_plans (id),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  approved_by     TEXT,
  approved_at     TEXT,
  eta             TEXT,
  days_late       INTEGER NOT NULL DEFAULT 0,
  at_risk         INTEGER NOT NULL DEFAULT 0 CHECK (at_risk IN (0, 1)),
  alerted_late    INTEGER NOT NULL DEFAULT 0,
  alerted_on      TEXT,
  cancel_reason   TEXT,
  close_reason    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_xpd_plan_doc ON xpd_expediting_plans (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_xpd_plan_company ON xpd_expediting_plans (company_id, status);
CREATE INDEX IF NOT EXISTS ix_xpd_plan_po ON xpd_expediting_plans (po_id, status);
CREATE INDEX IF NOT EXISTS ix_xpd_plan_project ON xpd_expediting_plans (org_project_id, status, at_risk);
CREATE INDEX IF NOT EXISTS ix_xpd_plan_parent ON xpd_expediting_plans (parent_id);

CREATE TABLE IF NOT EXISTS xpd_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  plan_id         INTEGER NOT NULL REFERENCES xpd_expediting_plans (id),
  seq_no          INTEGER NOT NULL CHECK (seq_no >= 1),
  name            TEXT    NOT NULL,
  kind            TEXT    NOT NULL DEFAULT 'OTHER' CHECK (kind IN ('DRAWING_APPROVAL', 'RAW_MATERIAL', 'MANUFACTURING', 'TESTING', 'DISPATCH', 'OTHER')),
  planned_date    TEXT    NOT NULL,
  forecast_date   TEXT,
  actual_date     TEXT,
  ms_status       TEXT    NOT NULL DEFAULT 'PENDING' CHECK (ms_status IN ('PENDING', 'IN_PROGRESS', 'DONE', 'DELAYED')),
  updated_via     TEXT    NOT NULL DEFAULT 'BUYER' CHECK (updated_via IN ('BUYER', 'VENDOR')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_xpd_ms_seq ON xpd_milestones (plan_id, seq_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_xpd_ms_company ON xpd_milestones (company_id);
CREATE INDEX IF NOT EXISTS ix_xpd_ms_status ON xpd_milestones (ms_status, planned_date);

CREATE TABLE IF NOT EXISTS xpd_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  po_id           INTEGER NOT NULL REFERENCES proc_purchase_orders (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  itype           TEXT    NOT NULL DEFAULT 'FINAL' CHECK (itype IN ('STAGE', 'FINAL', 'TPI')),
  mandatory       INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0, 1)),
  call_date       TEXT    NOT NULL,
  inspection_date TEXT,
  inspector       TEXT,
  agency          TEXT,
  location        TEXT,
  scope           TEXT,
  result          TEXT    NOT NULL DEFAULT 'PENDING' CHECK (result IN ('PENDING', 'PASSED', 'PASSED_WITH_PUNCH', 'FAILED')),
  punch_points_json TEXT,
  lines_json      TEXT,
  irn_no          TEXT,
  irn_date        TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CLOSED', 'CANCELLED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  parent_id       INTEGER REFERENCES xpd_inspections (id),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_xpd_insp_doc ON xpd_inspections (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_xpd_insp_irn ON xpd_inspections (company_id, irn_no) WHERE irn_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_xpd_insp_company ON xpd_inspections (company_id, status);
CREATE INDEX IF NOT EXISTS ix_xpd_insp_po ON xpd_inspections (po_id, status);
CREATE INDEX IF NOT EXISTS ix_xpd_insp_project ON xpd_inspections (org_project_id, call_date);
CREATE INDEX IF NOT EXISTS ix_xpd_insp_parent ON xpd_inspections (parent_id);

CREATE TABLE IF NOT EXISTS xpd_shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  po_id           INTEGER NOT NULL REFERENCES proc_purchase_orders (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  transporter     TEXT,
  vehicle_no      TEXT,
  lr_no           TEXT,
  bl_no           TEXT,
  eway_bill_no    TEXT,
  packing_list    TEXT,
  packages        INTEGER NOT NULL DEFAULT 0 CHECK (packages >= 0),
  is_odc          INTEGER NOT NULL DEFAULT 0 CHECK (is_odc IN (0, 1)),
  odc_permit_no   TEXT,
  odc_valid_to    TEXT,
  odc_dimensions  TEXT,
  dispatched_on   TEXT,
  eta             TEXT,
  delivered_on    TEXT,
  lines_json      TEXT    NOT NULL DEFAULT '[]',
  clearance       TEXT    NOT NULL DEFAULT 'NOT_CHECKED' CHECK (clearance IN ('NOT_CHECKED', 'NOT_REQUIRED', 'CLEARED', 'EXCEPTION')),
  irn_id          INTEGER REFERENCES xpd_inspections (id),
  status          TEXT    NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED')),
  requested_by    TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_xpd_ship_doc ON xpd_shipments (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_xpd_ship_company ON xpd_shipments (company_id, status);
CREATE INDEX IF NOT EXISTS ix_xpd_ship_po ON xpd_shipments (po_id, status);
CREATE INDEX IF NOT EXISTS ix_xpd_ship_project ON xpd_shipments (org_project_id, eta);
CREATE INDEX IF NOT EXISTS ix_xpd_ship_irn ON xpd_shipments (irn_id);

CREATE TABLE IF NOT EXISTS xpd_shipment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  shipment_id     INTEGER NOT NULL REFERENCES xpd_shipments (id),
  event_at        TEXT    NOT NULL,
  location        TEXT,
  note            TEXT,
  eta_after       TEXT,
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
CREATE INDEX IF NOT EXISTS ix_xpd_ship_ev_company ON xpd_shipment_events (company_id);
CREATE INDEX IF NOT EXISTS ix_xpd_ship_ev_ship ON xpd_shipment_events (shipment_id, event_at);
