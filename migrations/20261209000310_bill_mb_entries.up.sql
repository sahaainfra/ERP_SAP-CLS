-- Part 22.01: the measurement book: entries (approval-controlled) with dimensions per BOQ item and location, the check measurement by the QS lead or the consultant, the certified quantity and the page of the book.
CREATE TABLE IF NOT EXISTS bill_mb_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  boq_line_id     INTEGER NOT NULL REFERENCES proj_boq_lines (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  wa_id           INTEGER REFERENCES site_work_authorisations (id),
  activity_id     INTEGER REFERENCES plan_activities (id),
  ir_id           INTEGER REFERENCES qa_inspection_requests (id),
  dpr_work_id     INTEGER REFERENCES site_dpr_work (id),
  drawing_id      INTEGER REFERENCES engg_drawings (id),
  drawing_ref     TEXT,
  description     TEXT    NOT NULL,
  template        TEXT    NOT NULL DEFAULT 'VOLUME' CHECK (template IN ('QTY', 'NOS', 'LENGTH', 'AREA', 'VOLUME')),
  nos_th          INTEGER CHECK (nos_th IS NULL OR nos_th >= 0),
  length_th       INTEGER CHECK (length_th IS NULL OR length_th >= 0),
  breadth_th      INTEGER CHECK (breadth_th IS NULL OR breadth_th >= 0),
  depth_th        INTEGER CHECK (depth_th IS NULL OR depth_th >= 0),
  deduction_th    INTEGER NOT NULL DEFAULT 0 CHECK (deduction_th >= 0),
  qty_th          INTEGER NOT NULL CHECK (qty_th >= 0),
  uom             TEXT,
  measured_by     TEXT    NOT NULL,
  measured_on     TEXT    NOT NULL,
  client_check_required INTEGER NOT NULL DEFAULT 0 CHECK (client_check_required IN (0, 1)),
  check_status    TEXT    NOT NULL DEFAULT 'NOT_CHECKED' CHECK (check_status IN ('NOT_CHECKED', 'CHECKED', 'DIFFERENCE')),
  checked_qty_th  INTEGER CHECK (checked_qty_th IS NULL OR checked_qty_th >= 0),
  check_pct_bp    INTEGER NOT NULL DEFAULT 0 CHECK (check_pct_bp BETWEEN 0 AND 10000),
  check_diff_th   INTEGER,
  checked_by      TEXT,
  checker_name    TEXT,
  checker_org     TEXT,
  checked_on      TEXT,
  signature_ref   TEXT,
  check_note      TEXT,
  certified_qty_th INTEGER CHECK (certified_qty_th IS NULL OR certified_qty_th >= 0),
  certified_on    TEXT,
  bill_period     TEXT,
  mb_book         INTEGER NOT NULL DEFAULT 1 CHECK (mb_book >= 1),
  mb_page         INTEGER,
  mb_line         INTEGER,
  bill_ref        TEXT,
  eligibility_json TEXT   NOT NULL DEFAULT '[]',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_mb_doc ON bill_mb_entries (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_mb_page ON bill_mb_entries (company_id, org_project_id, mb_book, mb_line) WHERE mb_line IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_bill_mb_entries_org_project_id ON bill_mb_entries (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_mb_entries_org_site_id ON bill_mb_entries (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bill_mb_entries_boq_line_id ON bill_mb_entries (boq_line_id);
CREATE INDEX IF NOT EXISTS ix_bill_mb_entries_location_id ON bill_mb_entries (location_id);
CREATE INDEX IF NOT EXISTS ix_bill_mb_entries_wa_id ON bill_mb_entries (wa_id);
CREATE INDEX IF NOT EXISTS ix_bill_mb_entries_activity_id ON bill_mb_entries (activity_id);
CREATE INDEX IF NOT EXISTS ix_bill_mb_entries_ir_id ON bill_mb_entries (ir_id);
CREATE INDEX IF NOT EXISTS ix_bill_mb_entries_dpr_work_id ON bill_mb_entries (dpr_work_id);
CREATE INDEX IF NOT EXISTS ix_bill_mb_entries_drawing_id ON bill_mb_entries (drawing_id);
CREATE INDEX IF NOT EXISTS ix_bill_mb_status ON bill_mb_entries (company_id, org_project_id, status, boq_line_id);
CREATE INDEX IF NOT EXISTS ix_bill_mb_period ON bill_mb_entries (company_id, org_project_id, bill_period);
