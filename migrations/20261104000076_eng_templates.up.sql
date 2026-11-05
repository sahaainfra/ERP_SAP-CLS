-- Part 04.11: document templates, PDF generation, print and delivery.
-- tpl_templates are the formats (HTML and style with controlled variables), each version a row; one ACTIVE version of a code is used for production, a change is a new version that waits for approval.
-- tpl_records are the approved data a document is made from, put there by the module that owns the record (a thin adapter until the modules publish their own data); tpl_generated_docs are the official outputs
-- (immutable: a new generation is a new version with a reason); tpl_deliveries is the log of what was sent where; tpl_bulk_jobs follows the generation of many documents as a background job;
-- tpl_auto_rules say which approval milestone generates which document by itself.

CREATE TABLE IF NOT EXISTS tpl_templates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER REFERENCES org_companies (id),
  doc_type         TEXT    NOT NULL,
  code             TEXT    NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1 CHECK (template_version >= 1),
  name             TEXT    NOT NULL,
  html             TEXT    NOT NULL,
  css              TEXT    NOT NULL DEFAULT '',
  orientation      TEXT    NOT NULL DEFAULT 'portrait' CHECK (orientation IN ('portrait', 'landscape')),
  brand_json       TEXT    NOT NULL DEFAULT '{}',
  variables_json   TEXT    NOT NULL DEFAULT '[]',
  status           TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_REVIEW', 'ACTIVE', 'RETIRED', 'REJECTED')),
  is_default       INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  change_note      TEXT,
  instance_id      INTEGER,
  approved_by      TEXT,
  approved_at      TEXT,
  effective_from   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tpl_templates_version ON tpl_templates (COALESCE(company_id, 0), code, template_version);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tpl_templates_active ON tpl_templates (COALESCE(company_id, 0), code) WHERE status = 'ACTIVE' AND is_active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_tpl_templates_open ON tpl_templates (COALESCE(company_id, 0), code) WHERE status IN ('DRAFT', 'IN_REVIEW') AND is_active = 1;
CREATE INDEX IF NOT EXISTS ix_tpl_templates_company ON tpl_templates (company_id, doc_type, status);
CREATE INDEX IF NOT EXISTS ix_tpl_templates_instance ON tpl_templates (instance_id);

CREATE TABLE IF NOT EXISTS tpl_records (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  doc_type       TEXT    NOT NULL,
  entity_id      TEXT    NOT NULL,
  doc_no         TEXT    NOT NULL,
  data_json      TEXT    NOT NULL,
  approved       INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
  is_sample      INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
  record_version INTEGER NOT NULL DEFAULT 1 CHECK (record_version >= 1),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tpl_records_key ON tpl_records (company_id, doc_type, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tpl_records_doc_no ON tpl_records (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_tpl_records_project ON tpl_records (company_id, project_id, doc_type);

CREATE TABLE IF NOT EXISTS tpl_generated_docs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  template_id   INTEGER NOT NULL REFERENCES tpl_templates (id),
  doc_type      TEXT    NOT NULL,
  entity        TEXT    NOT NULL,
  entity_id     TEXT    NOT NULL,
  doc_number    TEXT    NOT NULL,
  version_no    INTEGER NOT NULL CHECK (version_no >= 1),
  file_id       INTEGER NOT NULL REFERENCES core_files (id),
  hash          TEXT    NOT NULL,
  pages         INTEGER NOT NULL DEFAULT 1 CHECK (pages >= 1),
  pdfa          INTEGER NOT NULL DEFAULT 0 CHECK (pdfa IN (0, 1)),
  purpose       TEXT    NOT NULL DEFAULT 'OFFICIAL' CHECK (purpose IN ('OFFICIAL', 'ARCHIVAL', 'MILESTONE')),
  reason        TEXT,
  verify_code   TEXT    NOT NULL,
  is_current    INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  superseded_by INTEGER REFERENCES tpl_generated_docs (id),
  bulk_job_id   INTEGER,
  generated_by  TEXT    NOT NULL,
  generated_at  TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tpl_generated_version ON tpl_generated_docs (company_id, doc_type, entity_id, version_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tpl_generated_verify ON tpl_generated_docs (verify_code);
CREATE INDEX IF NOT EXISTS ix_tpl_generated_template ON tpl_generated_docs (template_id);
CREATE INDEX IF NOT EXISTS ix_tpl_generated_file ON tpl_generated_docs (file_id);
CREATE INDEX IF NOT EXISTS ix_tpl_generated_list ON tpl_generated_docs (company_id, generated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_tpl_generated_project ON tpl_generated_docs (company_id, project_id, doc_type, generated_at DESC);
CREATE INDEX IF NOT EXISTS ix_tpl_generated_bulk ON tpl_generated_docs (bulk_job_id);
CREATE INDEX IF NOT EXISTS ix_tpl_generated_superseded ON tpl_generated_docs (superseded_by);
-- BR-02: an official document is immutable. Only the marks of being replaced may change; nothing is deleted.
CREATE TRIGGER IF NOT EXISTS trg_tpl_generated_immutable BEFORE UPDATE OF template_id, doc_type, entity, entity_id, doc_number, version_no, file_id, hash, pages, verify_code, generated_by, generated_at, company_id ON tpl_generated_docs
BEGIN SELECT RAISE(ABORT, 'A generated document cannot be changed; generate a new version with a reason.'); END;
CREATE TRIGGER IF NOT EXISTS trg_tpl_generated_no_delete BEFORE DELETE ON tpl_generated_docs
BEGIN SELECT RAISE(ABORT, 'A generated document cannot be deleted.'); END;

CREATE TABLE IF NOT EXISTS tpl_deliveries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  generated_doc_id INTEGER NOT NULL REFERENCES tpl_generated_docs (id),
  channel          TEXT    NOT NULL CHECK (channel IN ('DOWNLOAD', 'EMAIL', 'WHATSAPP', 'MESSAGE', 'PORTAL')),
  recipient        TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED', 'PUBLISHED', 'DOWNLOADED')),
  comm_message_id  INTEGER,
  sent_at          TEXT,
  error            TEXT,
  link_expires_at  TEXT,
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
CREATE INDEX IF NOT EXISTS ix_tpl_deliveries_doc ON tpl_deliveries (generated_doc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tpl_deliveries_company ON tpl_deliveries (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tpl_deliveries_message ON tpl_deliveries (comm_message_id);

CREATE TABLE IF NOT EXISTS tpl_bulk_jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  doc_type       TEXT    NOT NULL,
  template_code  TEXT,
  total          INTEGER NOT NULL CHECK (total >= 0),
  done           INTEGER NOT NULL DEFAULT 0 CHECK (done >= 0),
  failed         INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
  status         TEXT    NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED')),
  job_id         TEXT,
  entity_ids_json TEXT   NOT NULL,
  results_json   TEXT    NOT NULL DEFAULT '[]',
  purpose        TEXT    NOT NULL DEFAULT 'OFFICIAL',
  pdfa           INTEGER NOT NULL DEFAULT 0 CHECK (pdfa IN (0, 1)),
  requested_by   TEXT    NOT NULL,
  started_at     TEXT,
  finished_at    TEXT,
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
CREATE INDEX IF NOT EXISTS ix_tpl_bulk_company ON tpl_bulk_jobs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_tpl_bulk_job ON tpl_bulk_jobs (job_id);

CREATE TABLE IF NOT EXISTS tpl_auto_rules (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES org_companies (id),
  workflow_doc_type TEXT    NOT NULL,
  doc_type          TEXT    NOT NULL,
  template_code     TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tpl_auto_rules ON tpl_auto_rules (company_id, workflow_doc_type, doc_type) WHERE is_active = 1;
