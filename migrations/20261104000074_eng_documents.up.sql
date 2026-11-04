-- Part 04.10: the document management service. doc_documents is the register (one row for each controlled document, with the current revision); doc_versions are its revisions, each with the file it
-- holds; doc_folders are the folders of a project, made from a template; doc_shares are explicit grants; doc_distributions track who was sent which revision and who acknowledged it; doc_annotations
-- are markups kept as layers over a revision (the file is never changed); doc_links tie a document to the records it belongs to; doc_types and doc_folder_templates are the configuration
-- (a change waits for approval).

CREATE TABLE IF NOT EXISTS doc_types (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER REFERENCES org_companies (id),
  code                 TEXT    NOT NULL,
  name                 TEXT    NOT NULL,
  requires_review      INTEGER NOT NULL DEFAULT 1 CHECK (requires_review IN (0, 1)),
  reviewer_role        TEXT    NOT NULL DEFAULT 'DESIGN|SE|QCE',
  approver_role        TEXT    NOT NULL DEFAULT 'PM' CHECK (approver_role IN ('PM', 'QCMGR')),
  has_validity         INTEGER NOT NULL DEFAULT 0 CHECK (has_validity IN (0, 1)),
  default_confidentiality TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (default_confidentiality IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
  retention_class      TEXT    NOT NULL DEFAULT 'standard' CHECK (retention_class IN ('permanent', 'statutory', 'standard', 'short')),
  sort_order           INTEGER NOT NULL DEFAULT 100,
  type_version         INTEGER NOT NULL DEFAULT 1 CHECK (type_version >= 1),
  status               TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  batch_id             INTEGER,
  instance_id          INTEGER,
  reason               TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_doc_types ON doc_types (COALESCE(company_id, 0), code, type_version);
CREATE INDEX IF NOT EXISTS ix_doc_types_company ON doc_types (company_id, status);
CREATE INDEX IF NOT EXISTS ix_doc_types_batch ON doc_types (batch_id);

CREATE TABLE IF NOT EXISTS doc_folder_templates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER REFERENCES org_companies (id),
  code             TEXT    NOT NULL,
  name             TEXT    NOT NULL,
  tree_json        TEXT    NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1 CHECK (template_version >= 1),
  status           TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  batch_id         INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_doc_folder_templates ON doc_folder_templates (COALESCE(company_id, 0), code, template_version);
CREATE INDEX IF NOT EXISTS ix_doc_folder_templates_company ON doc_folder_templates (company_id, status);
CREATE INDEX IF NOT EXISTS ix_doc_folder_templates_batch ON doc_folder_templates (batch_id);

CREATE TABLE IF NOT EXISTS doc_folders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  parent_id        INTEGER REFERENCES doc_folders (id),
  name             TEXT    NOT NULL,
  path             TEXT    NOT NULL,
  template_code    TEXT,
  default_acl_json TEXT    NOT NULL DEFAULT '{}',
  sort_order       INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS ix_doc_folders_company_id ON doc_folders (company_id);
CREATE INDEX IF NOT EXISTS ix_doc_folders_project ON doc_folders (company_id, project_id, parent_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_doc_folders_parent ON doc_folders (parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_doc_folders_name ON doc_folders (company_id, COALESCE(project_id, 0), COALESCE(parent_id, 0), name COLLATE NOCASE) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS doc_documents (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no             TEXT    NOT NULL,
  title              TEXT    NOT NULL,
  doc_type           TEXT    NOT NULL,
  discipline         TEXT,
  folder_id          INTEGER REFERENCES doc_folders (id),
  wbs_ref            TEXT,
  location_ref       TEXT,
  current_revision   TEXT,
  current_version_id INTEGER,
  status             TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_REVIEW', 'ISSUED', 'ARCHIVED', 'CANCELLED')),
  confidentiality    TEXT    NOT NULL DEFAULT 'INTERNAL' CHECK (confidentiality IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
  owner_user_ref     TEXT    NOT NULL,
  retention_class    TEXT    NOT NULL DEFAULT 'standard' CHECK (retention_class IN ('permanent', 'statutory', 'standard', 'short')),
  valid_until        TEXT,
  expiry_notified_at TEXT,
  tags_json          TEXT    NOT NULL DEFAULT '[]',
  checked_out_by     TEXT,
  checked_out_at     TEXT,
  checkout_note      TEXT,
  archived_at        TEXT,
  archive_reason     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_doc_documents_no ON doc_documents (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_doc_documents_list ON doc_documents (company_id, status, doc_type);
CREATE INDEX IF NOT EXISTS ix_doc_documents_log ON doc_documents (company_id, id);
CREATE INDEX IF NOT EXISTS ix_doc_documents_project ON doc_documents (company_id, project_id, folder_id, status);
CREATE INDEX IF NOT EXISTS ix_doc_documents_folder ON doc_documents (folder_id);
CREATE INDEX IF NOT EXISTS ix_doc_documents_owner ON doc_documents (company_id, owner_user_ref);
CREATE INDEX IF NOT EXISTS ix_doc_documents_valid ON doc_documents (company_id, valid_until);
CREATE INDEX IF NOT EXISTS ix_doc_documents_checkout ON doc_documents (company_id, checked_out_by);

CREATE TABLE IF NOT EXISTS doc_versions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL REFERENCES org_companies (id),
  document_id        INTEGER NOT NULL REFERENCES doc_documents (id),
  revision           TEXT    NOT NULL,
  revision_no        INTEGER NOT NULL CHECK (revision_no >= 1),
  file_id            INTEGER REFERENCES core_files (id),
  change_note        TEXT,
  status             TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_REVIEW', 'RETURNED', 'ISSUED', 'SUPERSEDED', 'REJECTED')),
  instance_id        INTEGER,
  submitted_by       TEXT,
  submitted_at       TEXT,
  approved_at        TEXT,
  superseded_at      TEXT,
  superseded_by      INTEGER REFERENCES doc_versions (id),
  metadata_json      TEXT    NOT NULL DEFAULT '{}',
  text_extract       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_doc_versions_rev ON doc_versions (document_id, revision_no);
CREATE INDEX IF NOT EXISTS ix_doc_versions_company_id ON doc_versions (company_id);
CREATE INDEX IF NOT EXISTS ix_doc_versions_document ON doc_versions (document_id, status);
CREATE INDEX IF NOT EXISTS ix_doc_versions_file ON doc_versions (file_id);
CREATE INDEX IF NOT EXISTS ix_doc_versions_instance ON doc_versions (instance_id);
CREATE INDEX IF NOT EXISTS ix_doc_versions_superseded_by ON doc_versions (superseded_by);

CREATE TABLE IF NOT EXISTS doc_shares (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  document_id    INTEGER NOT NULL REFERENCES doc_documents (id),
  principal_type TEXT    NOT NULL CHECK (principal_type IN ('USER', 'ROLE', 'EXTERNAL')),
  principal_id   TEXT    NOT NULL,
  principal_name TEXT,
  permission     TEXT    NOT NULL DEFAULT 'VIEW' CHECK (permission IN ('VIEW', 'EDIT')),
  expires_at     TEXT,
  granted_by     TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_doc_shares_company_id ON doc_shares (company_id);
CREATE INDEX IF NOT EXISTS ix_doc_shares_document ON doc_shares (document_id, is_active);
CREATE INDEX IF NOT EXISTS ix_doc_shares_principal ON doc_shares (company_id, principal_type, principal_id, is_active);

CREATE TABLE IF NOT EXISTS doc_distributions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  document_id     INTEGER NOT NULL REFERENCES doc_documents (id),
  version_id      INTEGER NOT NULL REFERENCES doc_versions (id),
  recipient_type  TEXT    NOT NULL CHECK (recipient_type IN ('USER', 'EXTERNAL')),
  recipient_id    TEXT    NOT NULL,
  recipient_name  TEXT,
  recipient_email TEXT,
  sent_by         TEXT    NOT NULL,
  sent_at         TEXT    NOT NULL,
  message         TEXT,
  due_at          TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  ack_note        TEXT,
  reminded_at     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_doc_distributions ON doc_distributions (version_id, recipient_type, recipient_id);
CREATE INDEX IF NOT EXISTS ix_doc_distributions_company_id ON doc_distributions (company_id);
CREATE INDEX IF NOT EXISTS ix_doc_distributions_document ON doc_distributions (document_id);
CREATE INDEX IF NOT EXISTS ix_doc_distributions_recipient ON doc_distributions (company_id, recipient_type, recipient_id, acknowledged_at);

CREATE TABLE IF NOT EXISTS doc_annotations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  version_id  INTEGER NOT NULL REFERENCES doc_versions (id),
  user_ref    TEXT    NOT NULL,
  page        INTEGER NOT NULL DEFAULT 1 CHECK (page >= 1),
  shape_json  TEXT    NOT NULL,
  comment     TEXT,
  resolved    INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
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
CREATE INDEX IF NOT EXISTS ix_doc_annotations_company_id ON doc_annotations (company_id);
CREATE INDEX IF NOT EXISTS ix_doc_annotations_version ON doc_annotations (version_id, page);

CREATE TABLE IF NOT EXISTS doc_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  document_id INTEGER NOT NULL REFERENCES doc_documents (id),
  entity      TEXT    NOT NULL,
  entity_id   TEXT    NOT NULL,
  label       TEXT,
  route       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_doc_links ON doc_links (document_id, entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_doc_links_company_id ON doc_links (company_id);
CREATE INDEX IF NOT EXISTS ix_doc_links_record ON doc_links (company_id, entity, entity_id);
