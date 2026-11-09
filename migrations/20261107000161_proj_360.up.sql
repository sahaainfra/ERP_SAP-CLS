-- Part 10.08: Project 360 and the project dashboard (module proj). proj_360_widgets is the catalogue of the slots of the Project 360 page: which widget sits on which tab, who may see it and which part supplies it.
-- A slot whose owner module is not live shows an empty state that names that part; a module that goes live registers its provider and the slot fills. Nothing here stores a figure.
CREATE TABLE IF NOT EXISTS proj_360_widgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  widget_code     TEXT    NOT NULL,
  module          TEXT    NOT NULL,
  tab             TEXT    NOT NULL CHECK (tab IN ('overview', 'time', 'cost', 'resources', 'quality_hse', 'commercial', 'documents', 'activity')),
  slot            TEXT    NOT NULL DEFAULT 'main' CHECK (slot IN ('main', 'side')),
  sort_order      INTEGER NOT NULL DEFAULT 100,
  permission_key  TEXT    NOT NULL,
  owner_part      TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  title_hi        TEXT,
  empty_text      TEXT,
  drill_route     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_360_widgets_code ON proj_360_widgets (COALESCE(company_id, 0), widget_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proj_360_widgets_company_id ON proj_360_widgets (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_360_widgets_tab ON proj_360_widgets (tab, sort_order);
