-- Part 23.15: groups of companies. The relationship of two companies (subsidiary, associate, joint venture, fellow group company) with the holding and the
-- inter-company accounts each side uses; the inter-company transaction (approval-controlled: the originating accounts manager, then the counterpart accounts
-- manager accepts) whose mirror journals are posted in both companies at once; the consolidation of a parent with its subsidiaries for a period (finalised
-- only when every inter-company balance matches); the shares of the partners of a JV / consortium project.
CREATE TABLE IF NOT EXISTS ic_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  counterpart_company_id INTEGER NOT NULL REFERENCES org_companies (id),
  relationship_type TEXT  NOT NULL DEFAULT 'SUBSIDIARY' CHECK (relationship_type IN ('SUBSIDIARY', 'ASSOCIATE', 'JOINT_VENTURE', 'FELLOW')),
  holding_pct     REAL    NOT NULL DEFAULT 100 CHECK (holding_pct >= 0 AND holding_pct <= 100),
  consolidate     INTEGER NOT NULL DEFAULT 1 CHECK (consolidate IN (0, 1)),
  receivable_code TEXT    NOT NULL DEFAULT '160090',
  payable_code    TEXT    NOT NULL DEFAULT '230090',
  cp_receivable_code TEXT NOT NULL DEFAULT '160090',
  cp_payable_code TEXT    NOT NULL DEFAULT '230090',
  rel_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (rel_status IN ('ACTIVE', 'INACTIVE')),
  valid_from      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ic_relationships_pair ON ic_relationships (company_id, counterpart_company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ic_relationships_cp ON ic_relationships (counterpart_company_id);
CREATE INDEX IF NOT EXISTS ix_ic_relationships_company_id ON ic_relationships (company_id);

CREATE TABLE IF NOT EXISTS ic_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  relationship_id INTEGER NOT NULL REFERENCES ic_relationships (id),
  to_company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  ic_type         TEXT    NOT NULL CHECK (ic_type IN ('CHARGE', 'TRANSFER', 'LOAN', 'SETTLEMENT')),
  txn_date        TEXT    NOT NULL,
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  reference       TEXT,
  description     TEXT    NOT NULL,
  from_account_id INTEGER REFERENCES fin_accounts (id),
  to_account_id   INTEGER REFERENCES fin_accounts (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  from_dims_json  TEXT    NOT NULL DEFAULT '{}',
  to_dims_json    TEXT    NOT NULL DEFAULT '{}',
  ic_state        TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (ic_state IN ('DRAFT', 'AWAITING_COUNTERPART', 'POSTED', 'DISPUTED', 'REVERSED')),
  journals_json   TEXT    NOT NULL DEFAULT '{}',
  accepted_by     TEXT,
  accepted_at     TEXT,
  dispute_reason  TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  amends_id       INTEGER REFERENCES ic_transactions (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ic_transactions_doc ON ic_transactions (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_ic_transactions_list ON ic_transactions (company_id, txn_date, status);
CREATE INDEX IF NOT EXISTS ix_ic_transactions_to ON ic_transactions (to_company_id, ic_state);
CREATE INDEX IF NOT EXISTS ix_ic_transactions_rel ON ic_transactions (relationship_id);
CREATE INDEX IF NOT EXISTS ix_ic_transactions_from_acct ON ic_transactions (from_account_id);
CREATE INDEX IF NOT EXISTS ix_ic_transactions_to_acct ON ic_transactions (to_account_id);
CREATE INDEX IF NOT EXISTS ix_ic_transactions_project ON ic_transactions (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ic_transactions_wf ON ic_transactions (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_ic_transactions_amends ON ic_transactions (amends_id);

CREATE TABLE IF NOT EXISTS ic_consolidations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  basis           TEXT    NOT NULL DEFAULT 'YTD' CHECK (basis IN ('MONTH', 'QUARTER', 'YTD', 'YEAR')),
  companies_json  TEXT    NOT NULL DEFAULT '[]',
  result_json     TEXT    NOT NULL DEFAULT '{}',
  eliminations_paise INTEGER NOT NULL DEFAULT 0,
  unmatched_paise INTEGER NOT NULL DEFAULT 0,
  run_status      TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (run_status IN ('DRAFT', 'FINAL', 'SUPERSEDED')),
  finalised_by    TEXT,
  finalised_at    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ic_consolidations_doc ON ic_consolidations (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_ic_consolidations_list ON ic_consolidations (company_id, period, run_status);

CREATE TABLE IF NOT EXISTS jv_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  partner_id      INTEGER REFERENCES mdm_partners (id),
  partner_company_id INTEGER REFERENCES org_companies (id),
  partner_name    TEXT    NOT NULL,
  share_pct       REAL    NOT NULL CHECK (share_pct > 0 AND share_pct < 100),
  share_role      TEXT    NOT NULL DEFAULT 'MEMBER' CHECK (share_role IN ('LEAD', 'MEMBER')),
  valid_from      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_jv_shares_partner ON jv_shares (org_project_id, partner_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_jv_shares_project ON jv_shares (company_id, org_project_id);
CREATE INDEX IF NOT EXISTS ix_jv_shares_partner_id ON jv_shares (partner_id);
CREATE INDEX IF NOT EXISTS ix_jv_shares_partner_company ON jv_shares (partner_company_id);
