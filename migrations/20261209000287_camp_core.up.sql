-- Part 19.07: labour camps (blocks, rooms and beds), bed allocation with check-in and check-out, meals, welfare inspections, camp assets and the recovery charges to contractors. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS camp_camps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  location_id     INTEGER REFERENCES proj_locations (id),
  amenities_json  TEXT    NOT NULL DEFAULT '[]',
  in_charge       TEXT,
  camp_status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (camp_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_camp_code ON camp_camps (company_id, code);
CREATE INDEX IF NOT EXISTS ix_camp_site ON camp_camps (org_site_id, camp_status);
CREATE INDEX IF NOT EXISTS ix_camp_project ON camp_camps (org_project_id);
CREATE INDEX IF NOT EXISTS ix_camp_location ON camp_camps (location_id);
CREATE TABLE IF NOT EXISTS camp_rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  camp_id         INTEGER NOT NULL REFERENCES camp_camps (id),
  block           TEXT    NOT NULL DEFAULT 'A',
  room_no         TEXT    NOT NULL,
  beds            INTEGER NOT NULL CHECK (beds BETWEEN 1 AND 20),
  room_type       TEXT    NOT NULL DEFAULT 'DORMITORY' CHECK (room_type IN ('DORMITORY', 'FAMILY', 'STAFF', 'ISOLATION')),
  room_status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (room_status IN ('ACTIVE', 'MAINTENANCE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_camp_room ON camp_rooms (camp_id, block, room_no);
CREATE INDEX IF NOT EXISTS ix_camp_room_status ON camp_rooms (camp_id, room_status);
CREATE TABLE IF NOT EXISTS camp_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  camp_id         INTEGER NOT NULL REFERENCES camp_camps (id),
  room_id         INTEGER NOT NULL REFERENCES camp_rooms (id),
  bed_no          INTEGER NOT NULL CHECK (bed_no BETWEEN 1 AND 20),
  person_type     TEXT    NOT NULL CHECK (person_type IN ('WORKER', 'EMPLOYEE')),
  person_id       INTEGER NOT NULL,
  person_code     TEXT    NOT NULL,
  person_name     TEXT    NOT NULL,
  contractor_id   INTEGER REFERENCES mdm_partners (id),
  from_date       TEXT    NOT NULL,
  check_in        TEXT,
  check_out       TEXT,
  alloc_status    TEXT    NOT NULL DEFAULT 'ALLOCATED' CHECK (alloc_status IN ('ALLOCATED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_camp_al_doc ON camp_allocations (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_camp_al_bed ON camp_allocations (room_id, bed_no) WHERE alloc_status IN ('ALLOCATED', 'CHECKED_IN') AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_camp_al_person ON camp_allocations (company_id, person_type, person_id) WHERE alloc_status IN ('ALLOCATED', 'CHECKED_IN') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_camp_al_camp ON camp_allocations (camp_id, alloc_status);
CREATE INDEX IF NOT EXISTS ix_camp_al_contractor ON camp_allocations (contractor_id, alloc_status);
CREATE TABLE IF NOT EXISTS camp_meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  camp_id         INTEGER NOT NULL REFERENCES camp_camps (id),
  contractor_id   INTEGER REFERENCES mdm_partners (id),
  meal_date       TEXT    NOT NULL,
  meal            TEXT    NOT NULL CHECK (meal IN ('BREAKFAST', 'LUNCH', 'DINNER')),
  planned_count   INTEGER NOT NULL DEFAULT 0 CHECK (planned_count >= 0),
  served_count    INTEGER NOT NULL DEFAULT 0 CHECK (served_count >= 0),
  rate_paise      INTEGER NOT NULL DEFAULT 0 CHECK (rate_paise >= 0),
  recovered       INTEGER NOT NULL DEFAULT 0 CHECK (recovered IN (0, 1)),
  entered_by      TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_camp_meal ON camp_meals (camp_id, COALESCE(contractor_id, 0), meal_date, meal) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_camp_meal_date ON camp_meals (camp_id, meal_date);
CREATE INDEX IF NOT EXISTS ix_camp_meal_contractor ON camp_meals (contractor_id, meal_date);
CREATE TABLE IF NOT EXISTS camp_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  camp_id         INTEGER NOT NULL REFERENCES camp_camps (id),
  area            TEXT    NOT NULL CHECK (area IN ('WATER', 'TOILETS', 'DRAINAGE', 'ELECTRICITY', 'FIRE_SAFETY', 'FIRST_AID', 'CRECHE', 'MESS', 'GENERAL')),
  inspection_id   INTEGER REFERENCES qa_inspections (id),
  inspected_on    TEXT    NOT NULL,
  result          TEXT    NOT NULL CHECK (result IN ('PASS', 'FAIL', 'CONDITIONAL')),
  observation_id  INTEGER REFERENCES hse_observations (id),
  inspected_by    TEXT    NOT NULL,
  findings        TEXT,
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
CREATE INDEX IF NOT EXISTS ix_camp_in_camp ON camp_inspections (camp_id, inspected_on);
CREATE INDEX IF NOT EXISTS ix_camp_in_inspection ON camp_inspections (inspection_id);
CREATE INDEX IF NOT EXISTS ix_camp_in_observation ON camp_inspections (observation_id);
CREATE TABLE IF NOT EXISTS camp_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  camp_id         INTEGER NOT NULL REFERENCES camp_camps (id),
  asset_name      TEXT    NOT NULL,
  category        TEXT    NOT NULL DEFAULT 'FURNITURE' CHECK (category IN ('FURNITURE', 'BEDDING', 'KITCHEN', 'ELECTRICAL', 'SANITATION', 'OTHER')),
  qty             INTEGER NOT NULL CHECK (qty >= 0),
  asset_condition TEXT    NOT NULL DEFAULT 'GOOD' CHECK (asset_condition IN ('GOOD', 'FAIR', 'POOR', 'DISPOSED')),
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
CREATE INDEX IF NOT EXISTS ix_camp_as_camp ON camp_assets (camp_id, category);
CREATE TABLE IF NOT EXISTS camp_recoveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  camp_id         INTEGER NOT NULL REFERENCES camp_camps (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  contractor_id   INTEGER NOT NULL REFERENCES mdm_partners (id),
  period          TEXT    NOT NULL,
  meals_served    INTEGER NOT NULL DEFAULT 0 CHECK (meals_served >= 0),
  mess_paise      INTEGER NOT NULL DEFAULT 0 CHECK (mess_paise >= 0),
  bed_days        INTEGER NOT NULL DEFAULT 0 CHECK (bed_days >= 0),
  rent_paise      INTEGER NOT NULL DEFAULT 0 CHECK (rent_paise >= 0),
  total_paise     INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_camp_rc_doc ON camp_recoveries (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_camp_rc_contractor ON camp_recoveries (contractor_id, period, status);
CREATE INDEX IF NOT EXISTS ix_camp_rc_camp ON camp_recoveries (camp_id);
CREATE INDEX IF NOT EXISTS ix_camp_rc_project ON camp_recoveries (org_project_id);
CREATE INDEX IF NOT EXISTS ix_camp_assets_company_id ON camp_assets (company_id);
CREATE INDEX IF NOT EXISTS ix_camp_inspections_company_id ON camp_inspections (company_id);
CREATE INDEX IF NOT EXISTS ix_camp_meals_company_id ON camp_meals (company_id);
CREATE INDEX IF NOT EXISTS ix_camp_recoveries_org_site_id ON camp_recoveries (org_site_id);
CREATE INDEX IF NOT EXISTS ix_camp_rooms_company_id ON camp_rooms (company_id);
