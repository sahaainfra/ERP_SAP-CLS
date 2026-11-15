-- Part 22.02: deviation statements (approval-controlled), the forecast quantity of a BOQ item (the only quantity typed in the reconciliation) and the register of extra and substituted items.
CREATE TABLE IF NOT EXISTS bill_deviation_statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  ds_no           TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  contract_id     INTEGER REFERENCES ctr_contracts (id),
  period          TEXT    NOT NULL,
  threshold_bp    INTEGER NOT NULL CHECK (threshold_bp BETWEEN 0 AND 100000),
  items_json      TEXT    NOT NULL DEFAULT '[]',
  item_count      INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  over_count      INTEGER NOT NULL DEFAULT 0 CHECK (over_count >= 0),
  under_count     INTEGER NOT NULL DEFAULT 0 CHECK (under_count >= 0),
  net_effect_paise INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  client_state    TEXT    NOT NULL DEFAULT 'NOT_SENT' CHECK (client_state IN ('NOT_SENT', 'SENT', 'ACCEPTED', 'REJECTED')),
  sent_on         TEXT,
  client_ref      TEXT,
  responded_on    TEXT,
  outcome         TEXT    NOT NULL DEFAULT 'NONE' CHECK (outcome IN ('NONE', 'VARIATION', 'RATE_REVISION')),
  cr_id           INTEGER REFERENCES ctr_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_ds_doc ON bill_deviation_statements (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_ds_no ON bill_deviation_statements (company_id, org_project_id, ds_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bill_deviation_statements_org_project_id ON bill_deviation_statements (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_deviation_statements_org_site_id ON bill_deviation_statements (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bill_deviation_statements_contract_id ON bill_deviation_statements (contract_id);
CREATE INDEX IF NOT EXISTS ix_bill_deviation_statements_cr_id ON bill_deviation_statements (cr_id);
CREATE INDEX IF NOT EXISTS ix_bill_ds_status ON bill_deviation_statements (company_id, org_project_id, status, period);

CREATE TABLE IF NOT EXISTS bill_qty_forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  item_code       TEXT    NOT NULL COLLATE NOCASE,
  boq_line_id     INTEGER NOT NULL REFERENCES proj_boq_lines (id),
  forecast_qty_th INTEGER NOT NULL CHECK (forecast_qty_th >= 0),
  basis           TEXT    NOT NULL,
  updated_on      TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_fc_item ON bill_qty_forecasts (company_id, org_project_id, item_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bill_qty_forecasts_org_project_id ON bill_qty_forecasts (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_qty_forecasts_boq_line_id ON bill_qty_forecasts (boq_line_id);

CREATE TABLE IF NOT EXISTS bill_extra_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  kind            TEXT    NOT NULL CHECK (kind IN ('EXTRA', 'SUBSTITUTE')),
  description     TEXT    NOT NULL,
  uom             TEXT    NOT NULL,
  provisional_qty_th INTEGER NOT NULL CHECK (provisional_qty_th > 0),
  provisional_rate_x4 INTEGER NOT NULL DEFAULT 0 CHECK (provisional_rate_x4 >= 0),
  substitutes_boq_line_id INTEGER REFERENCES proj_boq_lines (id),
  reason          TEXT    NOT NULL,
  instruction_ref TEXT,
  ds_id           INTEGER REFERENCES bill_deviation_statements (id),
  cr_id           INTEGER REFERENCES ctr_change_requests (id),
  decision_state  TEXT    NOT NULL DEFAULT 'PENDING' CHECK (decision_state IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  decided_by      TEXT,
  decided_on      TEXT,
  decision_ref    TEXT,
  decision_note   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_xi_doc ON bill_extra_items (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_bill_extra_items_org_project_id ON bill_extra_items (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_extra_items_org_site_id ON bill_extra_items (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bill_extra_items_substitutes_boq_line_id ON bill_extra_items (substitutes_boq_line_id);
CREATE INDEX IF NOT EXISTS ix_bill_extra_items_ds_id ON bill_extra_items (ds_id);
CREATE INDEX IF NOT EXISTS ix_bill_extra_items_cr_id ON bill_extra_items (cr_id);
CREATE INDEX IF NOT EXISTS ix_bill_xi_state ON bill_extra_items (company_id, org_project_id, decision_state);
