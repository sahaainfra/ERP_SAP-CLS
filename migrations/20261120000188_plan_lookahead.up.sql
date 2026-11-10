-- Part 13.04: look-ahead planning, constraints and weekly work plans.
-- plan_lookaheads: a look-ahead generated for a schedule and a window of weeks (optionally one site or work front), with its counts of ready and blocked activities (FR-01).
-- plan_constraints: what stops an activity (drawing, RFI, submittal, material, labour, plant, permit, predecessor, client approval, access) with owner, due date and status; those found in other modules
-- are AUTO and clear by themselves when the source is resolved (BR-02) (FR-02, FR-03).
-- plan_weekly_plans: the weekly work plan of a project and site (approval-controlled, locked once approved, changed by a revision) and plan_weekly_items: its commitments by activity and crew with the
-- completion recorded afterwards and the variance code of what was not done; PPC = completed commitments / commitments (BR-01) (FR-04, FR-05).

CREATE TABLE IF NOT EXISTS plan_lookaheads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  schedule_id     INTEGER NOT NULL REFERENCES plan_schedules (id),
  la_site_id      INTEGER REFERENCES org_sites (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  from_date       TEXT    NOT NULL,
  to_date         TEXT    NOT NULL,
  weeks           INTEGER NOT NULL CHECK (weeks BETWEEN 1 AND 12),
  generated_at    TEXT    NOT NULL,
  generated_by    TEXT    NOT NULL,
  activities_count INTEGER NOT NULL DEFAULT 0 CHECK (activities_count >= 0),
  ready_count     INTEGER NOT NULL DEFAULT 0 CHECK (ready_count >= 0),
  blocked_count   INTEGER NOT NULL DEFAULT 0 CHECK (blocked_count >= 0),
  status          TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
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
CREATE INDEX IF NOT EXISTS ix_plan_lookaheads_company_id ON plan_lookaheads (company_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_lookaheads_project ON plan_lookaheads (org_project_id, generated_at);
CREATE INDEX IF NOT EXISTS ix_plan_lookaheads_schedule ON plan_lookaheads (schedule_id);
CREATE INDEX IF NOT EXISTS ix_plan_lookaheads_site ON plan_lookaheads (la_site_id);
CREATE INDEX IF NOT EXISTS ix_plan_lookaheads_location ON plan_lookaheads (location_id);

CREATE TABLE IF NOT EXISTS plan_constraints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  schedule_id     INTEGER NOT NULL REFERENCES plan_schedules (id),
  activity_id     INTEGER NOT NULL REFERENCES plan_activities (id),
  ctype           TEXT    NOT NULL CHECK (ctype IN ('DRAWING', 'RFI', 'SUBMITTAL', 'MATERIAL', 'LABOUR', 'PLANT', 'PERMIT', 'PREDECESSOR', 'CLIENT_APPROVAL', 'ACCESS')),
  description     TEXT    NOT NULL,
  owner_user      TEXT,
  due_date        TEXT,
  origin          TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (origin IN ('AUTO', 'MANUAL')),
  src_entity      TEXT,
  src_id          TEXT,
  status          TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLEARED', 'WAIVED')),
  cleared_on      TEXT,
  cleared_by      TEXT,
  clear_note      TEXT,
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
  CHECK ((status = 'OPEN') = (cleared_on IS NULL)),
  CHECK (origin = 'MANUAL' OR (src_entity IS NOT NULL AND src_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_constraints_auto ON plan_constraints (activity_id, ctype, src_entity, src_id) WHERE origin = 'AUTO' AND status = 'OPEN' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_plan_constraints_company_id ON plan_constraints (company_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_constraints_project ON plan_constraints (org_project_id, status, due_date);
CREATE INDEX IF NOT EXISTS ix_plan_constraints_schedule ON plan_constraints (schedule_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_constraints_activity ON plan_constraints (activity_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_constraints_source ON plan_constraints (src_entity, src_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_constraints_owner ON plan_constraints (company_id, owner_user, status);

CREATE TABLE IF NOT EXISTS plan_weekly_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  wp_site_id      INTEGER REFERENCES org_sites (id),
  schedule_id     INTEGER NOT NULL REFERENCES plan_schedules (id),
  week_start      TEXT    NOT NULL,
  revision_no     INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
  parent_plan_id  INTEGER REFERENCES plan_weekly_plans (id),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED')),
  items_count     INTEGER NOT NULL DEFAULT 0 CHECK (items_count >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  ppc             INTEGER CHECK (ppc IS NULL OR (ppc >= 0 AND ppc <= 10000)),
  note            TEXT,
  reason          TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  closed_at       TEXT,
  closed_by       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_weekly_plans_doc ON plan_weekly_plans (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_weekly_plans_week ON plan_weekly_plans (org_project_id, COALESCE(wp_site_id, 0), week_start, revision_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_plan_weekly_plans_company_id ON plan_weekly_plans (company_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_weekly_plans_project ON plan_weekly_plans (org_project_id, week_start, status);
CREATE INDEX IF NOT EXISTS ix_plan_weekly_plans_site ON plan_weekly_plans (wp_site_id);
CREATE INDEX IF NOT EXISTS ix_plan_weekly_plans_schedule ON plan_weekly_plans (schedule_id);
CREATE INDEX IF NOT EXISTS ix_plan_weekly_plans_parent ON plan_weekly_plans (parent_plan_id);

CREATE TABLE IF NOT EXISTS plan_weekly_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  plan_id         INTEGER NOT NULL REFERENCES plan_weekly_plans (id),
  activity_id     INTEGER NOT NULL REFERENCES plan_activities (id),
  crew_id         INTEGER REFERENCES hr_crews (id),
  committed_qty   INTEGER NOT NULL DEFAULT 0 CHECK (committed_qty >= 0),
  completed_qty   INTEGER NOT NULL DEFAULT 0 CHECK (completed_qty >= 0),
  uom             TEXT,
  completed       INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  variance_code   TEXT    CHECK (variance_code IS NULL OR variance_code IN ('DRAWINGS', 'MATERIAL', 'LABOUR', 'PLANT', 'WEATHER', 'PREDECESSOR', 'CLIENT', 'PERMIT', 'QUALITY', 'SAFETY', 'OTHER')),
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
  CHECK (completed = 0 OR variance_code IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_weekly_items_line ON plan_weekly_items (plan_id, activity_id, COALESCE(crew_id, 0)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_plan_weekly_items_company_id ON plan_weekly_items (company_id);
CREATE INDEX IF NOT EXISTS ix_plan_weekly_items_plan ON plan_weekly_items (plan_id);
CREATE INDEX IF NOT EXISTS ix_plan_weekly_items_activity ON plan_weekly_items (activity_id);
CREATE INDEX IF NOT EXISTS ix_plan_weekly_items_crew ON plan_weekly_items (crew_id);
