-- Part 22.07: the ledger of retention and security deposit (deducted from the bills and released), the advances received and given with their recovery rules and recoveries (approval-controlled), and the release requests (approval-controlled).
CREATE TABLE IF NOT EXISTS bill_retention_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  party_type      TEXT    NOT NULL CHECK (party_type IN ('CLIENT', 'SUBCONTRACTOR')),
  kind            TEXT    NOT NULL CHECK (kind IN ('RETENTION', 'SD')),
  contract_id     INTEGER REFERENCES ctr_contracts (id),
  wo_id           INTEGER REFERENCES ctr_work_orders (id),
  party_id        INTEGER REFERENCES mdm_partners (id),
  txn_type        TEXT    NOT NULL CHECK (txn_type IN ('DEDUCTED', 'RELEASED', 'OPENING')),
  txn_source      TEXT    NOT NULL CHECK (txn_source IN ('CLIENT_BILL', 'SUB_BILL', 'RELEASE', 'MANUAL')),
  txn_source_id   INTEGER,
  bill_ref        TEXT,
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  txn_date        TEXT    NOT NULL,
  balance_paise   INTEGER NOT NULL,
  release_id      INTEGER,
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
  remarks     TEXT,
  CHECK ((party_type = 'CLIENT' AND contract_id IS NOT NULL) OR (party_type = 'SUBCONTRACTOR' AND wo_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_rl_src ON bill_retention_ledger (company_id, txn_source, txn_source_id, kind, txn_type) WHERE txn_source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_bill_retention_ledger_company_id ON bill_retention_ledger (company_id);
CREATE INDEX IF NOT EXISTS ix_bill_retention_ledger_org_project_id ON bill_retention_ledger (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_retention_ledger_contract_id ON bill_retention_ledger (contract_id);
CREATE INDEX IF NOT EXISTS ix_bill_retention_ledger_wo_id ON bill_retention_ledger (wo_id);
CREATE INDEX IF NOT EXISTS ix_bill_retention_ledger_party_id ON bill_retention_ledger (party_id);
CREATE INDEX IF NOT EXISTS ix_bill_retention_ledger_release_id ON bill_retention_ledger (release_id);
CREATE INDEX IF NOT EXISTS ix_bill_rl_scope ON bill_retention_ledger (company_id, party_type, kind, contract_id, wo_id, id);

CREATE TABLE IF NOT EXISTS bill_advances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  ref_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  direction       TEXT    NOT NULL CHECK (direction IN ('RECEIVED', 'GIVEN')),
  party_type      TEXT    NOT NULL CHECK (party_type IN ('CLIENT', 'SUBCONTRACTOR', 'VENDOR')),
  party_id        INTEGER NOT NULL REFERENCES mdm_partners (id),
  contract_id     INTEGER REFERENCES ctr_contracts (id),
  wo_id           INTEGER REFERENCES ctr_work_orders (id),
  po_id           INTEGER REFERENCES proc_purchase_orders (id),
  adv_type        TEXT    NOT NULL CHECK (adv_type IN ('MOBILISATION', 'MACHINERY', 'SECURED', 'MATERIAL', 'OTHER')),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  advance_date    TEXT    NOT NULL,
  rule_mode       TEXT    NOT NULL DEFAULT 'PCT_OF_BILL' CHECK (rule_mode IN ('PCT_OF_BILL', 'FIXED')),
  rule_pct_bp     INTEGER NOT NULL DEFAULT 0 CHECK (rule_pct_bp BETWEEN 0 AND 10000),
  rule_fixed_paise INTEGER NOT NULL DEFAULT 0 CHECK (rule_fixed_paise >= 0),
  interest_bp     INTEGER NOT NULL DEFAULT 0 CHECK (interest_bp BETWEEN 0 AND 10000),
  recovered_paise INTEGER NOT NULL DEFAULT 0 CHECK (recovered_paise >= 0),
  interest_paise  INTEGER NOT NULL DEFAULT 0 CHECK (interest_paise >= 0),
  bg_id           INTEGER REFERENCES ctr_bank_guarantees (id),
  adv_state       TEXT    NOT NULL DEFAULT 'PROPOSED' CHECK (adv_state IN ('PROPOSED', 'ACTIVE', 'RECOVERED')),
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
  remarks     TEXT,
  CHECK (recovered_paise <= amount_paise)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_adv_doc ON bill_advances (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_adv_ref ON bill_advances (company_id, party_id, ref_no) WHERE deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED');
CREATE INDEX IF NOT EXISTS ix_bill_advances_org_project_id ON bill_advances (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_advances_org_site_id ON bill_advances (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bill_advances_party_id ON bill_advances (party_id);
CREATE INDEX IF NOT EXISTS ix_bill_advances_contract_id ON bill_advances (contract_id);
CREATE INDEX IF NOT EXISTS ix_bill_advances_wo_id ON bill_advances (wo_id);
CREATE INDEX IF NOT EXISTS ix_bill_advances_po_id ON bill_advances (po_id);
CREATE INDEX IF NOT EXISTS ix_bill_advances_bg_id ON bill_advances (bg_id);
CREATE INDEX IF NOT EXISTS ix_bill_adv_status ON bill_advances (company_id, org_project_id, status, adv_state);

CREATE TABLE IF NOT EXISTS bill_advance_recoveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  advance_id      INTEGER NOT NULL REFERENCES bill_advances (id),
  rec_source      TEXT    NOT NULL CHECK (rec_source IN ('CLIENT_BILL', 'SUB_BILL', 'MANUAL')),
  rec_source_id   INTEGER NOT NULL,
  bill_ref        TEXT,
  rec_date        TEXT    NOT NULL,
  principal_paise INTEGER NOT NULL CHECK (principal_paise > 0),
  interest_paise  INTEGER NOT NULL DEFAULT 0 CHECK (interest_paise >= 0),
  outstanding_paise INTEGER NOT NULL CHECK (outstanding_paise >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_ar_src ON bill_advance_recoveries (advance_id, rec_source, rec_source_id);
CREATE INDEX IF NOT EXISTS ix_bill_advance_recoveries_company_id ON bill_advance_recoveries (company_id);
CREATE INDEX IF NOT EXISTS ix_bill_advance_recoveries_advance_id ON bill_advance_recoveries (advance_id);

CREATE TABLE IF NOT EXISTS bill_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  release_type    TEXT    NOT NULL CHECK (release_type IN ('RETENTION', 'SD')),
  party_type      TEXT    NOT NULL CHECK (party_type IN ('CLIENT', 'SUBCONTRACTOR')),
  party_id        INTEGER REFERENCES mdm_partners (id),
  contract_id     INTEGER REFERENCES ctr_contracts (id),
  wo_id           INTEGER REFERENCES ctr_work_orders (id),
  release_basis   TEXT    NOT NULL CHECK (release_basis IN ('COMPLETION', 'DLP_END', 'AGAINST_BG', 'PARTIAL')),
  amount_paise    INTEGER NOT NULL CHECK (amount_paise > 0),
  balance_before_paise INTEGER NOT NULL DEFAULT 0,
  bg_id           INTEGER REFERENCES ctr_bank_guarantees (id),
  checklist_json  TEXT    NOT NULL DEFAULT '[]',
  waiver_reason   TEXT,
  expected_date   TEXT,
  released_on     TEXT,
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
  remarks     TEXT,
  CHECK ((party_type = 'CLIENT' AND contract_id IS NOT NULL) OR (party_type = 'SUBCONTRACTOR' AND wo_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_rel_doc ON bill_releases (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_bill_releases_org_project_id ON bill_releases (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_releases_org_site_id ON bill_releases (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bill_releases_party_id ON bill_releases (party_id);
CREATE INDEX IF NOT EXISTS ix_bill_releases_contract_id ON bill_releases (contract_id);
CREATE INDEX IF NOT EXISTS ix_bill_releases_wo_id ON bill_releases (wo_id);
CREATE INDEX IF NOT EXISTS ix_bill_releases_bg_id ON bill_releases (bg_id);
CREATE INDEX IF NOT EXISTS ix_bill_rel_status ON bill_releases (company_id, org_project_id, status);