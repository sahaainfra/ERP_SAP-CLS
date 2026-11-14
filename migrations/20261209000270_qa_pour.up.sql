-- Part 18.05: concrete pour cards (the clearance to pour), the delivery tickets of each pour, cube sample registers with QR labels and the strength results by age. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS qa_pour_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  activity_id     INTEGER REFERENCES plan_activities (id),
  element         TEXT    NOT NULL,
  grade           TEXT    NOT NULL,
  fck_mpa         INTEGER NOT NULL CHECK (fck_mpa BETWEEN 5 AND 100),
  planned_volume  INTEGER NOT NULL DEFAULT 0 CHECK (planned_volume >= 0),
  actual_volume   INTEGER NOT NULL DEFAULT 0 CHECK (actual_volume >= 0),
  planned_on      TEXT,
  ir_links_json   TEXT    NOT NULL DEFAULT '[]',
  checks_json     TEXT    NOT NULL DEFAULT '[]',
  weather         TEXT,
  pour_status     TEXT    NOT NULL DEFAULT 'PLANNED' CHECK (pour_status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED')),
  pour_start      TEXT,
  pour_end        TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_pc_doc ON qa_pour_cards (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_qa_pc_project ON qa_pour_cards (org_project_id, status, planned_on);
CREATE INDEX IF NOT EXISTS ix_qa_pc_site ON qa_pour_cards (org_site_id);
CREATE INDEX IF NOT EXISTS ix_qa_pc_location ON qa_pour_cards (location_id);
CREATE INDEX IF NOT EXISTS ix_qa_pc_activity ON qa_pour_cards (activity_id);
CREATE TABLE IF NOT EXISTS qa_pour_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  pour_card_id    INTEGER NOT NULL REFERENCES qa_pour_cards (id),
  ticket_no       TEXT    NOT NULL,
  batch_ref       TEXT,
  truck_no        TEXT,
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  delivered_at    TEXT    NOT NULL,
  slump_mm        INTEGER CHECK (slump_mm IS NULL OR slump_mm BETWEEN 0 AND 300),
  temperature_c   INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_pt_ticket ON qa_pour_tickets (company_id, ticket_no);
CREATE INDEX IF NOT EXISTS ix_qa_pt_card ON qa_pour_tickets (pour_card_id);
CREATE INDEX IF NOT EXISTS ix_qa_pt_vendor ON qa_pour_tickets (vendor_id);
CREATE INDEX IF NOT EXISTS ix_qa_pt_batch ON qa_pour_tickets (batch_ref);
CREATE TABLE IF NOT EXISTS qa_cube_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no       TEXT    NOT NULL COLLATE NOCASE,
  pour_card_id    INTEGER NOT NULL REFERENCES qa_pour_cards (id),
  ticket_id       INTEGER REFERENCES qa_pour_tickets (id),
  cubes_count     INTEGER NOT NULL CHECK (cubes_count BETWEEN 3 AND 12),
  cast_date       TEXT    NOT NULL,
  due_7           TEXT    NOT NULL,
  due_28          TEXT    NOT NULL,
  qr_code         TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_cs_no ON qa_cube_samples (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_qa_cs_card ON qa_cube_samples (pour_card_id);
CREATE INDEX IF NOT EXISTS ix_qa_cs_ticket ON qa_cube_samples (ticket_id);
CREATE INDEX IF NOT EXISTS ix_qa_cs_due7 ON qa_cube_samples (company_id, due_7);
CREATE INDEX IF NOT EXISTS ix_qa_cs_due28 ON qa_cube_samples (company_id, due_28);
CREATE TABLE IF NOT EXISTS qa_cube_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  sample_id       INTEGER NOT NULL REFERENCES qa_cube_samples (id),
  age_days        INTEGER NOT NULL CHECK (age_days BETWEEN 1 AND 365),
  strengths_json  TEXT    NOT NULL,
  mean_e3         INTEGER NOT NULL CHECK (mean_e3 >= 0),
  min_e3          INTEGER NOT NULL CHECK (min_e3 >= 0),
  tested_on       TEXT    NOT NULL,
  equipment_id    INTEGER REFERENCES qa_lab_equipment (id),
  acceptance      TEXT    NOT NULL CHECK (acceptance IN ('INDICATIVE', 'WATCH', 'PASS', 'FAIL')),
  ncr_id          INTEGER REFERENCES qa_ncrs (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_cr_age ON qa_cube_results (sample_id, age_days);
CREATE INDEX IF NOT EXISTS ix_qa_cr_company ON qa_cube_results (company_id, tested_on);
CREATE INDEX IF NOT EXISTS ix_qa_cr_equipment ON qa_cube_results (equipment_id);
CREATE INDEX IF NOT EXISTS ix_qa_cr_ncr ON qa_cube_results (ncr_id);
