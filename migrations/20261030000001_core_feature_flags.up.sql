-- Feature flags with environment / company / project scope (part 00.02).
CREATE TABLE IF NOT EXISTS core_feature_flags (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT    NOT NULL CHECK (key GLOB 'ff.*'),
  description     TEXT,
  default_enabled INTEGER NOT NULL DEFAULT 0 CHECK (default_enabled IN (0, 1)),
  environment     TEXT    CHECK (environment IS NULL OR environment IN ('development','test','staging','production')),
  company_id      INTEGER,
  project_id      INTEGER,
  enabled         INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  changed_by      TEXT,
  changed_at      TEXT,
  created_by      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by      TEXT,
  updated_at      TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at      TEXT,
  deleted_by      TEXT,
  source_type     TEXT,
  source_id       TEXT,
  remarks         TEXT,
  CHECK (project_id IS NULL OR company_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_feature_flags_scope
  ON core_feature_flags (key, COALESCE(environment, ''), COALESCE(company_id, 0), COALESCE(project_id, 0));
CREATE INDEX IF NOT EXISTS ix_core_feature_flags_company ON core_feature_flags (company_id);
CREATE INDEX IF NOT EXISTS ix_core_feature_flags_project ON core_feature_flags (project_id);
