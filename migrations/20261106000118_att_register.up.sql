-- Part 07.06: the attendance register (module hr). att_daily: one row for a person and a day, computed from the punches, the policy, the shift, the roster, holidays, approved regularisations, manual entries, overtime and visits,
-- and frozen when the period is locked. att_regularisations, att_overtime_requests and att_manual_entries: approval-controlled requests. att_period_locks: the lock of a period for a site (or all sites) with its reopen approval.
-- att_arrears: what a change after the lock would have changed, for payroll to settle.

CREATE TABLE IF NOT EXISTS att_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  person_type    TEXT    NOT NULL DEFAULT 'EMPLOYEE' CHECK (person_type IN ('EMPLOYEE', 'WORKER')),
  person_id      INTEGER NOT NULL,
  work_date      TEXT    NOT NULL,
  daily_site_id  INTEGER REFERENCES org_sites (id),
  status         TEXT    NOT NULL CHECK (status IN ('PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'ON_DUTY', 'COMP_OFF', 'MISSING_PUNCH', 'HOLIDAY_WORKED', 'WEEKLY_OFF_WORKED')),
  late           INTEGER NOT NULL DEFAULT 0 CHECK (late IN (0, 1)),
  early_going    INTEGER NOT NULL DEFAULT 0 CHECK (early_going IN (0, 1)),
  late_minutes   INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  early_minutes  INTEGER NOT NULL DEFAULT 0 CHECK (early_minutes >= 0),
  in_time        TEXT,
  out_time       TEXT,
  worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  ot_minutes     INTEGER NOT NULL DEFAULT 0 CHECK (ot_minutes >= 0),
  ot_approved_minutes INTEGER NOT NULL DEFAULT 0 CHECK (ot_approved_minutes >= 0),
  ot_paid_minutes INTEGER NOT NULL DEFAULT 0 CHECK (ot_paid_minutes >= 0),
  ot_multiplier  REAL,
  paid_day       REAL    NOT NULL DEFAULT 0 CHECK (paid_day >= 0 AND paid_day <= 1),
  lop_day        REAL    NOT NULL DEFAULT 0 CHECK (lop_day >= 0 AND lop_day <= 1),
  comp_off       REAL    NOT NULL DEFAULT 0 CHECK (comp_off >= 0),
  source         TEXT    NOT NULL DEFAULT 'PUNCH' CHECK (source IN ('PUNCH', 'REGULARISATION', 'MANUAL', 'VISIT', 'SYSTEM', 'LEAVE')),
  source_ids_json TEXT   NOT NULL DEFAULT '{}',
  flags_json     TEXT    NOT NULL DEFAULT '[]',
  period_start   TEXT,
  locked         INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  computed_at    TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_daily_person_day ON att_daily (company_id, person_type, person_id, work_date);
CREATE INDEX IF NOT EXISTS ix_att_daily_company_id ON att_daily (company_id);
CREATE INDEX IF NOT EXISTS ix_att_daily_site_day ON att_daily (daily_site_id, work_date);
CREATE INDEX IF NOT EXISTS ix_att_daily_period ON att_daily (company_id, period_start, locked);
CREATE INDEX IF NOT EXISTS ix_att_daily_status ON att_daily (company_id, work_date, status);

CREATE TABLE IF NOT EXISTS att_regularisations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  revision_no    INTEGER NOT NULL DEFAULT 1,
  root_id        INTEGER,
  supersedes_id  INTEGER,
  doc_date       TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  doc_site_id    INTEGER REFERENCES org_sites (id),
  work_date      TEXT    NOT NULL,
  requested_in   TEXT,
  requested_out  TEXT,
  reason         TEXT    NOT NULL,
  evidence_file_id INTEGER,
  band           TEXT    NOT NULL DEFAULT 'STANDARD',
  arrears        INTEGER NOT NULL DEFAULT 0 CHECK (arrears IN (0, 1)),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_regularisations_doc ON att_regularisations (company_id, doc_no, revision_no);
CREATE INDEX IF NOT EXISTS ix_att_regularisations_company_id ON att_regularisations (company_id);
CREATE INDEX IF NOT EXISTS ix_att_regularisations_employee ON att_regularisations (employee_id, work_date);
CREATE INDEX IF NOT EXISTS ix_att_regularisations_site ON att_regularisations (doc_site_id);
CREATE INDEX IF NOT EXISTS ix_att_regularisations_status ON att_regularisations (company_id, status);
CREATE INDEX IF NOT EXISTS ix_att_regularisations_root_id ON att_regularisations (root_id);
CREATE INDEX IF NOT EXISTS ix_att_regularisations_supersedes_id ON att_regularisations (supersedes_id);
CREATE INDEX IF NOT EXISTS ix_att_regularisations_evidence ON att_regularisations (evidence_file_id);
CREATE TABLE IF NOT EXISTS att_overtime_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  revision_no    INTEGER NOT NULL DEFAULT 1,
  root_id        INTEGER,
  supersedes_id  INTEGER,
  doc_date       TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  doc_site_id    INTEGER REFERENCES org_sites (id),
  work_date      TEXT    NOT NULL,
  ot_type        TEXT    NOT NULL CHECK (ot_type IN ('PRE', 'POST')),
  minutes_requested INTEGER NOT NULL CHECK (minutes_requested BETWEEN 15 AND 720),
  minutes_approved INTEGER CHECK (minutes_approved IS NULL OR minutes_approved >= 0),
  reason         TEXT    NOT NULL,
  band           TEXT    NOT NULL DEFAULT 'STANDARD',
  arrears        INTEGER NOT NULL DEFAULT 0 CHECK (arrears IN (0, 1)),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_overtime_requests_doc ON att_overtime_requests (company_id, doc_no, revision_no);
CREATE INDEX IF NOT EXISTS ix_att_overtime_requests_company_id ON att_overtime_requests (company_id);
CREATE INDEX IF NOT EXISTS ix_att_overtime_requests_employee ON att_overtime_requests (employee_id, work_date);
CREATE INDEX IF NOT EXISTS ix_att_overtime_requests_site ON att_overtime_requests (doc_site_id);
CREATE INDEX IF NOT EXISTS ix_att_overtime_requests_status ON att_overtime_requests (company_id, status);
CREATE INDEX IF NOT EXISTS ix_att_overtime_requests_root_id ON att_overtime_requests (root_id);
CREATE INDEX IF NOT EXISTS ix_att_overtime_requests_supersedes_id ON att_overtime_requests (supersedes_id);

CREATE TABLE IF NOT EXISTS att_manual_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  revision_no    INTEGER NOT NULL DEFAULT 1,
  root_id        INTEGER,
  supersedes_id  INTEGER,
  doc_date       TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  doc_site_id    INTEGER REFERENCES org_sites (id),
  work_date      TEXT    NOT NULL,
  entry_status   TEXT    NOT NULL CHECK (entry_status IN ('PRESENT', 'HALF_DAY', 'ABSENT', 'ON_DUTY', 'COMP_OFF')),
  in_time        TEXT,
  out_time       TEXT,
  reason         TEXT    NOT NULL,
  evidence_file_id INTEGER,
  band           TEXT    NOT NULL DEFAULT 'STANDARD',
  arrears        INTEGER NOT NULL DEFAULT 0 CHECK (arrears IN (0, 1)),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_manual_entries_doc ON att_manual_entries (company_id, doc_no, revision_no);
CREATE INDEX IF NOT EXISTS ix_att_manual_entries_company_id ON att_manual_entries (company_id);
CREATE INDEX IF NOT EXISTS ix_att_manual_entries_employee ON att_manual_entries (employee_id, work_date);
CREATE INDEX IF NOT EXISTS ix_att_manual_entries_site ON att_manual_entries (doc_site_id);
CREATE INDEX IF NOT EXISTS ix_att_manual_entries_status ON att_manual_entries (company_id, status);
CREATE INDEX IF NOT EXISTS ix_att_manual_entries_root_id ON att_manual_entries (root_id);
CREATE INDEX IF NOT EXISTS ix_att_manual_entries_supersedes_id ON att_manual_entries (supersedes_id);
CREATE INDEX IF NOT EXISTS ix_att_manual_entries_evidence ON att_manual_entries (evidence_file_id);
CREATE TABLE IF NOT EXISTS att_period_locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  period_start   TEXT    NOT NULL,
  period_end     TEXT    NOT NULL,
  lock_site_id   INTEGER REFERENCES org_sites (id),
  status         TEXT    NOT NULL DEFAULT 'LOCKED' CHECK (status IN ('LOCKED', 'REOPEN_PENDING', 'REOPENED')),
  locked_at      TEXT    NOT NULL,
  locked_by      TEXT    NOT NULL,
  summary_json   TEXT    NOT NULL DEFAULT '{}',
  reopen_reason  TEXT,
  reopen_requested_by TEXT,
  reopened_at    TEXT,
  reopened_by    TEXT,
  workflow_instance_id INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_period_locks_active ON att_period_locks (company_id, period_start, COALESCE(lock_site_id, 0)) WHERE status IN ('LOCKED', 'REOPEN_PENDING');
CREATE INDEX IF NOT EXISTS ix_att_period_locks_company_id ON att_period_locks (company_id);
CREATE INDEX IF NOT EXISTS ix_att_period_locks_site ON att_period_locks (lock_site_id);

CREATE TABLE IF NOT EXISTS att_arrears (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  person_type    TEXT    NOT NULL DEFAULT 'EMPLOYEE' CHECK (person_type IN ('EMPLOYEE', 'WORKER')),
  person_id      INTEGER NOT NULL,
  work_date      TEXT    NOT NULL,
  arrears_site_id INTEGER REFERENCES org_sites (id),
  period_start   TEXT    NOT NULL,
  lock_id        INTEGER REFERENCES att_period_locks (id),
  before_json    TEXT    NOT NULL,
  after_json     TEXT    NOT NULL,
  delta_paid     REAL    NOT NULL DEFAULT 0,
  delta_lop      REAL    NOT NULL DEFAULT 0,
  delta_ot_minutes INTEGER NOT NULL DEFAULT 0,
  cause          TEXT,
  status         TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'FOLDED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_arrears_open ON att_arrears (company_id, person_type, person_id, work_date) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS ix_att_arrears_company_id ON att_arrears (company_id);
CREATE INDEX IF NOT EXISTS ix_att_arrears_lock ON att_arrears (lock_id);
CREATE INDEX IF NOT EXISTS ix_att_arrears_site ON att_arrears (arrears_site_id);
