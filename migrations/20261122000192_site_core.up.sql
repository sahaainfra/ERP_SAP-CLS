-- Part 14.01: work fronts, daily work plans and work authorisations ("no plan, no work").
-- site_work_fronts: a front of work of a site (a location), its status and the summary of the constraints of its activities (FR-01).
-- site_daily_plans and site_daily_plan_lines: the plan of a site and a supervisor for a day, from the weekly plan (13.04) or copied from the day before; issued, each line becomes a WA in draft (FR-02).
-- site_work_authorisations: the WA (approval-controlled): activity, WBS, location, quantity, drawing revision, budget line, permit, hold points, time window, supervisor, the checks made and the closure;
-- an emergency WA starts at once and is regularised within 24 hours (FR-03 to FR-05).
-- site_wa_resources: the crews by trade, materials and plant a WA authorises, and what was used (FR-03, FR-04).
-- site_wa_uses: every attendance, material issue, plant log, DPR or measurement that names a WA, and what it used (FR-07).

CREATE TABLE IF NOT EXISTS site_work_fronts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  wf_site_id      INTEGER NOT NULL REFERENCES org_sites (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'BLOCKED', 'IN_PROGRESS', 'COMPLETED')),
  constraints_summary TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_site_work_fronts_code ON site_work_fronts (wf_site_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_site_work_fronts_company_id ON site_work_fronts (company_id, status);
CREATE INDEX IF NOT EXISTS ix_site_work_fronts_project ON site_work_fronts (org_project_id, wf_site_id, status);
CREATE INDEX IF NOT EXISTS ix_site_work_fronts_site ON site_work_fronts (wf_site_id);
CREATE INDEX IF NOT EXISTS ix_site_work_fronts_location ON site_work_fronts (location_id);

CREATE TABLE IF NOT EXISTS site_daily_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  dp_site_id      INTEGER NOT NULL REFERENCES org_sites (id),
  schedule_id     INTEGER REFERENCES plan_schedules (id),
  plan_date       TEXT    NOT NULL,
  supervisor      TEXT    NOT NULL,
  weekly_plan_id  INTEGER REFERENCES plan_weekly_plans (id),
  copied_from_id  INTEGER REFERENCES site_daily_plans (id),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'CANCELLED')),
  issued_at       TEXT,
  issued_by       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_site_daily_plans_doc ON site_daily_plans (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_site_daily_plans_day ON site_daily_plans (dp_site_id, plan_date, supervisor) WHERE deleted_at IS NULL AND status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS ix_site_daily_plans_company_id ON site_daily_plans (company_id, status);
CREATE INDEX IF NOT EXISTS ix_site_daily_plans_project ON site_daily_plans (org_project_id, plan_date);
CREATE INDEX IF NOT EXISTS ix_site_daily_plans_site ON site_daily_plans (dp_site_id, plan_date);
CREATE INDEX IF NOT EXISTS ix_site_daily_plans_schedule ON site_daily_plans (schedule_id);
CREATE INDEX IF NOT EXISTS ix_site_daily_plans_weekly ON site_daily_plans (weekly_plan_id);
CREATE INDEX IF NOT EXISTS ix_site_daily_plans_copied ON site_daily_plans (copied_from_id);

CREATE TABLE IF NOT EXISTS site_daily_plan_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  plan_id         INTEGER NOT NULL REFERENCES site_daily_plans (id),
  activity_id     INTEGER NOT NULL REFERENCES plan_activities (id),
  work_front_id   INTEGER REFERENCES site_work_fronts (id),
  crew_id         INTEGER REFERENCES hr_crews (id),
  planned_qty     INTEGER NOT NULL CHECK (planned_qty > 0),
  uom             TEXT,
  weekly_item_id  INTEGER REFERENCES plan_weekly_items (id),
  wa_id           INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_site_daily_plan_lines_company_id ON site_daily_plan_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_site_daily_plan_lines_plan ON site_daily_plan_lines (plan_id);
CREATE INDEX IF NOT EXISTS ix_site_daily_plan_lines_activity ON site_daily_plan_lines (activity_id);
CREATE INDEX IF NOT EXISTS ix_site_daily_plan_lines_front ON site_daily_plan_lines (work_front_id);
CREATE INDEX IF NOT EXISTS ix_site_daily_plan_lines_crew ON site_daily_plan_lines (crew_id);
CREATE INDEX IF NOT EXISTS ix_site_daily_plan_lines_weekly ON site_daily_plan_lines (weekly_item_id);
CREATE INDEX IF NOT EXISTS ix_site_daily_plan_lines_wa ON site_daily_plan_lines (wa_id);

CREATE TABLE IF NOT EXISTS site_work_authorisations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  wa_no           TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  wa_site_id      INTEGER NOT NULL REFERENCES org_sites (id),
  work_front_id   INTEGER REFERENCES site_work_fronts (id),
  daily_plan_id   INTEGER REFERENCES site_daily_plans (id),
  plan_date       TEXT    NOT NULL,
  activity_id     INTEGER NOT NULL REFERENCES plan_activities (id),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  planned_qty     INTEGER NOT NULL CHECK (planned_qty > 0),
  uom             TEXT,
  drawing_id      INTEGER REFERENCES engg_drawings (id),
  drawing_revision TEXT,
  cost_code_id    INTEGER,
  budget_amount   INTEGER NOT NULL DEFAULT 0 CHECK (budget_amount >= 0),
  budget_line_ref TEXT,
  permit_required INTEGER NOT NULL DEFAULT 0 CHECK (permit_required IN (0, 1)),
  permit_ref      TEXT,
  hold_points     TEXT,
  start_time      TEXT    NOT NULL,
  end_time        TEXT    NOT NULL,
  supervisor      TEXT    NOT NULL,
  in_plan         INTEGER NOT NULL DEFAULT 1 CHECK (in_plan IN (0, 1)),
  is_emergency    INTEGER NOT NULL DEFAULT 0 CHECK (is_emergency IN (0, 1)),
  emergency_reason TEXT,
  regularise_by   TEXT,
  regularised_at  TEXT,
  checks_json     TEXT    NOT NULL DEFAULT '[]',
  revision_no     INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
  parent_wa_id    INTEGER REFERENCES site_work_authorisations (id),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'EMERGENCY', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED')),
  actual_qty      INTEGER CHECK (actual_qty IS NULL OR actual_qty >= 0),
  closure_notes   TEXT,
  variance_reason TEXT,
  closed_at       TEXT,
  closed_by       TEXT,
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
  remarks     TEXT,
  CHECK (end_time > start_time),
  CHECK (is_emergency = 0 OR emergency_reason IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_site_work_authorisations_no ON site_work_authorisations (company_id, wa_no);
CREATE INDEX IF NOT EXISTS ix_site_work_authorisations_company_id ON site_work_authorisations (company_id, status);
CREATE INDEX IF NOT EXISTS ix_site_work_authorisations_project ON site_work_authorisations (org_project_id, status, plan_date);
CREATE INDEX IF NOT EXISTS ix_site_work_authorisations_site ON site_work_authorisations (wa_site_id, plan_date, status);
CREATE INDEX IF NOT EXISTS ix_site_work_authorisations_front ON site_work_authorisations (work_front_id);
CREATE INDEX IF NOT EXISTS ix_site_work_authorisations_daily ON site_work_authorisations (daily_plan_id);
CREATE INDEX IF NOT EXISTS ix_site_work_authorisations_activity ON site_work_authorisations (activity_id, status);
CREATE INDEX IF NOT EXISTS ix_site_work_authorisations_wbs ON site_work_authorisations (wbs_id);
CREATE INDEX IF NOT EXISTS ix_site_work_authorisations_location ON site_work_authorisations (location_id);
CREATE INDEX IF NOT EXISTS ix_site_work_authorisations_drawing ON site_work_authorisations (drawing_id);
CREATE INDEX IF NOT EXISTS ix_site_work_authorisations_parent ON site_work_authorisations (parent_wa_id) WHERE parent_wa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_site_work_authorisations_supervisor ON site_work_authorisations (company_id, supervisor, plan_date);
CREATE INDEX IF NOT EXISTS ix_site_work_authorisations_emergency ON site_work_authorisations (company_id, regularise_by) WHERE is_emergency = 1 AND regularised_at IS NULL;

CREATE TABLE IF NOT EXISTS site_wa_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  wa_id           INTEGER NOT NULL REFERENCES site_work_authorisations (id),
  resource_type   TEXT    NOT NULL CHECK (resource_type IN ('LABOUR', 'MATERIAL', 'PLANT')),
  item_id         INTEGER REFERENCES mdm_items (id),
  trade           TEXT    COLLATE NOCASE,
  crew_id         INTEGER REFERENCES hr_crews (id),
  res_key         TEXT    NOT NULL COLLATE NOCASE,
  label           TEXT    NOT NULL,
  uom             TEXT    NOT NULL,
  headcount       INTEGER CHECK (headcount IS NULL OR headcount >= 0),
  planned_qty     INTEGER NOT NULL CHECK (planned_qty >= 0),
  actual_qty      INTEGER NOT NULL DEFAULT 0 CHECK (actual_qty >= 0),
  source          TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'NORM', 'SCHEDULE')),
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
  CHECK (item_id IS NOT NULL OR trade IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_site_wa_resources_company_id ON site_wa_resources (company_id);
CREATE INDEX IF NOT EXISTS ix_site_wa_resources_wa ON site_wa_resources (wa_id, resource_type, res_key);
CREATE INDEX IF NOT EXISTS ix_site_wa_resources_item ON site_wa_resources (item_id);
CREATE INDEX IF NOT EXISTS ix_site_wa_resources_crew ON site_wa_resources (crew_id);

CREATE TABLE IF NOT EXISTS site_wa_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  wa_id           INTEGER REFERENCES site_work_authorisations (id),
  use_kind        TEXT    NOT NULL CHECK (use_kind IN ('ATTENDANCE', 'MATERIAL_ISSUE', 'PLANT_LOG', 'DPR', 'MEASUREMENT')),
  src_entity      TEXT    NOT NULL,
  src_id          TEXT    NOT NULL,
  resource_type   TEXT    CHECK (resource_type IS NULL OR resource_type IN ('LABOUR', 'MATERIAL', 'PLANT')),
  res_key         TEXT    COLLATE NOCASE,
  qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  uom             TEXT,
  use_date        TEXT    NOT NULL,
  result          TEXT    NOT NULL CHECK (result IN ('PASS', 'WARN', 'EXCEPTED', 'OBSERVED')),
  control_result  TEXT,
  exception_no    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_site_wa_uses_source ON site_wa_uses (company_id, use_kind, src_entity, src_id, COALESCE(res_key, '')) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_site_wa_uses_company_id ON site_wa_uses (company_id, use_date);
CREATE INDEX IF NOT EXISTS ix_site_wa_uses_project ON site_wa_uses (org_project_id, use_date);
CREATE INDEX IF NOT EXISTS ix_site_wa_uses_wa ON site_wa_uses (wa_id, use_kind, res_key);
