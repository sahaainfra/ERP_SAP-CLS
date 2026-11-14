-- Part 18.02: inspection requests (IR) raised for a planned point, an activity or a location, and the hold-point release they carry. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS qa_inspection_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  activity_id     INTEGER REFERENCES plan_activities (id),
  wa_id           INTEGER REFERENCES site_work_authorisations (id),
  planned_point_id INTEGER REFERENCES qa_planned_points (id),
  itp_step_code   TEXT,
  point_type      TEXT    NOT NULL DEFAULT 'HOLD' CHECK (point_type IN ('HOLD', 'WITNESS', 'REVIEW', 'SURVEILLANCE')),
  description     TEXT    NOT NULL,
  requested_for   TEXT    NOT NULL,
  requested_at    TEXT,
  consultant_required INTEGER NOT NULL DEFAULT 0 CHECK (consultant_required IN (0, 1)),
  inspection_id   INTEGER REFERENCES qa_inspections (id),
  reinspection_of_id INTEGER REFERENCES qa_inspection_requests (id),
  result          TEXT    CHECK (result IS NULL OR result IN ('APPROVED', 'APPROVED_WITH_COMMENTS', 'REJECTED')),
  reason_code     TEXT,
  assessment      TEXT,
  assessed_by     TEXT,
  decided_at      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_ir_doc ON qa_inspection_requests (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_qa_ir_project ON qa_inspection_requests (org_project_id, status, requested_for);
CREATE INDEX IF NOT EXISTS ix_qa_ir_site ON qa_inspection_requests (org_site_id);
CREATE INDEX IF NOT EXISTS ix_qa_ir_location ON qa_inspection_requests (location_id);
CREATE INDEX IF NOT EXISTS ix_qa_ir_activity ON qa_inspection_requests (activity_id);
CREATE INDEX IF NOT EXISTS ix_qa_ir_wa ON qa_inspection_requests (wa_id);
CREATE INDEX IF NOT EXISTS ix_qa_ir_point ON qa_inspection_requests (planned_point_id);
CREATE INDEX IF NOT EXISTS ix_qa_ir_inspection ON qa_inspection_requests (inspection_id);
CREATE INDEX IF NOT EXISTS ix_qa_ir_reinspect ON qa_inspection_requests (reinspection_of_id);
