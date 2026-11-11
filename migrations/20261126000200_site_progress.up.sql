-- Part 14.05: progress measurement, earned value and S-curves.
-- prs_activity_progress: the quantity executed on each activity and day from the approved DPRs (and the adjustments of a closed period, and measured quantities); keyed by the activity code so a revised schedule keeps its history.
-- prs_periods (approval-controlled): a weekly or monthly progress period with its adjustments, the actual cost, the snapshot taken when it is closed (approved) and the figures of the snapshot.
-- prs_evm: the earned-value figures of a closed period for the project and for each WBS node (money in paise, ratios in ten-thousandths).
-- prs_weights: manual weights (an amount in paise) that replace the budget share of an activity in the roll-up.

CREATE TABLE IF NOT EXISTS prs_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  period_type     TEXT    NOT NULL CHECK (period_type IN ('WEEK', 'MONTH')),
  period_start    TEXT    NOT NULL,
  period_end      TEXT    NOT NULL,
  actual_cost     INTEGER CHECK (actual_cost IS NULL OR actual_cost >= 0),
  adjustments_json TEXT   NOT NULL DEFAULT '[]',
  snapshot_json   TEXT,
  snapshot_hash   TEXT,
  physical_pct    INTEGER CHECK (physical_pct IS NULL OR (physical_pct >= 0 AND physical_pct <= 10000)),
  planned_pct     INTEGER CHECK (planned_pct IS NULL OR (planned_pct >= 0 AND planned_pct <= 10000)),
  financial_pct   INTEGER CHECK (financial_pct IS NULL OR (financial_pct >= 0 AND financial_pct <= 10000)),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
  parent_period_id INTEGER REFERENCES prs_periods (id),
  reason          TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  closed_by       TEXT,
  closed_at       TEXT,
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
  CHECK (period_end >= period_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_prs_periods_doc ON prs_periods (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_prs_periods_closed ON prs_periods (org_project_id, period_end) WHERE status = 'APPROVED' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_prs_periods_company ON prs_periods (company_id, status);
CREATE INDEX IF NOT EXISTS ix_prs_periods_project ON prs_periods (org_project_id, status, period_end);
CREATE INDEX IF NOT EXISTS ix_prs_periods_parent ON prs_periods (parent_period_id) WHERE parent_period_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS prs_activity_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  activity_id     INTEGER REFERENCES plan_activities (id),
  activity_code   TEXT    NOT NULL COLLATE NOCASE,
  work_date       TEXT    NOT NULL,
  qty             INTEGER NOT NULL,
  cum_qty         INTEGER NOT NULL DEFAULT 0,
  pct_complete    INTEGER NOT NULL DEFAULT 0 CHECK (pct_complete >= 0 AND pct_complete <= 10000),
  source          TEXT    NOT NULL CHECK (source IN ('DPR', 'MANUAL', 'MB')),
  dpr_id          INTEGER REFERENCES site_dprs (id),
  dpr_scope       TEXT,
  prog_site_id    INTEGER REFERENCES org_sites (id),
  period_id       INTEGER REFERENCES prs_periods (id),
  reason          TEXT,
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
CREATE INDEX IF NOT EXISTS ix_prs_progress_project ON prs_activity_progress (org_project_id, activity_code, work_date, id);
CREATE INDEX IF NOT EXISTS ix_prs_progress_company ON prs_activity_progress (company_id, work_date);
CREATE INDEX IF NOT EXISTS ix_prs_progress_activity ON prs_activity_progress (activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_prs_progress_dpr ON prs_activity_progress (dpr_id) WHERE dpr_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_prs_progress_site ON prs_activity_progress (prog_site_id, work_date) WHERE prog_site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_prs_progress_period ON prs_activity_progress (period_id) WHERE period_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS prs_evm (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  period_id       INTEGER NOT NULL REFERENCES prs_periods (id),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  period_end      TEXT    NOT NULL,
  bac             INTEGER NOT NULL DEFAULT 0 CHECK (bac >= 0),
  pv              INTEGER NOT NULL DEFAULT 0 CHECK (pv >= 0),
  ev              INTEGER NOT NULL DEFAULT 0 CHECK (ev >= 0),
  ac              INTEGER CHECK (ac IS NULL OR ac >= 0),
  sv              INTEGER NOT NULL DEFAULT 0,
  cv              INTEGER,
  spi             INTEGER,
  cpi             INTEGER,
  eac             INTEGER,
  tcpi            INTEGER,
  planned_pct     INTEGER NOT NULL DEFAULT 0 CHECK (planned_pct >= 0 AND planned_pct <= 10000),
  physical_pct    INTEGER NOT NULL DEFAULT 0 CHECK (physical_pct >= 0 AND physical_pct <= 10000),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_prs_evm ON prs_evm (period_id, COALESCE(wbs_id, 0)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_prs_evm_project ON prs_evm (org_project_id, period_end);
CREATE INDEX IF NOT EXISTS ix_prs_evm_company ON prs_evm (company_id);
CREATE INDEX IF NOT EXISTS ix_prs_evm_wbs ON prs_evm (wbs_id) WHERE wbs_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS prs_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  activity_code   TEXT    NOT NULL COLLATE NOCASE,
  weight_amount   INTEGER NOT NULL CHECK (weight_amount >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_prs_weights ON prs_weights (org_project_id, activity_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_prs_weights_company ON prs_weights (company_id);
