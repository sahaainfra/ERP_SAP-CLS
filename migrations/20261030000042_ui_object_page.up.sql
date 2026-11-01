-- Part 03.04: the Object Page's shared records. Discussion comments, version snapshots for the amendment comparison, reason codes for
-- cancelling, rejecting and returning, the documents a document type needs, and which file satisfies which of them.

CREATE TABLE IF NOT EXISTS ui_record_comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  entity_type   TEXT    NOT NULL,
  entity_id     INTEGER NOT NULL,
  body          TEXT    NOT NULL,
  mentions_json TEXT    NOT NULL DEFAULT '[]',
  author_ref    TEXT    NOT NULL,
  author_id     INTEGER REFERENCES iam_users (id),
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
CREATE INDEX IF NOT EXISTS ix_ui_record_comments_record ON ui_record_comments (company_id, entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS ix_ui_record_comments_author ON ui_record_comments (author_id);

-- One snapshot each time a record is submitted: version 1 is the original, later ones are amendments (after a return).
CREATE TABLE IF NOT EXISTS ui_record_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  entity_type   TEXT    NOT NULL,
  entity_id     INTEGER NOT NULL,
  version_no    INTEGER NOT NULL CHECK (version_no >= 1),
  snapshot_json TEXT    NOT NULL,
  reason        TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_record_versions_no ON ui_record_versions (company_id, entity_type, entity_id, version_no);

-- Reason codes: a shared list (company NULL) that a company may extend later.
CREATE TABLE IF NOT EXISTS ui_reason_codes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER REFERENCES org_companies (id),
  applies_to    TEXT    NOT NULL,
  code          TEXT    NOT NULL,
  label         TEXT    NOT NULL,
  needs_text    INTEGER NOT NULL DEFAULT 0 CHECK (needs_text IN (0, 1)),
  sort_order    INTEGER NOT NULL DEFAULT 100,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_reason_codes_code ON ui_reason_codes (COALESCE(company_id, 0), applies_to, code);
CREATE INDEX IF NOT EXISTS ix_ui_reason_codes_company ON ui_reason_codes (company_id);

-- What a document type needs attached, and at which step it is needed.
CREATE TABLE IF NOT EXISTS ui_required_documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER REFERENCES org_companies (id),
  doc_type      TEXT    NOT NULL,
  code          TEXT    NOT NULL,
  label         TEXT    NOT NULL,
  description   TEXT,
  required_at   TEXT    NOT NULL DEFAULT 'approve' CHECK (required_at IN ('submit', 'approve', 'optional')),
  sort_order    INTEGER NOT NULL DEFAULT 100,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_required_documents_code ON ui_required_documents (COALESCE(company_id, 0), doc_type, code);
CREATE INDEX IF NOT EXISTS ix_ui_required_documents_company ON ui_required_documents (company_id);

-- Which file satisfies which required item of a record.
CREATE TABLE IF NOT EXISTS ui_record_documents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  entity_type      TEXT    NOT NULL,
  entity_id        INTEGER NOT NULL,
  requirement_code TEXT    NOT NULL,
  file_id          INTEGER NOT NULL REFERENCES core_files (id),
  project_id       INTEGER,
  site_id          INTEGER,
  created_by       TEXT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by       TEXT,
  updated_at       TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at       TEXT,
  deleted_by       TEXT,
  source_type      TEXT,
  source_id        TEXT,
  remarks          TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_record_documents_link ON ui_record_documents (company_id, entity_type, entity_id, requirement_code, file_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ui_record_documents_file ON ui_record_documents (file_id);
CREATE INDEX IF NOT EXISTS ix_ui_record_documents_record ON ui_record_documents (company_id, entity_type, entity_id);
