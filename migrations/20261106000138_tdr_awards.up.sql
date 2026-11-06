-- Part 08.03: prequalification, EMD and tender fee, bid submission, opening results, competitors and award (module bd, tables tdr_*).
-- tdr_credentials: the company's credentials library (work orders, completion certificates, financials, machinery, key people), reused across tenders through tdr_tender_credentials. tdr_emd: the EMD or tender fee of a tender, asked of finance by a chain
-- and tracked to its refund. tdr_submissions: the submission checklist and the final bid price (approved by the chain). tdr_competitors and tdr_bid_results: the bidders and the prices read out at the opening, ranked by the server. tdr_negotiations: the rounds
-- of negotiation. tdr_awards: the award (letter of acceptance) or the loss, approved by the chain.

CREATE TABLE IF NOT EXISTS tdr_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  cred_type      TEXT    NOT NULL CHECK (cred_type IN ('WORK_ORDER', 'COMPLETION_CERTIFICATE', 'FINANCIALS', 'MACHINERY', 'KEY_PERSON', 'REGISTRATION', 'OTHER')),
  title          TEXT    NOT NULL,
  client_name    TEXT,
  client_partner_id INTEGER REFERENCES mdm_partners (id),
  sector         TEXT    CHECK (sector IS NULL OR sector IN ('BUILDING', 'ROADS', 'BRIDGES', 'WATER', 'INDUSTRIAL', 'EPC', 'OTHER')),
  value_minor    INTEGER CHECK (value_minor IS NULL OR value_minor >= 0),
  completion_date TEXT,
  valid_until    TEXT,
  tags_json      TEXT    NOT NULL DEFAULT '[]',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_credentials_doc ON tdr_credentials (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_tdr_credentials_company_id ON tdr_credentials (company_id);
CREATE INDEX IF NOT EXISTS ix_tdr_credentials_type ON tdr_credentials (company_id, cred_type);
CREATE INDEX IF NOT EXISTS ix_tdr_credentials_client ON tdr_credentials (client_partner_id);

CREATE TABLE IF NOT EXISTS tdr_tender_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  tender_id      INTEGER NOT NULL REFERENCES tdr_tenders (id),
  credential_id  INTEGER NOT NULL REFERENCES tdr_credentials (id),
  purpose        TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_tender_credentials ON tdr_tender_credentials (tender_id, credential_id);
CREATE INDEX IF NOT EXISTS ix_tdr_tender_credentials_company_id ON tdr_tender_credentials (company_id);
CREATE INDEX IF NOT EXISTS ix_tdr_tender_credentials_credential ON tdr_tender_credentials (credential_id);

CREATE TABLE IF NOT EXISTS tdr_emd (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  tender_id      INTEGER NOT NULL REFERENCES tdr_tenders (id),
  kind           TEXT    NOT NULL CHECK (kind IN ('EMD', 'FEE')),
  mode           TEXT    NOT NULL CHECK (mode IN ('BG', 'DD', 'ONLINE', 'EXEMPT')),
  amount_minor   INTEGER NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  payee          TEXT,
  exemption_reason TEXT,
  needed_by      TEXT,
  instrument_no  TEXT,
  bank           TEXT,
  issue_date     TEXT,
  valid_until    TEXT,
  issued_by      TEXT,
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  amendment_no   INTEGER NOT NULL DEFAULT 0,
  refund_status  TEXT    NOT NULL DEFAULT 'NOT_DUE' CHECK (refund_status IN ('NOT_APPLICABLE', 'NOT_DUE', 'DUE', 'REQUESTED', 'REFUNDED', 'FORFEITED', 'ADJUSTED')),
  result_on      TEXT,
  refund_requested_on TEXT,
  refunded_on    TEXT,
  refund_ref     TEXT,
  refund_note    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_emd_doc ON tdr_emd (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_tdr_emd_company_id ON tdr_emd (company_id);
CREATE INDEX IF NOT EXISTS ix_tdr_emd_tender ON tdr_emd (tender_id, kind);
CREATE INDEX IF NOT EXISTS ix_tdr_emd_status ON tdr_emd (company_id, status);
CREATE INDEX IF NOT EXISTS ix_tdr_emd_refund ON tdr_emd (company_id, refund_status, result_on);

CREATE TABLE IF NOT EXISTS tdr_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  tender_id      INTEGER NOT NULL REFERENCES tdr_tenders (id),
  checklist_json TEXT    NOT NULL DEFAULT '[]',
  estimate_minor INTEGER CHECK (estimate_minor IS NULL OR estimate_minor >= 0),
  estimate_source TEXT   NOT NULL DEFAULT 'MANUAL' CHECK (estimate_source IN ('ESTIMATE', 'MANUAL')),
  estimate_ref   TEXT,
  bid_amount_minor INTEGER CHECK (bid_amount_minor IS NULL OR bid_amount_minor >= 0),
  adjustment_minor INTEGER NOT NULL DEFAULT 0,
  adjustment_reason TEXT,
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  amendment_no   INTEGER NOT NULL DEFAULT 0,
  submitted_at   TEXT,
  submitted_by   TEXT,
  portal_ref     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_submissions_doc ON tdr_submissions (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_tdr_submissions_company_id ON tdr_submissions (company_id);
CREATE INDEX IF NOT EXISTS ix_tdr_submissions_tender ON tdr_submissions (tender_id, status);

CREATE TABLE IF NOT EXISTS tdr_competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  name           TEXT    NOT NULL,
  name_key       TEXT    NOT NULL,
  partner_id     INTEGER REFERENCES mdm_partners (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_competitors_name ON tdr_competitors (company_id, name_key);
CREATE INDEX IF NOT EXISTS ix_tdr_competitors_company_id ON tdr_competitors (company_id);
CREATE INDEX IF NOT EXISTS ix_tdr_competitors_partner ON tdr_competitors (partner_id);

CREATE TABLE IF NOT EXISTS tdr_bid_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  tender_id      INTEGER NOT NULL REFERENCES tdr_tenders (id),
  competitor_id  INTEGER REFERENCES tdr_competitors (id),
  bidder_partner_id INTEGER REFERENCES mdm_partners (id),
  bidder_name    TEXT    NOT NULL,
  is_us          INTEGER NOT NULL DEFAULT 0 CHECK (is_us IN (0, 1)),
  qualified      INTEGER NOT NULL DEFAULT 1 CHECK (qualified IN (0, 1)),
  quoted_minor   INTEGER CHECK (quoted_minor IS NULL OR quoted_minor >= 0),
  bid_rank       INTEGER,
  diff_l1_bp     INTEGER,
  opened_on      TEXT    NOT NULL,
  note           TEXT,
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
CREATE INDEX IF NOT EXISTS ix_tdr_bid_results_company_id ON tdr_bid_results (company_id);
CREATE INDEX IF NOT EXISTS ix_tdr_bid_results_tender ON tdr_bid_results (tender_id);
CREATE INDEX IF NOT EXISTS ix_tdr_bid_results_competitor ON tdr_bid_results (competitor_id);
CREATE INDEX IF NOT EXISTS ix_tdr_bid_results_partner ON tdr_bid_results (bidder_partner_id);

CREATE TABLE IF NOT EXISTS tdr_negotiations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  tender_id      INTEGER NOT NULL REFERENCES tdr_tenders (id),
  round_no       INTEGER NOT NULL,
  held_on        TEXT    NOT NULL,
  our_offer_minor INTEGER CHECK (our_offer_minor IS NULL OR our_offer_minor >= 0),
  client_counter_minor INTEGER CHECK (client_counter_minor IS NULL OR client_counter_minor >= 0),
  notes          TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_negotiations_round ON tdr_negotiations (tender_id, round_no);
CREATE INDEX IF NOT EXISTS ix_tdr_negotiations_company_id ON tdr_negotiations (company_id);

CREATE TABLE IF NOT EXISTS tdr_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  tender_id      INTEGER NOT NULL REFERENCES tdr_tenders (id),
  outcome        TEXT    NOT NULL CHECK (outcome IN ('WON', 'LOST')),
  loa_no         TEXT,
  loa_date       TEXT,
  awarded_value_minor INTEGER CHECK (awarded_value_minor IS NULL OR awarded_value_minor >= 0),
  awarded_to     TEXT,
  loss_reason_code TEXT,
  loss_reason    TEXT,
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  amendment_no   INTEGER NOT NULL DEFAULT 0,
  decided_at     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_awards_doc ON tdr_awards (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_tdr_awards_company_id ON tdr_awards (company_id);
CREATE INDEX IF NOT EXISTS ix_tdr_awards_tender ON tdr_awards (tender_id, status);
CREATE INDEX IF NOT EXISTS ix_tdr_awards_outcome ON tdr_awards (company_id, outcome);
