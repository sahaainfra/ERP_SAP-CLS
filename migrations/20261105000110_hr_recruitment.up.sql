-- Part 07.02: recruitment, manpower requisition and onboarding (module hr). hr_headcount_plans: the approved headcount per department, designation and project (the adapter for the manpower plan of 17.08).
-- hr_requisitions: approval-controlled, versioned by amendment; hr_candidates and the pipeline stages; hr_interviews with panel feedback; hr_offers: approval-controlled with the CTC breakup, accepted by a link;
-- hr_onboarding_tasks: the joining checklist assigned to departments. Money is stored in whole paise.

CREATE TABLE IF NOT EXISTS hr_headcount_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  department_id  INTEGER NOT NULL REFERENCES org_departments (id),
  designation_id INTEGER REFERENCES org_designations (id),
  approved_positions INTEGER NOT NULL CHECK (approved_positions >= 0),
  valid_from     TEXT    NOT NULL,
  valid_to       TEXT,
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
CREATE INDEX IF NOT EXISTS ix_hr_headcount_plans_company_id ON hr_headcount_plans (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_headcount_plans_department ON hr_headcount_plans (department_id);
CREATE INDEX IF NOT EXISTS ix_hr_headcount_plans_designation ON hr_headcount_plans (designation_id);
CREATE INDEX IF NOT EXISTS ix_hr_headcount_plans_project ON hr_headcount_plans (project_id);
CREATE TABLE IF NOT EXISTS hr_requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  revision_no    INTEGER NOT NULL DEFAULT 1,
  root_id        INTEGER REFERENCES hr_requisitions (id),
  supersedes_id  INTEGER REFERENCES hr_requisitions (id),
  doc_date       TEXT    NOT NULL,
  department_id  INTEGER NOT NULL REFERENCES org_departments (id),
  designation_id INTEGER NOT NULL REFERENCES org_designations (id),
  positions      INTEGER NOT NULL CHECK (positions BETWEEN 1 AND 500),
  reason         TEXT    NOT NULL CHECK (reason IN ('NEW', 'REPLACEMENT')),
  replaces_employee_id INTEGER REFERENCES hr_employees (id),
  employment_type TEXT   NOT NULL DEFAULT 'PERMANENT' CHECK (employment_type IN ('PERMANENT', 'CONTRACT', 'TRAINEE', 'CONSULTANT')),
  location_type  TEXT    NOT NULL DEFAULT 'HO' CHECK (location_type IN ('HO', 'SITE')),
  manager_id     INTEGER REFERENCES hr_employees (id),
  ctc_min        INTEGER NOT NULL CHECK (ctc_min >= 0),
  ctc_max        INTEGER NOT NULL CHECK (ctc_max >= 0),
  required_by    TEXT    NOT NULL,
  justification  TEXT,
  plan_json      TEXT    NOT NULL DEFAULT '{}',
  band           TEXT    NOT NULL DEFAULT 'WITHIN_PLAN' CHECK (band IN ('WITHIN_PLAN', 'BEYOND_PLAN')),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  closed_reason  TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_requisitions_doc ON hr_requisitions (company_id, doc_no, revision_no);
CREATE INDEX IF NOT EXISTS ix_hr_requisitions_list ON hr_requisitions (company_id, status);
CREATE INDEX IF NOT EXISTS ix_hr_requisitions_department ON hr_requisitions (department_id);
CREATE INDEX IF NOT EXISTS ix_hr_requisitions_designation ON hr_requisitions (designation_id);
CREATE INDEX IF NOT EXISTS ix_hr_requisitions_root ON hr_requisitions (root_id);
CREATE INDEX IF NOT EXISTS ix_hr_requisitions_supersedes ON hr_requisitions (supersedes_id);
CREATE INDEX IF NOT EXISTS ix_hr_requisitions_replaces ON hr_requisitions (replaces_employee_id);
CREATE INDEX IF NOT EXISTS ix_hr_requisitions_manager ON hr_requisitions (manager_id);
CREATE INDEX IF NOT EXISTS ix_hr_requisitions_project ON hr_requisitions (project_id);
CREATE INDEX IF NOT EXISTS ix_hr_requisitions_required ON hr_requisitions (company_id, required_by);
CREATE TABLE IF NOT EXISTS hr_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  full_name      TEXT    NOT NULL,
  mobile         TEXT    NOT NULL,
  email          TEXT,
  source         TEXT    NOT NULL CHECK (source IN ('REFERRAL', 'PORTAL', 'AGENCY', 'WALK_IN')),
  source_detail  TEXT,
  requisition_id INTEGER NOT NULL REFERENCES hr_requisitions (id),
  resume_file_id INTEGER,
  current_ctc    INTEGER CHECK (current_ctc IS NULL OR current_ctc >= 0),
  expected_ctc   INTEGER CHECK (expected_ctc IS NULL OR expected_ctc >= 0),
  notice_days    INTEGER CHECK (notice_days IS NULL OR notice_days >= 0),
  stage          TEXT    NOT NULL DEFAULT 'APPLIED' CHECK (stage IN ('APPLIED', 'SCREENED', 'INTERVIEW', 'SELECTED', 'OFFERED', 'ACCEPTED', 'JOINED', 'REJECTED')),
  stage_at       TEXT,
  reject_reason  TEXT,
  rejected_from  TEXT,
  retention_until TEXT,
  anonymised_at  TEXT,
  profile_json   TEXT    NOT NULL DEFAULT '{}',
  sensitive_enc  TEXT,
  bgv_status     TEXT    NOT NULL DEFAULT 'NOT_STARTED' CHECK (bgv_status IN ('NOT_STARTED', 'IN_PROGRESS', 'CLEAR', 'ADVERSE')),
  medical_status TEXT    NOT NULL DEFAULT 'PENDING' CHECK (medical_status IN ('PENDING', 'FIT', 'UNFIT')),
  employee_id    INTEGER REFERENCES hr_employees (id),
  joined_on      TEXT,
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
CREATE INDEX IF NOT EXISTS ix_hr_candidates_list ON hr_candidates (company_id, stage);
CREATE INDEX IF NOT EXISTS ix_hr_candidates_requisition ON hr_candidates (requisition_id, stage);
CREATE INDEX IF NOT EXISTS ix_hr_candidates_mobile ON hr_candidates (company_id, mobile);
CREATE INDEX IF NOT EXISTS ix_hr_candidates_employee ON hr_candidates (employee_id);
CREATE INDEX IF NOT EXISTS ix_hr_candidates_retention ON hr_candidates (stage, retention_until);
CREATE TABLE IF NOT EXISTS hr_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  candidate_id   INTEGER NOT NULL REFERENCES hr_candidates (id),
  round_no       INTEGER NOT NULL CHECK (round_no >= 1),
  scheduled_at   TEXT    NOT NULL,
  mode           TEXT    NOT NULL DEFAULT 'IN_PERSON' CHECK (mode IN ('IN_PERSON', 'PHONE', 'VIDEO')),
  panel_json     TEXT    NOT NULL DEFAULT '[]',
  feedback_json  TEXT    NOT NULL DEFAULT '[]',
  score          INTEGER,
  result         TEXT    NOT NULL DEFAULT 'PENDING' CHECK (result IN ('PENDING', 'PASS', 'HOLD', 'FAIL', 'CANCELLED')),
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
CREATE INDEX IF NOT EXISTS ix_hr_interviews_company_id ON hr_interviews (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_interviews_candidate ON hr_interviews (candidate_id, round_no);
CREATE INDEX IF NOT EXISTS ix_hr_interviews_when ON hr_interviews (company_id, scheduled_at);
CREATE TABLE IF NOT EXISTS hr_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  revision_no    INTEGER NOT NULL DEFAULT 1,
  supersedes_id  INTEGER REFERENCES hr_offers (id),
  doc_date       TEXT    NOT NULL,
  candidate_id   INTEGER NOT NULL REFERENCES hr_candidates (id),
  designation_id INTEGER NOT NULL REFERENCES org_designations (id),
  grade          TEXT,
  employment_type TEXT   NOT NULL DEFAULT 'PERMANENT' CHECK (employment_type IN ('PERMANENT', 'CONTRACT', 'TRAINEE', 'CONSULTANT')),
  ctc_annual     INTEGER NOT NULL CHECK (ctc_annual > 0),
  breakup_json   TEXT    NOT NULL DEFAULT '{}',
  doj_proposed   TEXT    NOT NULL,
  valid_days     INTEGER NOT NULL DEFAULT 7,
  band           TEXT    NOT NULL DEFAULT 'STANDARD' CHECK (band IN ('STANDARD', 'DIR')),
  band_reason    TEXT,
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  response       TEXT    NOT NULL DEFAULT 'NONE' CHECK (response IN ('NONE', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  token_hash     TEXT,
  sent_at        TEXT,
  valid_until    TEXT,
  responded_at   TEXT,
  response_note  TEXT,
  file_id        INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_offers_doc ON hr_offers (company_id, doc_no, revision_no);
CREATE INDEX IF NOT EXISTS ix_hr_offers_list ON hr_offers (company_id, status);
CREATE INDEX IF NOT EXISTS ix_hr_offers_candidate ON hr_offers (candidate_id);
CREATE INDEX IF NOT EXISTS ix_hr_offers_designation ON hr_offers (designation_id);
CREATE INDEX IF NOT EXISTS ix_hr_offers_supersedes ON hr_offers (supersedes_id);
CREATE INDEX IF NOT EXISTS ix_hr_offers_token ON hr_offers (token_hash);
CREATE TABLE IF NOT EXISTS hr_onboarding_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  candidate_id   INTEGER NOT NULL REFERENCES hr_candidates (id),
  employee_id    INTEGER REFERENCES hr_employees (id),
  task_code      TEXT    NOT NULL,
  title          TEXT    NOT NULL,
  assigned_department_id INTEGER REFERENCES org_departments (id),
  assigned_role  TEXT    NOT NULL,
  due_date       TEXT    NOT NULL,
  task_status    TEXT    NOT NULL DEFAULT 'OPEN' CHECK (task_status IN ('OPEN', 'DONE', 'WAIVED')),
  completed_at   TEXT,
  completed_by   TEXT,
  note           TEXT,
  task_id        INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_hr_onboarding_tasks_company_id ON hr_onboarding_tasks (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_onboarding_tasks_candidate ON hr_onboarding_tasks (candidate_id);
CREATE INDEX IF NOT EXISTS ix_hr_onboarding_tasks_employee ON hr_onboarding_tasks (employee_id);
CREATE INDEX IF NOT EXISTS ix_hr_onboarding_tasks_department ON hr_onboarding_tasks (assigned_department_id);
CREATE INDEX IF NOT EXISTS ix_hr_onboarding_tasks_queue ON hr_onboarding_tasks (task_status, due_date);
