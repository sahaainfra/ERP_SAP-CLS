-- Part 14.02: the Daily Progress Report (DPR), the single daily record of site execution.
-- site_dprs: the header (approval-controlled): site, day, supervisor, weather, summary, the cut-off and the late flag, the checks found, revisions (an amendment after approval is a new row that replaces its parent).
-- site_dpr_work: the quantity done under each work authorisation (FR-03, BR-01); site_dpr_labour: own staff and contract labour by contractor and trade, with the attendance it is reconciled with (BR-02);
-- site_dpr_materials and site_dpr_equipment: what was consumed and the hours of plant; site_dpr_photos: the metadata of the photos (position, time, markup) of files kept by the file service (FR-04);
-- site_dpr_notes: hindrances, visitors, instructions, quality and safety observations and the plan of the next day (FR-03).

CREATE TABLE IF NOT EXISTS site_dprs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  dpr_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  dpr_date        TEXT    NOT NULL,
  supervisor      TEXT    NOT NULL,
  scope           TEXT    NOT NULL DEFAULT 'SITE' CHECK (scope IN ('SITE', 'SUPERVISOR')),
  work_front_id   INTEGER REFERENCES site_work_fronts (id),
  weather_code    TEXT    CHECK (weather_code IS NULL OR weather_code IN ('CLEAR', 'CLOUDY', 'RAIN', 'HEAVY_RAIN', 'STORM', 'FOG', 'HOT', 'COLD')),
  rain_mm         INTEGER CHECK (rain_mm IS NULL OR (rain_mm >= 0 AND rain_mm <= 2000)),
  weather_ref     TEXT,
  summary         TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
  parent_dpr_id   INTEGER REFERENCES site_dprs (id),
  submitted_at    TEXT,
  submitted_via   TEXT    CHECK (submitted_via IS NULL OR submitted_via IN ('ONLINE', 'OFFLINE')),
  received_at     TEXT,
  cutoff_at       TEXT,
  late            INTEGER NOT NULL DEFAULT 0 CHECK (late IN (0, 1)),
  late_minutes    INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  flags_json      TEXT    NOT NULL DEFAULT '{}',
  reason          TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_site_dprs_doc ON site_dprs (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_site_dprs_site_day ON site_dprs (dpr_site_id, dpr_date) WHERE scope = 'SITE' AND parent_dpr_id IS NULL AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED');
CREATE UNIQUE INDEX IF NOT EXISTS ux_site_dprs_supervisor_day ON site_dprs (dpr_site_id, dpr_date, supervisor) WHERE scope = 'SUPERVISOR' AND parent_dpr_id IS NULL AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED');
CREATE INDEX IF NOT EXISTS ix_site_dprs_company_id ON site_dprs (company_id, status);
CREATE INDEX IF NOT EXISTS ix_site_dprs_project ON site_dprs (org_project_id, dpr_date);
CREATE INDEX IF NOT EXISTS ix_site_dprs_site ON site_dprs (dpr_site_id, dpr_date, status);
CREATE INDEX IF NOT EXISTS ix_site_dprs_date ON site_dprs (company_id, dpr_date);
CREATE INDEX IF NOT EXISTS ix_site_dprs_front ON site_dprs (work_front_id);
CREATE INDEX IF NOT EXISTS ix_site_dprs_parent ON site_dprs (parent_dpr_id) WHERE parent_dpr_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_site_dprs_late ON site_dprs (company_id, late, dpr_date) WHERE late = 1;
CREATE INDEX IF NOT EXISTS ix_site_dprs_supervisor ON site_dprs (company_id, supervisor, dpr_date);

CREATE TABLE IF NOT EXISTS site_dpr_work (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  dpr_id        INTEGER NOT NULL REFERENCES site_dprs (id),
  wa_id         INTEGER NOT NULL REFERENCES site_work_authorisations (id),
  activity_id   INTEGER NOT NULL REFERENCES plan_activities (id),
  location_id   INTEGER REFERENCES proj_locations (id),
  qty           INTEGER NOT NULL CHECK (qty >= 0),
  uom           TEXT,
  planned_qty   INTEGER NOT NULL DEFAULT 0 CHECK (planned_qty >= 0),
  prefill_qty   INTEGER CHECK (prefill_qty IS NULL OR prefill_qty >= 0),
  over_wa       INTEGER NOT NULL DEFAULT 0 CHECK (over_wa IN (0, 1)),
  reason        TEXT,
  line_remarks  TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS ix_site_dpr_work_company_id ON site_dpr_work (company_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_work_dpr ON site_dpr_work (dpr_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_work_wa ON site_dpr_work (wa_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_work_activity ON site_dpr_work (activity_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_work_location ON site_dpr_work (location_id);

CREATE TABLE IF NOT EXISTS site_dpr_labour (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  dpr_id        INTEGER NOT NULL REFERENCES site_dprs (id),
  category      TEXT    NOT NULL CHECK (category IN ('STAFF', 'CONTRACT')),
  contractor_id INTEGER REFERENCES mdm_partners (id),
  trade_code    TEXT    NOT NULL COLLATE NOCASE,
  headcount     INTEGER NOT NULL DEFAULT 0 CHECK (headcount >= 0),
  man_days      INTEGER NOT NULL DEFAULT 0 CHECK (man_days >= 0),
  ot_hours      INTEGER NOT NULL DEFAULT 0 CHECK (ot_hours >= 0),
  att_headcount INTEGER CHECK (att_headcount IS NULL OR att_headcount >= 0),
  att_man_days  INTEGER CHECK (att_man_days IS NULL OR att_man_days >= 0),
  variance_pct  INTEGER,
  flagged       INTEGER NOT NULL DEFAULT 0 CHECK (flagged IN (0, 1)),
  reason        TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS ix_site_dpr_labour_company_id ON site_dpr_labour (company_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_labour_dpr ON site_dpr_labour (dpr_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_labour_contractor ON site_dpr_labour (contractor_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_labour_trade ON site_dpr_labour (trade_code);

CREATE TABLE IF NOT EXISTS site_dpr_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  dpr_id        INTEGER NOT NULL REFERENCES site_dprs (id),
  item_id       INTEGER NOT NULL REFERENCES mdm_items (id),
  qty           INTEGER NOT NULL CHECK (qty >= 0),
  uom           TEXT,
  wa_id         INTEGER REFERENCES site_work_authorisations (id),
  issue_ref     TEXT,
  prefill_qty   INTEGER CHECK (prefill_qty IS NULL OR prefill_qty >= 0),
  reason        TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS ix_site_dpr_materials_company_id ON site_dpr_materials (company_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_materials_dpr ON site_dpr_materials (dpr_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_materials_item ON site_dpr_materials (item_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_materials_wa ON site_dpr_materials (wa_id);

CREATE TABLE IF NOT EXISTS site_dpr_equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  dpr_id          INTEGER NOT NULL REFERENCES site_dprs (id),
  equipment_key   TEXT    NOT NULL COLLATE NOCASE,
  label           TEXT    NOT NULL,
  hours_worked    INTEGER NOT NULL DEFAULT 0 CHECK (hours_worked >= 0),
  hours_idle      INTEGER NOT NULL DEFAULT 0 CHECK (hours_idle >= 0),
  hours_breakdown INTEGER NOT NULL DEFAULT 0 CHECK (hours_breakdown >= 0),
  log_ref         TEXT,
  prefill_hours   INTEGER CHECK (prefill_hours IS NULL OR prefill_hours >= 0),
  reason          TEXT,
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
CREATE INDEX IF NOT EXISTS ix_site_dpr_equipment_company_id ON site_dpr_equipment (company_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_equipment_dpr ON site_dpr_equipment (dpr_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_equipment_key ON site_dpr_equipment (equipment_key);

CREATE TABLE IF NOT EXISTS site_dpr_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  dpr_id      INTEGER NOT NULL REFERENCES site_dprs (id),
  file_id     INTEGER NOT NULL REFERENCES core_files (id),
  caption     TEXT,
  lat         REAL CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)),
  lng         REAL CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180)),
  taken_at    TEXT,
  location_id INTEGER REFERENCES proj_locations (id),
  markup_json TEXT    NOT NULL DEFAULT '[]',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_site_dpr_photos_file ON site_dpr_photos (dpr_id, file_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_site_dpr_photos_company_id ON site_dpr_photos (company_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_photos_file ON site_dpr_photos (file_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_photos_location ON site_dpr_photos (location_id);

CREATE TABLE IF NOT EXISTS site_dpr_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  dpr_id        INTEGER NOT NULL REFERENCES site_dprs (id),
  note_type     TEXT    NOT NULL CHECK (note_type IN ('HINDRANCE', 'VISITOR', 'INSTRUCTION', 'QUALITY', 'SAFETY', 'NEXT_DAY')),
  note_text     TEXT    NOT NULL,
  linked_entity TEXT,
  linked_id     TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS ix_site_dpr_notes_company_id ON site_dpr_notes (company_id);
CREATE INDEX IF NOT EXISTS ix_site_dpr_notes_dpr ON site_dpr_notes (dpr_id, note_type);
