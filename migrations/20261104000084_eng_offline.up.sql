-- Part 04.15: the offline-first field engine.
-- off_devices are the browsers a person registered for offline work (revoking one wipes its local copy at its next contact). off_sync_log has one row for each command a device queued while offline (a client-made id makes
-- a replay harmless), with its outcome and, for a conflict, what the server holds. off_uploads are photos sent in resumable chunks.

CREATE TABLE IF NOT EXISTS off_devices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  user_ref         TEXT    NOT NULL,
  device_id        TEXT    NOT NULL,
  device_name      TEXT    NOT NULL DEFAULT '',
  platform         TEXT,
  registered_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_sync_at     TEXT,
  last_seen_at     TEXT,
  clock_drift_ms   INTEGER NOT NULL DEFAULT 0,
  revoked_at       TEXT,
  revoked_by       TEXT,
  revoke_reason    TEXT,
  wiped_at         TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_off_devices_user_device ON off_devices (company_id, user_ref, device_id);
CREATE INDEX IF NOT EXISTS ix_off_devices_user ON off_devices (company_id, user_ref, revoked_at);

CREATE TABLE IF NOT EXISTS off_sync_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  device_pk        INTEGER NOT NULL REFERENCES off_devices (id),
  user_ref         TEXT    NOT NULL,
  command_id       TEXT    NOT NULL,
  seq              INTEGER NOT NULL DEFAULT 0,
  command_type     TEXT    NOT NULL,
  op               TEXT    NOT NULL DEFAULT 'create' CHECK (op IN ('create', 'update')),
  client_ref       TEXT,
  status           TEXT    NOT NULL CHECK (status IN ('APPLIED', 'CONFLICT', 'REJECTED', 'NEEDS_CONFIRMATION', 'DEFERRED', 'RESOLVED', 'DECLINED')),
  server_entity_id TEXT,
  base_version     INTEGER,
  payload_json     TEXT    NOT NULL DEFAULT '{}',
  conflict_json    TEXT,
  result_json      TEXT,
  error_message    TEXT,
  client_created_at TEXT,
  device_clock_at  TEXT,
  effective_at     TEXT,
  lat              REAL,
  lng              REAL,
  accuracy         REAL,
  received_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at     TEXT,
  confirmed_by     TEXT,
  confirmed_at     TEXT,
  actor_json       TEXT,
  resolution       TEXT    CHECK (resolution IS NULL OR resolution IN ('MINE', 'SERVER', 'MERGE')),
  resolved_by      TEXT,
  resolved_at      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_off_sync_command ON off_sync_log (company_id, command_id);
CREATE INDEX IF NOT EXISTS ix_off_sync_device ON off_sync_log (device_pk, seq);
CREATE INDEX IF NOT EXISTS ix_off_sync_user ON off_sync_log (company_id, user_ref, status, id);
CREATE INDEX IF NOT EXISTS ix_off_sync_status ON off_sync_log (company_id, status, id);
CREATE INDEX IF NOT EXISTS ix_off_sync_ref ON off_sync_log (company_id, client_ref);
CREATE INDEX IF NOT EXISTS ix_off_sync_entity ON off_sync_log (company_id, command_type, server_entity_id);

CREATE TABLE IF NOT EXISTS off_uploads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  device_pk     INTEGER NOT NULL REFERENCES off_devices (id),
  user_ref      TEXT    NOT NULL,
  upload_id     TEXT    NOT NULL,
  command_id    TEXT    NOT NULL,
  file_name     TEXT    NOT NULL,
  total_size    INTEGER NOT NULL CHECK (total_size >= 0),
  chunk_size    INTEGER NOT NULL CHECK (chunk_size > 0),
  total_chunks  INTEGER NOT NULL CHECK (total_chunks >= 1),
  received_json TEXT    NOT NULL DEFAULT '[]',
  sha256        TEXT,
  status        TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETE', 'FAILED')),
  file_id       INTEGER REFERENCES core_files (id),
  error_message TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_off_uploads_id ON off_uploads (upload_id);
CREATE INDEX IF NOT EXISTS ix_off_uploads_device ON off_uploads (device_pk, status);
CREATE INDEX IF NOT EXISTS ix_off_uploads_command ON off_uploads (company_id, command_id);
CREATE INDEX IF NOT EXISTS ix_off_uploads_file ON off_uploads (file_id);
CREATE INDEX IF NOT EXISTS ix_off_uploads_company_id ON off_uploads (company_id);
CREATE INDEX IF NOT EXISTS ix_off_sync_log_company_id ON off_sync_log (company_id);
CREATE INDEX IF NOT EXISTS ix_off_devices_company_id ON off_devices (company_id);
