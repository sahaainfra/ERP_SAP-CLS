-- Formula registry, calculation traces, shadow-run results, units of measure with their conversions, and a sample bill
-- that proves the engine end to end (part 01.06). Versions of a formula are immutable once they leave DRAFT.

CREATE TABLE IF NOT EXISTS core_formulas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER,
  code            TEXT    NOT NULL,
  formula_version INTEGER NOT NULL CHECK (formula_version >= 1),
  description     TEXT    NOT NULL,
  owner_module    TEXT    NOT NULL,
  financial       INTEGER NOT NULL DEFAULT 0 CHECK (financial IN (0, 1)),
  expression      TEXT    NOT NULL,
  inputs_json     TEXT    NOT NULL,
  outputs_json    TEXT    NOT NULL,
  rounding_policy TEXT    NOT NULL DEFAULT 'half_up' CHECK (rounding_policy IN ('half_up', 'bankers', 'down', 'up')),
  tests_json      TEXT    NOT NULL DEFAULT '[]',
  effective_from  TEXT    NOT NULL,
  effective_to    TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SHADOW', 'ACTIVE', 'RETIRED')),
  activated_at    TEXT,
  activated_by    TEXT,
  project_id      INTEGER,
  site_id         INTEGER,
  created_by      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by      TEXT,
  updated_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at      TEXT,
  deleted_by      TEXT,
  source_type     TEXT,
  source_id       TEXT,
  remarks         TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_formulas_code_version ON core_formulas (code, formula_version);
CREATE INDEX IF NOT EXISTS ix_core_formulas_status ON core_formulas (code, status, effective_from);
CREATE INDEX IF NOT EXISTS ix_core_formulas_owner ON core_formulas (owner_module);
CREATE INDEX IF NOT EXISTS ix_core_formulas_company ON core_formulas (company_id, status);

-- BR-02: once a version is more than a draft, what it calculates can never change; make a new version.
CREATE TRIGGER IF NOT EXISTS trg_core_formulas_immutable
BEFORE UPDATE OF code, formula_version, expression, inputs_json, outputs_json, rounding_policy, tests_json, owner_module, financial, effective_from ON core_formulas
WHEN OLD.status <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'A formula version that is no longer a draft cannot be changed: create a new version');
END;

CREATE TABLE IF NOT EXISTS core_calc_traces (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  formula_code  TEXT    NOT NULL,
  formula_version INTEGER NOT NULL,
  entity        TEXT    NOT NULL,
  entity_id     INTEGER NOT NULL,
  field         TEXT    NOT NULL DEFAULT '',
  inputs_json   TEXT    NOT NULL,
  result_json   TEXT    NOT NULL,
  steps_json    TEXT    NOT NULL,
  computed_by   TEXT,
  computed_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_core_calc_traces_entity ON core_calc_traces (company_id, entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_core_calc_traces_formula ON core_calc_traces (formula_code, formula_version, computed_at);

CREATE TABLE IF NOT EXISTS core_calc_shadow_results (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER,
  formula_code      TEXT    NOT NULL,
  baseline_version  INTEGER NOT NULL,
  candidate_version INTEGER NOT NULL,
  inputs_json       TEXT    NOT NULL,
  baseline_json     TEXT    NOT NULL,
  candidate_json    TEXT    NOT NULL,
  differs           INTEGER NOT NULL CHECK (differs IN (0, 1)),
  candidate_error   TEXT,
  computed_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_core_calc_shadow_formula ON core_calc_shadow_results (formula_code, candidate_version, differs);

CREATE TABLE IF NOT EXISTS core_uoms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER,
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  dimension   TEXT    NOT NULL CHECK (dimension IN ('count', 'mass', 'length', 'area', 'volume', 'time', 'other')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_uoms_code ON core_uoms (code);
CREATE INDEX IF NOT EXISTS ix_core_uoms_company ON core_uoms (company_id);

CREATE TABLE IF NOT EXISTS core_uom_conversions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER,
  item_code   TEXT,
  from_uom    TEXT    NOT NULL,
  to_uom      TEXT    NOT NULL,
  factor      TEXT    NOT NULL CHECK (factor GLOB '[0-9]*' AND factor NOT GLOB '*[^0-9.]*'),
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
  CHECK (from_uom <> to_uom)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_uom_conversions_pair ON core_uom_conversions (COALESCE(item_code, ''), from_uom, to_uom) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_core_uom_conversions_item ON core_uom_conversions (item_code);
CREATE INDEX IF NOT EXISTS ix_core_uom_conversions_company ON core_uom_conversions (company_id);

-- A bill that computes its tax through the engine, keeps the formula versions it used and a trace of each computed field.
CREATE TABLE IF NOT EXISTS core_sample_bills (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL,
  title             TEXT    NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity >= 0),
  unit_rate         INTEGER NOT NULL CHECK (unit_rate >= 0),
  gst_percent       INTEGER NOT NULL CHECK (gst_percent >= 0),
  supply            TEXT    NOT NULL CHECK (supply IN ('intra', 'inter')),
  taxable_amount    INTEGER NOT NULL CHECK (taxable_amount >= 0),
  cgst_amount       INTEGER NOT NULL CHECK (cgst_amount >= 0),
  sgst_amount       INTEGER NOT NULL CHECK (sgst_amount >= 0),
  igst_amount       INTEGER NOT NULL CHECK (igst_amount >= 0),
  total_amount      INTEGER NOT NULL CHECK (total_amount >= 0),
  formula_pins_json TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED')),
  project_id        INTEGER,
  site_id           INTEGER,
  created_by        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by        TEXT,
  updated_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at        TEXT,
  deleted_by        TEXT,
  source_type       TEXT,
  source_id         TEXT,
  remarks           TEXT
);
CREATE INDEX IF NOT EXISTS ix_core_sample_bills_company ON core_sample_bills (company_id, status);
