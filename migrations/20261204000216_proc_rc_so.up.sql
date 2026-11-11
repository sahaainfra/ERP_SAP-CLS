-- Part 15.06: rate contracts, price variation, service orders and service entry sheets.
-- proc_price_indices: index values by code and month (entered by hand or loaded). proc_rate_contracts / proc_rc_lines: the contract, its rates and ceilings, consumed by call-off orders. proc_rc_revisions: price-variation revisions.
-- proc_service_orders / proc_so_lines: orders for services. proc_service_entries / proc_se_lines: the sheets that certify the services performed. Call-off orders keep the contract in proc_po_rc and proc_po_line_rc.

CREATE TABLE IF NOT EXISTS proc_price_indices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  index_code      TEXT    NOT NULL COLLATE NOCASE,
  period          TEXT    NOT NULL CHECK (length(period) = 7),
  index_value     INTEGER NOT NULL CHECK (index_value > 0),
  index_source    TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (index_source IN ('MANUAL', 'RBI', 'JPC', 'IMPORT')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_price_indices ON proc_price_indices (company_id, index_code, period) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS proc_rate_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  vendor_id       INTEGER NOT NULL REFERENCES mdm_partners (id),
  valid_from      TEXT    NOT NULL,
  valid_to        TEXT    NOT NULL,
  ceiling_value   INTEGER NOT NULL DEFAULT 0 CHECK (ceiling_value >= 0),
  consumed_value  INTEGER NOT NULL DEFAULT 0 CHECK (consumed_value >= 0),
  projects_json   TEXT    NOT NULL DEFAULT '[]',
  regions_json    TEXT    NOT NULL DEFAULT '[]',
  pv_json         TEXT,
  terms           TEXT,
  payment_terms   TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CLOSED', 'CANCELLED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  parent_id       INTEGER REFERENCES proc_rate_contracts (id),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  approved_by     TEXT,
  approved_at     TEXT,
  alerted_80      INTEGER NOT NULL DEFAULT 0 CHECK (alerted_80 IN (0, 1)),
  alerted_100     INTEGER NOT NULL DEFAULT 0 CHECK (alerted_100 IN (0, 1)),
  alerted_expiry  INTEGER NOT NULL DEFAULT 0 CHECK (alerted_expiry IN (0, 1)),
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
  remarks     TEXT,
  CHECK (valid_to >= valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_rc_doc ON proc_rate_contracts (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_proc_rc_company ON proc_rate_contracts (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_rc_vendor ON proc_rate_contracts (vendor_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_rc_valid ON proc_rate_contracts (valid_to);
CREATE INDEX IF NOT EXISTS ix_proc_rc_parent ON proc_rate_contracts (parent_id);

CREATE TABLE IF NOT EXISTS proc_rc_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  rc_id           INTEGER NOT NULL REFERENCES proc_rate_contracts (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  item_id         INTEGER REFERENCES mdm_items (id),
  description     TEXT    NOT NULL,
  uom             TEXT    NOT NULL,
  rate            INTEGER NOT NULL CHECK (rate >= 0),
  base_rate       INTEGER NOT NULL CHECK (base_rate >= 0),
  tax_code        TEXT,
  ceiling_qty     INTEGER NOT NULL DEFAULT 0 CHECK (ceiling_qty >= 0),
  consumed_qty    INTEGER NOT NULL DEFAULT 0 CHECK (consumed_qty >= 0),
  pv_linked       INTEGER NOT NULL DEFAULT 0 CHECK (pv_linked IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_rc_lines ON proc_rc_lines (rc_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proc_rc_lines_company ON proc_rc_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_rc_lines_item ON proc_rc_lines (item_id);

CREATE TABLE IF NOT EXISTS proc_rc_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  rc_id           INTEGER NOT NULL REFERENCES proc_rate_contracts (id),
  revision_no     INTEGER NOT NULL CHECK (revision_no >= 1),
  index_code      TEXT    NOT NULL,
  period          TEXT    NOT NULL,
  index_value     INTEGER NOT NULL CHECK (index_value > 0),
  base_index      INTEGER NOT NULL CHECK (base_index > 0),
  effective_from  TEXT    NOT NULL,
  changes_json    TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_proc_rc_rev_company ON proc_rc_revisions (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_rc_rev_rc ON proc_rc_revisions (rc_id, status);

CREATE TABLE IF NOT EXISTS proc_service_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  so_site_id      INTEGER REFERENCES org_sites (id),
  vendor_id       INTEGER NOT NULL REFERENCES mdm_partners (id),
  title           TEXT    NOT NULL,
  scope           TEXT    NOT NULL,
  deliverables    TEXT,
  start_date      TEXT    NOT NULL,
  end_date        TEXT    NOT NULL,
  payment_terms   TEXT,
  terms           TEXT,
  total_value     INTEGER NOT NULL DEFAULT 0 CHECK (total_value >= 0),
  certified_value INTEGER NOT NULL DEFAULT 0 CHECK (certified_value >= 0),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CLOSED', 'CANCELLED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  parent_id       INTEGER REFERENCES proc_service_orders (id),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  approved_by     TEXT,
  approved_at     TEXT,
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
  remarks     TEXT,
  CHECK (end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_so_doc ON proc_service_orders (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_proc_so_company ON proc_service_orders (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_so_project ON proc_service_orders (org_project_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_so_vendor ON proc_service_orders (vendor_id);
CREATE INDEX IF NOT EXISTS ix_proc_so_site ON proc_service_orders (so_site_id);
CREATE INDEX IF NOT EXISTS ix_proc_so_parent ON proc_service_orders (parent_id);

CREATE TABLE IF NOT EXISTS proc_so_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  so_id           INTEGER NOT NULL REFERENCES proc_service_orders (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  description     TEXT    NOT NULL,
  pricing_kind    TEXT    NOT NULL DEFAULT 'PER_UNIT' CHECK (pricing_kind IN ('LUMP_SUM', 'PER_UNIT', 'PER_MONTH')),
  uom             TEXT    NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  rate            INTEGER NOT NULL CHECK (rate >= 0),
  line_amount     INTEGER NOT NULL DEFAULT 0 CHECK (line_amount >= 0),
  tax_code        TEXT,
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  certified_qty   INTEGER NOT NULL DEFAULT 0 CHECK (certified_qty >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_so_lines ON proc_so_lines (so_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proc_so_lines_company ON proc_so_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_so_lines_wbs ON proc_so_lines (wbs_id);
CREATE INDEX IF NOT EXISTS ix_proc_so_lines_cost_code ON proc_so_lines (cost_code_id);

CREATE TABLE IF NOT EXISTS proc_service_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  so_id           INTEGER NOT NULL REFERENCES proc_service_orders (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  period_from     TEXT    NOT NULL,
  period_to       TEXT    NOT NULL,
  entry_amount    INTEGER NOT NULL DEFAULT 0 CHECK (entry_amount >= 0),
  certified_by    TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CLOSED', 'CANCELLED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  parent_id       INTEGER REFERENCES proc_service_entries (id),
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
  CHECK (period_to >= period_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_se_doc ON proc_service_entries (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_proc_se_company ON proc_service_entries (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_se_so ON proc_service_entries (so_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_se_project ON proc_service_entries (org_project_id);
CREATE INDEX IF NOT EXISTS ix_proc_se_parent ON proc_service_entries (parent_id);

CREATE TABLE IF NOT EXISTS proc_se_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  se_id           INTEGER NOT NULL REFERENCES proc_service_entries (id),
  so_line_id      INTEGER NOT NULL REFERENCES proc_so_lines (id),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  rate            INTEGER NOT NULL CHECK (rate >= 0),
  line_amount     INTEGER NOT NULL DEFAULT 0 CHECK (line_amount >= 0),
  note            TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_se_lines ON proc_se_lines (se_id, so_line_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proc_se_lines_company ON proc_se_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_se_lines_so_line ON proc_se_lines (so_line_id);

-- the call-off link of a purchase order and of its lines (kept apart so the order tables of 15.05 are not altered)
CREATE TABLE IF NOT EXISTS proc_po_rc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  po_id           INTEGER NOT NULL REFERENCES proc_purchase_orders (id),
  rc_id           INTEGER NOT NULL REFERENCES proc_rate_contracts (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_po_rc_po ON proc_po_rc (po_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_rc_company ON proc_po_rc (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_rc_rc ON proc_po_rc (rc_id);

CREATE TABLE IF NOT EXISTS proc_po_line_rc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  po_line_id      INTEGER NOT NULL REFERENCES proc_po_lines (id),
  rc_line_id      INTEGER NOT NULL REFERENCES proc_rc_lines (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_po_line_rc_line ON proc_po_line_rc (po_line_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_line_rc_company ON proc_po_line_rc (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_po_line_rc_rc ON proc_po_line_rc (rc_line_id);
