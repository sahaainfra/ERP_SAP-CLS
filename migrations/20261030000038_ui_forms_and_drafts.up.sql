-- Part 03.02: the data-entry framework. Server drafts (one per person, company, form and record), declarative form definitions,
-- and the reference form that shows the framework working end to end (a sample material request with lines).

-- A person's unsaved work on a form. entity_key is '' for a new record, else the id of the record being edited. A discarded or
-- submitted draft is soft-deleted, so the unique key covers live drafts only.
CREATE TABLE IF NOT EXISTS ui_drafts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  user_id      INTEGER REFERENCES iam_users (id),
  user_ref     TEXT    NOT NULL,
  form_code    TEXT    NOT NULL,
  entity_key   TEXT    NOT NULL DEFAULT '',
  title        TEXT,
  payload_json TEXT    NOT NULL DEFAULT '{}',
  bytes        INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  saved_at     TEXT    NOT NULL,
  saved_by     TEXT    NOT NULL DEFAULT 'manual' CHECK (saved_by IN ('manual', 'autosave', 'blur')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_drafts_live ON ui_drafts (company_id, user_ref, form_code, entity_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ui_drafts_owner ON ui_drafts (company_id, user_ref, saved_at);
CREATE INDEX IF NOT EXISTS ix_ui_drafts_user ON ui_drafts (user_id);

-- A form's declared fields, sections, rules and defaults. Definitions are code: a migration seeds each version (ADR-115).
CREATE TABLE IF NOT EXISTS ui_form_metadata (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER REFERENCES org_companies (id),
  form_code     TEXT    NOT NULL,
  form_version  INTEGER NOT NULL DEFAULT 1 CHECK (form_version >= 1),
  name          TEXT    NOT NULL,
  module        TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  schema_json   TEXT    NOT NULL DEFAULT '{}',
  layout_json   TEXT    NOT NULL DEFAULT '{}',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_form_metadata_code ON ui_form_metadata (COALESCE(company_id, 0), form_code, form_version);
CREATE INDEX IF NOT EXISTS ix_ui_form_metadata_company ON ui_form_metadata (company_id, status);

-- The reference form (AC-02): a sample material request. Amounts are whole minor units (ADR-14); the server recomputes them.
CREATE TABLE IF NOT EXISTS ui_sample_requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no             TEXT,
  doc_date           TEXT    NOT NULL,
  status             TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'CANCELLED')),
  title              TEXT    NOT NULL,
  project_id         INTEGER NOT NULL REFERENCES org_projects (id),
  site_id            INTEGER REFERENCES org_sites (id),
  cost_centre_id     INTEGER REFERENCES org_cost_centres (id),
  department_id      INTEGER REFERENCES org_departments (id),
  requested_by       TEXT    NOT NULL,
  required_by        TEXT    NOT NULL,
  priority           TEXT    NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'URGENT')),
  urgency_reason     TEXT,
  returnable         INTEGER NOT NULL DEFAULT 0 CHECK (returnable IN (0, 1)),
  return_by          TEXT,
  delivery_note      TEXT,
  delivery_lat       TEXT,
  delivery_lng       TEXT,
  total_amount       INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  line_count         INTEGER NOT NULL DEFAULT 0 CHECK (line_count >= 0),
  formula_pins_json  TEXT    NOT NULL DEFAULT '{}',
  submitted_at       TEXT,
  created_by         TEXT,
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by         TEXT,
  updated_at         TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at         TEXT,
  deleted_by         TEXT,
  source_type        TEXT,
  source_id          TEXT,
  remarks            TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_sample_requests_doc_no ON ui_sample_requests (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_ui_sample_requests_status ON ui_sample_requests (company_id, status);
CREATE INDEX IF NOT EXISTS ix_ui_sample_requests_project ON ui_sample_requests (project_id);
CREATE INDEX IF NOT EXISTS ix_ui_sample_requests_site ON ui_sample_requests (site_id);
CREATE INDEX IF NOT EXISTS ix_ui_sample_requests_cost_centre ON ui_sample_requests (cost_centre_id);
CREATE INDEX IF NOT EXISTS ix_ui_sample_requests_department ON ui_sample_requests (department_id);
CREATE INDEX IF NOT EXISTS ix_ui_sample_requests_dup ON ui_sample_requests (company_id, project_id, doc_date);

CREATE TABLE IF NOT EXISTS ui_sample_request_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  request_id    INTEGER NOT NULL REFERENCES ui_sample_requests (id),
  line_no       INTEGER NOT NULL CHECK (line_no >= 1),
  description   TEXT    NOT NULL,
  uom           TEXT    NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  unit_rate     INTEGER NOT NULL CHECK (unit_rate >= 0),
  line_amount   INTEGER NOT NULL CHECK (line_amount >= 0),
  needed_on     TEXT,
  comment       TEXT,
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
CREATE INDEX IF NOT EXISTS ix_ui_sample_request_lines_request ON ui_sample_request_lines (request_id, line_no);
CREATE INDEX IF NOT EXISTS ix_ui_sample_request_lines_company ON ui_sample_request_lines (company_id);
