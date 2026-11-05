-- Part 06.06: the rate analysis engine and the schedule of rates library. ra_resource_rates: the rate of a material, labour trade, equipment or transport item by region, project and date, with
-- where it came from (quotation, market survey, DSR, last PO); ra_sor_books / ra_sor_items: schedules of rates (CPWD DSR, state PWD, client SORs) in editions; ra_analyses: the analysed unit rate of a
-- work item in versions (a released version is never changed; a change is a new version), with its add-ons and the SOR item it is compared with; ra_analysis_lines: its components. Rates, amounts,
-- quantities and percentages are integers in minor units (ADR-14): rate 4 places, money 2, quantity 3, percent 4.

CREATE TABLE IF NOT EXISTS ra_resource_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  region_code     TEXT,
  rate            INTEGER NOT NULL CHECK (rate >= 0),
  uom             TEXT    NOT NULL,
  source_kind     TEXT    NOT NULL CHECK (source_kind IN ('QUOTATION', 'MARKET_SURVEY', 'DSR', 'LAST_PO', 'OTHER')),
  basis_ref       TEXT,
  effective_from  TEXT    NOT NULL,
  effective_to    TEXT,
  entry_status    TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (entry_status IN ('ACTIVE', 'RETIRED')),
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
CREATE INDEX IF NOT EXISTS ix_ra_resource_rates_item ON ra_resource_rates (item_id, effective_from);
CREATE INDEX IF NOT EXISTS ix_ra_resource_rates_list ON ra_resource_rates (company_id, entry_status, region_code);
CREATE INDEX IF NOT EXISTS ix_ra_resource_rates_project ON ra_resource_rates (project_id);

CREATE TABLE IF NOT EXISTS ra_sor_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  edition         INTEGER NOT NULL DEFAULT 1 CHECK (edition >= 1),
  name            TEXT    NOT NULL,
  authority       TEXT    NOT NULL CHECK (authority IN ('CPWD', 'STATE_PWD', 'CLIENT', 'OTHER')),
  book_year       INTEGER NOT NULL CHECK (book_year BETWEEN 1990 AND 2100),
  region_code     TEXT,
  book_status     TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (book_status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  supersedes_id   INTEGER REFERENCES ra_sor_books (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ra_sor_books_code ON ra_sor_books (company_id, code, edition) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ra_sor_books_list ON ra_sor_books (company_id, book_status);
CREATE INDEX IF NOT EXISTS ix_ra_sor_books_supersedes ON ra_sor_books (supersedes_id);

CREATE TABLE IF NOT EXISTS ra_sor_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  book_id         INTEGER NOT NULL REFERENCES ra_sor_books (id),
  item_code       TEXT    NOT NULL,
  parent_code     TEXT,
  description     TEXT    NOT NULL,
  uom             TEXT,
  rate            INTEGER CHECK (rate IS NULL OR rate >= 0),
  sort_order      INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ra_sor_items_code ON ra_sor_items (book_id, item_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ra_sor_items_company ON ra_sor_items (company_id, item_code);

CREATE TABLE IF NOT EXISTS ra_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  analysis_no     TEXT    NOT NULL,
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  work_item_id    INTEGER NOT NULL REFERENCES mdm_items (id),
  title           TEXT    NOT NULL,
  scope           TEXT    NOT NULL DEFAULT 'STANDARD' CHECK (scope IN ('STANDARD', 'PROJECT', 'VARIATION')),
  region_code     TEXT,
  basis_qty       INTEGER NOT NULL CHECK (basis_qty > 0),
  basis_uom       TEXT    NOT NULL,
  water_pct       INTEGER NOT NULL DEFAULT 0 CHECK (water_pct >= 0),
  overhead_pct    INTEGER NOT NULL DEFAULT 0 CHECK (overhead_pct >= 0),
  profit_pct      INTEGER NOT NULL DEFAULT 0 CHECK (profit_pct >= 0),
  contingency_pct INTEGER NOT NULL DEFAULT 0 CHECK (contingency_pct >= 0),
  insurance_pct   INTEGER NOT NULL DEFAULT 0 CHECK (insurance_pct >= 0),
  escalation_pct  INTEGER NOT NULL DEFAULT 0 CHECK (escalation_pct >= 0),
  gst_pct         INTEGER NOT NULL DEFAULT 0 CHECK (gst_pct >= 0),
  gst_treatment   TEXT    NOT NULL DEFAULT 'EXCLUDED' CHECK (gst_treatment IN ('EXCLUDED', 'ADDED')),
  direct_cost     INTEGER NOT NULL DEFAULT 0 CHECK (direct_cost >= 0),
  unit_rate       INTEGER NOT NULL DEFAULT 0 CHECK (unit_rate >= 0),
  unit_rate_gross INTEGER NOT NULL DEFAULT 0 CHECK (unit_rate_gross >= 0),
  breakdown_json  TEXT    NOT NULL DEFAULT '{}',
  formulas_json   TEXT    NOT NULL DEFAULT '{}',
  sor_item_id     INTEGER REFERENCES ra_sor_items (id),
  analysis_status TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (analysis_status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  effective_from  TEXT    NOT NULL,
  effective_to    TEXT,
  supersedes_id   INTEGER REFERENCES ra_analyses (id),
  template_code   TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  released_by     TEXT,
  released_at     TEXT,
  calculated_at   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ra_analyses_no ON ra_analyses (company_id, analysis_no, version_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ra_analyses_list ON ra_analyses (company_id, analysis_status, scope);
CREATE INDEX IF NOT EXISTS ix_ra_analyses_item ON ra_analyses (work_item_id);
CREATE INDEX IF NOT EXISTS ix_ra_analyses_sor ON ra_analyses (sor_item_id);
CREATE INDEX IF NOT EXISTS ix_ra_analyses_supersedes ON ra_analyses (supersedes_id);
CREATE INDEX IF NOT EXISTS ix_ra_analyses_project ON ra_analyses (project_id);

CREATE TABLE IF NOT EXISTS ra_analysis_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  analysis_id     INTEGER NOT NULL REFERENCES ra_analyses (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  component_type  TEXT    NOT NULL CHECK (component_type IN ('MATERIAL', 'LABOUR', 'EQUIPMENT', 'TRANSPORT', 'SUBCONTRACT', 'OTHER')),
  component_item_id INTEGER REFERENCES mdm_items (id),
  description     TEXT    NOT NULL,
  uom             TEXT    NOT NULL,
  qty_per_basis   INTEGER NOT NULL CHECK (qty_per_basis >= 0),
  wastage_pct     INTEGER NOT NULL DEFAULT 0 CHECK (wastage_pct >= 0),
  rate            INTEGER NOT NULL DEFAULT 0 CHECK (rate >= 0),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  line_origin    TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (line_origin IN ('LIBRARY', 'MANUAL')),
  resource_rate_id INTEGER REFERENCES ra_resource_rates (id),
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
CREATE INDEX IF NOT EXISTS ix_ra_analysis_lines_analysis ON ra_analysis_lines (analysis_id, line_no);
CREATE INDEX IF NOT EXISTS ix_ra_analysis_lines_item ON ra_analysis_lines (component_item_id);
CREATE INDEX IF NOT EXISTS ix_ra_analysis_lines_rate ON ra_analysis_lines (resource_rate_id);
CREATE INDEX IF NOT EXISTS ix_ra_analysis_lines_company ON ra_analysis_lines (company_id);
