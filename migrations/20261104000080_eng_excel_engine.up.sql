-- Part 04.13: the Excel import and export engine.
-- xl_templates hold a company's settings of an import type (instructions, column labels and help, chunked commit), versioned and changed only by an approved change; the standard definition comes from the module
-- that registered the import type. xl_jobs are the import jobs (upload, check, preview, commit, history); xl_job_errors are the row-level errors of a check (sheet, row, column, value, reason).

CREATE TABLE IF NOT EXISTS xl_templates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  import_type      TEXT    NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1 CHECK (template_version >= 1),
  columns_json     TEXT    NOT NULL DEFAULT '{}',
  instructions     TEXT    NOT NULL DEFAULT '',
  settings_json    TEXT    NOT NULL DEFAULT '{}',
  status           TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  instance_id      INTEGER,
  reason           TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_xl_templates_version ON xl_templates (company_id, import_type, template_version);
CREATE UNIQUE INDEX IF NOT EXISTS ux_xl_templates_active ON xl_templates (company_id, import_type) WHERE status = 'ACTIVE' AND is_active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_xl_templates_pending ON xl_templates (company_id, import_type) WHERE status = 'PENDING' AND is_active = 1;
CREATE INDEX IF NOT EXISTS ix_xl_templates_instance ON xl_templates (instance_id);

CREATE TABLE IF NOT EXISTS xl_jobs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  import_type      TEXT    NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 0,
  file_id          INTEGER REFERENCES core_files (id),
  file_name        TEXT    NOT NULL,
  file_hash        TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED', 'VALIDATING', 'FAILED', 'PREVIEW', 'COMMITTING', 'COMMITTED', 'PARTIAL', 'CANCELLED')),
  mode             TEXT    NOT NULL DEFAULT 'ALL_OR_NOTHING' CHECK (mode IN ('ALL_OR_NOTHING', 'CHUNKED')),
  on_existing      TEXT    NOT NULL DEFAULT 'ERROR' CHECK (on_existing IN ('ERROR', 'UPDATE', 'SKIP')),
  total_rows       INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows       INTEGER NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  error_rows       INTEGER NOT NULL DEFAULT 0 CHECK (error_rows >= 0),
  create_rows      INTEGER NOT NULL DEFAULT 0 CHECK (create_rows >= 0),
  update_rows      INTEGER NOT NULL DEFAULT 0 CHECK (update_rows >= 0),
  skip_rows        INTEGER NOT NULL DEFAULT 0 CHECK (skip_rows >= 0),
  committed_rows   INTEGER NOT NULL DEFAULT 0 CHECK (committed_rows >= 0),
  progress         INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  core_job_id      TEXT,
  last_error       TEXT,
  result_json      TEXT    NOT NULL DEFAULT '{}',
  started_by       TEXT    NOT NULL,
  started_at       TEXT    NOT NULL,
  validated_at     TEXT,
  committed_by     TEXT,
  committed_at     TEXT,
  cancelled_at     TEXT,
  actor_json       TEXT    NOT NULL DEFAULT '{}',
  commit_actor_json TEXT   NOT NULL DEFAULT '{}',
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
CREATE INDEX IF NOT EXISTS ix_xl_jobs_company_id ON xl_jobs (company_id);
CREATE INDEX IF NOT EXISTS ix_xl_jobs_file ON xl_jobs (file_id);
CREATE INDEX IF NOT EXISTS ix_xl_jobs_list ON xl_jobs (company_id, started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_xl_jobs_filter ON xl_jobs (company_id, import_type, status);
CREATE INDEX IF NOT EXISTS ix_xl_jobs_user ON xl_jobs (company_id, started_by, started_at DESC);

CREATE TABLE IF NOT EXISTS xl_job_errors (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  job_id       INTEGER NOT NULL REFERENCES xl_jobs (id),
  sheet        TEXT    NOT NULL,
  row_no       INTEGER NOT NULL CHECK (row_no >= 0),
  column_key   TEXT,
  column_label TEXT,
  value        TEXT,
  message      TEXT    NOT NULL,
  code         TEXT    NOT NULL DEFAULT 'INVALID',
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
CREATE INDEX IF NOT EXISTS ix_xl_job_errors_company_id ON xl_job_errors (company_id);
CREATE INDEX IF NOT EXISTS ix_xl_job_errors_job ON xl_job_errors (job_id, row_no, id);
