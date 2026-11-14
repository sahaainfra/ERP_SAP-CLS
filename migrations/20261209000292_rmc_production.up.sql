-- Part 20.02: concrete requisitions (approval-controlled, with the plant's schedule on them), batch records with actual weights, delivery tickets (approval-controlled) and the silo ledger; quantities of concrete in thousandths of m3, weights in thousandths of kg.
CREATE TABLE IF NOT EXISTS bp_requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  pour_card_id    INTEGER REFERENCES qa_pour_cards (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  location_text   TEXT,
  grade           TEXT    NOT NULL CHECK (grade IN ('M10', 'M15', 'M20', 'M25', 'M30', 'M35', 'M40', 'M45', 'M50', 'M55', 'M60')),
  qty_milli       INTEGER NOT NULL CHECK (qty_milli > 0),
  required_at     TEXT    NOT NULL,
  pump_required   INTEGER NOT NULL DEFAULT 0 CHECK (pump_required IN (0, 1)),
  slump_mm        INTEGER CHECK (slump_mm IS NULL OR slump_mm BETWEEN 0 AND 300),
  plant_id        INTEGER REFERENCES bp_plants (id),
  mix_design_id   INTEGER REFERENCES bp_mix_designs (id),
  supplier_id     INTEGER REFERENCES mdm_partners (id),
  slot_from       TEXT,
  slot_to         TEXT,
  scheduled_by    TEXT,
  scheduled_at    TEXT,
  prod_status     TEXT    NOT NULL DEFAULT 'PENDING' CHECK (prod_status IN ('PENDING', 'SCHEDULED', 'IN_PROGRESS', 'FULFILLED', 'CLOSED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_req_doc ON bp_requisitions (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_bp_requisitions_org_project_id ON bp_requisitions (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bp_requisitions_org_site_id ON bp_requisitions (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bp_requisitions_pour_card_id ON bp_requisitions (pour_card_id);
CREATE INDEX IF NOT EXISTS ix_bp_requisitions_location_id ON bp_requisitions (location_id);
CREATE INDEX IF NOT EXISTS ix_bp_requisitions_plant_id ON bp_requisitions (plant_id);
CREATE INDEX IF NOT EXISTS ix_bp_requisitions_mix_design_id ON bp_requisitions (mix_design_id);
CREATE INDEX IF NOT EXISTS ix_bp_requisitions_supplier_id ON bp_requisitions (supplier_id);
CREATE INDEX IF NOT EXISTS ix_bp_req_board ON bp_requisitions (company_id, prod_status, required_at);
CREATE TABLE IF NOT EXISTS bp_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  batch_ref       TEXT,
  plant_id        INTEGER NOT NULL REFERENCES bp_plants (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  requisition_id  INTEGER REFERENCES bp_requisitions (id),
  mix_design_id   INTEGER NOT NULL REFERENCES bp_mix_designs (id),
  grade           TEXT    NOT NULL,
  batch_time      TEXT    NOT NULL,
  qty_milli       INTEGER NOT NULL CHECK (qty_milli > 0),
  actual_weights_json TEXT NOT NULL DEFAULT '[]',
  theoretical_json TEXT   NOT NULL DEFAULT '[]',
  max_variance_bp INTEGER NOT NULL DEFAULT 0,
  variance_flag   INTEGER NOT NULL DEFAULT 0 CHECK (variance_flag IN (0, 1)),
  origin          TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (origin IN ('MANUAL', 'SCADA')),
  batch_status    TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (batch_status IN ('ACTIVE', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_batch_doc ON bp_batches (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_batch_ref ON bp_batches (plant_id, batch_ref) WHERE batch_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_bp_batches_org_project_id ON bp_batches (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bp_batches_org_site_id ON bp_batches (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bp_batches_requisition_id ON bp_batches (requisition_id);
CREATE INDEX IF NOT EXISTS ix_bp_batches_mix_design_id ON bp_batches (mix_design_id);
CREATE INDEX IF NOT EXISTS ix_bp_batch_time ON bp_batches (plant_id, batch_time);
CREATE TABLE IF NOT EXISTS bp_delivery_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  ticket_no       TEXT    NOT NULL COLLATE NOCASE,
  qr_code         TEXT    NOT NULL,
  requisition_id  INTEGER NOT NULL REFERENCES bp_requisitions (id),
  plant_id        INTEGER REFERENCES bp_plants (id),
  supplier_id     INTEGER REFERENCES mdm_partners (id),
  batch_id        INTEGER REFERENCES bp_batches (id),
  mix_design_id   INTEGER REFERENCES bp_mix_designs (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  grade           TEXT    NOT NULL,
  qty_milli       INTEGER NOT NULL CHECK (qty_milli > 0),
  truck_no        TEXT    NOT NULL,
  driver          TEXT,
  driver_phone    TEXT,
  batched_at      TEXT,
  departed_at     TEXT,
  arrived_at      TEXT,
  unload_start    TEXT,
  unload_end      TEXT,
  slump_mm        INTEGER CHECK (slump_mm IS NULL OR slump_mm BETWEEN 0 AND 300),
  temperature_c   INTEGER,
  slump_flag      INTEGER NOT NULL DEFAULT 0 CHECK (slump_flag IN (0, 1)),
  received_by     TEXT,
  returned_milli  INTEGER NOT NULL DEFAULT 0 CHECK (returned_milli >= 0),
  wasted_milli    INTEGER NOT NULL DEFAULT 0 CHECK (wasted_milli >= 0),
  return_reason   TEXT,
  outside_premises INTEGER NOT NULL DEFAULT 0 CHECK (outside_premises IN (0, 1)),
  eway_no         TEXT,
  ticket_state    TEXT    NOT NULL DEFAULT 'DISPATCHED' CHECK (ticket_state IN ('DISPATCHED', 'ARRIVED', 'RECEIVED', 'REJECTED')),
  pour_ticket_id  INTEGER REFERENCES qa_pour_tickets (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_tkt_doc ON bp_delivery_tickets (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bp_tkt_no ON bp_delivery_tickets (company_id, ticket_no);
CREATE INDEX IF NOT EXISTS ix_bp_delivery_tickets_requisition_id ON bp_delivery_tickets (requisition_id);
CREATE INDEX IF NOT EXISTS ix_bp_delivery_tickets_plant_id ON bp_delivery_tickets (plant_id);
CREATE INDEX IF NOT EXISTS ix_bp_delivery_tickets_supplier_id ON bp_delivery_tickets (supplier_id);
CREATE INDEX IF NOT EXISTS ix_bp_delivery_tickets_batch_id ON bp_delivery_tickets (batch_id);
CREATE INDEX IF NOT EXISTS ix_bp_delivery_tickets_mix_design_id ON bp_delivery_tickets (mix_design_id);
CREATE INDEX IF NOT EXISTS ix_bp_delivery_tickets_org_project_id ON bp_delivery_tickets (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bp_delivery_tickets_org_site_id ON bp_delivery_tickets (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bp_delivery_tickets_pour_ticket_id ON bp_delivery_tickets (pour_ticket_id);
CREATE TABLE IF NOT EXISTS bp_silo_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  silo_id         INTEGER NOT NULL REFERENCES bp_silos (id),
  batch_id        INTEGER REFERENCES bp_batches (id),
  delta_milli     INTEGER NOT NULL,
  level_after_milli INTEGER NOT NULL CHECK (level_after_milli >= 0),
  reason          TEXT    NOT NULL,
  moved_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
CREATE INDEX IF NOT EXISTS ix_bp_moves_company ON bp_silo_moves (company_id);
CREATE INDEX IF NOT EXISTS ix_bp_moves_silo ON bp_silo_moves (silo_id, moved_at);
CREATE INDEX IF NOT EXISTS ix_bp_moves_batch ON bp_silo_moves (batch_id);
