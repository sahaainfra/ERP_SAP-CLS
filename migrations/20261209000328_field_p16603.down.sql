-- Part 166.3 down: the language checks back to English and Hindi (a Telugu preference becomes English, a Telugu wording of the company is
-- removed), the bottom bar by role and the Telugu and role columns removed, the 03.06 field tiles as they were, the flag removed.
CREATE TABLE ui_translations_p16603 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  namespace   TEXT    NOT NULL CHECK (namespace GLOB '[a-z]*' AND length(namespace) <= 40),
  msg_key     TEXT    NOT NULL CHECK (length(msg_key) BETWEEN 1 AND 120),
  lang        TEXT    NOT NULL CHECK (lang IN ('en', 'hi')),
  text        TEXT    NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
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
INSERT INTO ui_translations_p16603 SELECT * FROM ui_translations WHERE lang <> 'te';
DROP TABLE ui_translations;
ALTER TABLE ui_translations_p16603 RENAME TO ui_translations;
CREATE UNIQUE INDEX ux_ui_translations_key ON ui_translations (company_id, namespace, msg_key, lang);
CREATE INDEX ix_ui_translations_lang ON ui_translations (company_id, lang, namespace);

CREATE TABLE ui_user_preferences_p16603 (
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
INSERT INTO ui_user_preferences_p16603 SELECT id, company_id, user_id, user_ref, theme, density, CASE WHEN language = 'te' THEN 'en' ELSE language END, start_page, table_settings_json,
  project_id, site_id, created_by, created_at, updated_by, updated_at, version, is_active, deleted_at, deleted_by, source_type, source_id, remarks FROM ui_user_preferences;
DROP TABLE ui_user_preferences;
ALTER TABLE ui_user_preferences_p16603 RENAME TO ui_user_preferences;
CREATE UNIQUE INDEX ux_ui_user_preferences_person ON ui_user_preferences (company_id, user_ref);
CREATE INDEX ix_ui_user_preferences_user ON ui_user_preferences (user_id);

DROP TABLE IF EXISTS ui_bottom_bar;

DELETE FROM ui_field_tiles WHERE feature_flag = 'ff.field.p16603' AND source_type = 'reference_seed';
ALTER TABLE ui_field_tiles DROP COLUMN tone;
ALTER TABLE ui_field_tiles DROP COLUMN retired_flag;
ALTER TABLE ui_field_tiles DROP COLUMN feature_flag;
ALTER TABLE ui_field_tiles DROP COLUMN role_codes;
ALTER TABLE ui_field_tiles DROP COLUMN label_te;
ALTER TABLE ui_navigation_entries DROP COLUMN label_te;

DELETE FROM core_feature_flags WHERE key = 'ff.field.p16603';
