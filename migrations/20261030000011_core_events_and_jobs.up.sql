-- Event catalogue, consumer inbox (de-duplication, retry, dead letters), background jobs, schedules and the
-- demonstration projection used to prove replay (part 01.04). core_outbox (part 00.02) is unchanged: its rows are
-- the event log, published_at marks that the relay has fanned the event out to its consumers.

CREATE TABLE IF NOT EXISTS core_event_types (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT    NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  schema_json  TEXT    NOT NULL,
  owner_module TEXT    NOT NULL,
  description  TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_event_types_type ON core_event_types (type, version);
CREATE INDEX IF NOT EXISTS ix_core_event_types_owner ON core_event_types (owner_module);

CREATE TABLE IF NOT EXISTS core_inbox (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  consumer        TEXT    NOT NULL,
  event_id        TEXT    NOT NULL,
  outbox_id       INTEGER NOT NULL REFERENCES core_outbox(id),
  event_type      TEXT    NOT NULL,
  company_id      INTEGER,
  status          TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSED', 'DEAD', 'DISCARDED')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT    NOT NULL,
  last_error      TEXT,
  processed_at    TEXT,
  resolved_by     TEXT,
  resolution      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_inbox_consumer_event ON core_inbox (consumer, event_id);
CREATE INDEX IF NOT EXISTS ix_core_inbox_due ON core_inbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_core_inbox_outbox ON core_inbox (outbox_id);

CREATE TABLE IF NOT EXISTS core_jobs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id            TEXT    NOT NULL,
  type              TEXT    NOT NULL,
  params_json       TEXT    NOT NULL DEFAULT '{}',
  status            TEXT    NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  progress          INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  progress_message  TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  run_after         TEXT    NOT NULL,
  started_at        TEXT,
  finished_at       TEXT,
  heartbeat_at      TEXT,
  error             TEXT,
  result_json       TEXT,
  log_json          TEXT    NOT NULL DEFAULT '[]',
  cancel_requested  INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  created_by        TEXT    NOT NULL,
  company_id        INTEGER,
  schedule_code     TEXT,
  scheduled_for     TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_jobs_job_id ON core_jobs (job_id);
CREATE INDEX IF NOT EXISTS ix_core_jobs_due ON core_jobs (status, run_after);
CREATE INDEX IF NOT EXISTS ix_core_jobs_type ON core_jobs (type, status);
CREATE INDEX IF NOT EXISTS ix_core_jobs_company ON core_jobs (company_id);
-- The same scheduled run can never create two jobs, whichever instance asks.
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_jobs_schedule_run ON core_jobs (schedule_code, scheduled_for) WHERE schedule_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS core_schedules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER,
  code        TEXT    NOT NULL,
  description TEXT,
  cron        TEXT    NOT NULL,
  job_type    TEXT    NOT NULL,
  params_json TEXT    NOT NULL DEFAULT '{}',
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_run_at TEXT,
  next_run_at TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_schedules_code ON core_schedules (code);
CREATE INDEX IF NOT EXISTS ix_core_schedules_due ON core_schedules (enabled, next_run_at);
CREATE INDEX IF NOT EXISTS ix_core_schedules_company ON core_schedules (company_id);

-- A projection built from events, to prove that replaying a date range rebuilds a read model identically.
CREATE TABLE IF NOT EXISTS core_projection_event_counts (
  company_id INTEGER NOT NULL,
  event_type TEXT    NOT NULL,
  total      INTEGER NOT NULL DEFAULT 0,
  last_event_at TEXT,
  PRIMARY KEY (company_id, event_type)
);
