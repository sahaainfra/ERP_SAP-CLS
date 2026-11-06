-- Part 07.10: training, certifications, skills and the competency matrix (module hr).
-- trn_courses: what is taught (internal or external), who must take it and how long it stays valid. trn_sessions: a run of a course (date, trainer, venue, site, capacity, cost); an external session with a cost is approved.
-- trn_attendance: nominations, QR sign-in, attendance, post-test score and feedback. trn_cert_types and trn_certifications: licences and tickets of employees and workers, with validity, document, verification and the dependent checks.
-- trn_skill_defs and trn_skills: the skills and trades and the assessed level of a person (the matrix).

CREATE TABLE IF NOT EXISTS trn_courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code           TEXT    NOT NULL COLLATE NOCASE,
  title          TEXT    NOT NULL,
  title_hi       TEXT,
  category       TEXT    NOT NULL DEFAULT 'SAFETY' CHECK (category IN ('SAFETY', 'TECHNICAL', 'STATUTORY', 'SOFT', 'OTHER')),
  mode           TEXT    NOT NULL DEFAULT 'INTERNAL' CHECK (mode IN ('INTERNAL', 'EXTERNAL')),
  mandatory_for_json TEXT NOT NULL DEFAULT '{}',
  validity_months INTEGER CHECK (validity_months IS NULL OR validity_months > 0),
  pass_score     INTEGER CHECK (pass_score IS NULL OR (pass_score >= 0 AND pass_score <= 100)),
  cert_type_code TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_trn_courses_code ON trn_courses (company_id, code);
CREATE INDEX IF NOT EXISTS ix_trn_courses_company_id ON trn_courses (company_id);

CREATE TABLE IF NOT EXISTS trn_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  course_id      INTEGER NOT NULL REFERENCES trn_courses (id),
  start_at       TEXT    NOT NULL,
  end_at         TEXT    NOT NULL,
  trainer        TEXT,
  venue          TEXT,
  department_id  INTEGER,
  capacity       INTEGER NOT NULL DEFAULT 20 CHECK (capacity > 0),
  cost_minor     INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'COMPLETED')),
  band           TEXT    NOT NULL DEFAULT 'INTERNAL',
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  qr_token       TEXT,
  completed_at   TEXT,
  cancel_reason  TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_trn_sessions_doc ON trn_sessions (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_trn_sessions_company_id ON trn_sessions (company_id);
CREATE INDEX IF NOT EXISTS ix_trn_sessions_course ON trn_sessions (course_id);
CREATE INDEX IF NOT EXISTS ix_trn_sessions_when ON trn_sessions (company_id, start_at);
CREATE INDEX IF NOT EXISTS ix_trn_sessions_status ON trn_sessions (company_id, status);
CREATE INDEX IF NOT EXISTS ix_trn_sessions_site ON trn_sessions (site_id);
CREATE INDEX IF NOT EXISTS ix_trn_sessions_project ON trn_sessions (project_id);
CREATE INDEX IF NOT EXISTS ix_trn_sessions_department ON trn_sessions (department_id);

CREATE TABLE IF NOT EXISTS trn_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  session_id     INTEGER NOT NULL REFERENCES trn_sessions (id),
  person_type    TEXT    NOT NULL CHECK (person_type IN ('EMPLOYEE', 'WORKER')),
  person_id      INTEGER NOT NULL,
  nominated_by   TEXT,
  attendance     TEXT    NOT NULL DEFAULT 'NOMINATED' CHECK (attendance IN ('NOMINATED', 'ATTENDED', 'ABSENT')),
  signed_in_at   TEXT,
  sign_in_method TEXT CHECK (sign_in_method IS NULL OR sign_in_method IN ('QR', 'TRAINER')),
  score          INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  passed         INTEGER CHECK (passed IS NULL OR passed IN (0, 1)),
  feedback_rating INTEGER CHECK (feedback_rating IS NULL OR (feedback_rating >= 1 AND feedback_rating <= 5)),
  feedback       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_trn_attendance_person ON trn_attendance (session_id, person_type, person_id);
CREATE INDEX IF NOT EXISTS ix_trn_attendance_company_id ON trn_attendance (company_id);
CREATE INDEX IF NOT EXISTS ix_trn_attendance_who ON trn_attendance (company_id, person_type, person_id);
CREATE INDEX IF NOT EXISTS ix_trn_attendance_site ON trn_attendance (site_id);
CREATE INDEX IF NOT EXISTS ix_trn_attendance_project ON trn_attendance (project_id);

CREATE TABLE IF NOT EXISTS trn_cert_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code           TEXT    NOT NULL COLLATE NOCASE,
  name           TEXT    NOT NULL,
  name_hi        TEXT,
  validity_months INTEGER CHECK (validity_months IS NULL OR validity_months > 0),
  alert_days     INTEGER NOT NULL DEFAULT 30 CHECK (alert_days >= 0),
  required_for_json TEXT NOT NULL DEFAULT '{}',
  mandatory      INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_trn_cert_types_code ON trn_cert_types (company_id, code);
CREATE INDEX IF NOT EXISTS ix_trn_cert_types_company_id ON trn_cert_types (company_id);

CREATE TABLE IF NOT EXISTS trn_certifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  person_type    TEXT    NOT NULL CHECK (person_type IN ('EMPLOYEE', 'WORKER')),
  person_id      INTEGER NOT NULL,
  cert_type      TEXT    NOT NULL COLLATE NOCASE,
  number         TEXT,
  issuer         TEXT,
  valid_from     TEXT    NOT NULL,
  valid_until    TEXT,
  file_id        INTEGER,
  verified       INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  verified_by    TEXT,
  verified_at    TEXT,
  cert_status    TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (cert_status IN ('ACTIVE', 'REVOKED')),
  revoked_reason TEXT,
  session_id     INTEGER REFERENCES trn_sessions (id),
  alerted_state  TEXT,
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
CREATE INDEX IF NOT EXISTS ix_trn_certifications_company_id ON trn_certifications (company_id);
CREATE INDEX IF NOT EXISTS ix_trn_certifications_person ON trn_certifications (company_id, person_type, person_id);
CREATE INDEX IF NOT EXISTS ix_trn_certifications_type ON trn_certifications (company_id, cert_type, valid_until);
CREATE INDEX IF NOT EXISTS ix_trn_certifications_session ON trn_certifications (session_id);
CREATE INDEX IF NOT EXISTS ix_trn_certifications_file ON trn_certifications (file_id);
CREATE INDEX IF NOT EXISTS ix_trn_certifications_site ON trn_certifications (site_id);
CREATE INDEX IF NOT EXISTS ix_trn_certifications_project ON trn_certifications (project_id);

CREATE TABLE IF NOT EXISTS trn_skill_defs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code           TEXT    NOT NULL COLLATE NOCASE,
  name           TEXT    NOT NULL,
  name_hi        TEXT,
  trade          TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_trn_skill_defs_code ON trn_skill_defs (company_id, code);
CREATE INDEX IF NOT EXISTS ix_trn_skill_defs_company_id ON trn_skill_defs (company_id);

CREATE TABLE IF NOT EXISTS trn_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  person_type    TEXT    NOT NULL CHECK (person_type IN ('EMPLOYEE', 'WORKER')),
  person_id      INTEGER NOT NULL,
  skill_code     TEXT    NOT NULL COLLATE NOCASE,
  level          INTEGER NOT NULL CHECK (level >= 0 AND level <= 4),
  assessed_on    TEXT    NOT NULL,
  assessor_id    INTEGER REFERENCES hr_employees (id),
  assessor       TEXT,
  notes          TEXT,
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
CREATE INDEX IF NOT EXISTS ix_trn_skills_company_id ON trn_skills (company_id);
CREATE INDEX IF NOT EXISTS ix_trn_skills_person ON trn_skills (company_id, person_type, person_id, skill_code, assessed_on);
CREATE INDEX IF NOT EXISTS ix_trn_skills_assessor ON trn_skills (assessor_id);
CREATE INDEX IF NOT EXISTS ix_trn_skills_site ON trn_skills (site_id);
CREATE INDEX IF NOT EXISTS ix_trn_skills_project ON trn_skills (project_id);
