-- Part 07.01: the employee master and employment records (module hr). hr_employees: one person employed by a company (head office or site) with personal and employment details; the record is
-- approval-controlled (DRAFT -> SUBMITTED -> APPROVED | REJECTED, RETURNED, CANCELLED) and its employment status (Active, Notice, Separated, Absconding) is separate and effective-dated.
-- hr_employee_statutory (PAN encrypted with a hash for duplicates, Aadhaar only as last four digits and a hash, UAN, ESIC, PF/ESI flags, PT/LWF state) and hr_employee_banks (account number encrypted,
-- hash, last four digits, IFSC, verification) are restricted to HR, payroll and the employee. hr_employee_contacts (emergency, family, nominees), hr_employee_education, hr_employee_experience,
-- hr_employee_documents (with expiry), hr_employee_history (promotions, transfers, increments with effective dates) and hr_employee_changes (every change after approval: profile, statutory,
-- bank, employment, separation, each approved through the workflow engine and applied on its effective date).

CREATE TABLE IF NOT EXISTS hr_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  emp_code           TEXT    NOT NULL COLLATE NOCASE,
  first_name         TEXT    NOT NULL,
  last_name          TEXT,
  full_name          TEXT    NOT NULL,
  name_key           TEXT    NOT NULL DEFAULT '',
  photo_file_id      INTEGER,
  gender             TEXT    NOT NULL CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
  dob                TEXT    NOT NULL,
  blood_group        TEXT    CHECK (blood_group IS NULL OR blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  marital_status     TEXT    CHECK (marital_status IS NULL OR marital_status IN ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'OTHER')),
  mobile             TEXT    NOT NULL,
  email              TEXT,
  permanent_address  TEXT,
  current_address    TEXT,
  branch_id          INTEGER REFERENCES org_branches (id),
  department_id      INTEGER REFERENCES org_departments (id),
  designation_id     INTEGER REFERENCES org_designations (id),
  grade              TEXT,
  employment_type    TEXT    NOT NULL CHECK (employment_type IN ('PERMANENT', 'CONTRACT', 'TRAINEE', 'CONSULTANT')),
  doj                TEXT    NOT NULL,
  confirmation_date  TEXT,
  manager_id         INTEGER REFERENCES hr_employees (id),
  cost_centre_id     INTEGER REFERENCES org_cost_centres (id),
  location_type      TEXT    NOT NULL DEFAULT 'HO' CHECK (location_type IN ('HO', 'SITE')),
  salary_payment_mode TEXT   NOT NULL DEFAULT 'BANK_TRANSFER' CHECK (salary_payment_mode IN ('BANK_TRANSFER', 'CASH', 'CHEQUE')),
  employment_status  TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (employment_status IN ('ACTIVE', 'NOTICE', 'SEPARATED', 'ABSCONDING')),
  status_effective_date TEXT,
  last_working_date  TEXT,
  separation_reason  TEXT,
  access_note        TEXT,
  record_status      TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (record_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  languages_json     TEXT    NOT NULL DEFAULT '[]',
  skills_json        TEXT    NOT NULL DEFAULT '[]',
  user_id            INTEGER REFERENCES iam_users (id),
  workflow_instance_id INTEGER,
  requested_by       TEXT,
  activated_at       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_employees_code ON hr_employees (company_id, emp_code);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_employees_user ON hr_employees (company_id, user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL AND record_status NOT IN ('CANCELLED', 'REJECTED');
CREATE INDEX IF NOT EXISTS ix_hr_employees_list ON hr_employees (company_id, record_status, employment_status);
CREATE INDEX IF NOT EXISTS ix_hr_employees_name ON hr_employees (company_id, full_name);
CREATE INDEX IF NOT EXISTS ix_hr_employees_mobile ON hr_employees (company_id, mobile);
CREATE INDEX IF NOT EXISTS ix_hr_employees_dob ON hr_employees (company_id, dob);
CREATE INDEX IF NOT EXISTS ix_hr_employees_branch ON hr_employees (branch_id);
CREATE INDEX IF NOT EXISTS ix_hr_employees_department ON hr_employees (department_id);
CREATE INDEX IF NOT EXISTS ix_hr_employees_designation ON hr_employees (designation_id);
CREATE INDEX IF NOT EXISTS ix_hr_employees_manager ON hr_employees (manager_id);
CREATE INDEX IF NOT EXISTS ix_hr_employees_cost_centre ON hr_employees (cost_centre_id);
CREATE INDEX IF NOT EXISTS ix_hr_employees_project ON hr_employees (project_id);
CREATE INDEX IF NOT EXISTS ix_hr_employees_site ON hr_employees (site_id);
CREATE INDEX IF NOT EXISTS ix_hr_employees_user_id ON hr_employees (user_id);
CREATE INDEX IF NOT EXISTS ix_hr_employees_doj ON hr_employees (company_id, doj);

CREATE TABLE IF NOT EXISTS hr_employee_statutory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  pan_enc        TEXT,
  pan_hash       TEXT,
  pan_last4      TEXT,
  aadhaar_last4  TEXT,
  aadhaar_hash   TEXT,
  uan            TEXT,
  esic_ip        TEXT,
  pf_applicable  INTEGER NOT NULL DEFAULT 0 CHECK (pf_applicable IN (0, 1)),
  esi_applicable INTEGER NOT NULL DEFAULT 0 CHECK (esi_applicable IN (0, 1)),
  pt_state       TEXT,
  lwf_state      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_employee_statutory_employee ON hr_employee_statutory (employee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_hr_employee_statutory_pan ON hr_employee_statutory (company_id, pan_hash);
CREATE INDEX IF NOT EXISTS ix_hr_employee_statutory_aadhaar ON hr_employee_statutory (company_id, aadhaar_hash);

CREATE TABLE IF NOT EXISTS hr_employee_banks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  account_enc    TEXT    NOT NULL,
  account_hash   TEXT    NOT NULL,
  account_last4  TEXT    NOT NULL,
  ifsc           TEXT    NOT NULL,
  bank_name      TEXT,
  branch_name    TEXT,
  account_name   TEXT    NOT NULL,
  bank_status    TEXT    NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (bank_status IN ('PENDING_APPROVAL', 'ACTIVE', 'REPLACED', 'REJECTED')),
  verified_status TEXT   NOT NULL DEFAULT 'UNVERIFIED' CHECK (verified_status IN ('UNVERIFIED', 'VERIFIED', 'FAILED')),
  verified_by    TEXT,
  verified_at    TEXT,
  verify_note    TEXT,
  is_primary     INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  change_id      INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_hr_employee_banks_employee ON hr_employee_banks (employee_id);
CREATE INDEX IF NOT EXISTS ix_hr_employee_banks_hash ON hr_employee_banks (company_id, account_hash);
CREATE INDEX IF NOT EXISTS ix_hr_employee_banks_status ON hr_employee_banks (company_id, bank_status);

CREATE TABLE IF NOT EXISTS hr_employee_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  contact_type   TEXT    NOT NULL CHECK (contact_type IN ('EMERGENCY', 'FAMILY', 'NOMINEE')),
  name           TEXT    NOT NULL,
  relation       TEXT    NOT NULL,
  phone          TEXT,
  dob            TEXT,
  share_pct      INTEGER CHECK (share_pct IS NULL OR share_pct >= 0),
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
CREATE INDEX IF NOT EXISTS ix_hr_employee_contacts_employee ON hr_employee_contacts (employee_id, contact_type);

CREATE TABLE IF NOT EXISTS hr_employee_education (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  qualification  TEXT    NOT NULL,
  institute      TEXT,
  pass_year      INTEGER CHECK (pass_year IS NULL OR pass_year BETWEEN 1950 AND 2100),
  grade_text     TEXT,
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
CREATE INDEX IF NOT EXISTS ix_hr_employee_education_employee ON hr_employee_education (employee_id);

CREATE TABLE IF NOT EXISTS hr_employee_experience (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  employer       TEXT    NOT NULL,
  job_title      TEXT    NOT NULL,
  from_date      TEXT    NOT NULL,
  to_date        TEXT,
  leaving_reason TEXT,
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
CREATE INDEX IF NOT EXISTS ix_hr_employee_experience_employee ON hr_employee_experience (employee_id);

CREATE TABLE IF NOT EXISTS hr_employee_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  doc_type       TEXT    NOT NULL CHECK (doc_type IN ('ID_PROOF', 'ADDRESS_PROOF', 'OFFER_LETTER', 'APPOINTMENT_LETTER', 'CERTIFICATE', 'DRIVING_LICENCE', 'MEDICAL', 'OTHER')),
  document_ref   TEXT,
  file_id        INTEGER,
  valid_from     TEXT,
  valid_until    TEXT,
  verified_by    TEXT,
  verified_at    TEXT,
  alert_stage    TEXT,
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
CREATE INDEX IF NOT EXISTS ix_hr_employee_documents_employee ON hr_employee_documents (employee_id);
CREATE INDEX IF NOT EXISTS ix_hr_employee_documents_expiry ON hr_employee_documents (company_id, valid_until);

CREATE TABLE IF NOT EXISTS hr_employee_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  change_type    TEXT    NOT NULL CHECK (change_type IN ('PROFILE', 'STATUTORY', 'BANK', 'EMPLOYMENT', 'SEPARATION')),
  effective_date TEXT    NOT NULL,
  payload_enc    TEXT    NOT NULL,
  summary_json   TEXT    NOT NULL DEFAULT '{}',
  before_json    TEXT    NOT NULL DEFAULT '{}',
  reason         TEXT    NOT NULL,
  change_status  TEXT    NOT NULL DEFAULT 'PENDING' CHECK (change_status IN ('PENDING', 'SCHEDULED', 'APPLIED', 'REJECTED', 'RETURNED', 'CANCELLED')),
  senior         INTEGER NOT NULL DEFAULT 0 CHECK (senior IN (0, 1)),
  workflow_instance_id INTEGER,
  requested_by   TEXT    NOT NULL,
  requested_self INTEGER NOT NULL DEFAULT 0 CHECK (requested_self IN (0, 1)),
  decided_by     TEXT,
  decided_at     TEXT,
  applied_at     TEXT,
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
CREATE INDEX IF NOT EXISTS ix_hr_employee_changes_employee ON hr_employee_changes (employee_id);
CREATE INDEX IF NOT EXISTS ix_hr_employee_changes_list ON hr_employee_changes (company_id, change_status);
CREATE INDEX IF NOT EXISTS ix_hr_employee_changes_due ON hr_employee_changes (change_status, effective_date);

CREATE TABLE IF NOT EXISTS hr_employee_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  event_type     TEXT    NOT NULL CHECK (event_type IN ('JOINED', 'CONFIRMED', 'PROMOTION', 'TRANSFER', 'INCREMENT', 'DESIGNATION_CHANGE', 'GRADE_CHANGE', 'MANAGER_CHANGE', 'STATUS_CHANGE', 'SEPARATION', 'OTHER')),
  effective_date TEXT    NOT NULL,
  from_json      TEXT    NOT NULL DEFAULT '{}',
  to_json        TEXT    NOT NULL DEFAULT '{}',
  reference_doc  TEXT,
  reason         TEXT,
  change_id      INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_hr_employee_history_employee ON hr_employee_history (employee_id, effective_date);

CREATE INDEX IF NOT EXISTS ix_hr_employee_contacts_company_id ON hr_employee_contacts (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_employee_education_company_id ON hr_employee_education (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_employee_experience_company_id ON hr_employee_experience (company_id);
CREATE INDEX IF NOT EXISTS ix_hr_employee_history_company_id ON hr_employee_history (company_id);
