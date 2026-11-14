-- Part 17.08: manpower and plant demand (from the resource-loaded schedules) and supply (deployments, allocations, the available pool) by project and week, the resource plans (scenarios, approval-controlled) and the requests an approved plan raises. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS rp_demand (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  week_start      TEXT    NOT NULL,
  resource_type   TEXT    NOT NULL CHECK (resource_type IN ('LABOUR', 'PLANT')),
  res_key         TEXT    NOT NULL COLLATE NOCASE,
  label           TEXT    NOT NULL,
  qty_required    INTEGER NOT NULL DEFAULT 0 CHECK (qty_required >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_rp_demand_key ON rp_demand (org_project_id, week_start, resource_type, res_key);
CREATE INDEX IF NOT EXISTS ix_rp_demand_company ON rp_demand (company_id, week_start);

CREATE TABLE IF NOT EXISTS rp_supply (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  week_start      TEXT    NOT NULL,
  resource_type   TEXT    NOT NULL CHECK (resource_type IN ('LABOUR', 'PLANT')),
  res_key         TEXT    NOT NULL COLLATE NOCASE,
  label           TEXT    NOT NULL,
  qty_available   INTEGER NOT NULL DEFAULT 0 CHECK (qty_available >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_rp_supply_key ON rp_supply (COALESCE(org_project_id, 0), week_start, resource_type, res_key);
CREATE INDEX IF NOT EXISTS ix_rp_supply_company ON rp_supply (company_id, week_start);
CREATE INDEX IF NOT EXISTS ix_rp_supply_project ON rp_supply (org_project_id);

CREATE TABLE IF NOT EXISTS rp_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  plan_date       TEXT    NOT NULL,
  scenario_json   TEXT    NOT NULL DEFAULT '{"actions":[]}',
  projects_json   TEXT    NOT NULL DEFAULT '[]',
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  cancel_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_rp_plans_doc ON rp_plans (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_rp_plans_status ON rp_plans (company_id, status);

CREATE TABLE IF NOT EXISTS rp_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  plan_id         INTEGER NOT NULL REFERENCES rp_plans (id),
  action_no       INTEGER NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('MOVE', 'HIRE', 'HIRE_IN')),
  target_module   TEXT    NOT NULL CHECK (target_module IN ('DEPLOYMENT', 'HIRING', 'REQUISITION', 'ALLOCATION')),
  resource_type   TEXT    NOT NULL CHECK (resource_type IN ('LABOUR', 'PLANT')),
  res_key         TEXT    NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  from_project_id INTEGER REFERENCES org_projects (id),
  to_project_id   INTEGER NOT NULL REFERENCES org_projects (id),
  from_week       TEXT    NOT NULL,
  to_week         TEXT    NOT NULL,
  request_status  TEXT    NOT NULL DEFAULT 'RAISED' CHECK (request_status IN ('RAISED', 'CLOSED', 'CANCELLED')),
  ref_doc         TEXT,
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
CREATE INDEX IF NOT EXISTS ix_rp_requests_plan ON rp_requests (plan_id);
CREATE INDEX IF NOT EXISTS ix_rp_requests_from ON rp_requests (from_project_id);
CREATE INDEX IF NOT EXISTS ix_rp_requests_to ON rp_requests (to_project_id);
CREATE INDEX IF NOT EXISTS ix_rp_requests_company ON rp_requests (company_id, request_status);
