-- Part 03.05: the application shell. The navigation registry (what the menu holds, in which group, behind which permission and flag),
-- each person's favourites, recently opened records and remembered working context.

CREATE TABLE IF NOT EXISTS ui_navigation_entries (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER REFERENCES org_companies (id),
  code               TEXT    NOT NULL UNIQUE,
  parent_code        TEXT    REFERENCES ui_navigation_entries (code),
  kind               TEXT    NOT NULL CHECK (kind IN ('group', 'page')),
  placement          TEXT    NOT NULL DEFAULT 'sidebar' CHECK (placement IN ('sidebar', 'user_menu', 'console')),
  label              TEXT    NOT NULL,
  label_hi           TEXT,
  route              TEXT,
  icon               TEXT,
  permission_key     TEXT,
  feature_flag       TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 100,
  keywords           TEXT,
  mobile_visible     INTEGER NOT NULL DEFAULT 1 CHECK (mobile_visible IN (0, 1)),
  requires_context   TEXT    CHECK (requires_context IN ('project', 'site')),
  onboarding         TEXT    NOT NULL DEFAULT 'none' CHECK (onboarding IN ('none', 'allowed', 'only')),
  shortcut           TEXT    CHECK (shortcut IS NULL OR length(shortcut) = 1),
  tile               INTEGER NOT NULL DEFAULT 0 CHECK (tile IN (0, 1)),
  quick_create_label TEXT,
  quick_create_route TEXT,
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT,
  -- BR-01: a page needs a permission key (the key 'self' means any signed-in person); only Home and Profile may go without
  CHECK (kind = 'group' OR permission_key IS NOT NULL OR code IN ('home', 'profile')),
  CHECK (kind = 'group' OR route IS NOT NULL),
  CHECK (quick_create_label IS NULL OR quick_create_route IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_ui_navigation_parent ON ui_navigation_entries (parent_code, sort_order);
CREATE INDEX IF NOT EXISTS ix_ui_navigation_company ON ui_navigation_entries (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_navigation_route ON ui_navigation_entries (route) WHERE route IS NOT NULL AND is_active = 1;

CREATE TABLE IF NOT EXISTS ui_favourites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  user_ref      TEXT    NOT NULL,
  ref_key       TEXT    NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN ('page', 'record')),
  nav_code      TEXT,
  entity        TEXT,
  entity_id     INTEGER,
  title         TEXT    NOT NULL,
  route         TEXT    NOT NULL,
  sort_order    INTEGER NOT NULL DEFAULT 100,
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_favourites_ref ON ui_favourites (company_id, user_ref, ref_key);
CREATE INDEX IF NOT EXISTS ix_ui_favourites_user ON ui_favourites (company_id, user_ref, sort_order);

CREATE TABLE IF NOT EXISTS ui_recent_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  user_ref      TEXT    NOT NULL,
  entity        TEXT    NOT NULL,
  entity_id     INTEGER NOT NULL,
  title         TEXT    NOT NULL,
  route         TEXT    NOT NULL,
  visited_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  visit_count   INTEGER NOT NULL DEFAULT 1,
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_recent_records_ref ON ui_recent_records (company_id, user_ref, entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_ui_recent_records_user ON ui_recent_records (company_id, user_ref, visited_at);

CREATE TABLE IF NOT EXISTS ui_user_context (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  user_ref      TEXT    NOT NULL,
  context_project_id INTEGER REFERENCES org_projects (id),
  context_site_id    INTEGER REFERENCES org_sites (id),
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_user_context_user ON ui_user_context (company_id, user_ref);
CREATE INDEX IF NOT EXISTS ix_ui_user_context_project ON ui_user_context (context_project_id);
CREATE INDEX IF NOT EXISTS ix_ui_user_context_site ON ui_user_context (context_site_id);
