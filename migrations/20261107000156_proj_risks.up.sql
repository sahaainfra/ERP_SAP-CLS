-- Part 10.06: project risks, opportunities and issues (module proj, tables proj_risk*). Money in paise (x 100), percentages x 10 000, days as integers.
-- proj_risks: a risk or an opportunity with its assessment (probability and impact 1 to 5, score, level), response, residual rating, exposure (minimum, most likely, maximum for cost and time) and EMV; its closure is approved by the project manager when it is
-- high or critical. proj_risk_actions: the response actions (tasks). proj_risk_triggers: early-warning indicators with a threshold and the latest reading. proj_risk_contingency: allocations of contingency to risks and drawdown requests (executed by 12.02).
-- proj_risk_issues: realised problems. proj_risk_snapshots: the monthly review with its frozen figures. proj_risk_settings: the contingency pool of a project.
CREATE TABLE IF NOT EXISTS proj_risk_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  contingency_pool INTEGER NOT NULL DEFAULT 0 CHECK (contingency_pool >= 0),
  thresholds_json TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_risk_settings_project ON proj_risk_settings (org_project_id);
CREATE INDEX IF NOT EXISTS ix_proj_risk_settings_company_id ON proj_risk_settings (company_id);

CREATE TABLE IF NOT EXISTS proj_risks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  rtype           TEXT    NOT NULL CHECK (rtype IN ('RISK', 'OPPORTUNITY')),
  title           TEXT    NOT NULL,
  description     TEXT,
  cause           TEXT,
  effect          TEXT,
  category        TEXT    NOT NULL CHECK (category IN ('TECHNICAL', 'COMMERCIAL', 'CONTRACTUAL', 'SAFETY', 'ENVIRONMENTAL', 'FINANCIAL', 'STATUTORY')),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  activity_ref    TEXT,
  clause_ref      TEXT,
  owner_user      TEXT    NOT NULL,
  probability     INTEGER NOT NULL CHECK (probability BETWEEN 1 AND 5),
  impact_cost     INTEGER NOT NULL DEFAULT 1 CHECK (impact_cost BETWEEN 1 AND 5),
  impact_time     INTEGER NOT NULL DEFAULT 1 CHECK (impact_time BETWEEN 1 AND 5),
  impact_quality  INTEGER NOT NULL DEFAULT 1 CHECK (impact_quality BETWEEN 1 AND 5),
  impact_safety   INTEGER NOT NULL DEFAULT 1 CHECK (impact_safety BETWEEN 1 AND 5),
  score           INTEGER NOT NULL DEFAULT 0,
  level           TEXT    NOT NULL DEFAULT 'LOW' CHECK (level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  strategy        TEXT    NOT NULL DEFAULT 'MITIGATE' CHECK (strategy IN ('AVOID', 'MITIGATE', 'TRANSFER', 'ACCEPT', 'EXPLOIT', 'ENHANCE', 'SHARE')),
  residual_probability INTEGER CHECK (residual_probability IS NULL OR residual_probability BETWEEN 1 AND 5),
  residual_impact INTEGER CHECK (residual_impact IS NULL OR residual_impact BETWEEN 1 AND 5),
  residual_score  INTEGER,
  residual_level  TEXT,
  exposure_cost_min INTEGER NOT NULL DEFAULT 0 CHECK (exposure_cost_min >= 0),
  exposure_cost_ml  INTEGER NOT NULL DEFAULT 0 CHECK (exposure_cost_ml >= 0),
  exposure_cost_max INTEGER NOT NULL DEFAULT 0 CHECK (exposure_cost_max >= 0),
  exposure_time_min INTEGER NOT NULL DEFAULT 0 CHECK (exposure_time_min >= 0),
  exposure_time_ml  INTEGER NOT NULL DEFAULT 0 CHECK (exposure_time_ml >= 0),
  exposure_time_max INTEGER NOT NULL DEFAULT 0 CHECK (exposure_time_max >= 0),
  probability_pct INTEGER NOT NULL DEFAULT 0,
  emv             INTEGER NOT NULL DEFAULT 0 CHECK (emv >= 0),
  contingency_allocated INTEGER NOT NULL DEFAULT 0 CHECK (contingency_allocated >= 0),
  status          TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSE_REQUESTED', 'CLOSED', 'OCCURRED', 'CANCELLED')),
  close_reason    TEXT,
  close_occurred  INTEGER NOT NULL DEFAULT 0 CHECK (close_occurred IN (0, 1)),
  closed_at       TEXT,
  closed_by       TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  occurred_issue_id INTEGER,
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
  CHECK (exposure_cost_min <= exposure_cost_ml AND exposure_cost_ml <= exposure_cost_max AND exposure_time_min <= exposure_time_ml AND exposure_time_ml <= exposure_time_max)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_risks_doc ON proj_risks (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_proj_risks_company_id ON proj_risks (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_risks_project ON proj_risks (org_project_id, rtype, status);
CREATE INDEX IF NOT EXISTS ix_proj_risks_owner ON proj_risks (company_id, owner_user);
CREATE INDEX IF NOT EXISTS ix_proj_risks_wbs ON proj_risks (wbs_id);
CREATE INDEX IF NOT EXISTS ix_proj_risks_cost_code ON proj_risks (cost_code_id);
CREATE INDEX IF NOT EXISTS ix_proj_risks_level ON proj_risks (company_id, level, status);

CREATE TABLE IF NOT EXISTS proj_risk_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  risk_id         INTEGER NOT NULL REFERENCES proj_risks (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  action_no       INTEGER NOT NULL CHECK (action_no >= 1),
  description     TEXT    NOT NULL,
  owner_user      TEXT    NOT NULL,
  due_date        TEXT    NOT NULL,
  task_id         INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_proj_risk_actions_company_id ON proj_risk_actions (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_risk_actions_risk ON proj_risk_actions (risk_id, action_no);
CREATE INDEX IF NOT EXISTS ix_proj_risk_actions_project ON proj_risk_actions (org_project_id);
CREATE INDEX IF NOT EXISTS ix_proj_risk_actions_owner ON proj_risk_actions (company_id, owner_user);
CREATE INDEX IF NOT EXISTS ix_proj_risk_actions_task ON proj_risk_actions (task_id);

CREATE TABLE IF NOT EXISTS proj_risk_triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  risk_id         INTEGER NOT NULL REFERENCES proj_risks (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  name            TEXT    NOT NULL,
  indicator       TEXT,
  comparator      TEXT    NOT NULL CHECK (comparator IN ('GTE', 'GT', 'LTE', 'LT')),
  threshold       INTEGER NOT NULL,
  unit            TEXT,
  current_value   INTEGER,
  trigger_status  TEXT    NOT NULL DEFAULT 'ARMED' CHECK (trigger_status IN ('ARMED', 'FIRED')),
  fired_at        TEXT,
  last_reading_at TEXT,
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
CREATE INDEX IF NOT EXISTS ix_proj_risk_triggers_company_id ON proj_risk_triggers (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_risk_triggers_risk ON proj_risk_triggers (risk_id);
CREATE INDEX IF NOT EXISTS ix_proj_risk_triggers_project ON proj_risk_triggers (org_project_id, trigger_status);

CREATE TABLE IF NOT EXISTS proj_risk_contingency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  risk_id         INTEGER NOT NULL REFERENCES proj_risks (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  kind            TEXT    NOT NULL CHECK (kind IN ('ALLOCATION', 'DRAWDOWN')),
  amount          INTEGER NOT NULL CHECK (amount > 0),
  entry_status    TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (entry_status IN ('ACTIVE', 'RELEASED', 'REQUESTED', 'EXECUTED', 'REJECTED')),
  reason          TEXT    NOT NULL,
  by_user         TEXT,
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
CREATE INDEX IF NOT EXISTS ix_proj_risk_contingency_company_id ON proj_risk_contingency (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_risk_contingency_risk ON proj_risk_contingency (risk_id, kind);
CREATE INDEX IF NOT EXISTS ix_proj_risk_contingency_project ON proj_risk_contingency (org_project_id, entry_status);

CREATE TABLE IF NOT EXISTS proj_risk_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  risk_id         INTEGER REFERENCES proj_risks (id),
  title           TEXT    NOT NULL,
  description     TEXT,
  priority        TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  owner_user      TEXT    NOT NULL,
  due_date        TEXT,
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  impact_cost     INTEGER NOT NULL DEFAULT 0 CHECK (impact_cost >= 0),
  impact_time     INTEGER NOT NULL DEFAULT 0 CHECK (impact_time >= 0),
  impact_text     TEXT,
  resolution      TEXT,
  status          TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED')),
  resolved_at     TEXT,
  resolved_by     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_risk_issues_doc ON proj_risk_issues (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_proj_risk_issues_company_id ON proj_risk_issues (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_risk_issues_project ON proj_risk_issues (org_project_id, status);
CREATE INDEX IF NOT EXISTS ix_proj_risk_issues_risk ON proj_risk_issues (risk_id);
CREATE INDEX IF NOT EXISTS ix_proj_risk_issues_owner ON proj_risk_issues (company_id, owner_user);
CREATE INDEX IF NOT EXISTS ix_proj_risk_issues_wbs ON proj_risk_issues (wbs_id);

CREATE TABLE IF NOT EXISTS proj_risk_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  data_json       TEXT    NOT NULL DEFAULT '{}',
  notes           TEXT,
  snap_status     TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (snap_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_risk_snapshots_period ON proj_risk_snapshots (org_project_id, period) WHERE deleted_at IS NULL AND snap_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED');
CREATE INDEX IF NOT EXISTS ix_proj_risk_snapshots_company_id ON proj_risk_snapshots (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_risk_snapshots_project ON proj_risk_snapshots (org_project_id, snap_status);
