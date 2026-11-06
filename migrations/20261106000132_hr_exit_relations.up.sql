-- Part 07.13: exit, full-and-final inputs, grievances and disciplinary records (module hr).
-- hr_separations: a resignation or a termination with the notice computation, approved by workflow, then cleared and settled (full-and-final inputs to payroll). hr_clearances: the clearance of each department.
-- hr_exit_interviews: the exit interview. hr_grievances: grievances of employees and workers (anonymous ones keep no identity, only a hash of a tracking code). hr_disciplinary_cases: restricted cases with their stages.

CREATE TABLE IF NOT EXISTS hr_separations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  sep_type       TEXT    NOT NULL CHECK (sep_type IN ('RESIGNATION', 'TERMINATION')),
  reason_code    TEXT    NOT NULL,
  reason         TEXT    NOT NULL,
  submitted_on   TEXT    NOT NULL,
  notice_days    INTEGER NOT NULL CHECK (notice_days >= 0),
  standard_lwd   TEXT    NOT NULL,
  last_working_day TEXT  NOT NULL,
  early_mode     TEXT    NOT NULL DEFAULT 'NONE' CHECK (early_mode IN ('NONE', 'WAIVER', 'BUYOUT')),
  waiver_days    INTEGER NOT NULL DEFAULT 0 CHECK (waiver_days >= 0),
  buyout_days    INTEGER NOT NULL DEFAULT 0 CHECK (buyout_days >= 0),
  notice_pay_days INTEGER NOT NULL DEFAULT 0 CHECK (notice_pay_days >= 0),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SETTLED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  approved_at    TEXT,
  notice_change_id INTEGER,
  exit_change_id INTEGER,
  fnf_json       TEXT,
  fnf_released_at TEXT,
  fnf_released_by TEXT,
  relieving_doc_id INTEGER,
  experience_doc_id INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_separations_doc ON hr_separations (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_hr_separations_company_id ON hr_separations (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_separations_employee ON hr_separations (employee_id, status);
CREATE INDEX IF NOT EXISTS ix_hr_separations_status ON hr_separations (company_id, status);
CREATE INDEX IF NOT EXISTS ix_hr_separations_lwd ON hr_separations (company_id, last_working_day);
CREATE INDEX IF NOT EXISTS ix_hr_separations_notice_change ON hr_separations (notice_change_id);
CREATE INDEX IF NOT EXISTS ix_hr_separations_exit_change ON hr_separations (exit_change_id);
CREATE INDEX IF NOT EXISTS ix_hr_separations_relieving ON hr_separations (relieving_doc_id);
CREATE INDEX IF NOT EXISTS ix_hr_separations_experience ON hr_separations (experience_doc_id);
CREATE INDEX IF NOT EXISTS ix_hr_separations_project ON hr_separations (project_id);
CREATE INDEX IF NOT EXISTS ix_hr_separations_site ON hr_separations (site_id);

CREATE TABLE IF NOT EXISTS hr_clearances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  separation_id  INTEGER NOT NULL REFERENCES hr_separations (id),
  department_code TEXT   NOT NULL,
  department_name TEXT   NOT NULL,
  owner_roles    TEXT    NOT NULL DEFAULT '[]',
  owner_user     TEXT,
  items_json     TEXT    NOT NULL DEFAULT '[]',
  due_date       TEXT,
  clr_status     TEXT    NOT NULL DEFAULT 'PENDING' CHECK (clr_status IN ('PENDING', 'CLEARED', 'WAIVED', 'CANCELLED')),
  cleared_by     TEXT,
  cleared_at     TEXT,
  waived_by      TEXT,
  waive_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_clearances_dept ON hr_clearances (separation_id, department_code);
CREATE INDEX IF NOT EXISTS ix_hr_clearances_company_id ON hr_clearances (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_clearances_status ON hr_clearances (company_id, clr_status, due_date);
CREATE INDEX IF NOT EXISTS ix_hr_clearances_separation ON hr_clearances (separation_id);
CREATE INDEX IF NOT EXISTS ix_hr_clearances_project ON hr_clearances (project_id);
CREATE INDEX IF NOT EXISTS ix_hr_clearances_site ON hr_clearances (site_id);

CREATE TABLE IF NOT EXISTS hr_exit_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  separation_id  INTEGER NOT NULL REFERENCES hr_separations (id),
  responses_json TEXT    NOT NULL DEFAULT '{}',
  overall_rating INTEGER CHECK (overall_rating IS NULL OR overall_rating BETWEEN 1 AND 5),
  reason_code    TEXT,
  would_rejoin   INTEGER CHECK (would_rejoin IS NULL OR would_rejoin IN (0, 1)),
  conducted_by   TEXT    NOT NULL,
  conducted_at   TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_exit_interviews_sep ON hr_exit_interviews (separation_id);
CREATE INDEX IF NOT EXISTS ix_hr_exit_interviews_company_id ON hr_exit_interviews (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_exit_interviews_project ON hr_exit_interviews (project_id);
CREATE INDEX IF NOT EXISTS ix_hr_exit_interviews_site ON hr_exit_interviews (site_id);

CREATE TABLE IF NOT EXISTS hr_grievances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  complainant_type TEXT  NOT NULL CHECK (complainant_type IN ('EMPLOYEE', 'WORKER')),
  complainant_id INTEGER,
  anonymous      INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
  tracking_hash  TEXT,
  raised_by      TEXT,
  category       TEXT    NOT NULL,
  subject        TEXT    NOT NULL,
  description    TEXT    NOT NULL,
  priority       TEXT    NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'HIGH')),
  assigned_to    TEXT,
  sla_due        TEXT,
  overdue_alerted INTEGER NOT NULL DEFAULT 0 CHECK (overdue_alerted IN (0, 1)),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'RESOLVED', 'CLOSED', 'REJECTED', 'CANCELLED')),
  notes_json     TEXT    NOT NULL DEFAULT '[]',
  resolution     TEXT,
  resolved_by    TEXT,
  resolved_at    TEXT,
  closed_at      TEXT,
  reopen_count   INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_grievances_doc ON hr_grievances (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_grievances_tracking ON hr_grievances (tracking_hash) WHERE tracking_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_hr_grievances_company_id ON hr_grievances (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_grievances_status ON hr_grievances (company_id, status, sla_due);
CREATE INDEX IF NOT EXISTS ix_hr_grievances_assigned ON hr_grievances (company_id, assigned_to);
CREATE INDEX IF NOT EXISTS ix_hr_grievances_raised_by ON hr_grievances (company_id, raised_by);
CREATE INDEX IF NOT EXISTS ix_hr_grievances_complainant ON hr_grievances (complainant_type, complainant_id);
CREATE INDEX IF NOT EXISTS ix_hr_grievances_project ON hr_grievances (project_id);
CREATE INDEX IF NOT EXISTS ix_hr_grievances_site ON hr_grievances (site_id);

CREATE TABLE IF NOT EXISTS hr_disciplinary_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  incident_date  TEXT    NOT NULL,
  category       TEXT    NOT NULL,
  severity       TEXT    NOT NULL DEFAULT 'MINOR' CHECK (severity IN ('MINOR', 'MAJOR', 'GROSS')),
  incident       TEXT    NOT NULL,
  documents_json TEXT    NOT NULL DEFAULT '[]',
  actions_json   TEXT    NOT NULL DEFAULT '[]',
  case_status    TEXT    NOT NULL DEFAULT 'OPEN' CHECK (case_status IN ('OPEN', 'SHOW_CAUSE', 'RESPONDED', 'INQUIRY', 'ACTION_TAKEN', 'CLOSED', 'DROPPED')),
  response_due   TEXT,
  final_action   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_disciplinary_doc ON hr_disciplinary_cases (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_hr_disciplinary_cases_company_id ON hr_disciplinary_cases (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_disciplinary_cases_employee ON hr_disciplinary_cases (employee_id);
CREATE INDEX IF NOT EXISTS ix_hr_disciplinary_cases_status ON hr_disciplinary_cases (company_id, case_status);
CREATE INDEX IF NOT EXISTS ix_hr_disciplinary_cases_project ON hr_disciplinary_cases (project_id);
CREATE INDEX IF NOT EXISTS ix_hr_disciplinary_cases_site ON hr_disciplinary_cases (site_id);
