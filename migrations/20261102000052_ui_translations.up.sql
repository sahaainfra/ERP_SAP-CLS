-- Part 03.09: a company's own wording over the built-in English and Hindi text (an override of one string of one language), and each person's choice
-- of number grouping and hour format. The built-in text is in code (src/shared/i18n/locales); an override changes only what a company asks for and
-- is applied through a change request that another administrator approves.

CREATE TABLE IF NOT EXISTS ui_translations (
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_translations_key ON ui_translations (company_id, namespace, msg_key, lang);
CREATE INDEX IF NOT EXISTS ix_ui_translations_lang ON ui_translations (company_id, lang, namespace);

CREATE TABLE IF NOT EXISTS ui_locale_preferences (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  user_id      INTEGER,
  user_ref     TEXT    NOT NULL,
  number_style TEXT    CHECK (number_style IS NULL OR number_style IN ('indian', 'international')),
  time_format  TEXT    CHECK (time_format IS NULL OR time_format IN ('12', '24')),
  project_id   INTEGER,
  site_id      INTEGER,
  created_by   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by   TEXT,
  updated_at   TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at   TEXT,
  deleted_by   TEXT,
  source_type  TEXT,
  source_id    TEXT,
  remarks      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_locale_preferences_person ON ui_locale_preferences (company_id, user_ref);
