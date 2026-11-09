-- Part 07.04: shifts, work calendars and attendance policies (module hr). att_shifts: the shift master (times in minutes of the day; a shift whose end is not after its start crosses midnight); a shift in use keeps its times.
-- att_policies: attendance policy versions, approval-controlled, effective-dated (rules_json); att_policy_assignments: which policy, shift, weekly off and holiday calendar apply to the company, a site, a crew or an employee from a date;
-- att_rosters: rotating shift patterns per site or crew; att_roster_changes: a change of one day or a swap of two people, approval-controlled; att_period_defs and att_periods: the attendance period aligned with payroll and its closing.

CREATE TABLE IF NOT EXISTS att_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code           TEXT    NOT NULL COLLATE NOCASE,
  name           TEXT    NOT NULL,
  start_minute   INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute     INTEGER NOT NULL CHECK (end_minute BETWEEN 0 AND 1439),
  night_shift    INTEGER NOT NULL DEFAULT 0 CHECK (night_shift IN (0, 1)),
  break_minutes  INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 480),
  grace_minutes  INTEGER NOT NULL DEFAULT 0 CHECK (grace_minutes BETWEEN 0 AND 120),
  half_day_minutes INTEGER NOT NULL CHECK (half_day_minutes > 0),
  full_day_minutes INTEGER NOT NULL CHECK (full_day_minutes > 0),
  ot_after_minutes INTEGER CHECK (ot_after_minutes IS NULL OR ot_after_minutes > 0),
  rounding_minutes INTEGER NOT NULL DEFAULT 0 CHECK (rounding_minutes IN (0, 5, 10, 15, 30)),
  rounding_mode  TEXT    NOT NULL DEFAULT 'NEAREST' CHECK (rounding_mode IN ('NEAREST', 'UP', 'DOWN')),
  status         TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
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
  CHECK (half_day_minutes <= full_day_minutes)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_shifts_code ON att_shifts (company_id, code);
CREATE INDEX IF NOT EXISTS ix_att_shifts_company_id ON att_shifts (company_id);

CREATE TABLE IF NOT EXISTS att_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code           TEXT    NOT NULL COLLATE NOCASE,
  name           TEXT    NOT NULL,
  version_no     INTEGER NOT NULL DEFAULT 1,
  root_id        INTEGER REFERENCES att_policies (id),
  supersedes_id  INTEGER REFERENCES att_policies (id),
  effective_from TEXT    NOT NULL,
  rules_json     TEXT    NOT NULL,
  band           TEXT    NOT NULL DEFAULT 'STANDARD' CHECK (band IN ('STANDARD', 'PAY_IMPACTING')),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  change_note    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_policies_version ON att_policies (company_id, code, version_no);
CREATE INDEX IF NOT EXISTS ix_att_policies_company_id ON att_policies (company_id);
CREATE INDEX IF NOT EXISTS ix_att_policies_status ON att_policies (company_id, status);
CREATE INDEX IF NOT EXISTS ix_att_policies_root_id ON att_policies (root_id);
CREATE INDEX IF NOT EXISTS ix_att_policies_supersedes_id ON att_policies (supersedes_id);

CREATE TABLE IF NOT EXISTS att_policy_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  scope_type     TEXT    NOT NULL CHECK (scope_type IN ('COMPANY', 'SITE', 'CREW', 'EMPLOYEE')),
  scope_id       INTEGER NOT NULL DEFAULT 0,
  policy_code    TEXT    COLLATE NOCASE,
  shift_id       INTEGER REFERENCES att_shifts (id),
  weekly_off_json TEXT,
  holiday_calendar_id INTEGER REFERENCES core_holiday_calendars (id),
  effective_from TEXT    NOT NULL,
  effective_to   TEXT,
  reason         TEXT,
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
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (policy_code IS NOT NULL OR shift_id IS NOT NULL OR weekly_off_json IS NOT NULL OR holiday_calendar_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_att_policy_assignments_company_id ON att_policy_assignments (company_id);
CREATE INDEX IF NOT EXISTS ix_att_policy_assignments_scope ON att_policy_assignments (company_id, scope_type, scope_id);
CREATE INDEX IF NOT EXISTS ix_att_policy_assignments_shift ON att_policy_assignments (shift_id);
CREATE INDEX IF NOT EXISTS ix_att_policy_assignments_calendar ON att_policy_assignments (holiday_calendar_id);

CREATE TABLE IF NOT EXISTS att_rosters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  roster_site_id INTEGER NOT NULL REFERENCES org_sites (id),
  crew_id        INTEGER REFERENCES hr_crews (id),
  name           TEXT    NOT NULL,
  pattern_json   TEXT    NOT NULL,
  from_date      TEXT    NOT NULL,
  to_date        TEXT,
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
  CHECK (to_date IS NULL OR to_date >= from_date)
);
CREATE INDEX IF NOT EXISTS ix_att_rosters_company_id ON att_rosters (company_id);
CREATE INDEX IF NOT EXISTS ix_att_rosters_site ON att_rosters (roster_site_id);
CREATE INDEX IF NOT EXISTS ix_att_rosters_crew ON att_rosters (crew_id);

CREATE TABLE IF NOT EXISTS att_roster_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  change_site_id INTEGER NOT NULL REFERENCES org_sites (id),
  kind           TEXT    NOT NULL CHECK (kind IN ('CHANGE', 'SWAP')),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  swap_employee_id INTEGER REFERENCES hr_employees (id),
  work_date      TEXT    NOT NULL,
  shift_id       INTEGER REFERENCES att_shifts (id),
  is_off         INTEGER NOT NULL DEFAULT 0 CHECK (is_off IN (0, 1)),
  swap_shift_id  INTEGER REFERENCES att_shifts (id),
  swap_is_off    INTEGER NOT NULL DEFAULT 0 CHECK (swap_is_off IN (0, 1)),
  reason         TEXT    NOT NULL,
  band           TEXT    NOT NULL DEFAULT 'STANDARD' CHECK (band IN ('STANDARD', 'RAISED_BY_WSUP')),
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
  remarks     TEXT,
  CHECK ((kind = 'SWAP' AND swap_employee_id IS NOT NULL AND swap_employee_id != employee_id) OR (kind = 'CHANGE' AND swap_employee_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_roster_changes_doc ON att_roster_changes (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_att_roster_changes_company_id ON att_roster_changes (company_id);
CREATE INDEX IF NOT EXISTS ix_att_roster_changes_site ON att_roster_changes (change_site_id);
CREATE INDEX IF NOT EXISTS ix_att_roster_changes_employee ON att_roster_changes (employee_id, work_date);
CREATE INDEX IF NOT EXISTS ix_att_roster_changes_swap ON att_roster_changes (swap_employee_id);
CREATE INDEX IF NOT EXISTS ix_att_roster_changes_shift ON att_roster_changes (shift_id);
CREATE INDEX IF NOT EXISTS ix_att_roster_changes_swap_shift ON att_roster_changes (swap_shift_id);
CREATE INDEX IF NOT EXISTS ix_att_roster_changes_status ON att_roster_changes (company_id, status);

CREATE TABLE IF NOT EXISTS att_period_defs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  start_day      INTEGER NOT NULL CHECK (start_day BETWEEN 1 AND 28),
  effective_from TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_att_period_defs_company_id ON att_period_defs (company_id);

CREATE TABLE IF NOT EXISTS att_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  period_start   TEXT    NOT NULL,
  period_end     TEXT    NOT NULL,
  label          TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  closed_by      TEXT,
  closed_at      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_periods_start ON att_periods (company_id, period_start);
CREATE INDEX IF NOT EXISTS ix_att_periods_company_id ON att_periods (company_id);
