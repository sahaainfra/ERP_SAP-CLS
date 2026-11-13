-- Part 17.02: equipment requisitions, allocations (including transfers between sites and projects, with mobilisation, arrival and demobilisation) and operator assignments. Nothing here changes an existing table. Money is paise.
CREATE TABLE IF NOT EXISTS plt_requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  class_item_id   INTEGER NOT NULL REFERENCES mdm_items (id),
  capacity        TEXT,
  qty             INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1 AND qty <= 1000),
  from_date       TEXT    NOT NULL,
  to_date         TEXT    NOT NULL,
  purpose         TEXT    NOT NULL,
  activity_id     INTEGER REFERENCES plan_activities (id),
  priority        TEXT    NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  hire_qty        INTEGER NOT NULL DEFAULT 0 CHECK (hire_qty >= 0),
  hire_reason     TEXT,
  hire_decided_by TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
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
  remarks     TEXT,
  CHECK (to_date >= from_date),
  CHECK (hire_qty <= qty)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_req_doc ON plt_requisitions (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_plt_req_project ON plt_requisitions (org_project_id);
CREATE INDEX IF NOT EXISTS ix_plt_req_site ON plt_requisitions (org_site_id);
CREATE INDEX IF NOT EXISTS ix_plt_req_class ON plt_requisitions (class_item_id);
CREATE INDEX IF NOT EXISTS ix_plt_req_activity ON plt_requisitions (activity_id);
CREATE INDEX IF NOT EXISTS ix_plt_req_list ON plt_requisitions (company_id, status, from_date);

CREATE TABLE IF NOT EXISTS plt_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  equipment_id    INTEGER NOT NULL REFERENCES plt_equipment (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  requisition_id  INTEGER REFERENCES plt_requisitions (id),
  alloc_kind      TEXT    NOT NULL DEFAULT 'ALLOCATION' CHECK (alloc_kind IN ('ALLOCATION', 'TRANSFER')),
  transfer_from_id INTEGER REFERENCES plt_allocations (id),
  transfer_reason TEXT,
  source          TEXT    NOT NULL DEFAULT 'OWN' CHECK (source IN ('OWN', 'HIRE')),
  from_date       TEXT    NOT NULL,
  to_date         TEXT    NOT NULL,
  internal_rate   INTEGER NOT NULL DEFAULT 0 CHECK (internal_rate >= 0),
  charge_basis      TEXT    NOT NULL DEFAULT 'DAY' CHECK (charge_basis IN ('HOUR', 'DAY', 'MONTH')),
  estimated_amount INTEGER NOT NULL DEFAULT 0 CHECK (estimated_amount >= 0),
  phase           TEXT    NOT NULL DEFAULT 'PLANNED' CHECK (phase IN ('PLANNED', 'IN_TRANSIT', 'ON_SITE', 'RELEASED')),
  vehicle_no      TEXT,
  trailer_no      TEXT,
  driver_name     TEXT,
  gate_pass_id    INTEGER REFERENCES inv_gate_passes (id),
  dispatched_on   TEXT,
  dispatch_meter  INTEGER CHECK (dispatch_meter IS NULL OR dispatch_meter >= 0),
  arrived_on      TEXT,
  arrival_meter   INTEGER CHECK (arrival_meter IS NULL OR arrival_meter >= 0),
  arrival_checklist_json TEXT NOT NULL DEFAULT '[]',
  departed_on     TEXT,
  departure_meter INTEGER CHECK (departure_meter IS NULL OR departure_meter >= 0),
  demob_note      TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
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
  remarks     TEXT,
  CHECK (to_date >= from_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_alloc_doc ON plt_allocations (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_plt_alloc_eq ON plt_allocations (equipment_id, from_date, to_date);
CREATE INDEX IF NOT EXISTS ix_plt_alloc_project ON plt_allocations (org_project_id);
CREATE INDEX IF NOT EXISTS ix_plt_alloc_site ON plt_allocations (org_site_id);
CREATE INDEX IF NOT EXISTS ix_plt_alloc_req ON plt_allocations (requisition_id);
CREATE INDEX IF NOT EXISTS ix_plt_alloc_from ON plt_allocations (transfer_from_id);
CREATE INDEX IF NOT EXISTS ix_plt_alloc_gate ON plt_allocations (gate_pass_id);
CREATE INDEX IF NOT EXISTS ix_plt_alloc_list ON plt_allocations (company_id, status, phase);

CREATE TABLE IF NOT EXISTS plt_operator_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  equipment_id    INTEGER NOT NULL REFERENCES plt_equipment (id),
  allocation_id   INTEGER REFERENCES plt_allocations (id),
  person_type     TEXT    NOT NULL CHECK (person_type IN ('EMPLOYEE', 'WORKER')),
  person_id       INTEGER NOT NULL,
  person_name     TEXT    NOT NULL,
  shift           TEXT    NOT NULL DEFAULT 'GENERAL' CHECK (shift IN ('GENERAL', 'DAY', 'NIGHT')),
  from_date       TEXT    NOT NULL,
  to_date         TEXT    NOT NULL,
  cert_types_json TEXT    NOT NULL DEFAULT '[]',
  assign_status   TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (assign_status IN ('ACTIVE', 'ENDED')),
  ended_reason    TEXT,
  assigned_by     TEXT    NOT NULL,
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
  CHECK (to_date >= from_date)
);
CREATE INDEX IF NOT EXISTS ix_plt_op_eq ON plt_operator_assignments (equipment_id, assign_status, from_date, to_date);
CREATE INDEX IF NOT EXISTS ix_plt_op_alloc ON plt_operator_assignments (allocation_id);
CREATE INDEX IF NOT EXISTS ix_plt_op_person ON plt_operator_assignments (company_id, person_type, person_id, assign_status);
