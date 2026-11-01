-- Part 03.07: the dashboard and widget framework. The widget registry (what a widget is: its type, the permission it needs, its size, how often it
-- refreshes, where a click on it goes) and the dashboards (a layout of widgets, owned by the system, by a role as its default, or by one person
-- as their own copy). The data of a widget comes from the module that owns it, through a provider registered in code under the same widget code.

CREATE TABLE IF NOT EXISTS ui_widgets (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER REFERENCES org_companies (id),
  code               TEXT    NOT NULL UNIQUE,
  module             TEXT    NOT NULL,
  title              TEXT    NOT NULL,
  title_hi           TEXT,
  description        TEXT,
  type               TEXT    NOT NULL CHECK (type IN ('kpi', 'line', 'bar', 'stacked', 'area', 'donut', 'gauge', 'heatmap', 'gantt', 'table', 'alerts', 'list', 'calendar', 'map', 'notice', 'actions')),
  data_endpoint      TEXT    NOT NULL,
  params_schema_json TEXT    NOT NULL DEFAULT '{}',
  permission_key     TEXT    NOT NULL,
  default_w          INTEGER NOT NULL DEFAULT 4 CHECK (default_w BETWEEN 1 AND 12),
  default_h          INTEGER NOT NULL DEFAULT 1 CHECK (default_h BETWEEN 1 AND 4),
  refresh_sec        INTEGER NOT NULL DEFAULT 60 CHECK (refresh_sec = 0 OR refresh_sec >= 15),
  drill_route        TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 100,
  project_id         INTEGER,
  site_id            INTEGER,
  created_by         TEXT,
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by         TEXT,
  updated_at         TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at         TEXT,
  deleted_by         TEXT,
  source_type        TEXT,
  source_id          TEXT,
  remarks            TEXT
);
CREATE INDEX IF NOT EXISTS ix_ui_widgets_module ON ui_widgets (module, sort_order);
CREATE INDEX IF NOT EXISTS ix_ui_widgets_company ON ui_widgets (company_id);

-- One dashboard code can have a system layout, a default for each role (per company) and a copy of each person (per company).
CREATE TABLE IF NOT EXISTS ui_dashboards (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER REFERENCES org_companies (id),
  code           TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  owner_type     TEXT    NOT NULL CHECK (owner_type IN ('system', 'role', 'user')),
  owner_ref      TEXT    NOT NULL,
  permission_key TEXT    NOT NULL DEFAULT 'self',
  layout_json    TEXT    NOT NULL DEFAULT '[]',
  filters_json   TEXT    NOT NULL DEFAULT '{}',
  is_default     INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  project_id     INTEGER,
  site_id        INTEGER,
  created_by     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by     TEXT,
  updated_at     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at     TEXT,
  deleted_by     TEXT,
  source_type    TEXT,
  source_id      TEXT,
  remarks        TEXT,
  CHECK ((owner_type = 'system' AND company_id IS NULL) OR (owner_type != 'system' AND company_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_dashboards_owner ON ui_dashboards (COALESCE(company_id, 0), code, owner_type, owner_ref);
CREATE INDEX IF NOT EXISTS ix_ui_dashboards_company ON ui_dashboards (company_id, code);
CREATE INDEX IF NOT EXISTS ix_ui_dashboards_owner_ref ON ui_dashboards (owner_type, owner_ref);
