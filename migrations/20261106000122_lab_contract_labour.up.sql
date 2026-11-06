-- Part 07.08: contract labour (module hr). lab_workers (the register of contract workers: approval-controlled; an amendment is a revision row applied to the worker row when approved),
-- lab_contractor_compliance (licence, registrations and the most workers allowed, per labour contractor of the partner master), lab_wage_rates (minimum wages and contracted rates, effective-dated, approval-controlled).

CREATE TABLE IF NOT EXISTS lab_workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  revision_no    INTEGER NOT NULL DEFAULT 1,
  root_id        INTEGER,
  supersedes_id  INTEGER,
  doc_date       TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  band           TEXT    NOT NULL DEFAULT 'STANDARD',
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  worker_code    TEXT    NOT NULL COLLATE NOCASE,
  name           TEXT    NOT NULL,
  photo_file_id  INTEGER,
  aadhaar_last4  TEXT,
  aadhaar_hash   TEXT,
  mobile         TEXT,
  dob            TEXT    NOT NULL,
  gender         TEXT    NOT NULL CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
  home_state     TEXT,
  trade_code     TEXT    NOT NULL,
  skill_category TEXT    NOT NULL CHECK (skill_category IN ('UNSKILLED', 'SEMI_SKILLED', 'SKILLED', 'HIGHLY_SKILLED')),
  contractor_id  INTEGER NOT NULL REFERENCES mdm_partners (id),
  bank_enc       TEXT,
  bank_last4     TEXT,
  ifsc           TEXT,
  uan            TEXT,
  esic_ip        TEXT,
  bocw_no        TEXT,
  emergency_name TEXT,
  emergency_mobile TEXT,
  induction_status TEXT  NOT NULL DEFAULT 'PENDING' CHECK (induction_status IN ('PENDING', 'CLEARED', 'EXPIRED')),
  induction_date TEXT,
  medical_status TEXT    NOT NULL DEFAULT 'PENDING' CHECK (medical_status IN ('PENDING', 'FIT', 'UNFIT', 'EXPIRED')),
  medical_valid_until TEXT,
  ppe_json       TEXT    NOT NULL DEFAULT '[]',
  worker_status  TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (worker_status IN ('ACTIVE', 'BLACKLISTED', 'LEFT')),
  blacklist_reason TEXT,
  blacklisted_by TEXT,
  blacklisted_at TEXT,
  qr_token       TEXT,
  card_issued_at TEXT,
  card_version   INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_lab_workers_doc ON lab_workers (company_id, doc_no, revision_no);
CREATE INDEX IF NOT EXISTS ix_lab_workers_company_id ON lab_workers (company_id);
CREATE INDEX IF NOT EXISTS ix_lab_workers_contractor ON lab_workers (contractor_id);
CREATE INDEX IF NOT EXISTS ix_lab_workers_status ON lab_workers (company_id, status, worker_status);
CREATE INDEX IF NOT EXISTS ix_lab_workers_root_id ON lab_workers (root_id);
CREATE INDEX IF NOT EXISTS ix_lab_workers_supersedes_id ON lab_workers (supersedes_id);
CREATE INDEX IF NOT EXISTS ix_lab_workers_photo ON lab_workers (photo_file_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lab_workers_qr ON lab_workers (qr_token) WHERE qr_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_lab_workers_aadhaar ON lab_workers (company_id, aadhaar_hash) WHERE aadhaar_hash IS NOT NULL AND status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') AND root_id = id;

CREATE TABLE IF NOT EXISTS lab_contractor_compliance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  contractor_id  INTEGER NOT NULL REFERENCES mdm_partners (id),
  clra_licence_no TEXT,
  licence_valid_until TEXT,
  max_workers    INTEGER CHECK (max_workers IS NULL OR max_workers >= 0),
  pf_code        TEXT,
  esi_code       TEXT,
  wo_reference   TEXT,
  wo_valid_until TEXT,
  alerted_for    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_lab_compliance_contractor ON lab_contractor_compliance (company_id, contractor_id);
CREATE INDEX IF NOT EXISTS ix_lab_compliance_company_id ON lab_contractor_compliance (company_id);
CREATE INDEX IF NOT EXISTS ix_lab_compliance_contractor ON lab_contractor_compliance (contractor_id);

CREATE TABLE IF NOT EXISTS lab_wage_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  revision_no    INTEGER NOT NULL DEFAULT 1,
  root_id        INTEGER,
  supersedes_id  INTEGER,
  doc_date       TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  band           TEXT    NOT NULL DEFAULT 'STANDARD',
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  kind           TEXT    NOT NULL CHECK (kind IN ('MINIMUM', 'CONTRACT')),
  contractor_id  INTEGER REFERENCES mdm_partners (id),
  trade_code     TEXT,
  skill_category TEXT    NOT NULL CHECK (skill_category IN ('UNSKILLED', 'SEMI_SKILLED', 'SKILLED', 'HIGHLY_SKILLED')),
  state_code     TEXT    NOT NULL,
  pay_basis      TEXT    NOT NULL CHECK (pay_basis IN ('DAILY', 'HOURLY', 'PIECE')),
  rate_minor     INTEGER NOT NULL CHECK (rate_minor > 0),
  min_wage_ref   TEXT,
  effective_from TEXT    NOT NULL,
  reason         TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_lab_wage_rates_doc ON lab_wage_rates (company_id, doc_no, revision_no);
CREATE INDEX IF NOT EXISTS ix_lab_wage_rates_company_id ON lab_wage_rates (company_id);
CREATE INDEX IF NOT EXISTS ix_lab_wage_rates_contractor ON lab_wage_rates (contractor_id);
CREATE INDEX IF NOT EXISTS ix_lab_wage_rates_lookup ON lab_wage_rates (company_id, kind, state_code, skill_category, effective_from);
CREATE INDEX IF NOT EXISTS ix_lab_wage_rates_root_id ON lab_wage_rates (root_id);
CREATE INDEX IF NOT EXISTS ix_lab_wage_rates_supersedes_id ON lab_wage_rates (supersedes_id);
