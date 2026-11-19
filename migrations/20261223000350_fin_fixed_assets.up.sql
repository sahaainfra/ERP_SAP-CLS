-- Part 23.09: fixed assets and depreciation. fa_classes: the asset classes (plant and machinery, earth-moving equipment, vehicles, computers, furniture, office
-- equipment, buildings) with their ledger accounts, the Companies Act useful life and method (Schedule II) and the Income-tax block and rate, dated master data.
-- fa_cwip / fa_cwip_lines: capital work in progress gathered from AP bills, settled into assets. fa_assets: the register (approved: capitalised), linked to the
-- equipment register (17.01) or a small asset (16.09). fa_dep_runs / fa_depreciation: one book depreciation run a month, a line per asset, posted to the ledger by
-- project. fa_transfers: an asset moved between projects, sites or custodians. fa_disposals: sale, scrap or write-off with the gain or loss, approved by the
-- accounts manager, the CFO and above ₹10 lakh a director. fa_verifications / fa_verification_lines: physical verification by QR tag.

CREATE TABLE IF NOT EXISTS fa_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER REFERENCES org_companies (id),
  code              TEXT    NOT NULL,
  name              TEXT    NOT NULL,
  asset_account_code TEXT   NOT NULL,
  accum_account_code TEXT   NOT NULL,
  book_method       TEXT    NOT NULL CHECK (book_method IN ('SLM', 'WDV')),
  useful_life_months INTEGER NOT NULL CHECK (useful_life_months BETWEEN 12 AND 1200),
  residual_bp       INTEGER NOT NULL DEFAULT 500 CHECK (residual_bp BETWEEN 0 AND 10000),
  tax_block         TEXT    NOT NULL,
  tax_rate_bp       INTEGER NOT NULL CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  legal_ref         TEXT,
  effective_from    TEXT    NOT NULL DEFAULT '2014-04-01',
  effective_to      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_classes ON fa_classes (COALESCE(company_id, 0), code, effective_from) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fa_classes_company_id ON fa_classes (company_id);

CREATE TABLE IF NOT EXISTS fa_cwip (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL,
  title          TEXT    NOT NULL,
  org_project_id INTEGER REFERENCES org_projects (id),
  cost_paise     INTEGER NOT NULL DEFAULT 0 CHECK (cost_paise >= 0),
  settled_paise  INTEGER NOT NULL DEFAULT 0 CHECK (settled_paise >= 0),
  cwip_status    TEXT    NOT NULL DEFAULT 'OPEN' CHECK (cwip_status IN ('OPEN', 'SETTLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_cwip_doc ON fa_cwip (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_fa_cwip_project ON fa_cwip (org_project_id);

CREATE TABLE IF NOT EXISTS fa_cwip_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  cwip_id      INTEGER NOT NULL REFERENCES fa_cwip (id),
  bill_id      INTEGER NOT NULL REFERENCES ap_bills (id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_cwip_lines_bill ON fa_cwip_lines (bill_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fa_cwip_lines_cwip ON fa_cwip_lines (cwip_id);
CREATE INDEX IF NOT EXISTS ix_fa_cwip_lines_company_id ON fa_cwip_lines (company_id);

CREATE TABLE IF NOT EXISTS fa_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no            TEXT    NOT NULL,
  asset_no          TEXT,
  class_code        TEXT    NOT NULL,
  description       TEXT    NOT NULL,
  cost_paise        INTEGER NOT NULL CHECK (cost_paise > 0),
  cap_date          TEXT    NOT NULL,
  org_project_id    INTEGER REFERENCES org_projects (id),
  org_site_id       INTEGER REFERENCES org_sites (id),
  custodian         TEXT,
  equipment_id      INTEGER REFERENCES plt_equipment (id),
  small_asset_id    INTEGER REFERENCES ast_small_assets (id),
  cap_source        TEXT    NOT NULL CHECK (cap_source IN ('AP_BILL', 'CWIP', 'EQUIPMENT', 'SMALL_ASSET', 'OPENING')),
  source_bill_id    INTEGER REFERENCES ap_bills (id),
  cwip_id           INTEGER REFERENCES fa_cwip (id),
  useful_life_months INTEGER NOT NULL CHECK (useful_life_months BETWEEN 1 AND 1200),
  residual_paise    INTEGER NOT NULL DEFAULT 0 CHECK (residual_paise >= 0),
  book_method       TEXT    NOT NULL CHECK (book_method IN ('SLM', 'WDV')),
  wdv_rate_bp       INTEGER NOT NULL DEFAULT 0 CHECK (wdv_rate_bp >= 0),
  tax_block         TEXT    NOT NULL,
  tax_rate_bp       INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp >= 0),
  opening_accum_paise INTEGER NOT NULL DEFAULT 0 CHECK (opening_accum_paise >= 0),
  accumulated_dep_paise INTEGER NOT NULL DEFAULT 0 CHECK (accumulated_dep_paise >= 0),
  wdv_paise         INTEGER NOT NULL DEFAULT 0,
  fy_base_paise     INTEGER,
  fy_base_year      TEXT,
  dep_until         TEXT,
  hsn_code          TEXT,
  asset_state       TEXT    NOT NULL DEFAULT 'PENDING' CHECK (asset_state IN ('PENDING', 'IN_USE', 'DISPOSED')),
  disposed_on       TEXT,
  journal_id        INTEGER REFERENCES fin_journals (id),
  last_verified_on  TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_assets_doc ON fa_assets (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_assets_equipment ON fa_assets (equipment_id) WHERE equipment_id IS NOT NULL AND status NOT IN ('CANCELLED', 'REJECTED') AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_assets_small ON fa_assets (small_asset_id) WHERE small_asset_id IS NOT NULL AND status NOT IN ('CANCELLED', 'REJECTED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fa_assets_list ON fa_assets (company_id, status, asset_state, class_code);
CREATE INDEX IF NOT EXISTS ix_fa_assets_project ON fa_assets (org_project_id);
CREATE INDEX IF NOT EXISTS ix_fa_assets_site ON fa_assets (org_site_id);
CREATE INDEX IF NOT EXISTS ix_fa_assets_bill ON fa_assets (source_bill_id);
CREATE INDEX IF NOT EXISTS ix_fa_assets_cwip ON fa_assets (cwip_id);
CREATE INDEX IF NOT EXISTS ix_fa_assets_wf ON fa_assets (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_fa_assets_journal ON fa_assets (journal_id);

CREATE TABLE IF NOT EXISTS fa_dep_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no       TEXT    NOT NULL,
  period       TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  period_id    INTEGER REFERENCES core_periods (id),
  assets_count INTEGER NOT NULL DEFAULT 0 CHECK (assets_count >= 0),
  total_paise  INTEGER NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  journal_id   INTEGER REFERENCES fin_journals (id),
  run_by       TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_dep_runs_doc ON fa_dep_runs (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_dep_runs_period ON fa_dep_runs (company_id, period) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fa_dep_runs_journal ON fa_dep_runs (journal_id);
CREATE INDEX IF NOT EXISTS ix_fa_dep_runs_period_id ON fa_dep_runs (period_id);

CREATE TABLE IF NOT EXISTS fa_depreciation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  asset_id     INTEGER NOT NULL REFERENCES fa_assets (id),
  run_id       INTEGER REFERENCES fa_dep_runs (id),
  period       TEXT    NOT NULL,
  period_id    INTEGER REFERENCES core_periods (id),
  from_date    TEXT    NOT NULL,
  to_date      TEXT    NOT NULL,
  book_dep_paise INTEGER NOT NULL CHECK (book_dep_paise >= 0),
  tax_dep_paise INTEGER,
  wdv_after_paise INTEGER NOT NULL,
  dep_kind     TEXT    NOT NULL DEFAULT 'MONTHLY' CHECK (dep_kind IN ('MONTHLY', 'TO_DISPOSAL')),
  posted_journal_id INTEGER REFERENCES fin_journals (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_depreciation ON fa_depreciation (asset_id, period, dep_kind) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fa_depreciation_run ON fa_depreciation (run_id);
CREATE INDEX IF NOT EXISTS ix_fa_depreciation_period ON fa_depreciation (company_id, period);
CREATE INDEX IF NOT EXISTS ix_fa_depreciation_period_id ON fa_depreciation (period_id);
CREATE INDEX IF NOT EXISTS ix_fa_depreciation_journal ON fa_depreciation (posted_journal_id);

CREATE TABLE IF NOT EXISTS fa_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  asset_id        INTEGER NOT NULL REFERENCES fa_assets (id),
  transfer_date   TEXT    NOT NULL,
  from_project_id INTEGER REFERENCES org_projects (id),
  to_project_id   INTEGER REFERENCES org_projects (id),
  from_site_id    INTEGER REFERENCES org_sites (id),
  to_site_id      INTEGER REFERENCES org_sites (id),
  from_custodian  TEXT,
  to_custodian    TEXT,
  reason          TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_transfers_doc ON fa_transfers (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_fa_transfers_asset ON fa_transfers (asset_id);
CREATE INDEX IF NOT EXISTS ix_fa_transfers_from ON fa_transfers (from_project_id);
CREATE INDEX IF NOT EXISTS ix_fa_transfers_to ON fa_transfers (to_project_id);
CREATE INDEX IF NOT EXISTS ix_fa_transfers_from_site ON fa_transfers (from_site_id);
CREATE INDEX IF NOT EXISTS ix_fa_transfers_to_site ON fa_transfers (to_site_id);

CREATE TABLE IF NOT EXISTS fa_disposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  asset_id        INTEGER NOT NULL REFERENCES fa_assets (id),
  disposal_date   TEXT    NOT NULL,
  method          TEXT    NOT NULL CHECK (method IN ('SALE', 'SCRAP', 'WRITE_OFF')),
  buyer_partner_id INTEGER REFERENCES mdm_partners (id),
  proceeds_paise  INTEGER NOT NULL DEFAULT 0 CHECK (proceeds_paise >= 0),
  gst_paise       INTEGER NOT NULL DEFAULT 0 CHECK (gst_paise >= 0),
  dep_to_date_paise INTEGER NOT NULL DEFAULT 0 CHECK (dep_to_date_paise >= 0),
  wdv_paise       INTEGER NOT NULL DEFAULT 0,
  gain_loss_paise INTEGER NOT NULL DEFAULT 0,
  reason          TEXT    NOT NULL,
  journal_id      INTEGER REFERENCES fin_journals (id),
  ar_invoice_ref  TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_disposals_doc ON fa_disposals (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_disposals_live ON fa_disposals (asset_id) WHERE status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fa_disposals_list ON fa_disposals (company_id, status, disposal_date);
CREATE INDEX IF NOT EXISTS ix_fa_disposals_buyer ON fa_disposals (buyer_partner_id);
CREATE INDEX IF NOT EXISTS ix_fa_disposals_wf ON fa_disposals (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_fa_disposals_journal ON fa_disposals (journal_id);

CREATE TABLE IF NOT EXISTS fa_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL,
  org_project_id INTEGER REFERENCES org_projects (id),
  org_site_id    INTEGER REFERENCES org_sites (id),
  verify_date    TEXT    NOT NULL,
  verify_status  TEXT    NOT NULL DEFAULT 'OPEN' CHECK (verify_status IN ('OPEN', 'CLOSED')),
  expected_count INTEGER NOT NULL DEFAULT 0 CHECK (expected_count >= 0),
  found_count    INTEGER NOT NULL DEFAULT 0 CHECK (found_count >= 0),
  closed_by      TEXT,
  closed_at      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_verifications_doc ON fa_verifications (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_fa_verifications_project ON fa_verifications (org_project_id);
CREATE INDEX IF NOT EXISTS ix_fa_verifications_site ON fa_verifications (org_site_id);

CREATE TABLE IF NOT EXISTS fa_verification_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  verification_id INTEGER NOT NULL REFERENCES fa_verifications (id),
  asset_id        INTEGER NOT NULL REFERENCES fa_assets (id),
  line_status     TEXT    NOT NULL DEFAULT 'EXPECTED' CHECK (line_status IN ('EXPECTED', 'FOUND', 'MISSING', 'FOUND_ELSEWHERE')),
  asset_condition TEXT    CHECK (asset_condition IS NULL OR asset_condition IN ('GOOD', 'FAIR', 'DAMAGED', 'NOT_WORKING')),
  scanned_by      TEXT,
  scanned_at      TEXT,
  note            TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fa_verification_lines ON fa_verification_lines (verification_id, asset_id);
CREATE INDEX IF NOT EXISTS ix_fa_verification_lines_asset ON fa_verification_lines (asset_id);
CREATE INDEX IF NOT EXISTS ix_fa_verification_lines_company_id ON fa_verification_lines (company_id);
