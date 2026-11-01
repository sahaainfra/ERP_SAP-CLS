-- Part 03.03: saved list views (personal, or shared with roles or projects) and the background exports of lists.

CREATE TABLE IF NOT EXISTS ui_saved_views (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES org_companies (id),
  owner_user_id     INTEGER REFERENCES iam_users (id),
  owner_ref         TEXT    NOT NULL,
  list_code         TEXT    NOT NULL,
  name              TEXT    NOT NULL,
  is_shared         INTEGER NOT NULL DEFAULT 0 CHECK (is_shared IN (0, 1)),
  share_scope_json  TEXT    NOT NULL DEFAULT '{}',
  config_json       TEXT    NOT NULL DEFAULT '{}',
  is_default        INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  project_id        INTEGER,
  site_id           INTEGER,
  created_by        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by        TEXT,
  updated_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at        TEXT,
  deleted_by        TEXT,
  source_type       TEXT,
  source_id         TEXT,
  remarks           TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_saved_views_name ON ui_saved_views (company_id, owner_ref, list_code, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ui_saved_views_list ON ui_saved_views (company_id, list_code, is_shared);
CREATE INDEX IF NOT EXISTS ix_ui_saved_views_owner ON ui_saved_views (owner_user_id);

CREATE TABLE IF NOT EXISTS ui_export_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  user_id       INTEGER REFERENCES iam_users (id),
  user_ref      TEXT    NOT NULL,
  list_code     TEXT    NOT NULL,
  format        TEXT    NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf')),
  query_json    TEXT    NOT NULL DEFAULT '{}',
  actor_json    TEXT    NOT NULL DEFAULT '{}',
  status        TEXT    NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED')),
  rows_planned  INTEGER NOT NULL DEFAULT 0 CHECK (rows_planned >= 0),
  rows_written  INTEGER NOT NULL DEFAULT 0 CHECK (rows_written >= 0),
  file_name     TEXT,
  storage_key   TEXT,
  bytes         INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  error         TEXT,
  job_id        INTEGER,
  finished_at   TEXT,
  expires_at    TEXT,
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
CREATE INDEX IF NOT EXISTS ix_ui_export_jobs_owner ON ui_export_jobs (company_id, user_ref, created_at);
CREATE INDEX IF NOT EXISTS ix_ui_export_jobs_status ON ui_export_jobs (company_id, status);
CREATE INDEX IF NOT EXISTS ix_ui_export_jobs_user ON ui_export_jobs (user_id);
