-- Part 16.02: gate control. Delivery appointments, inbound gate entries (with PO validation), weighments and outbound gate passes.
-- Weights are kilograms in thousandths; percentages are x10000 (1.5% = 15000); a variance can be negative.
CREATE TABLE IF NOT EXISTS inv_gate_appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  expected_on     TEXT    NOT NULL,
  expected_slot   TEXT,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  po_id           INTEGER REFERENCES proc_purchase_orders (id),
  shipment_id     INTEGER REFERENCES xpd_shipments (id),
  vehicle_no      TEXT,
  driver_name     TEXT,
  driver_phone    TEXT,
  material_desc   TEXT,
  status          TEXT    NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'ARRIVED', 'MISSED', 'CANCELLED')),
  cancel_reason   TEXT,
  requested_by    TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_gapp_doc ON inv_gate_appointments (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_gapp_list ON inv_gate_appointments (company_id, status, expected_on);
CREATE INDEX IF NOT EXISTS ix_inv_gapp_project ON inv_gate_appointments (org_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_gapp_site ON inv_gate_appointments (org_site_id);
CREATE INDEX IF NOT EXISTS ix_inv_gapp_vendor ON inv_gate_appointments (vendor_id);
CREATE INDEX IF NOT EXISTS ix_inv_gapp_po ON inv_gate_appointments (po_id);
CREATE INDEX IF NOT EXISTS ix_inv_gapp_shipment ON inv_gate_appointments (shipment_id);

CREATE TABLE IF NOT EXISTS inv_gate_inward (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  entry_date      TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  appointment_id  INTEGER REFERENCES inv_gate_appointments (id),
  vehicle_no      TEXT    NOT NULL,
  driver_name     TEXT    NOT NULL,
  driver_phone    TEXT,
  transporter     TEXT,
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  po_id           INTEGER REFERENCES proc_purchase_orders (id),
  shipment_id     INTEGER REFERENCES xpd_shipments (id),
  challan_no      TEXT,
  challan_date    TEXT,
  challan_kg      INTEGER CHECK (challan_kg IS NULL OR challan_kg > 0),
  eway_bill_no    TEXT,
  material_desc   TEXT    NOT NULL,
  time_in         TEXT,
  time_out        TEXT,
  unloading_store_id INTEGER REFERENCES inv_stores (id),
  unloading_note  TEXT,
  unexpected      INTEGER NOT NULL DEFAULT 0 CHECK (unexpected IN (0, 1)),
  unexpected_why  TEXT,
  flags_json      TEXT    NOT NULL DEFAULT '[]',
  photos_json     TEXT    NOT NULL DEFAULT '[]',
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'AT_GATE', 'UNLOADING', 'HANDED_OVER', 'EXITED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  amendment_no    INTEGER NOT NULL DEFAULT 0 CHECK (amendment_no >= 0),
  requested_by    TEXT    NOT NULL,
  approved_by     TEXT,
  approved_at     TEXT,
  handed_over_by  TEXT,
  handed_over_at  TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_gin_doc ON inv_gate_inward (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_gin_list ON inv_gate_inward (company_id, status, entry_date);
CREATE INDEX IF NOT EXISTS ix_inv_gin_project ON inv_gate_inward (org_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_gin_site ON inv_gate_inward (org_site_id, status);
CREATE INDEX IF NOT EXISTS ix_inv_gin_appt ON inv_gate_inward (appointment_id);
CREATE INDEX IF NOT EXISTS ix_inv_gin_vendor ON inv_gate_inward (vendor_id);
CREATE INDEX IF NOT EXISTS ix_inv_gin_po ON inv_gate_inward (po_id);
CREATE INDEX IF NOT EXISTS ix_inv_gin_shipment ON inv_gate_inward (shipment_id);
CREATE INDEX IF NOT EXISTS ix_inv_gin_store ON inv_gate_inward (unloading_store_id);
CREATE INDEX IF NOT EXISTS ix_inv_gin_vehicle ON inv_gate_inward (company_id, vehicle_no);

CREATE TABLE IF NOT EXISTS inv_gate_weighments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  inward_id       INTEGER NOT NULL REFERENCES inv_gate_inward (id),
  gross_kg        INTEGER CHECK (gross_kg IS NULL OR gross_kg > 0),
  tare_kg         INTEGER CHECK (tare_kg IS NULL OR tare_kg > 0),
  net_kg          INTEGER CHECK (net_kg IS NULL OR net_kg > 0),
  challan_kg      INTEGER,
  variance_pct    INTEGER,
  tolerance_pct   INTEGER NOT NULL DEFAULT 0 CHECK (tolerance_pct >= 0),
  flagged         INTEGER NOT NULL DEFAULT 0 CHECK (flagged IN (0, 1)),
  weigh_source    TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (weigh_source IN ('MANUAL', 'DEVICE')),
  device_ref      TEXT,
  slip_file_id    INTEGER REFERENCES core_files (id),
  weighed_by      TEXT    NOT NULL,
  weighed_at      TEXT    NOT NULL,
  superseded      INTEGER NOT NULL DEFAULT 0 CHECK (superseded IN (0, 1)),
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
CREATE INDEX IF NOT EXISTS ix_inv_gwt_inward ON inv_gate_weighments (inward_id, superseded);
CREATE INDEX IF NOT EXISTS ix_inv_gwt_slip ON inv_gate_weighments (slip_file_id);
CREATE INDEX IF NOT EXISTS ix_inv_gwt_flag ON inv_gate_weighments (company_id, flagged);

CREATE TABLE IF NOT EXISTS inv_gate_passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  pass_date       TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  pass_type       TEXT    NOT NULL CHECK (pass_type IN ('RETURNABLE', 'NON_RETURNABLE', 'SCRAP', 'VENDOR_RETURN')),
  returnable      INTEGER NOT NULL DEFAULT 0 CHECK (returnable IN (0, 1)),
  expected_return TEXT,
  items_json      TEXT    NOT NULL DEFAULT '[]',
  reference_type  TEXT,
  reference_id    TEXT,
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  vehicle_no      TEXT,
  driver_name     TEXT,
  destination     TEXT    NOT NULL,
  purpose         TEXT    NOT NULL,
  qr_code         TEXT    NOT NULL,
  time_out        TEXT,
  verified_by     TEXT,
  returned_on     TEXT,
  returned_note   TEXT,
  overdue_notified_on TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'OUT', 'CLOSED')),
  workflow_instance_id INTEGER,
  amendment_no    INTEGER NOT NULL DEFAULT 0 CHECK (amendment_no >= 0),
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
  CHECK (returnable = (pass_type = 'RETURNABLE')),
  CHECK (returnable = 0 OR expected_return IS NOT NULL OR status = 'DRAFT')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_gps_doc ON inv_gate_passes (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_gps_qr ON inv_gate_passes (qr_code);
CREATE INDEX IF NOT EXISTS ix_inv_gps_list ON inv_gate_passes (company_id, status, pass_date);
CREATE INDEX IF NOT EXISTS ix_inv_gps_project ON inv_gate_passes (org_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_gps_site ON inv_gate_passes (org_site_id, status);
CREATE INDEX IF NOT EXISTS ix_inv_gps_vendor ON inv_gate_passes (vendor_id);
CREATE INDEX IF NOT EXISTS ix_inv_gps_overdue ON inv_gate_passes (company_id, returnable, status, expected_return);
