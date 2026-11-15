-- Part 22.03: the client running-account bill (approval-controlled) with its lines: previous, this bill and cumulative quantities and amounts per BOQ item, extra item and milestone.
CREATE TABLE IF NOT EXISTS bill_client_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  bill_no         TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  contract_id     INTEGER NOT NULL REFERENCES ctr_contracts (id),
  bill_type       TEXT    NOT NULL DEFAULT 'RA' CHECK (bill_type IN ('RA', 'FINAL', 'ESCALATION', 'MILESTONE')),
  seq_no          INTEGER NOT NULL CHECK (seq_no >= 1),
  period_from     TEXT    NOT NULL,
  period_to       TEXT    NOT NULL,
  prev_bill_id    INTEGER REFERENCES bill_client_bills (id),
  supply          TEXT    NOT NULL DEFAULT 'intra' CHECK (supply IN ('intra', 'inter')),
  gst_pct_bp      INTEGER NOT NULL DEFAULT 0 CHECK (gst_pct_bp BETWEEN 0 AND 10000),
  prev_gross_paise INTEGER NOT NULL DEFAULT 0 CHECK (prev_gross_paise >= 0),
  gross_paise     INTEGER NOT NULL DEFAULT 0 CHECK (gross_paise >= 0),
  cum_gross_paise INTEGER NOT NULL DEFAULT 0 CHECK (cum_gross_paise >= 0),
  escalation_paise INTEGER NOT NULL DEFAULT 0,
  escalation_calc_id INTEGER REFERENCES ctr_escalation_calcs (id),
  taxable_paise   INTEGER NOT NULL DEFAULT 0 CHECK (taxable_paise >= 0),
  gst_json        TEXT    NOT NULL DEFAULT '{}',
  gst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (gst_paise >= 0),
  manual_json     TEXT    NOT NULL DEFAULT '[]',
  ld_input_paise  INTEGER NOT NULL DEFAULT 0 CHECK (ld_input_paise >= 0),
  deductions_json TEXT    NOT NULL DEFAULT '[]',
  deductions_paise INTEGER NOT NULL DEFAULT 0 CHECK (deductions_paise >= 0),
  net_paise       INTEGER NOT NULL DEFAULT 0,
  issues_json     TEXT    NOT NULL DEFAULT '[]',
  mb_ids_json     TEXT    NOT NULL DEFAULT '[]',
  client_state    TEXT    NOT NULL DEFAULT 'NOT_SENT' CHECK (client_state IN ('NOT_SENT', 'SENT')),
  sent_on         TEXT,
  client_ref      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_cb_doc ON bill_client_bills (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_cb_no ON bill_client_bills (company_id, bill_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_cb_seq ON bill_client_bills (contract_id, seq_no) WHERE deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED');
CREATE INDEX IF NOT EXISTS ix_bill_client_bills_org_project_id ON bill_client_bills (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_client_bills_org_site_id ON bill_client_bills (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bill_client_bills_contract_id ON bill_client_bills (contract_id);
CREATE INDEX IF NOT EXISTS ix_bill_client_bills_prev_bill_id ON bill_client_bills (prev_bill_id);
CREATE INDEX IF NOT EXISTS ix_bill_client_bills_escalation_calc_id ON bill_client_bills (escalation_calc_id);
CREATE INDEX IF NOT EXISTS ix_bill_cb_status ON bill_client_bills (company_id, org_project_id, status, period_to);

CREATE TABLE IF NOT EXISTS bill_client_bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  bill_id         INTEGER NOT NULL REFERENCES bill_client_bills (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  item_kind       TEXT    NOT NULL DEFAULT 'BOQ' CHECK (item_kind IN ('BOQ', 'EXTRA', 'MILESTONE')),
  boq_line_id     INTEGER REFERENCES proj_boq_lines (id),
  milestone_id    INTEGER REFERENCES ctr_milestones (id),
  item_code       TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  uom             TEXT,
  vo_no           TEXT,
  rate_x4         INTEGER NOT NULL DEFAULT 0 CHECK (rate_x4 >= 0),
  prev_qty_th     INTEGER NOT NULL DEFAULT 0 CHECK (prev_qty_th >= 0),
  this_qty_th     INTEGER NOT NULL DEFAULT 0 CHECK (this_qty_th >= 0),
  cum_qty_th      INTEGER NOT NULL DEFAULT 0 CHECK (cum_qty_th >= 0),
  certified_cum_th INTEGER NOT NULL DEFAULT 0 CHECK (certified_cum_th >= 0),
  prev_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (prev_amount_paise >= 0),
  this_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (this_amount_paise >= 0),
  cum_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (cum_amount_paise >= 0),
  mb_ids_json     TEXT    NOT NULL DEFAULT '[]',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_cbi_line ON bill_client_bill_items (bill_id, line_no);
CREATE INDEX IF NOT EXISTS ix_bill_client_bill_items_company_id ON bill_client_bill_items (company_id);
CREATE INDEX IF NOT EXISTS ix_bill_client_bill_items_bill_id ON bill_client_bill_items (bill_id);
CREATE INDEX IF NOT EXISTS ix_bill_client_bill_items_boq_line_id ON bill_client_bill_items (boq_line_id);
CREATE INDEX IF NOT EXISTS ix_bill_client_bill_items_milestone_id ON bill_client_bill_items (milestone_id);
