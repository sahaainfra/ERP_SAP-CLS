-- Part 07.03: deployment, transfers and project/site assignment (module hr). hr_site_plans: the manpower planned for a site by designation (the adapter for 17.08 resource planning).
-- hr_crews and hr_crew_members: the gangs of a site with a supervisor and members (staff, and contract labour once 07.08 holds it). hr_deployments: approval-controlled, versioned by
-- amendment; an approved deployment drives geofence eligibility, site access and messaging groups. hr_transfers: approval-controlled moves between sites or projects with a handover checklist.

CREATE TABLE IF NOT EXISTS hr_site_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  plan_site_id    INTEGER NOT NULL REFERENCES org_sites (id),
  designation_id  INTEGER NOT NULL REFERENCES org_designations (id),
  planned         INTEGER NOT NULL CHECK (planned >= 0),
  valid_from      TEXT    NOT NULL,
  valid_to        TEXT,
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
CREATE INDEX IF NOT EXISTS ix_hr_site_plans_company_id ON hr_site_plans (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_site_plans_site ON hr_site_plans (plan_site_id);
CREATE INDEX IF NOT EXISTS ix_hr_site_plans_designation ON hr_site_plans (designation_id);

CREATE TABLE IF NOT EXISTS hr_crews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  crew_site_id   INTEGER NOT NULL REFERENCES org_sites (id),
  code           TEXT    NOT NULL COLLATE NOCASE,
  name           TEXT    NOT NULL,
  trade          TEXT,
  supervisor_id  INTEGER REFERENCES hr_employees (id),
  labour_contractor_id INTEGER,
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
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
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS ix_hr_crews_company_id ON hr_crews (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_crews_site ON hr_crews (crew_site_id);
CREATE INDEX IF NOT EXISTS ix_hr_crews_supervisor ON hr_crews (supervisor_id);

CREATE TABLE IF NOT EXISTS hr_crew_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  crew_id     INTEGER NOT NULL REFERENCES hr_crews (id),
  person_type TEXT    NOT NULL CHECK (person_type IN ('EMPLOYEE', 'WORKER')),
  person_id   INTEGER NOT NULL,
  from_date   TEXT    NOT NULL,
  to_date     TEXT,
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
CREATE INDEX IF NOT EXISTS ix_hr_crew_members_company_id ON hr_crew_members (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_crew_members_crew ON hr_crew_members (crew_id);
CREATE INDEX IF NOT EXISTS ix_hr_crew_members_person ON hr_crew_members (person_type, person_id);

CREATE TABLE IF NOT EXISTS hr_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  revision_no    INTEGER NOT NULL DEFAULT 1,
  root_id        INTEGER REFERENCES hr_deployments (id),
  supersedes_id  INTEGER REFERENCES hr_deployments (id),
  doc_date       TEXT    NOT NULL,
  person_type    TEXT    NOT NULL DEFAULT 'EMPLOYEE' CHECK (person_type IN ('EMPLOYEE', 'WORKER')),
  person_id      INTEGER NOT NULL,
  dep_project_id INTEGER NOT NULL REFERENCES org_projects (id),
  dep_site_id    INTEGER REFERENCES org_sites (id),
  crew_id        INTEGER REFERENCES hr_crews (id),
  site_role      TEXT,
  access_role    TEXT,
  from_date      TEXT    NOT NULL,
  to_date        TEXT,
  is_primary     INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
  default_wbs_id       INTEGER,
  default_cost_code_id INTEGER,
  band           TEXT    NOT NULL DEFAULT 'WITHIN_PLAN' CHECK (band IN ('WITHIN_PLAN', 'OUTSIDE_PLAN')),
  plan_json      TEXT    NOT NULL DEFAULT '{}',
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  closed_reason  TEXT,
  transfer_id    INTEGER,
  activated_at   TEXT,
  ended_event_at TEXT,
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
CREATE INDEX IF NOT EXISTS ix_hr_deployments_company_id ON hr_deployments (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_deployments_person ON hr_deployments (person_type, person_id);
CREATE INDEX IF NOT EXISTS ix_hr_deployments_project ON hr_deployments (dep_project_id);
CREATE INDEX IF NOT EXISTS ix_hr_deployments_site ON hr_deployments (dep_site_id);
CREATE INDEX IF NOT EXISTS ix_hr_deployments_crew ON hr_deployments (crew_id);
CREATE INDEX IF NOT EXISTS ix_hr_deployments_status ON hr_deployments (company_id, status);
CREATE INDEX IF NOT EXISTS ix_hr_deployments_dates ON hr_deployments (from_date, to_date);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_deployments_doc ON hr_deployments (company_id, doc_no, revision_no);

CREATE TABLE IF NOT EXISTS hr_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  revision_no    INTEGER NOT NULL DEFAULT 1,
  root_id        INTEGER REFERENCES hr_transfers (id),
  supersedes_id  INTEGER REFERENCES hr_transfers (id),
  doc_date       TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  kind           TEXT    NOT NULL DEFAULT 'TRANSFER' CHECK (kind IN ('TRANSFER', 'SECONDMENT')),
  from_project_id INTEGER REFERENCES org_projects (id),
  from_site_id   INTEGER REFERENCES org_sites (id),
  to_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  to_site_id     INTEGER REFERENCES org_sites (id),
  to_crew_id     INTEGER REFERENCES hr_crews (id),
  site_role      TEXT,
  relieve_date   TEXT    NOT NULL,
  join_date      TEXT    NOT NULL,
  return_date    TEXT,
  reason         TEXT    NOT NULL,
  travel_required INTEGER NOT NULL DEFAULT 0 CHECK (travel_required IN (0, 1)),
  accommodation_required INTEGER NOT NULL DEFAULT 0 CHECK (accommodation_required IN (0, 1)),
  handover_json  TEXT    NOT NULL DEFAULT '[]',
  scope          TEXT    NOT NULL DEFAULT 'SAME_PROJECT' CHECK (scope IN ('SAME_PROJECT', 'CROSS_PROJECT')),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  closed_reason  TEXT,
  applied_at     TEXT,
  applied_json   TEXT,
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
  CHECK (join_date >= relieve_date)
);
CREATE INDEX IF NOT EXISTS ix_hr_transfers_company_id ON hr_transfers (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_transfers_employee ON hr_transfers (employee_id);
CREATE INDEX IF NOT EXISTS ix_hr_transfers_to_project ON hr_transfers (to_project_id);
CREATE INDEX IF NOT EXISTS ix_hr_transfers_status ON hr_transfers (company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_transfers_doc ON hr_transfers (company_id, doc_no, revision_no);
