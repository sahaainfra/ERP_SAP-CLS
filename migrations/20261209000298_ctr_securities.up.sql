-- Part 21.02: bank guarantees given and received (approval-controlled) with their event history, insurance policies (approval-controlled) and claims, bank limits and the advance ledger that limits the reduction of an advance guarantee; money in paise, rates in basis points.
CREATE TABLE IF NOT EXISTS ctr_bank_guarantees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  bg_no           TEXT    NOT NULL COLLATE NOCASE,
  direction       TEXT    NOT NULL CHECK (direction IN ('GIVEN', 'RECEIVED')),
  bg_type         TEXT    NOT NULL CHECK (bg_type IN ('PERFORMANCE', 'ADVANCE', 'EMD', 'RETENTION', 'SECURITY_DEPOSIT', 'FINANCIAL', 'OTHER')),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  contract_id     INTEGER REFERENCES ctr_contracts (id),
  partner_id      INTEGER REFERENCES mdm_partners (id),
  advance_id      INTEGER,
  bank_id         INTEGER REFERENCES mdm_banks (id),
  bank_name       TEXT    NOT NULL,
  original_paise  INTEGER NOT NULL CHECK (original_paise > 0),
  current_paise   INTEGER NOT NULL CHECK (current_paise >= 0),
  issue_date      TEXT    NOT NULL,
  expiry_date     TEXT    NOT NULL,
  claim_expiry    TEXT,
  linked_type     TEXT    NOT NULL DEFAULT 'CONTRACT' CHECK (linked_type IN ('CONTRACT', 'WORK_ORDER', 'PURCHASE_ORDER', 'TENDER', 'OTHER')),
  linked_id       INTEGER,
  linked_ref      TEXT,
  margin_bp       INTEGER NOT NULL DEFAULT 0 CHECK (margin_bp BETWEEN 0 AND 10000),
  commission_bp   INTEGER NOT NULL DEFAULT 0 CHECK (commission_bp BETWEEN 0 AND 10000),
  commission_paise INTEGER NOT NULL DEFAULT 0 CHECK (commission_paise >= 0),
  bg_state        TEXT    NOT NULL DEFAULT 'REQUESTED' CHECK (bg_state IN ('REQUESTED', 'ACTIVE', 'EXTENDED', 'REDUCED', 'RELEASED', 'INVOKED', 'EXPIRED')),
  released_on     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_bg_doc ON ctr_bank_guarantees (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_bg_no ON ctr_bank_guarantees (company_id, bank_name, bg_no);
CREATE INDEX IF NOT EXISTS ix_ctr_bank_guarantees_org_project_id ON ctr_bank_guarantees (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctr_bank_guarantees_org_site_id ON ctr_bank_guarantees (org_site_id);
CREATE INDEX IF NOT EXISTS ix_ctr_bank_guarantees_contract_id ON ctr_bank_guarantees (contract_id);
CREATE INDEX IF NOT EXISTS ix_ctr_bank_guarantees_partner_id ON ctr_bank_guarantees (partner_id);
CREATE INDEX IF NOT EXISTS ix_ctr_bank_guarantees_bank_id ON ctr_bank_guarantees (bank_id);
CREATE INDEX IF NOT EXISTS ix_ctr_bg_expiry ON ctr_bank_guarantees (company_id, bg_state, expiry_date);
CREATE TABLE IF NOT EXISTS ctr_bg_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  bg_id           INTEGER NOT NULL REFERENCES ctr_bank_guarantees (id),
  event_kind      TEXT    NOT NULL CHECK (event_kind IN ('ISSUED', 'EXTEND', 'REDUCE', 'RELEASE', 'INVOKE', 'AMEND')),
  event_status    TEXT    NOT NULL DEFAULT 'REQUESTED' CHECK (event_status IN ('REQUESTED', 'DONE', 'REJECTED')),
  amount_before_paise INTEGER NOT NULL,
  amount_after_paise INTEGER NOT NULL,
  expiry_before   TEXT,
  expiry_after    TEXT,
  reference_no    TEXT,
  reason          TEXT    NOT NULL,
  requested_by    TEXT    NOT NULL,
  decided_by      TEXT,
  decided_at      TEXT,
  decision_note   TEXT,
  commission_paise INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS ix_ctr_bg_events_company_id ON ctr_bg_events (company_id);
CREATE INDEX IF NOT EXISTS ix_ctr_bg_events_bg_id ON ctr_bg_events (bg_id);
CREATE TABLE IF NOT EXISTS ctr_advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  contract_id     INTEGER NOT NULL REFERENCES ctr_contracts (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  partner_id      INTEGER REFERENCES mdm_partners (id),
  advance_kind    TEXT    NOT NULL DEFAULT 'MOBILISATION' CHECK (advance_kind IN ('MOBILISATION', 'MACHINERY', 'MATERIAL', 'OTHER')),
  ref_no          TEXT    NOT NULL,
  advance_paise   INTEGER NOT NULL CHECK (advance_paise > 0),
  recovered_paise INTEGER NOT NULL DEFAULT 0 CHECK (recovered_paise >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_adv_ref ON ctr_advances (contract_id, ref_no);
CREATE INDEX IF NOT EXISTS ix_ctr_advances_company_id ON ctr_advances (company_id);
CREATE INDEX IF NOT EXISTS ix_ctr_advances_org_project_id ON ctr_advances (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctr_advances_partner_id ON ctr_advances (partner_id);
CREATE TABLE IF NOT EXISTS ctr_insurances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  contract_id     INTEGER REFERENCES ctr_contracts (id),
  policy_type     TEXT    NOT NULL CHECK (policy_type IN ('CAR', 'EAR', 'WORKMEN_COMP', 'THIRD_PARTY', 'VEHICLE', 'MARINE', 'FIRE', 'OTHER')),
  policy_no       TEXT    NOT NULL COLLATE NOCASE,
  insurer         TEXT    NOT NULL,
  sum_insured_paise INTEGER NOT NULL CHECK (sum_insured_paise > 0),
  premium_paise   INTEGER NOT NULL DEFAULT 0 CHECK (premium_paise >= 0),
  valid_from      TEXT    NOT NULL,
  valid_to        TEXT    NOT NULL,
  coverage        TEXT,
  renewal_of_id   INTEGER REFERENCES ctr_insurances (id),
  ins_state       TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (ins_state IN ('ACTIVE', 'RENEWED', 'EXPIRED', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_ins_doc ON ctr_insurances (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_ins_no ON ctr_insurances (company_id, insurer, policy_no);
CREATE INDEX IF NOT EXISTS ix_ctr_insurances_org_project_id ON ctr_insurances (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctr_insurances_org_site_id ON ctr_insurances (org_site_id);
CREATE INDEX IF NOT EXISTS ix_ctr_insurances_contract_id ON ctr_insurances (contract_id);
CREATE INDEX IF NOT EXISTS ix_ctr_insurances_renewal_of_id ON ctr_insurances (renewal_of_id);
CREATE INDEX IF NOT EXISTS ix_ctr_ins_valid ON ctr_insurances (company_id, ins_state, valid_to);
CREATE TABLE IF NOT EXISTS ctr_insurance_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  policy_id       INTEGER NOT NULL REFERENCES ctr_insurances (id),
  claim_no        TEXT    NOT NULL,
  incident_ref    TEXT,
  incident_date   TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  claimed_paise   INTEGER NOT NULL CHECK (claimed_paise > 0),
  settled_paise   INTEGER NOT NULL DEFAULT 0 CHECK (settled_paise >= 0),
  claim_status    TEXT    NOT NULL DEFAULT 'INTIMATED' CHECK (claim_status IN ('INTIMATED', 'SURVEY', 'SETTLED', 'REJECTED', 'CLOSED')),
  settled_on      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_clm_no ON ctr_insurance_claims (policy_id, claim_no);
CREATE INDEX IF NOT EXISTS ix_ctr_insurance_claims_company_id ON ctr_insurance_claims (company_id);
CREATE TABLE IF NOT EXISTS ctr_bank_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  bank_name       TEXT    NOT NULL,
  limit_kind      TEXT    NOT NULL DEFAULT 'BG' CHECK (limit_kind IN ('BG', 'LC', 'FUND_BASED', 'OTHER')),
  limit_paise     INTEGER NOT NULL CHECK (limit_paise > 0),
  valid_to        TEXT,
  margin_bp       INTEGER NOT NULL DEFAULT 0 CHECK (margin_bp BETWEEN 0 AND 10000),
  limit_status    TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (limit_status IN ('ACTIVE', 'LAPSED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_lim ON ctr_bank_limits (company_id, bank_name, limit_kind);
