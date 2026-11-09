-- Part 11.04: EPC engineering deliverables and vendor document review (module engg, tables engg_*).
-- engg_deliverables: the master deliverable register (drawings, calculations, specifications, data sheets, MTOs) with a weight, planned and actual dates for IFR, IFA, IFC and as-built, the milestone reached and the progress worked out from the milestone weights.
-- engg_crs: the client comment resolution sheet per deliverable revision. engg_vdr_items: the vendor document requirements per purchase order with due dates and the review code. engg_holds: engineering holds on deliverables awaiting information.
CREATE TABLE IF NOT EXISTS engg_deliverables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  deliverable_no  TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  title           TEXT    NOT NULL,
  discipline      TEXT    NOT NULL CHECK (discipline IN ('ARCHITECTURAL', 'STRUCTURAL', 'MEP', 'CIVIL', 'LANDSCAPE', 'PROCESS', 'PIPING', 'ELECTRICAL', 'INSTRUMENTATION', 'MECHANICAL')),
  deliverable_type TEXT   NOT NULL CHECK (deliverable_type IN ('DRAWING', 'CALCULATION', 'SPECIFICATION', 'DATA_SHEET', 'MTO', 'REPORT', 'OTHER')),
  package_name    TEXT,
  weight          INTEGER NOT NULL DEFAULT 100 CHECK (weight >= 1),
  plan_ifr        TEXT,
  plan_ifa        TEXT,
  plan_ifc        TEXT,
  plan_asbuilt    TEXT,
  act_ifr         TEXT,
  act_ifa         TEXT,
  act_ifc         TEXT,
  act_asbuilt     TEXT,
  milestone       TEXT    NOT NULL DEFAULT 'NOT_STARTED' CHECK (milestone IN ('NOT_STARTED', 'IFR', 'IFA', 'IFC', 'ASBUILT')),
  progress_bp     INTEGER NOT NULL DEFAULT 0 CHECK (progress_bp BETWEEN 0 AND 10000),
  drawing_id      INTEGER REFERENCES engg_drawings (id),
  document_id     INTEGER REFERENCES doc_documents (id),
  owner_user      TEXT,
  release_status  TEXT    NOT NULL DEFAULT 'NONE' CHECK (release_status IN ('NONE', 'PENDING')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  reg_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (reg_status IN ('ACTIVE', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_deliverables_no ON engg_deliverables (company_id, deliverable_no);
CREATE INDEX IF NOT EXISTS ix_engg_deliverables_company_id ON engg_deliverables (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_deliverables_project ON engg_deliverables (org_project_id, discipline, milestone);
CREATE INDEX IF NOT EXISTS ix_engg_deliverables_drawing ON engg_deliverables (drawing_id);
CREATE INDEX IF NOT EXISTS ix_engg_deliverables_document ON engg_deliverables (document_id);

CREATE TABLE IF NOT EXISTS engg_crs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  deliverable_id  INTEGER NOT NULL REFERENCES engg_deliverables (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  revision        TEXT    NOT NULL,
  comment_no      INTEGER NOT NULL CHECK (comment_no >= 1),
  comment_text    TEXT    NOT NULL,
  raised_by       TEXT,
  response_text   TEXT,
  responded_by    TEXT,
  responded_on    TEXT,
  comment_status  TEXT    NOT NULL DEFAULT 'OPEN' CHECK (comment_status IN ('OPEN', 'RESPONDED', 'CLOSED')),
  closed_on       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_crs_no ON engg_crs (deliverable_id, revision, comment_no);
CREATE INDEX IF NOT EXISTS ix_engg_crs_company_id ON engg_crs (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_crs_project ON engg_crs (org_project_id, comment_status);

CREATE TABLE IF NOT EXISTS engg_vdr_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  vdr_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  po_ref          TEXT    NOT NULL,
  vendor          TEXT    NOT NULL,
  doc_type        TEXT    NOT NULL CHECK (doc_type IN ('GA_DRAWING', 'DATA_SHEET', 'TEST_PROCEDURE', 'MANUAL', 'CALCULATION', 'CERTIFICATE', 'OTHER')),
  title           TEXT    NOT NULL,
  due_date        TEXT    NOT NULL,
  submitted_on    TEXT,
  cycle_no        INTEGER NOT NULL DEFAULT 1 CHECK (cycle_no >= 1),
  review_code     TEXT    CHECK (review_code IS NULL OR review_code IN ('A', 'B', 'C', 'D')),
  review_text     TEXT,
  reviewed_on     TEXT,
  status          TEXT    NOT NULL DEFAULT 'REQUIRED' CHECK (status IN ('REQUIRED', 'RECEIVED', 'IN_REVIEW', 'ACCEPTED', 'RESUBMIT', 'RETURNED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  pending_code    TEXT    CHECK (pending_code IS NULL OR pending_code IN ('A', 'B', 'C', 'D')),
  pending_text    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_vdr_items_no ON engg_vdr_items (company_id, vdr_no);
CREATE INDEX IF NOT EXISTS ix_engg_vdr_items_company_id ON engg_vdr_items (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_vdr_items_project ON engg_vdr_items (org_project_id, status, due_date);
CREATE INDEX IF NOT EXISTS ix_engg_vdr_items_po ON engg_vdr_items (company_id, po_ref);

CREATE TABLE IF NOT EXISTS engg_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  hold_no         TEXT    NOT NULL COLLATE NOCASE,
  deliverable_id  INTEGER NOT NULL REFERENCES engg_deliverables (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  description     TEXT    NOT NULL,
  impact_procurement INTEGER NOT NULL DEFAULT 0 CHECK (impact_procurement IN (0, 1)),
  impact_construction INTEGER NOT NULL DEFAULT 0 CHECK (impact_construction IN (0, 1)),
  po_ref          TEXT,
  activity_ref    TEXT,
  raised_on       TEXT    NOT NULL,
  raised_by       TEXT,
  cleared_on      TEXT,
  cleared_by      TEXT,
  clear_note      TEXT,
  hold_status     TEXT    NOT NULL DEFAULT 'OPEN' CHECK (hold_status IN ('OPEN', 'CLEARED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_holds_no ON engg_holds (company_id, hold_no);
CREATE INDEX IF NOT EXISTS ix_engg_holds_company_id ON engg_holds (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_holds_deliverable ON engg_holds (deliverable_id, hold_status);
CREATE INDEX IF NOT EXISTS ix_engg_holds_project ON engg_holds (org_project_id, hold_status);
