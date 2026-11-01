-- Part 03.01: each person's screen preferences. One row per person and company; the person is named by username (user_ref) so
-- development identities have preferences too, and linked to iam_users when the person is a real account.
CREATE TABLE IF NOT EXISTS ui_user_preferences (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES org_companies (id),
  user_id             INTEGER REFERENCES iam_users (id),
  user_ref            TEXT    NOT NULL,
  theme               TEXT    NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'high-contrast')),
  density             TEXT    NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable', 'compact')),
  language            TEXT    NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi')),
  start_page          TEXT,
  table_settings_json TEXT    NOT NULL DEFAULT '{}',
  project_id          INTEGER,
  site_id             INTEGER,
  created_by          TEXT,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by          TEXT,
  updated_at          TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at          TEXT,
  deleted_by          TEXT,
  source_type         TEXT,
  source_id           TEXT,
  remarks             TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_user_preferences_person ON ui_user_preferences (company_id, user_ref);
CREATE INDEX IF NOT EXISTS ix_ui_user_preferences_user ON ui_user_preferences (user_id);
