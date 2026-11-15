-- Part 22.05: the joint measurement of the work of a subcontractor against the items of its work order, the subcontractor bill (approval-controlled) with its items, and the claims that stop a recovery of another module being deducted twice.
CREATE TABLE IF NOT EXISTS bill_sub_measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  wo_id           INTEGER NOT NULL REFERENCES ctr_work_orders (id),
  subcontractor_id INTEGER NOT NULL REFERENCES mdm_partners (id),
  wo_item_id      INTEGER NOT NULL REFERENCES ctr_wo_items (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  description     TEXT    NOT NULL,
  template        TEXT    NOT NULL DEFAULT 'QTY' CHECK (template IN ('QTY', 'NOS', 'LENGTH', 'AREA', 'VOLUME')),
  nos_th          INTEGER CHECK (nos_th IS NULL OR nos_th >= 0),
  length_th       INTEGER CHECK (length_th IS NULL OR length_th >= 0),
  breadth_th      INTEGER CHECK (breadth_th IS NULL OR breadth_th >= 0),
  depth_th        INTEGER CHECK (depth_th IS NULL OR depth_th >= 0),
  deduction_th    INTEGER NOT NULL DEFAULT 0 CHECK (deduction_th >= 0),
  qty_th          INTEGER NOT NULL CHECK (qty_th >= 0),
  measured_by     TEXT    NOT NULL,
  measured_on     TEXT    NOT NULL,
  sub_signer      TEXT,
  sub_signed_on   TEXT,
  signature_ref   TEXT,
  sign_method     TEXT    CHECK (sign_method IS NULL OR sign_method IN ('MANUAL', 'OTP', 'PORTAL')),
  verified_by     TEXT,
  verified_on     TEXT,
  bill_id         INTEGER REFERENCES bill_sub_bills (id),
  meas_status     TEXT    NOT NULL DEFAULT 'RECORDED' CHECK (meas_status IN ('RECORDED', 'SIGNED', 'VERIFIED', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_sm_doc ON bill_sub_measurements (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_bill_sub_measurements_company_id ON bill_sub_measurements (company_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_measurements_org_project_id ON bill_sub_measurements (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_measurements_org_site_id ON bill_sub_measurements (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_measurements_wo_id ON bill_sub_measurements (wo_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_measurements_subcontractor_id ON bill_sub_measurements (subcontractor_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_measurements_wo_item_id ON bill_sub_measurements (wo_item_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_measurements_location_id ON bill_sub_measurements (location_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_measurements_bill_id ON bill_sub_measurements (bill_id);
CREATE INDEX IF NOT EXISTS ix_bill_sm_status ON bill_sub_measurements (company_id, wo_id, meas_status);

CREATE TABLE IF NOT EXISTS bill_sub_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  bill_no         TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  wo_id           INTEGER NOT NULL REFERENCES ctr_work_orders (id),
  subcontractor_id INTEGER NOT NULL REFERENCES mdm_partners (id),
  bill_type       TEXT    NOT NULL DEFAULT 'RA' CHECK (bill_type IN ('RA', 'FINAL', 'MILESTONE')),
  seq_no          INTEGER NOT NULL CHECK (seq_no >= 1),
  period_from     TEXT    NOT NULL,
  period_to       TEXT    NOT NULL,
  prev_bill_id    INTEGER REFERENCES bill_sub_bills (id),
  prev_gross_paise INTEGER NOT NULL DEFAULT 0 CHECK (prev_gross_paise >= 0),
  gross_paise     INTEGER NOT NULL DEFAULT 0 CHECK (gross_paise >= 0),
  cum_gross_paise INTEGER NOT NULL DEFAULT 0 CHECK (cum_gross_paise >= 0),
  gst_mode        TEXT    NOT NULL DEFAULT 'FORWARD' CHECK (gst_mode IN ('FORWARD', 'RCM', 'EXEMPT')),
  gst_pct_bp      INTEGER NOT NULL DEFAULT 0 CHECK (gst_pct_bp BETWEEN 0 AND 10000),
  gst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (gst_paise >= 0),
  rcm_paise       INTEGER NOT NULL DEFAULT 0 CHECK (rcm_paise >= 0),
  tds_paise       INTEGER NOT NULL DEFAULT 0 CHECK (tds_paise >= 0),
  manual_json     TEXT    NOT NULL DEFAULT '[]',
  deductions_json TEXT    NOT NULL DEFAULT '[]',
  deductions_paise INTEGER NOT NULL DEFAULT 0 CHECK (deductions_paise >= 0),
  net_paise       INTEGER NOT NULL DEFAULT 0,
  issues_json     TEXT    NOT NULL DEFAULT '[]',
  meas_ids_json   TEXT    NOT NULL DEFAULT '[]',
  compliance_ok   INTEGER NOT NULL DEFAULT 1 CHECK (compliance_ok IN (0, 1)),
  compliance_json TEXT    NOT NULL DEFAULT '[]',
  payable_state   TEXT    NOT NULL DEFAULT 'NOT_POSTED' CHECK (payable_state IN ('NOT_POSTED', 'POSTED')),
  payable_ref     TEXT,
  notes           TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_sb_doc ON bill_sub_bills (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_sb_no ON bill_sub_bills (company_id, bill_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_sb_seq ON bill_sub_bills (wo_id, seq_no) WHERE deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED');
CREATE INDEX IF NOT EXISTS ix_bill_sub_bills_org_project_id ON bill_sub_bills (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_bills_org_site_id ON bill_sub_bills (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_bills_wo_id ON bill_sub_bills (wo_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_bills_subcontractor_id ON bill_sub_bills (subcontractor_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_bills_prev_bill_id ON bill_sub_bills (prev_bill_id);
CREATE INDEX IF NOT EXISTS ix_bill_sb_status ON bill_sub_bills (company_id, org_project_id, status, period_to);

CREATE TABLE IF NOT EXISTS bill_sub_bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  bill_id         INTEGER NOT NULL REFERENCES bill_sub_bills (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  wo_item_id      INTEGER NOT NULL REFERENCES ctr_wo_items (id),
  wo_line_no      INTEGER NOT NULL,
  item_kind       TEXT    NOT NULL DEFAULT 'BOQ',
  description     TEXT    NOT NULL,
  uom             TEXT,
  rate_x4         INTEGER NOT NULL DEFAULT 0 CHECK (rate_x4 >= 0),
  prev_qty_th     INTEGER NOT NULL DEFAULT 0 CHECK (prev_qty_th >= 0),
  this_qty_th     INTEGER NOT NULL DEFAULT 0 CHECK (this_qty_th >= 0),
  cum_qty_th      INTEGER NOT NULL DEFAULT 0 CHECK (cum_qty_th >= 0),
  measured_cum_th INTEGER NOT NULL DEFAULT 0 CHECK (measured_cum_th >= 0),
  client_cert_th  INTEGER,
  prev_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (prev_amount_paise >= 0),
  this_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (this_amount_paise >= 0),
  cum_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (cum_amount_paise >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_sbi_line ON bill_sub_bill_items (bill_id, line_no);
CREATE INDEX IF NOT EXISTS ix_bill_sub_bill_items_company_id ON bill_sub_bill_items (company_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_bill_items_bill_id ON bill_sub_bill_items (bill_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_bill_items_wo_item_id ON bill_sub_bill_items (wo_item_id);

CREATE TABLE IF NOT EXISTS bill_sub_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  bill_id         INTEGER NOT NULL REFERENCES bill_sub_bills (id),
  source_kind     TEXT    NOT NULL CHECK (source_kind IN ('FREE_ISSUE', 'CHARGEABLE', 'FORMWORK', 'NCR', 'SAFETY', 'CAMP')),
  source_ref      TEXT    NOT NULL,
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_sc_src ON bill_sub_claims (company_id, source_kind, source_ref) WHERE active = 1;
CREATE INDEX IF NOT EXISTS ix_bill_sub_claims_company_id ON bill_sub_claims (company_id);
CREATE INDEX IF NOT EXISTS ix_bill_sub_claims_bill_id ON bill_sub_claims (bill_id);
