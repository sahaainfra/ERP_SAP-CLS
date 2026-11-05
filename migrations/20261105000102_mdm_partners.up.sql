-- Part 06.04: the business partner master. mdm_partners: one partner (vendor, subcontractor, labour contractor, service provider, client, consultant, transporter: the roles are in
-- mdm_partner_roles) with its statutory identity and its status (Prospect, Pending approval, Active, On hold, Blacklisted, Inactive). The GST registrations per state, addresses, contacts,
-- bank accounts (the account number encrypted, a hash for duplicates and the last four digits for display), compliance documents with expiry, TDS settings with lower-deduction
-- certificates, and the requests to blacklist a partner or lift it (approved by the director). A bank change waits for confirmation by the partner and approval; payments are held until then.

CREATE TABLE IF NOT EXISTS mdm_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  legal_name      TEXT    NOT NULL,
  trade_name      TEXT,
  name_key        TEXT    NOT NULL DEFAULT '',
  constitution    TEXT    NOT NULL CHECK (constitution IN ('PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'TRUST', 'SOCIETY', 'GOVERNMENT', 'HUF', 'INDIVIDUAL', 'OTHER')),
  pan             TEXT,
  msme_no         TEXT,
  msme_category   TEXT    CHECK (msme_category IS NULL OR msme_category IN ('MICRO', 'SMALL', 'MEDIUM')),
  cin             TEXT,
  partner_status  TEXT    NOT NULL DEFAULT 'PROSPECT' CHECK (partner_status IN ('PROSPECT', 'PENDING', 'ACTIVE', 'ON_HOLD', 'BLACKLISTED', 'INACTIVE', 'REJECTED')),
  status_reason   TEXT,
  blacklist_reason TEXT,
  blacklist_until TEXT,
  payment_hold_until TEXT,
  payment_hold_reason TEXT,
  steward_role    TEXT    NOT NULL CHECK (steward_role IN ('PROCMGR', 'COMMGR')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  activated_at    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_partners_code ON mdm_partners (company_id, code);
CREATE INDEX IF NOT EXISTS ix_mdm_partners_list ON mdm_partners (company_id, partner_status);
CREATE INDEX IF NOT EXISTS ix_mdm_partners_pan ON mdm_partners (company_id, pan);
CREATE INDEX IF NOT EXISTS ix_mdm_partners_name ON mdm_partners (company_id, legal_name);

CREATE TABLE IF NOT EXISTS mdm_partner_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  partner_role    TEXT    NOT NULL CHECK (partner_role IN ('VENDOR', 'SUBCONTRACTOR', 'LABOUR_CONTRACTOR', 'SERVICE_PROVIDER', 'CLIENT', 'CONSULTANT', 'TRANSPORTER')),
  categories_json TEXT    NOT NULL DEFAULT '[]',
  regions_json    TEXT    NOT NULL DEFAULT '[]',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_partner_roles ON mdm_partner_roles (partner_id, partner_role) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_partner_roles_role ON mdm_partner_roles (company_id, partner_role);

CREATE TABLE IF NOT EXISTS mdm_partner_gstins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  state_code      TEXT    NOT NULL,
  gstin           TEXT    NOT NULL CHECK (length(gstin) = 15),
  gstin_status    TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (gstin_status IN ('ACTIVE', 'CANCELLED', 'SUSPENDED')),
  verify_source   TEXT    CHECK (verify_source IS NULL OR verify_source IN ('FORMAT', 'API')),
  verified_at     TEXT,
  verified_by     TEXT,
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
CREATE INDEX IF NOT EXISTS ix_mdm_partner_gstins_partner ON mdm_partner_gstins (partner_id);
CREATE INDEX IF NOT EXISTS ix_mdm_partner_gstins_gstin ON mdm_partner_gstins (company_id, gstin);

CREATE TABLE IF NOT EXISTS mdm_partner_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  address_type    TEXT    NOT NULL CHECK (address_type IN ('REGISTERED', 'BILLING', 'SHIPPING', 'SITE', 'OTHER')),
  address         TEXT    NOT NULL,
  city            TEXT,
  state_code      TEXT    NOT NULL,
  pin             TEXT,
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
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
CREATE INDEX IF NOT EXISTS ix_mdm_partner_addresses_partner ON mdm_partner_addresses (partner_id);
CREATE INDEX IF NOT EXISTS ix_mdm_partner_addresses_company ON mdm_partner_addresses (company_id);

CREATE TABLE IF NOT EXISTS mdm_partner_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  name            TEXT    NOT NULL,
  designation     TEXT,
  email           TEXT,
  mobile          TEXT,
  is_primary      INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  portal_user_id  INTEGER REFERENCES iam_users (id),
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
CREATE INDEX IF NOT EXISTS ix_mdm_partner_contacts_partner ON mdm_partner_contacts (partner_id);
CREATE INDEX IF NOT EXISTS ix_mdm_partner_contacts_mobile ON mdm_partner_contacts (company_id, mobile);
CREATE INDEX IF NOT EXISTS ix_mdm_partner_contacts_portal ON mdm_partner_contacts (portal_user_id);

CREATE TABLE IF NOT EXISTS mdm_partner_banks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  account_no_encrypted TEXT NOT NULL,
  account_hash    TEXT    NOT NULL,
  account_last4   TEXT    NOT NULL,
  ifsc            TEXT    NOT NULL CHECK (length(ifsc) = 11),
  bank_name       TEXT,
  branch          TEXT,
  account_name    TEXT    NOT NULL,
  bank_status     TEXT    NOT NULL CHECK (bank_status IN ('PENDING_CONFIRMATION', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'REPLACED')),
  verified_status TEXT    NOT NULL DEFAULT 'UNVERIFIED' CHECK (verified_status IN ('UNVERIFIED', 'VERIFIED', 'FAILED')),
  verify_method   TEXT    CHECK (verify_method IS NULL OR verify_method IN ('PENNY_DROP', 'OTP', 'CALLBACK')),
  verify_note     TEXT,
  verified_at     TEXT,
  otp_id          INTEGER,
  cheque_file_id  INTEGER,
  cooling_off_until TEXT,
  is_primary      INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  change_reason   TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
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
CREATE INDEX IF NOT EXISTS ix_mdm_partner_banks_partner ON mdm_partner_banks (partner_id, bank_status);
CREATE INDEX IF NOT EXISTS ix_mdm_partner_banks_hash ON mdm_partner_banks (company_id, account_hash);

CREATE TABLE IF NOT EXISTS mdm_partner_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  doc_type        TEXT    NOT NULL CHECK (doc_type IN ('GST_CERTIFICATE', 'PAN_CARD', 'MSME_CERTIFICATE', 'CLRA_LICENCE', 'PF_REGISTRATION', 'ESI_REGISTRATION', 'INSURANCE', 'ISO_CERTIFICATE', 'CANCELLED_CHEQUE', 'INCORPORATION', 'OTHER')),
  document_ref    TEXT,
  file_id         INTEGER,
  valid_from      TEXT,
  valid_until     TEXT,
  verified_by     TEXT,
  verified_at     TEXT,
  alert_stage     TEXT    CHECK (alert_stage IS NULL OR alert_stage IN ('DUE', 'EXPIRED')),
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
CREATE INDEX IF NOT EXISTS ix_mdm_partner_documents_partner ON mdm_partner_documents (partner_id);
CREATE INDEX IF NOT EXISTS ix_mdm_partner_documents_expiry ON mdm_partner_documents (company_id, valid_until);

CREATE TABLE IF NOT EXISTS mdm_partner_tds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  section         TEXT    NOT NULL,
  ldc_no          TEXT,
  ldc_rate        INTEGER CHECK (ldc_rate IS NULL OR ldc_rate BETWEEN 0 AND 1000000),
  ldc_limit       INTEGER CHECK (ldc_limit IS NULL OR ldc_limit >= 0),
  valid_from      TEXT,
  valid_until     TEXT,
  verified_by     TEXT,
  verified_at     TEXT,
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
CREATE INDEX IF NOT EXISTS ix_mdm_partner_tds_partner ON mdm_partner_tds (partner_id);
CREATE INDEX IF NOT EXISTS ix_mdm_partner_tds_company ON mdm_partner_tds (company_id, section);

CREATE TABLE IF NOT EXISTS mdm_partner_status_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  action          TEXT    NOT NULL CHECK (action IN ('BLACKLIST', 'LIFT_BLACKLIST')),
  reason          TEXT    NOT NULL,
  until_date      TEXT,
  request_status  TEXT    NOT NULL DEFAULT 'PENDING' CHECK (request_status IN ('PENDING', 'RETURNED', 'APPLIED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  decided_by      TEXT,
  decided_at      TEXT,
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
CREATE INDEX IF NOT EXISTS ix_mdm_partner_status_requests_partner ON mdm_partner_status_requests (partner_id);
CREATE INDEX IF NOT EXISTS ix_mdm_partner_status_requests_list ON mdm_partner_status_requests (company_id, request_status);
