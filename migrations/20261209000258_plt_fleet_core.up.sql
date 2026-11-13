-- Part 17.07: the cost items of owning a machine, the monthly cost snapshots (owning and operating cost, cost an hour), telematics readings and the disposal recommendations (approval-controlled). Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS plt_cost_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  equipment_id    INTEGER NOT NULL REFERENCES plt_equipment (id),
  item_type       TEXT    NOT NULL CHECK (item_type IN ('DEPRECIATION', 'EMI', 'INSURANCE', 'PERMIT', 'OPERATOR', 'OTHER')),
  monthly_amount  INTEGER NOT NULL CHECK (monthly_amount >= 0),
  from_date       TEXT    NOT NULL,
  to_date         TEXT    NOT NULL DEFAULT '9999-12-31',
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
  remarks     TEXT,
  CHECK (to_date >= from_date)
);
CREATE INDEX IF NOT EXISTS ix_plt_ci_equip ON plt_cost_items (equipment_id, item_type);
CREATE INDEX IF NOT EXISTS ix_plt_ci_company ON plt_cost_items (company_id);

CREATE TABLE IF NOT EXISTS plt_cost_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  equipment_id    INTEGER NOT NULL REFERENCES plt_equipment (id),
  period          TEXT    NOT NULL,
  owning_cost     INTEGER NOT NULL DEFAULT 0 CHECK (owning_cost >= 0),
  operating_cost  INTEGER NOT NULL DEFAULT 0 CHECK (operating_cost >= 0),
  fuel_cost       INTEGER NOT NULL DEFAULT 0 CHECK (fuel_cost >= 0),
  maintenance_cost INTEGER NOT NULL DEFAULT 0 CHECK (maintenance_cost >= 0),
  hire_cost       INTEGER NOT NULL DEFAULT 0 CHECK (hire_cost >= 0),
  operator_cost   INTEGER NOT NULL DEFAULT 0 CHECK (operator_cost >= 0),
  hours           INTEGER NOT NULL DEFAULT 0 CHECK (hours >= 0),
  km              INTEGER NOT NULL DEFAULT 0 CHECK (km >= 0),
  cost_per_hour   INTEGER,
  cost_per_km     INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_cs_eq_period ON plt_cost_snapshots (equipment_id, period);
CREATE INDEX IF NOT EXISTS ix_plt_cs_company ON plt_cost_snapshots (company_id, period);

CREATE TABLE IF NOT EXISTS plt_telematics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  equipment_id    INTEGER NOT NULL REFERENCES plt_equipment (id),
  ts              TEXT    NOT NULL,
  lat_e6          INTEGER,
  lng_e6          INTEGER,
  engine_hours    INTEGER CHECK (engine_hours IS NULL OR engine_hours >= 0),
  ignition        INTEGER CHECK (ignition IS NULL OR ignition IN (0, 1)),
  fuel_level      INTEGER CHECK (fuel_level IS NULL OR fuel_level >= 0),
  source          TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_tm_eq_ts ON plt_telematics (equipment_id, ts, source);
CREATE INDEX IF NOT EXISTS ix_plt_tm_company ON plt_telematics (company_id, ts);

CREATE TABLE IF NOT EXISTS plt_disposal_recs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  equipment_id    INTEGER NOT NULL REFERENCES plt_equipment (id),
  reason          TEXT    NOT NULL,
  flags_json      TEXT    NOT NULL DEFAULT '[]',
  age_years       INTEGER,
  purchase_value  INTEGER NOT NULL DEFAULT 0 CHECK (purchase_value >= 0),
  repair_cost     INTEGER NOT NULL DEFAULT 0 CHECK (repair_cost >= 0),
  utilisation_bp  INTEGER,
  est_value       INTEGER NOT NULL DEFAULT 0 CHECK (est_value >= 0),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_dr_doc ON plt_disposal_recs (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_plt_dr_equip ON plt_disposal_recs (equipment_id, status);
