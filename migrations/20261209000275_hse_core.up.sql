-- Part 19.01: project HSE plans, the risk assessment (HIRA) and job safety analysis (JSA), site induction content and inductions, the toolbox talk library and talks, and medical fitness status. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS hse_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  title           TEXT    NOT NULL,
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  document_file_id INTEGER,
  emergency_json  TEXT    NOT NULL DEFAULT '{}',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_pl_doc ON hse_plans (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_hse_pl_project ON hse_plans (org_project_id, status);
CREATE INDEX IF NOT EXISTS ix_hse_pl_site ON hse_plans (org_site_id);
CREATE TABLE IF NOT EXISTS hse_hira (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  activity_id     INTEGER REFERENCES plan_activities (id),
  activity_type   TEXT,
  title           TEXT    NOT NULL,
  hazards_json    TEXT    NOT NULL DEFAULT '[]',
  max_score       INTEGER NOT NULL DEFAULT 0 CHECK (max_score BETWEEN 0 AND 25),
  max_residual    INTEGER NOT NULL DEFAULT 0 CHECK (max_residual BETWEEN 0 AND 25),
  risk_level      TEXT    NOT NULL DEFAULT 'LOW' CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'EXTREME')),
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_hira_doc ON hse_hira (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_hse_hira_project ON hse_hira (org_project_id, status, risk_level);
CREATE INDEX IF NOT EXISTS ix_hse_hira_site ON hse_hira (org_site_id);
CREATE INDEX IF NOT EXISTS ix_hse_hira_activity ON hse_hira (activity_id);
CREATE TABLE IF NOT EXISTS hse_jsa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  hira_id         INTEGER REFERENCES hse_hira (id),
  wa_id           INTEGER REFERENCES site_work_authorisations (id),
  activity_id     INTEGER REFERENCES plan_activities (id),
  task            TEXT    NOT NULL,
  method_statement_ref TEXT,
  steps_json      TEXT    NOT NULL DEFAULT '[]',
  participants_json TEXT  NOT NULL DEFAULT '[]',
  jsa_status      TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (jsa_status IN ('DRAFT', 'ISSUED', 'COMPLETED', 'CANCELLED')),
  prepared_by     TEXT    NOT NULL,
  valid_on        TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_jsa_doc ON hse_jsa (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_hse_jsa_project ON hse_jsa (org_project_id, jsa_status);
CREATE INDEX IF NOT EXISTS ix_hse_jsa_site ON hse_jsa (org_site_id);
CREATE INDEX IF NOT EXISTS ix_hse_jsa_hira ON hse_jsa (hira_id);
CREATE INDEX IF NOT EXISTS ix_hse_jsa_wa ON hse_jsa (wa_id);
CREATE INDEX IF NOT EXISTS ix_hse_jsa_activity ON hse_jsa (activity_id);
CREATE TABLE IF NOT EXISTS hse_induction_content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  title           TEXT    NOT NULL,
  body            TEXT    NOT NULL,
  quiz_json       TEXT    NOT NULL DEFAULT '[]',
  pass_pct        INTEGER NOT NULL DEFAULT 70 CHECK (pass_pct BETWEEN 0 AND 100),
  validity_days   INTEGER NOT NULL DEFAULT 365 CHECK (validity_days BETWEEN 1 AND 3650),
  content_status  TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (content_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_ic_code ON hse_induction_content (company_id, code);
CREATE INDEX IF NOT EXISTS ix_hse_ic_project ON hse_induction_content (org_project_id);
CREATE INDEX IF NOT EXISTS ix_hse_ic_site ON hse_induction_content (org_site_id);
CREATE TABLE IF NOT EXISTS hse_inductions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  content_id      INTEGER NOT NULL REFERENCES hse_induction_content (id),
  person_type     TEXT    NOT NULL CHECK (person_type IN ('WORKER', 'EMPLOYEE')),
  person_id       INTEGER NOT NULL,
  person_code     TEXT    NOT NULL,
  person_name     TEXT    NOT NULL,
  induction_date  TEXT    NOT NULL,
  conducted_by    TEXT    NOT NULL,
  quiz_score_pct  INTEGER CHECK (quiz_score_pct IS NULL OR quiz_score_pct BETWEEN 0 AND 100),
  passed          INTEGER NOT NULL DEFAULT 0 CHECK (passed IN (0, 1)),
  valid_until     TEXT,
  answers_json    TEXT    NOT NULL DEFAULT '[]',
  via             TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (via IN ('QR', 'MANUAL')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_in_doc ON hse_inductions (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_hse_in_site ON hse_inductions (org_site_id, status);
CREATE INDEX IF NOT EXISTS ix_hse_in_project ON hse_inductions (org_project_id);
CREATE INDEX IF NOT EXISTS ix_hse_in_content ON hse_inductions (content_id);
CREATE INDEX IF NOT EXISTS ix_hse_in_person ON hse_inductions (person_type, person_id, valid_until);
CREATE TABLE IF NOT EXISTS hse_toolbox_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  title           TEXT    NOT NULL,
  body            TEXT,
  category        TEXT,
  frequency       TEXT    NOT NULL DEFAULT 'WEEKLY' CHECK (frequency IN ('DAILY', 'WEEKLY', 'AD_HOC')),
  topic_status    TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (topic_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_tt_code ON hse_toolbox_topics (company_id, code);
CREATE TABLE IF NOT EXISTS hse_toolbox_talks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  talk_date       TEXT    NOT NULL,
  topic_id        INTEGER REFERENCES hse_toolbox_topics (id),
  topic_text      TEXT    NOT NULL,
  conducted_by    TEXT    NOT NULL,
  attendees_json  TEXT    NOT NULL DEFAULT '[]',
  attendee_count  INTEGER NOT NULL DEFAULT 0 CHECK (attendee_count >= 0),
  photo_file_ids  TEXT    NOT NULL DEFAULT '[]',
  duration_min    INTEGER CHECK (duration_min IS NULL OR duration_min BETWEEN 1 AND 480),
  notes           TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_tk_doc ON hse_toolbox_talks (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_hse_tk_site ON hse_toolbox_talks (org_site_id, talk_date);
CREATE INDEX IF NOT EXISTS ix_hse_tk_project ON hse_toolbox_talks (org_project_id);
CREATE INDEX IF NOT EXISTS ix_hse_tk_topic ON hse_toolbox_talks (topic_id);
CREATE TABLE IF NOT EXISTS hse_medical_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  worker_id       INTEGER NOT NULL REFERENCES lab_workers (id),
  fitness         TEXT    NOT NULL CHECK (fitness IN ('FIT', 'UNFIT', 'RESTRICTED')),
  examined_on     TEXT    NOT NULL,
  valid_until     TEXT,
  recorded_by     TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_hse_med_worker ON hse_medical_records (worker_id, examined_on);
CREATE INDEX IF NOT EXISTS ix_hse_med_company ON hse_medical_records (company_id, valid_until);
