-- Part 13.02: interactive Gantt, schedule editing and resource loading. Three new tables; nothing existing is altered.
-- plan_activity_resources: the labour, plant and material an activity needs (FR-03), entered as a total or as a daily rate (the other is worked out from the duration), by hand or from the BOQ norms (rate analyses of 06.06).
-- plan_resource_capacity: what is available of a resource on a project between two dates, drafted by one person and put in force by another (maker-checker); with the approved deployments of 07.03 it is the availability line of the histograms.
-- plan_gantt_edits: every edit made on the Gantt, with the state before and after, so that it can be undone (FR-02).
CREATE TABLE IF NOT EXISTS plan_activity_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  schedule_id     INTEGER NOT NULL REFERENCES plan_schedules (id),
  activity_id     INTEGER NOT NULL REFERENCES plan_activities (id),
  resource_type   TEXT    NOT NULL CHECK (resource_type IN ('LABOUR', 'PLANT', 'MATERIAL')),
  item_id         INTEGER REFERENCES mdm_items (id),
  trade           TEXT    COLLATE NOCASE,
  res_key         TEXT    NOT NULL COLLATE NOCASE,
  label           TEXT    NOT NULL,
  uom             TEXT    NOT NULL,
  basis           TEXT    NOT NULL DEFAULT 'TOTAL' CHECK (basis IN ('TOTAL', 'PER_DAY')),
  qty_total       INTEGER NOT NULL DEFAULT 0 CHECK (qty_total >= 0),
  qty_per_day     INTEGER NOT NULL DEFAULT 0 CHECK (qty_per_day >= 0),
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
  CHECK (item_id IS NOT NULL OR trade IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_activity_resources_key ON plan_activity_resources (activity_id, resource_type, res_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_plan_activity_resources_company_id ON plan_activity_resources (company_id);
CREATE INDEX IF NOT EXISTS ix_plan_activity_resources_schedule ON plan_activity_resources (schedule_id, resource_type, res_key);
CREATE INDEX IF NOT EXISTS ix_plan_activity_resources_activity ON plan_activity_resources (activity_id);
CREATE INDEX IF NOT EXISTS ix_plan_activity_resources_item ON plan_activity_resources (item_id);

CREATE TABLE IF NOT EXISTS plan_resource_capacity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  resource_type   TEXT    NOT NULL CHECK (resource_type IN ('LABOUR', 'PLANT', 'MATERIAL')),
  item_id         INTEGER REFERENCES mdm_items (id),
  trade           TEXT    COLLATE NOCASE,
  res_key         TEXT    NOT NULL COLLATE NOCASE,
  label           TEXT    NOT NULL,
  uom             TEXT    NOT NULL,
  qty_per_day     INTEGER NOT NULL CHECK (qty_per_day > 0),
  from_date       TEXT    NOT NULL,
  to_date         TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'CANCELLED')),
  reason          TEXT,
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
  remarks     TEXT,
  CHECK (to_date >= from_date),
  CHECK (item_id IS NOT NULL OR trade IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_plan_resource_capacity_company_id ON plan_resource_capacity (company_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_resource_capacity_project ON plan_resource_capacity (org_project_id, resource_type, res_key, status);
CREATE INDEX IF NOT EXISTS ix_plan_resource_capacity_item ON plan_resource_capacity (item_id);

CREATE TABLE IF NOT EXISTS plan_gantt_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  schedule_id     INTEGER NOT NULL REFERENCES plan_schedules (id),
  op              TEXT    NOT NULL CHECK (op IN ('MOVE', 'RESIZE', 'EDIT', 'LINK', 'UNLINK', 'ADD', 'DELETE', 'RESOURCES')),
  summary         TEXT    NOT NULL,
  before_json     TEXT    NOT NULL,
  after_json      TEXT    NOT NULL,
  finish_before   TEXT,
  finish_after    TEXT,
  undone_at       TEXT,
  undone_by       TEXT,
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
CREATE INDEX IF NOT EXISTS ix_plan_gantt_edits_company_id ON plan_gantt_edits (company_id);
CREATE INDEX IF NOT EXISTS ix_plan_gantt_edits_schedule ON plan_gantt_edits (schedule_id, id);
