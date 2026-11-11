-- Part 14.06: productivity tracking and analysis.
-- prod_norms: the planned output of an activity of a project, per man-day (labour) or per machine-hour (equipment), from the BOQ resource norms (10.04, source BOQ) or entered and approved (source MANUAL, maker-checker); output in thousandths of the activity's unit.
-- prod_actuals: the actual productivity of each work line of an approved DPR (quantity over the man-days and machine-hours allocated to it), against the norm, with the man-days lost and the main loss reason.
-- prod_losses: a loss of time recorded by the site with a reason code (idle time, rework, weather, material shortage, drawing delay, breakdown); prod_alerts: productivity below the threshold for N days.

CREATE TABLE IF NOT EXISTS prod_norms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  activity_code   TEXT    NOT NULL COLLATE NOCASE,
  work_type       TEXT    NOT NULL,
  resource_type   TEXT    NOT NULL CHECK (resource_type IN ('LABOUR', 'EQUIPMENT')),
  output_per_unit INTEGER NOT NULL CHECK (output_per_unit > 0),
  uom             TEXT,
  source          TEXT    NOT NULL CHECK (source IN ('BOQ', 'MANUAL')),
  effective_from  TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  note            TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_prod_norms_live ON prod_norms (org_project_id, activity_code, resource_type, source, effective_from) WHERE status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_prod_norms_company ON prod_norms (company_id, status);
CREATE INDEX IF NOT EXISTS ix_prod_norms_project ON prod_norms (org_project_id, activity_code, resource_type, status);
CREATE INDEX IF NOT EXISTS ix_prod_norms_type ON prod_norms (company_id, work_type);

CREATE TABLE IF NOT EXISTS prod_actuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  prod_site_id    INTEGER NOT NULL REFERENCES org_sites (id),
  work_date       TEXT    NOT NULL,
  activity_id     INTEGER REFERENCES plan_activities (id),
  activity_code   TEXT    NOT NULL COLLATE NOCASE,
  work_type       TEXT    NOT NULL,
  crew_id         INTEGER REFERENCES hr_crews (id),
  contractor_id   INTEGER REFERENCES mdm_partners (id),
  dpr_id          INTEGER NOT NULL REFERENCES site_dprs (id),
  dpr_work_id     INTEGER,
  dpr_scope       TEXT,
  qty             INTEGER NOT NULL CHECK (qty >= 0),
  uom             TEXT,
  man_days        INTEGER NOT NULL DEFAULT 0 CHECK (man_days >= 0),
  machine_hours   INTEGER NOT NULL DEFAULT 0 CHECK (machine_hours >= 0),
  alloc_basis     TEXT    NOT NULL DEFAULT 'WA' CHECK (alloc_basis IN ('WA', 'NORM', 'QTY')),
  norm_labour     INTEGER,
  norm_equipment  INTEGER,
  productivity    INTEGER,
  productivity_machine INTEGER,
  variance_pct    INTEGER,
  machine_variance_pct INTEGER,
  shortfall_md    INTEGER NOT NULL DEFAULT 0 CHECK (shortfall_md >= 0),
  loss_reason     TEXT    CHECK (loss_reason IS NULL OR loss_reason IN ('IDLE', 'REWORK', 'WEATHER', 'MATERIAL_SHORTAGE', 'DRAWING_DELAY', 'BREAKDOWN', 'OTHER')),
  derived_reason  TEXT    CHECK (derived_reason IS NULL OR derived_reason IN ('IDLE', 'REWORK', 'WEATHER', 'MATERIAL_SHORTAGE', 'DRAWING_DELAY', 'BREAKDOWN', 'OTHER')),
  outlier         INTEGER NOT NULL DEFAULT 0 CHECK (outlier IN (0, 1)),
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
CREATE INDEX IF NOT EXISTS ix_prod_actuals_project ON prod_actuals (org_project_id, work_date);
CREATE INDEX IF NOT EXISTS ix_prod_actuals_site ON prod_actuals (prod_site_id, work_date, activity_code);
CREATE INDEX IF NOT EXISTS ix_prod_actuals_company ON prod_actuals (company_id, work_date);
CREATE INDEX IF NOT EXISTS ix_prod_actuals_type ON prod_actuals (company_id, work_type, work_date);
CREATE INDEX IF NOT EXISTS ix_prod_actuals_dpr ON prod_actuals (dpr_id);
CREATE INDEX IF NOT EXISTS ix_prod_actuals_crew ON prod_actuals (crew_id, work_date) WHERE crew_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_prod_actuals_contractor ON prod_actuals (contractor_id, work_date) WHERE contractor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_prod_actuals_activity ON prod_actuals (activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_prod_actuals_outlier ON prod_actuals (company_id, work_date) WHERE outlier = 1;

CREATE TABLE IF NOT EXISTS prod_losses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  loss_site_id    INTEGER NOT NULL REFERENCES org_sites (id),
  loss_date       TEXT    NOT NULL,
  activity_code   TEXT    COLLATE NOCASE,
  reason_code     TEXT    NOT NULL CHECK (reason_code IN ('IDLE', 'REWORK', 'WEATHER', 'MATERIAL_SHORTAGE', 'DRAWING_DELAY', 'BREAKDOWN', 'OTHER')),
  hours_lost      INTEGER NOT NULL CHECK (hours_lost > 0 AND hours_lost <= 240000),
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
CREATE INDEX IF NOT EXISTS ix_prod_losses_site ON prod_losses (loss_site_id, loss_date);
CREATE INDEX IF NOT EXISTS ix_prod_losses_project ON prod_losses (org_project_id, loss_date);
CREATE INDEX IF NOT EXISTS ix_prod_losses_company ON prod_losses (company_id, loss_date);

CREATE TABLE IF NOT EXISTS prod_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  alert_site_id   INTEGER NOT NULL REFERENCES org_sites (id),
  activity_code   TEXT    NOT NULL COLLATE NOCASE,
  work_type       TEXT    NOT NULL,
  days            INTEGER NOT NULL CHECK (days >= 1),
  from_date       TEXT    NOT NULL,
  to_date         TEXT    NOT NULL,
  avg_pct         INTEGER NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLEARED')),
  raised_at       TEXT    NOT NULL,
  cleared_at      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_prod_alerts_open ON prod_alerts (alert_site_id, activity_code) WHERE status = 'OPEN' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_prod_alerts_company ON prod_alerts (company_id, status);
CREATE INDEX IF NOT EXISTS ix_prod_alerts_project ON prod_alerts (org_project_id, status);
