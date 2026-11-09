-- Part 13.01: the schedule core (module plan). Durations and lags in working days of a calendar, quantities x 1 000, per cent complete x 100 (10 000 = 100 %).
-- plan_calendars: the working week, the hours of a day, the holidays of a holiday calendar of 01.03 and site exceptions; a company calendar (no project) or a project or site one; drafted by one person and put in force by another.
-- plan_schedules: the schedule of a project in versions (the working version; baselines come in 13.03); approved by the project controls manager and then locked, changed by a new version.
-- plan_activities: the activities with their WBS node, location, type, duration, calendar, constraint, quantity and the dates the server's CPM pass worked out (early and late dates, total and free float, critical), and the progress (actual dates, per cent, remaining duration).
-- plan_dependencies: the logic (FS, SS, FF, SF with a lag); plan_activity_boq: the BOQ lines an activity carries and the quantity split; plan_templates: the activity sequences that generate activities per WBS node or per location.
CREATE TABLE IF NOT EXISTS plan_calendars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  work_week       TEXT    NOT NULL DEFAULT '1111110' CHECK (length(work_week) = 7 AND work_week GLOB '[01][01][01][01][01][01][01]' AND work_week <> '0000000'),
  hours_per_day   INTEGER NOT NULL DEFAULT 8 CHECK (hours_per_day BETWEEN 1 AND 24),
  holiday_calendar_id INTEGER REFERENCES core_holiday_calendars (id),
  exceptions_json TEXT    NOT NULL DEFAULT '[]',
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'CANCELLED')),
  reason          TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_calendars_code ON plan_calendars (company_id, COALESCE(org_project_id, 0), code) WHERE status IN ('DRAFT', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_plan_calendars_company_id ON plan_calendars (company_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_calendars_project ON plan_calendars (org_project_id);
CREATE INDEX IF NOT EXISTS ix_plan_calendars_holidays ON plan_calendars (holiday_calendar_id);

CREATE TABLE IF NOT EXISTS plan_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  name            TEXT    NOT NULL,
  version_type    TEXT    NOT NULL DEFAULT 'WORKING' CHECK (version_type IN ('WORKING')),
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  parent_schedule_id INTEGER REFERENCES plan_schedules (id),
  calendar_id     INTEGER NOT NULL REFERENCES plan_calendars (id),
  start_date      TEXT    NOT NULL,
  data_date       TEXT,
  finish_date     TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  activities_count INTEGER NOT NULL DEFAULT 0 CHECK (activities_count >= 0),
  critical_count  INTEGER NOT NULL DEFAULT 0 CHECK (critical_count >= 0),
  needs_calc      INTEGER NOT NULL DEFAULT 1 CHECK (needs_calc IN (0, 1)),
  calculated_at   TEXT,
  calc_ms         INTEGER,
  reason          TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  locked_at       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_schedules_doc ON plan_schedules (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_schedules_version ON plan_schedules (org_project_id, version_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_schedules_inforce ON plan_schedules (org_project_id) WHERE status = 'APPROVED' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_schedules_open ON plan_schedules (org_project_id) WHERE status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_plan_schedules_company_id ON plan_schedules (company_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_schedules_project ON plan_schedules (org_project_id);
CREATE INDEX IF NOT EXISTS ix_plan_schedules_calendar ON plan_schedules (calendar_id);
CREATE INDEX IF NOT EXISTS ix_plan_schedules_parent ON plan_schedules (parent_schedule_id);

CREATE TABLE IF NOT EXISTS plan_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  schedule_id     INTEGER NOT NULL REFERENCES plan_schedules (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  act_type        TEXT    NOT NULL DEFAULT 'TASK' CHECK (act_type IN ('TASK', 'MILESTONE', 'LOE', 'SUMMARY')),
  duration_days   INTEGER NOT NULL DEFAULT 0 CHECK (duration_days >= 0 AND duration_days <= 36500),
  calendar_id     INTEGER REFERENCES plan_calendars (id),
  constraint_type TEXT    NOT NULL DEFAULT 'NONE' CHECK (constraint_type IN ('NONE', 'SNET', 'FNLT')),
  constraint_date TEXT,
  qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  uom             TEXT,
  es              TEXT,
  ef              TEXT,
  ls              TEXT,
  lf              TEXT,
  total_float     INTEGER,
  free_float      INTEGER,
  is_critical     INTEGER NOT NULL DEFAULT 0 CHECK (is_critical IN (0, 1)),
  actual_start    TEXT,
  actual_finish   TEXT,
  pct_complete    INTEGER NOT NULL DEFAULT 0 CHECK (pct_complete >= 0 AND pct_complete <= 10000),
  pct_source      TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (pct_source IN ('MANUAL', 'DPR')),
  remaining_days  INTEGER CHECK (remaining_days IS NULL OR remaining_days >= 0),
  responsible_user TEXT,
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
  remarks     TEXT,
  CHECK ((constraint_type = 'NONE') = (constraint_date IS NULL)),
  CHECK (actual_finish IS NULL OR (actual_start IS NOT NULL AND actual_finish >= actual_start))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_activities_code ON plan_activities (schedule_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_plan_activities_company_id ON plan_activities (company_id);
CREATE INDEX IF NOT EXISTS ix_plan_activities_schedule ON plan_activities (schedule_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_plan_activities_wbs ON plan_activities (wbs_id);
CREATE INDEX IF NOT EXISTS ix_plan_activities_location ON plan_activities (location_id);
CREATE INDEX IF NOT EXISTS ix_plan_activities_calendar ON plan_activities (calendar_id);
CREATE INDEX IF NOT EXISTS ix_plan_activities_critical ON plan_activities (schedule_id, is_critical, total_float);
CREATE INDEX IF NOT EXISTS ix_plan_activities_responsible ON plan_activities (company_id, responsible_user);

CREATE TABLE IF NOT EXISTS plan_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  schedule_id     INTEGER NOT NULL REFERENCES plan_schedules (id),
  pred_id         INTEGER NOT NULL REFERENCES plan_activities (id),
  succ_id         INTEGER NOT NULL REFERENCES plan_activities (id),
  dep_type        TEXT    NOT NULL DEFAULT 'FS' CHECK (dep_type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days        INTEGER NOT NULL DEFAULT 0 CHECK (lag_days BETWEEN -3650 AND 3650),
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
  CHECK (pred_id <> succ_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_dependencies_pair ON plan_dependencies (schedule_id, pred_id, succ_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_plan_dependencies_company_id ON plan_dependencies (company_id);
CREATE INDEX IF NOT EXISTS ix_plan_dependencies_pred ON plan_dependencies (pred_id);
CREATE INDEX IF NOT EXISTS ix_plan_dependencies_succ ON plan_dependencies (succ_id);

CREATE TABLE IF NOT EXISTS plan_activity_boq (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  activity_id     INTEGER NOT NULL REFERENCES plan_activities (id),
  boq_line_id     INTEGER NOT NULL REFERENCES proj_boq_lines (id),
  qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_activity_boq ON plan_activity_boq (activity_id, boq_line_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_plan_activity_boq_company_id ON plan_activity_boq (company_id);
CREATE INDEX IF NOT EXISTS ix_plan_activity_boq_line ON plan_activity_boq (boq_line_id);

CREATE TABLE IF NOT EXISTS plan_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  target          TEXT    NOT NULL CHECK (target IN ('WBS', 'LOCATION')),
  steps_json      TEXT    NOT NULL,
  chain_step      TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'CANCELLED')),
  reason          TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_templates_code ON plan_templates (COALESCE(company_id, 0), code) WHERE status IN ('DRAFT', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_plan_templates_company_id ON plan_templates (company_id, status);
