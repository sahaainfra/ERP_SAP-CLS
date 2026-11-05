-- Part 06.02: the common reference masters. A row with no company is the system row every company sees; a company's own row with the same key replaces it for that company
-- (for the dated masters: from its own date). effective_from / effective_to give the dates a row applies; row_status PENDING is a statutory change waiting for its approval (change_request_id).
-- Units: mdm_uoms is the master; the calculation engine's core_uoms / core_uom_conversions (01.06) are kept in step by the service (D-042).

CREATE TABLE IF NOT EXISTS mdm_uoms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  name_hi         TEXT,
  category        TEXT    NOT NULL CHECK (category IN ('LENGTH', 'AREA', 'VOLUME', 'WEIGHT', 'COUNT', 'TIME')),
  base_uom        TEXT    NOT NULL,
  factor_to_base  TEXT    NOT NULL CHECK (factor_to_base GLOB '[0-9]*' AND factor_to_base NOT GLOB '*[^0-9.]*'),
  decimals        INTEGER NOT NULL DEFAULT 3 CHECK (decimals BETWEEN 0 AND 6),
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_uoms_key ON mdm_uoms (COALESCE(company_id, 0), code) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_uoms_company ON mdm_uoms (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_uoms_cr ON mdm_uoms (change_request_id);
CREATE INDEX IF NOT EXISTS ix_mdm_uoms_category ON mdm_uoms (category);

CREATE TABLE IF NOT EXISTS mdm_gst_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  igst_pct        INTEGER NOT NULL CHECK (igst_pct >= 0),
  cgst_pct        INTEGER NOT NULL CHECK (cgst_pct >= 0),
  sgst_pct        INTEGER NOT NULL CHECK (sgst_pct >= 0),
  cess_pct        INTEGER NOT NULL DEFAULT 0 CHECK (cess_pct >= 0),
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_gst_rates_key ON mdm_gst_rates (COALESCE(company_id, 0), code, effective_from) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_gst_rates_company ON mdm_gst_rates (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_gst_rates_cr ON mdm_gst_rates (change_request_id);

CREATE TABLE IF NOT EXISTS mdm_hsn_sac (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  code_type       TEXT    NOT NULL CHECK (code_type IN ('HSN', 'SAC')),
  description     TEXT    NOT NULL,
  default_gst_rate TEXT   NOT NULL,
  reverse_charge  INTEGER NOT NULL DEFAULT 0 CHECK (reverse_charge IN (0, 1)),
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_hsn_sac_key ON mdm_hsn_sac (COALESCE(company_id, 0), code, effective_from) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_hsn_sac_company ON mdm_hsn_sac (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_hsn_sac_cr ON mdm_hsn_sac (change_request_id);
CREATE INDEX IF NOT EXISTS ix_mdm_hsn_sac_code_type ON mdm_hsn_sac (code_type);

CREATE TABLE IF NOT EXISTS mdm_tds_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  section         TEXT    NOT NULL,
  tax_kind        TEXT    NOT NULL DEFAULT 'TDS' CHECK (tax_kind IN ('TDS', 'TCS')),
  description     TEXT    NOT NULL,
  rate_individual INTEGER NOT NULL CHECK (rate_individual >= 0),
  rate_company    INTEGER NOT NULL CHECK (rate_company >= 0),
  threshold_single INTEGER NOT NULL DEFAULT 0 CHECK (threshold_single >= 0),
  threshold_annual INTEGER NOT NULL DEFAULT 0 CHECK (threshold_annual >= 0),
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_tds_sections_key ON mdm_tds_sections (COALESCE(company_id, 0), section, effective_from) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_tds_sections_company ON mdm_tds_sections (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_tds_sections_cr ON mdm_tds_sections (change_request_id);
CREATE INDEX IF NOT EXISTS ix_mdm_tds_sections_tax_kind ON mdm_tds_sections (tax_kind);

CREATE TABLE IF NOT EXISTS mdm_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  gst_code        TEXT    NOT NULL CHECK (length(gst_code) = 2),
  name            TEXT    NOT NULL,
  name_hi         TEXT,
  is_ut           INTEGER NOT NULL DEFAULT 0 CHECK (is_ut IN (0, 1)),
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_states_key ON mdm_states (COALESCE(company_id, 0), code) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_states_company ON mdm_states (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_states_cr ON mdm_states (change_request_id);
CREATE INDEX IF NOT EXISTS ix_mdm_states_gst_code ON mdm_states (gst_code);

CREATE TABLE IF NOT EXISTS mdm_districts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  state_code      TEXT    NOT NULL,
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  name_hi         TEXT,
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_districts_key ON mdm_districts (COALESCE(company_id, 0), state_code, code) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_districts_company ON mdm_districts (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_districts_cr ON mdm_districts (change_request_id);
CREATE INDEX IF NOT EXISTS ix_mdm_districts_state_code ON mdm_districts (state_code);

CREATE TABLE IF NOT EXISTS mdm_currencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  code            TEXT    NOT NULL CHECK (length(code) = 3),
  name            TEXT    NOT NULL,
  symbol          TEXT    NOT NULL,
  decimals        INTEGER NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 4),
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_currencies_key ON mdm_currencies (COALESCE(company_id, 0), code) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_currencies_company ON mdm_currencies (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_currencies_cr ON mdm_currencies (change_request_id);

CREATE TABLE IF NOT EXISTS mdm_exchange_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  currency_code   TEXT    NOT NULL,
  rate_date       TEXT    NOT NULL,
  rate_to_inr     INTEGER NOT NULL CHECK (rate_to_inr > 0),
  rate_source     TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (rate_source IN ('MANUAL', 'FEED', 'IMPORT')),
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_exchange_rates_key ON mdm_exchange_rates (COALESCE(company_id, 0), currency_code, rate_date) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_exchange_rates_company ON mdm_exchange_rates (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_exchange_rates_cr ON mdm_exchange_rates (change_request_id);
CREATE INDEX IF NOT EXISTS ix_mdm_exchange_rates_rate_date ON mdm_exchange_rates (rate_date);

CREATE TABLE IF NOT EXISTS mdm_banks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  bank_name       TEXT    NOT NULL,
  ifsc            TEXT    NOT NULL CHECK (length(ifsc) = 11),
  branch          TEXT    NOT NULL,
  city            TEXT,
  state_name      TEXT,
  address         TEXT,
  micr            TEXT,
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_banks_key ON mdm_banks (COALESCE(company_id, 0), ifsc) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_banks_company ON mdm_banks (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_banks_cr ON mdm_banks (change_request_id);
CREATE INDEX IF NOT EXISTS ix_mdm_banks_bank_name ON mdm_banks (bank_name);

CREATE TABLE IF NOT EXISTS mdm_payment_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  term_kind       TEXT    NOT NULL CHECK (term_kind IN ('PAYMENT', 'DELIVERY', 'INCOTERM')),
  description     TEXT    NOT NULL,
  advance_pct     INTEGER NOT NULL DEFAULT 0 CHECK (advance_pct BETWEEN 0 AND 1000000),
  credit_days     INTEGER NOT NULL DEFAULT 0 CHECK (credit_days >= 0),
  structure_json  TEXT    NOT NULL DEFAULT '[]',
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_payment_terms_key ON mdm_payment_terms (COALESCE(company_id, 0), code) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_payment_terms_company ON mdm_payment_terms (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_payment_terms_cr ON mdm_payment_terms (change_request_id);
CREATE INDEX IF NOT EXISTS ix_mdm_payment_terms_term_kind ON mdm_payment_terms (term_kind);

CREATE TABLE IF NOT EXISTS mdm_lookup_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  name_hi         TEXT,
  system_list     INTEGER NOT NULL DEFAULT 0 CHECK (system_list IN (0, 1)),
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_lookup_lists_key ON mdm_lookup_lists (COALESCE(company_id, 0), code) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_lookup_lists_company ON mdm_lookup_lists (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_lookup_lists_cr ON mdm_lookup_lists (change_request_id);

CREATE TABLE IF NOT EXISTS mdm_lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  list_code       TEXT    NOT NULL,
  code            TEXT    NOT NULL,
  label_en        TEXT    NOT NULL,
  label_hi        TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_lookups_key ON mdm_lookups (COALESCE(company_id, 0), list_code, code) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_lookups_company ON mdm_lookups (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_lookups_cr ON mdm_lookups (change_request_id);
CREATE INDEX IF NOT EXISTS ix_mdm_lookups_list_code ON mdm_lookups (list_code);
