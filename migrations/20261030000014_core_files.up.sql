-- Stored files, resumable upload sessions and per-company file settings (part 01.05). The bytes live outside the
-- database (storage adapter); core_files holds what is needed to find, check and authorise them.

CREATE TABLE IF NOT EXISTS core_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  storage_key   TEXT    NOT NULL,
  original_name TEXT    NOT NULL,
  extension     TEXT    NOT NULL,
  mime          TEXT    NOT NULL,
  category      TEXT    NOT NULL CHECK (category IN ('image', 'document', 'drawing', 'video')),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256        TEXT    NOT NULL,
  scan_status   TEXT    NOT NULL DEFAULT 'PENDING' CHECK (scan_status IN ('PENDING', 'CLEAN', 'INFECTED', 'ERROR')),
  scan_detail   TEXT,
  scanned_at    TEXT,
  linked_entity TEXT    NOT NULL,
  linked_id     INTEGER NOT NULL,
  supersedes_id INTEGER REFERENCES core_files(id),
  version_no    INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  retention_class TEXT  NOT NULL DEFAULT 'standard' CHECK (retention_class IN ('permanent', 'statutory', 'standard', 'short')),
  exif_json     TEXT,
  exif_stripped INTEGER NOT NULL DEFAULT 0 CHECK (exif_stripped IN (0, 1)),
  thumbnail_key TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_files_storage_key ON core_files (storage_key);
CREATE INDEX IF NOT EXISTS ix_core_files_entity ON core_files (company_id, linked_entity, linked_id);
CREATE INDEX IF NOT EXISTS ix_core_files_sha256 ON core_files (company_id, linked_entity, linked_id, sha256);
CREATE INDEX IF NOT EXISTS ix_core_files_scan ON core_files (company_id, scan_status);
CREATE INDEX IF NOT EXISTS ix_core_files_supersedes ON core_files (supersedes_id);

-- Resumable upload sessions: bytes arrive in chunks at known offsets and are assembled in a temporary file.
CREATE TABLE IF NOT EXISTS core_file_uploads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id     TEXT    NOT NULL,
  company_id    INTEGER NOT NULL,
  user_id       TEXT    NOT NULL,
  file_name     TEXT    NOT NULL,
  declared_size INTEGER NOT NULL CHECK (declared_size > 0),
  received      INTEGER NOT NULL DEFAULT 0 CHECK (received >= 0),
  meta_json     TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETED', 'ABORTED')),
  file_id       INTEGER REFERENCES core_files(id),
  expires_at    TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_file_uploads_upload_id ON core_file_uploads (upload_id);
CREATE INDEX IF NOT EXISTS ix_core_file_uploads_expiry ON core_file_uploads (status, expires_at);
CREATE INDEX IF NOT EXISTS ix_core_file_uploads_file ON core_file_uploads (file_id);

-- Per-company file settings: allowed types, size limits, retention class per category, link lifetime.
CREATE TABLE IF NOT EXISTS core_file_settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  settings_json TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_file_settings_company ON core_file_settings (company_id);
