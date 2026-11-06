-- Part 09.01: the estimate workspace (module est, tables est_*). Amounts are fixed-point integers as in the rate analysis engine (06.06): money in paise (x 100), rates x 10 000, quantities x 1 000, percentages x 10 000.
-- est_estimates: an estimate version of a tender or a project (header, the HO overhead, contingency, escalation and GST percentages, and the totals the calculation engine works out). Versions of one estimate share doc_no.
-- est_estimate_items: the items in sections mirroring the client BOQ, priced from a rate analysis (06.06), a manual build-up (est_item_components) or a typed cost rate, with the markup and the selling rate.
-- est_indirects: the indirect costs sheet (site establishment, staff, camp, temporary works, insurance, BG charges, finance cost, mobilisation). est_risks: the risks whose exposure (impact x probability) is the contingency.
CREATE TABLE IF NOT EXISTS est_estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  title           TEXT    NOT NULL,
  tender_id       INTEGER REFERENCES tdr_tenders (id),
  basis_date      TEXT    NOT NULL,
  region_code     TEXT,
  currency_code   TEXT    NOT NULL DEFAULT 'INR',
  ho_overhead_pct INTEGER NOT NULL DEFAULT 0 CHECK (ho_overhead_pct >= 0),
  contingency_pct INTEGER NOT NULL DEFAULT 0 CHECK (contingency_pct >= 0),
  escalation_pct  INTEGER NOT NULL DEFAULT 0 CHECK (escalation_pct >= 0),
  gst_pct         INTEGER NOT NULL DEFAULT 0 CHECK (gst_pct >= 0),
  direct_cost     INTEGER NOT NULL DEFAULT 0,
  indirect_cost   INTEGER NOT NULL DEFAULT 0,
  overhead_amount INTEGER NOT NULL DEFAULT 0,
  risk_amount     INTEGER NOT NULL DEFAULT 0,
  contingency_amount INTEGER NOT NULL DEFAULT 0,
  escalation_amount INTEGER NOT NULL DEFAULT 0,
  total_cost      INTEGER NOT NULL DEFAULT 0,
  total_selling   INTEGER NOT NULL DEFAULT 0,
  margin_amount   INTEGER NOT NULL DEFAULT 0,
  margin_pct      INTEGER NOT NULL DEFAULT 0,
  gst_amount      INTEGER NOT NULL DEFAULT 0,
  bid_value       INTEGER NOT NULL DEFAULT 0,
  breakdown_json  TEXT,
  calculated_at   TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_at     TEXT,
  supersedes_id   INTEGER REFERENCES est_estimates (id),
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
  CHECK (tender_id IS NOT NULL OR project_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_est_estimates_doc ON est_estimates (company_id, doc_no, version_no);
CREATE INDEX IF NOT EXISTS ix_est_estimates_company_id ON est_estimates (company_id);
CREATE INDEX IF NOT EXISTS ix_est_estimates_status ON est_estimates (company_id, status);
CREATE INDEX IF NOT EXISTS ix_est_estimates_tender ON est_estimates (tender_id);
CREATE INDEX IF NOT EXISTS ix_est_estimates_project ON est_estimates (project_id);
CREATE INDEX IF NOT EXISTS ix_est_estimates_supersedes ON est_estimates (supersedes_id);
CREATE TABLE IF NOT EXISTS est_estimate_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  estimate_id     INTEGER NOT NULL REFERENCES est_estimates (id),
  section_code    TEXT    NOT NULL,
  section_name    TEXT,
  item_no         TEXT    NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  description     TEXT    NOT NULL,
  uom             TEXT    NOT NULL,
  qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  client_rate     INTEGER CHECK (client_rate IS NULL OR client_rate >= 0),
  work_item_id    INTEGER REFERENCES mdm_items (id),
  build_mode      TEXT    NOT NULL DEFAULT 'RATE' CHECK (build_mode IN ('ANALYSIS', 'MANUAL', 'RATE')),
  analysis_id     INTEGER REFERENCES ra_analyses (id),
  cost_rate       INTEGER NOT NULL DEFAULT 0 CHECK (cost_rate >= 0),
  markup_pct      INTEGER NOT NULL DEFAULT 0 CHECK (markup_pct >= 0),
  selling_rate    INTEGER NOT NULL DEFAULT 0 CHECK (selling_rate >= 0),
  cost_amount     INTEGER NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  priced_at       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_est_items_no ON est_estimate_items (estimate_id, item_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_est_estimate_items_company_id ON est_estimate_items (company_id);
CREATE INDEX IF NOT EXISTS ix_est_estimate_items_estimate ON est_estimate_items (estimate_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_est_estimate_items_work_item ON est_estimate_items (work_item_id);
CREATE INDEX IF NOT EXISTS ix_est_estimate_items_analysis ON est_estimate_items (analysis_id);
CREATE TABLE IF NOT EXISTS est_item_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  estimate_item_id INTEGER NOT NULL REFERENCES est_estimate_items (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  component_type  TEXT    NOT NULL CHECK (component_type IN ('MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER')),
  component_item_id INTEGER REFERENCES mdm_items (id),
  description     TEXT    NOT NULL,
  uom             TEXT    NOT NULL,
  qty_per_unit    INTEGER NOT NULL CHECK (qty_per_unit >= 0),
  rate            INTEGER NOT NULL CHECK (rate >= 0),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  line_origin     TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (line_origin IN ('LIBRARY', 'MANUAL')),
  resource_rate_id INTEGER REFERENCES ra_resource_rates (id),
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
CREATE INDEX IF NOT EXISTS ix_est_item_components_company_id ON est_item_components (company_id);
CREATE INDEX IF NOT EXISTS ix_est_item_components_item ON est_item_components (estimate_item_id, line_no);
CREATE INDEX IF NOT EXISTS ix_est_item_components_component ON est_item_components (component_item_id);
CREATE INDEX IF NOT EXISTS ix_est_item_components_rate ON est_item_components (resource_rate_id);
CREATE TABLE IF NOT EXISTS est_indirects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  estimate_id     INTEGER NOT NULL REFERENCES est_estimates (id),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  category        TEXT    NOT NULL CHECK (category IN ('SITE_ESTABLISHMENT', 'STAFF', 'CAMP', 'TEMPORARY_WORKS', 'INSURANCE', 'BG_CHARGES', 'FINANCE_COST', 'MOBILISATION', 'OTHER')),
  description     TEXT    NOT NULL,
  basis           TEXT    NOT NULL DEFAULT 'LUMP_SUM' CHECK (basis IN ('LUMP_SUM', 'QTY_RATE', 'PERCENT')),
  qty             INTEGER CHECK (qty IS NULL OR qty >= 0),
  rate            INTEGER CHECK (rate IS NULL OR rate >= 0),
  percent         INTEGER CHECK (percent IS NULL OR percent >= 0),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
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
CREATE INDEX IF NOT EXISTS ix_est_indirects_company_id ON est_indirects (company_id);
CREATE INDEX IF NOT EXISTS ix_est_indirects_estimate ON est_indirects (estimate_id, sort_order);
CREATE TABLE IF NOT EXISTS est_risks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  estimate_id     INTEGER NOT NULL REFERENCES est_estimates (id),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  description     TEXT    NOT NULL,
  impact          INTEGER NOT NULL CHECK (impact >= 0),
  probability_pct INTEGER NOT NULL CHECK (probability_pct >= 0 AND probability_pct <= 1000000),
  exposure        INTEGER NOT NULL DEFAULT 0 CHECK (exposure >= 0),
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
CREATE INDEX IF NOT EXISTS ix_est_risks_company_id ON est_risks (company_id);
CREATE INDEX IF NOT EXISTS ix_est_risks_estimate ON est_risks (estimate_id, sort_order);
