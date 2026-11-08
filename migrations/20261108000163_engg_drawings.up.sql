-- Part 11.01: drawing register, revisions, transmittals and controlled distribution (module engg, tables engg_*).
-- engg_drawings: the register entry of a drawing (number, discipline, package, WBS and location, scale, size, originator, planned and actual receipt) with its current revision and the latest response of the consultant.
-- engg_drawing_revisions: the approval-controlled records: a revision with its status code (IFR, IFA, IFC, as-built), its change note, its file and its place in the chain; an issued IFC revision supersedes the earlier ones (BR-02).
-- engg_drawing_links: what a drawing is for (WBS node, location, BOQ item, activity). engg_transmittals and engg_transmittal_items: outgoing and incoming transmittals with the response of each drawing.
-- engg_copies: controlled copies held by people and sites, acknowledged, and marked superseded when a newer revision is issued.
CREATE TABLE IF NOT EXISTS engg_drawings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  drawing_no      TEXT    NOT NULL COLLATE NOCASE,
  title           TEXT    NOT NULL,
  discipline      TEXT    NOT NULL CHECK (discipline IN ('ARCHITECTURAL', 'STRUCTURAL', 'MEP', 'CIVIL', 'LANDSCAPE')),
  package_name    TEXT,
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  scale           TEXT,
  sheet_size      TEXT    CHECK (sheet_size IS NULL OR sheet_size IN ('A0', 'A1', 'A2', 'A3', 'A4', 'OTHER')),
  originator_type TEXT    NOT NULL DEFAULT 'CONSULTANT' CHECK (originator_type IN ('CONSULTANT', 'IN_HOUSE', 'VENDOR')),
  originator      TEXT,
  document_id     INTEGER REFERENCES doc_documents (id),
  planned_receipt TEXT,
  actual_receipt  TEXT,
  current_revision_id     INTEGER,
  current_revision        TEXT,
  current_status_code     TEXT CHECK (current_status_code IS NULL OR current_status_code IN ('IFR', 'IFA', 'IFC', 'ASBUILT')),
  current_ifc_revision_id INTEGER,
  response_code   TEXT    CHECK (response_code IS NULL OR response_code IN ('A', 'B', 'C', 'D')),
  response_date   TEXT,
  register_status TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (register_status IN ('ACTIVE', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_drawings_no ON engg_drawings (company_id, org_project_id, drawing_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_engg_drawings_company_id ON engg_drawings (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_drawings_project ON engg_drawings (org_project_id, discipline, register_status);
CREATE INDEX IF NOT EXISTS ix_engg_drawings_wbs ON engg_drawings (wbs_id);
CREATE INDEX IF NOT EXISTS ix_engg_drawings_location ON engg_drawings (location_id);
CREATE INDEX IF NOT EXISTS ix_engg_drawings_document ON engg_drawings (document_id);
CREATE INDEX IF NOT EXISTS ix_engg_drawings_planned ON engg_drawings (org_project_id, planned_receipt);

CREATE TABLE IF NOT EXISTS engg_drawing_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  drawing_id      INTEGER NOT NULL REFERENCES engg_drawings (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  rev_seq         INTEGER NOT NULL CHECK (rev_seq >= 1),
  rev_label       TEXT    NOT NULL,
  status_code     TEXT    NOT NULL CHECK (status_code IN ('IFR', 'IFA', 'IFC', 'ASBUILT')),
  issue_purpose   TEXT,
  change_note     TEXT,
  cloud_summary   TEXT,
  received_on     TEXT,
  issued_on       TEXT,
  file_id         INTEGER,
  supersedes_id   INTEGER REFERENCES engg_drawing_revisions (id),
  rev_status      TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (rev_status IN ('DRAFT', 'SUBMITTED', 'ISSUED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  superseded_by_id INTEGER REFERENCES engg_drawing_revisions (id),
  superseded_at   TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_drawing_revisions_seq ON engg_drawing_revisions (drawing_id, rev_seq) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_engg_drawing_revisions_company_id ON engg_drawing_revisions (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_drawing_revisions_project ON engg_drawing_revisions (org_project_id, rev_status);
CREATE INDEX IF NOT EXISTS ix_engg_drawing_revisions_supersedes ON engg_drawing_revisions (supersedes_id);
CREATE INDEX IF NOT EXISTS ix_engg_drawing_revisions_superseded_by ON engg_drawing_revisions (superseded_by_id);
CREATE INDEX IF NOT EXISTS ix_engg_drawing_revisions_file ON engg_drawing_revisions (file_id);

CREATE TABLE IF NOT EXISTS engg_drawing_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  drawing_id      INTEGER NOT NULL REFERENCES engg_drawings (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  link_type       TEXT    NOT NULL CHECK (link_type IN ('WBS', 'LOCATION', 'BOQ', 'ACTIVITY')),
  target_id       INTEGER,
  target_ref      TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_drawing_links_target ON engg_drawing_links (drawing_id, link_type, target_ref) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_engg_drawing_links_company_id ON engg_drawing_links (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_drawing_links_project ON engg_drawing_links (org_project_id, link_type, target_id);

CREATE TABLE IF NOT EXISTS engg_transmittals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  direction       TEXT    NOT NULL CHECK (direction IN ('OUT', 'IN')),
  party           TEXT    NOT NULL,
  contact         TEXT,
  purpose         TEXT    NOT NULL CHECK (purpose IN ('FOR_APPROVAL', 'FOR_CONSTRUCTION', 'FOR_INFORMATION')),
  cover_note      TEXT,
  issued_on       TEXT,
  due_on          TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'ISSUED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED')),
  closed_at       TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_transmittals_doc ON engg_transmittals (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_engg_transmittals_company_id ON engg_transmittals (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_transmittals_project ON engg_transmittals (org_project_id, direction, status);
CREATE INDEX IF NOT EXISTS ix_engg_transmittals_due ON engg_transmittals (org_project_id, due_on);

CREATE TABLE IF NOT EXISTS engg_transmittal_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  transmittal_id  INTEGER NOT NULL REFERENCES engg_transmittals (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  drawing_id      INTEGER NOT NULL REFERENCES engg_drawings (id),
  revision_id     INTEGER NOT NULL REFERENCES engg_drawing_revisions (id),
  copies          INTEGER NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 99),
  response_code   TEXT    CHECK (response_code IS NULL OR response_code IN ('A', 'B', 'C', 'D')),
  response_date   TEXT,
  comments        TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_transmittal_items_pair ON engg_transmittal_items (transmittal_id, revision_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_engg_transmittal_items_company_id ON engg_transmittal_items (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_transmittal_items_drawing ON engg_transmittal_items (drawing_id);
CREATE INDEX IF NOT EXISTS ix_engg_transmittal_items_project ON engg_transmittal_items (org_project_id, response_code);

CREATE TABLE IF NOT EXISTS engg_copies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  drawing_id      INTEGER NOT NULL REFERENCES engg_drawings (id),
  revision_id     INTEGER NOT NULL REFERENCES engg_drawing_revisions (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  holder_user     TEXT    NOT NULL,
  holder_site_id  INTEGER REFERENCES org_sites (id),
  copy_no         INTEGER NOT NULL DEFAULT 1 CHECK (copy_no >= 1),
  issued_on       TEXT    NOT NULL,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  copy_status     TEXT    NOT NULL DEFAULT 'ISSUED' CHECK (copy_status IN ('ISSUED', 'ACKNOWLEDGED', 'SUPERSEDED', 'WITHDRAWN')),
  replaced_by_id  INTEGER REFERENCES engg_copies (id),
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
CREATE INDEX IF NOT EXISTS ix_engg_copies_company_id ON engg_copies (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_copies_drawing ON engg_copies (drawing_id, copy_status);
CREATE INDEX IF NOT EXISTS ix_engg_copies_revision ON engg_copies (revision_id);
CREATE INDEX IF NOT EXISTS ix_engg_copies_holder ON engg_copies (company_id, holder_user, copy_status);
CREATE INDEX IF NOT EXISTS ix_engg_copies_project ON engg_copies (org_project_id, copy_status);
CREATE INDEX IF NOT EXISTS ix_engg_copies_site ON engg_copies (holder_site_id);
CREATE INDEX IF NOT EXISTS ix_engg_copies_replaced ON engg_copies (replaced_by_id);
