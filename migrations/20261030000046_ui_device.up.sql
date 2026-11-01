-- Part 03.06: device capabilities. The browsers (phones, tablets, computers) a person has allowed to receive Web Push, and the tiles of the
-- field home (which pages of the navigation registry a site person gets as quick actions, under which name).

CREATE TABLE IF NOT EXISTS ui_push_subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  user_ref      TEXT    NOT NULL,
  endpoint      TEXT    NOT NULL,
  p256dh        TEXT    NOT NULL,
  auth          TEXT    NOT NULL,
  user_agent    TEXT,
  device_label  TEXT,
  expires_at    TEXT,
  last_used_at  TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
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
-- one browser, one subscription: the address the push service gave it is unique across people
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_push_subscriptions_endpoint ON ui_push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS ix_ui_push_subscriptions_user ON ui_push_subscriptions (company_id, user_ref, is_active);

CREATE TABLE IF NOT EXISTS ui_field_tiles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER REFERENCES org_companies (id),
  code          TEXT    NOT NULL,
  nav_code      TEXT    NOT NULL REFERENCES ui_navigation_entries (code),
  label         TEXT    NOT NULL,
  label_hi      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_field_tiles_code ON ui_field_tiles (COALESCE(company_id, 0), code);
CREATE INDEX IF NOT EXISTS ix_ui_field_tiles_nav ON ui_field_tiles (nav_code);
CREATE INDEX IF NOT EXISTS ix_ui_field_tiles_company ON ui_field_tiles (company_id, sort_order);
