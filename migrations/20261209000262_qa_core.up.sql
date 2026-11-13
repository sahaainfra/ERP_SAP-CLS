-- Part 18.01: project quality plans, the library of inspection and test plans (ITPs), checklist templates (versioned), inspections with their answers, and the planned inspection points an ITP generates for activities. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS qa_quality_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  title           TEXT    NOT NULL,
  revision        INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  summary         TEXT,
  document_file_id INTEGER,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  cancel_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_qp_doc ON qa_quality_plans (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_qa_qp_project ON qa_quality_plans (org_project_id, status);
CREATE INDEX IF NOT EXISTS ix_qa_qp_site ON qa_quality_plans (org_site_id);

CREATE TABLE IF NOT EXISTS qa_itps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  title           TEXT    NOT NULL,
  activity_type   TEXT    NOT NULL CHECK (activity_type IN ('EXCAVATION', 'PCC', 'RCC', 'MASONRY', 'PLASTER', 'WATERPROOFING', 'MEP', 'ROAD', 'OTHER')),
  org_project_id  INTEGER REFERENCES org_projects (id),
  standard_ref    TEXT,
  steps_json      TEXT    NOT NULL DEFAULT '[]',
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  cancel_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_itp_code ON qa_itps (company_id, code, version_no);
CREATE INDEX IF NOT EXISTS ix_qa_itp_type ON qa_itps (company_id, activity_type, status);
CREATE INDEX IF NOT EXISTS ix_qa_itp_project ON qa_itps (org_project_id);

CREATE TABLE IF NOT EXISTS qa_checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  name            TEXT    NOT NULL,
  module          TEXT    NOT NULL CHECK (module IN ('QUALITY', 'HSE', 'PLANT', 'STORES', 'HANDOVER', 'SNAG')),
  sections_json   TEXT    NOT NULL DEFAULT '[]',
  scoring_json    TEXT    NOT NULL DEFAULT '{}',
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  cancel_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_ct_code ON qa_checklist_templates (company_id, code, version_no);
CREATE INDEX IF NOT EXISTS ix_qa_ct_module ON qa_checklist_templates (company_id, module, status);

CREATE TABLE IF NOT EXISTS qa_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  template_id     INTEGER NOT NULL REFERENCES qa_checklist_templates (id),
  module          TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  activity_id     INTEGER REFERENCES plan_activities (id),
  wa_id           INTEGER REFERENCES site_work_authorisations (id),
  planned_point_id INTEGER,
  itp_step_code   TEXT,
  entity_type     TEXT,
  entity_id       TEXT,
  subject         TEXT,
  inspected_by    TEXT    NOT NULL,
  inspected_at    TEXT    NOT NULL,
  lat_e6          INTEGER,
  lng_e6          INTEGER,
  result          TEXT    CHECK (result IS NULL OR result IN ('PASS', 'FAIL', 'CONDITIONAL')),
  score_bp        INTEGER,
  signatures_json TEXT    NOT NULL DEFAULT '[]',
  defects_json    TEXT    NOT NULL DEFAULT '[]',
  client_ref      TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  cancel_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_in_doc ON qa_inspections (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_in_client ON qa_inspections (company_id, client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_qa_in_template ON qa_inspections (template_id);
CREATE INDEX IF NOT EXISTS ix_qa_in_project ON qa_inspections (org_project_id, module, result);
CREATE INDEX IF NOT EXISTS ix_qa_in_site ON qa_inspections (org_site_id);
CREATE INDEX IF NOT EXISTS ix_qa_in_location ON qa_inspections (location_id);
CREATE INDEX IF NOT EXISTS ix_qa_in_activity ON qa_inspections (activity_id);
CREATE INDEX IF NOT EXISTS ix_qa_in_wa ON qa_inspections (wa_id);
CREATE INDEX IF NOT EXISTS ix_qa_in_entity ON qa_inspections (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS qa_inspection_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  inspection_id   INTEGER NOT NULL REFERENCES qa_inspections (id),
  question_code   TEXT    NOT NULL,
  section_code    TEXT,
  answer          TEXT    CHECK (answer IS NULL OR answer IN ('YES', 'NO', 'NA')),
  num_value       INTEGER,
  text_value      TEXT,
  passed          INTEGER CHECK (passed IS NULL OR passed IN (0, 1)),
  within_tolerance INTEGER CHECK (within_tolerance IS NULL OR within_tolerance IN (0, 1)),
  photo_file_ids  TEXT    NOT NULL DEFAULT '[]',
  remark          TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_ia_q ON qa_inspection_answers (inspection_id, question_code);
CREATE INDEX IF NOT EXISTS ix_qa_ia_company ON qa_inspection_answers (company_id);

CREATE TABLE IF NOT EXISTS qa_planned_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  itp_id          INTEGER NOT NULL REFERENCES qa_itps (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  activity_id     INTEGER NOT NULL REFERENCES plan_activities (id),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  step_code       TEXT    NOT NULL,
  seq_no          INTEGER NOT NULL DEFAULT 0,
  point_type      TEXT    NOT NULL CHECK (point_type IN ('HOLD', 'WITNESS', 'REVIEW', 'SURVEILLANCE')),
  title           TEXT    NOT NULL,
  point_status    TEXT    NOT NULL DEFAULT 'PLANNED' CHECK (point_status IN ('PLANNED', 'REQUESTED', 'DONE', 'WAIVED')),
  inspection_id   INTEGER REFERENCES qa_inspections (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_pp_key ON qa_planned_points (itp_id, activity_id, COALESCE(location_id, 0), step_code);
CREATE INDEX IF NOT EXISTS ix_qa_pp_project ON qa_planned_points (org_project_id, point_status);
CREATE INDEX IF NOT EXISTS ix_qa_pp_activity ON qa_planned_points (activity_id);
CREATE INDEX IF NOT EXISTS ix_qa_pp_location ON qa_planned_points (location_id);
CREATE INDEX IF NOT EXISTS ix_qa_pp_wbs ON qa_planned_points (wbs_id);
CREATE INDEX IF NOT EXISTS ix_qa_pp_inspection ON qa_planned_points (inspection_id);
CREATE INDEX IF NOT EXISTS ix_qa_pp_company ON qa_planned_points (company_id);
