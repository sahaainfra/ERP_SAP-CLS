-- Part 21.04: the subcontractor workspace: monthly compliance (items checked, verified by a second person), compliance waivers (approval-controlled), committed manpower, payment holds and period ratings.
CREATE TABLE IF NOT EXISTS ctr_sub_compliance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  subcontractor_id INTEGER NOT NULL REFERENCES mdm_partners (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  due_date        TEXT    NOT NULL,
  items_json      TEXT    NOT NULL DEFAULT '[]',
  comp_state      TEXT    NOT NULL DEFAULT 'OPEN' CHECK (comp_state IN ('OPEN', 'SUBMITTED', 'VERIFIED', 'RETURNED')),
  missing_mandatory INTEGER NOT NULL DEFAULT 0 CHECK (missing_mandatory >= 0),
  score_bp        INTEGER NOT NULL DEFAULT 0 CHECK (score_bp BETWEEN 0 AND 10000),
  compiled_by     TEXT,
  compiled_at     TEXT,
  verified_by     TEXT,
  verified_at     TEXT,
  verify_note     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_sc_doc ON ctr_sub_compliance (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_sc_key ON ctr_sub_compliance (company_id, subcontractor_id, org_project_id, period) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ctr_sub_compliance_subcontractor_id ON ctr_sub_compliance (subcontractor_id);
CREATE INDEX IF NOT EXISTS ix_ctr_sub_compliance_org_project_id ON ctr_sub_compliance (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctr_sub_compliance_org_site_id ON ctr_sub_compliance (org_site_id);
CREATE INDEX IF NOT EXISTS ix_ctr_sc_due ON ctr_sub_compliance (company_id, comp_state, due_date);
CREATE TABLE IF NOT EXISTS ctr_sub_waivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  compliance_id   INTEGER NOT NULL REFERENCES ctr_sub_compliance (id),
  subcontractor_id INTEGER NOT NULL REFERENCES mdm_partners (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  items_json      TEXT    NOT NULL DEFAULT '[]',
  reason          TEXT    NOT NULL,
  valid_until     TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_sw_doc ON ctr_sub_waivers (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_ctr_sub_waivers_compliance_id ON ctr_sub_waivers (compliance_id);
CREATE INDEX IF NOT EXISTS ix_ctr_sub_waivers_subcontractor_id ON ctr_sub_waivers (subcontractor_id);
CREATE INDEX IF NOT EXISTS ix_ctr_sub_waivers_org_project_id ON ctr_sub_waivers (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctr_sub_waivers_org_site_id ON ctr_sub_waivers (org_site_id);
CREATE TABLE IF NOT EXISTS ctr_sub_manpower (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  subcontractor_id INTEGER NOT NULL REFERENCES mdm_partners (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  trade_code      TEXT    NOT NULL COLLATE NOCASE,
  committed       INTEGER NOT NULL CHECK (committed >= 0),
  from_date       TEXT    NOT NULL,
  to_date         TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_sm_key ON ctr_sub_manpower (company_id, subcontractor_id, org_project_id, trade_code, from_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ctr_sub_manpower_subcontractor_id ON ctr_sub_manpower (subcontractor_id);
CREATE INDEX IF NOT EXISTS ix_ctr_sub_manpower_org_project_id ON ctr_sub_manpower (org_project_id);
CREATE TABLE IF NOT EXISTS ctr_sub_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  subcontractor_id INTEGER NOT NULL REFERENCES mdm_partners (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  hold            INTEGER NOT NULL DEFAULT 0 CHECK (hold IN (0, 1)),
  reasons_json    TEXT    NOT NULL DEFAULT '[]',
  since           TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_sh_key ON ctr_sub_holds (company_id, subcontractor_id, org_project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ctr_sub_holds_subcontractor_id ON ctr_sub_holds (subcontractor_id);
CREATE INDEX IF NOT EXISTS ix_ctr_sub_holds_org_project_id ON ctr_sub_holds (org_project_id);
CREATE TABLE IF NOT EXISTS ctr_sub_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  subcontractor_id INTEGER NOT NULL REFERENCES mdm_partners (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  progress_score  INTEGER NOT NULL CHECK (progress_score BETWEEN 0 AND 100),
  quality_score   INTEGER NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
  safety_score    INTEGER NOT NULL CHECK (safety_score BETWEEN 0 AND 100),
  compliance_score INTEGER NOT NULL CHECK (compliance_score BETWEEN 0 AND 100),
  total           INTEGER NOT NULL CHECK (total BETWEEN 0 AND 100),
  band            TEXT    NOT NULL CHECK (band IN ('A', 'B', 'C', 'D')),
  weights_json    TEXT    NOT NULL DEFAULT '[]',
  details_json    TEXT    NOT NULL DEFAULT '{}',
  computed_at     TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_sr_key ON ctr_sub_ratings (company_id, subcontractor_id, org_project_id, period) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ctr_sub_ratings_subcontractor_id ON ctr_sub_ratings (subcontractor_id);
CREATE INDEX IF NOT EXISTS ix_ctr_sub_ratings_org_project_id ON ctr_sub_ratings (org_project_id);
