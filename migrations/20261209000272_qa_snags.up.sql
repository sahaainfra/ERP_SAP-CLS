-- Part 18.06: snags and punch lists: a defect pinned on a plan, rectified by the responsible party with an after-photograph and verified by someone else. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS qa_snags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  unit_ref        TEXT,
  drawing_id      INTEGER REFERENCES engg_drawings (id),
  pin_x           INTEGER CHECK (pin_x IS NULL OR pin_x BETWEEN 0 AND 10000),
  pin_y           INTEGER CHECK (pin_y IS NULL OR pin_y BETWEEN 0 AND 10000),
  category        TEXT    NOT NULL CHECK (category IN ('CIVIL', 'FINISHING', 'MEP', 'OTHER')),
  punch_class     TEXT    NOT NULL DEFAULT 'B' CHECK (punch_class IN ('A', 'B', 'C')),
  priority        TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  description     TEXT    NOT NULL,
  responsible_type TEXT   NOT NULL DEFAULT 'OWN_CREW' CHECK (responsible_type IN ('OWN_CREW', 'SUBCONTRACTOR', 'SUPPLIER')),
  responsible_id  INTEGER REFERENCES mdm_partners (id),
  due_date        TEXT,
  raised_kind     TEXT    NOT NULL DEFAULT 'INTERNAL' CHECK (raised_kind IN ('INTERNAL', 'CLIENT', 'CONSULTANT')),
  inspection_id   INTEGER REFERENCES qa_inspections (id),
  before_photos_json TEXT NOT NULL DEFAULT '[]',
  after_photos_json  TEXT NOT NULL DEFAULT '[]',
  rectified_by    TEXT,
  rectified_on    TEXT,
  rectification_note TEXT,
  closed_by       TEXT,
  closed_on       TEXT,
  reopen_count    INTEGER NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  backcharge      INTEGER NOT NULL DEFAULT 0 CHECK (backcharge >= 0),
  status          TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RECTIFIED', 'CLOSED', 'CANCELLED')),
  raised_by       TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_sn_doc ON qa_snags (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_qa_sn_project ON qa_snags (org_project_id, status, punch_class);
CREATE INDEX IF NOT EXISTS ix_qa_sn_site ON qa_snags (org_site_id);
CREATE INDEX IF NOT EXISTS ix_qa_sn_location ON qa_snags (location_id, status);
CREATE INDEX IF NOT EXISTS ix_qa_sn_drawing ON qa_snags (drawing_id);
CREATE INDEX IF NOT EXISTS ix_qa_sn_responsible ON qa_snags (responsible_id, status);
CREATE INDEX IF NOT EXISTS ix_qa_sn_due ON qa_snags (company_id, due_date);
CREATE INDEX IF NOT EXISTS ix_qa_sn_inspection ON qa_snags (inspection_id);
