-- D-736 (follow-up of 23.08): TCS collected on the sale of scrap (s.206C(1) of the Income-tax Act 1961; s.394 of the Act of 2025 from April 2026) when the
-- receivable of the sale is approved (23.05); the account TCS payable; the collections are the rows of the quarterly statement 27EQ.
CREATE TABLE IF NOT EXISTS tcs_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  invoice_id      INTEGER NOT NULL REFERENCES ar_invoices (id),
  partner_id      INTEGER REFERENCES mdm_partners (id),
  nature          TEXT    NOT NULL CHECK (nature IN ('SCRAP')),
  section         TEXT    NOT NULL,
  collected_on    TEXT    NOT NULL,
  base_paise      INTEGER NOT NULL CHECK (base_paise >= 0),
  rate_bp         INTEGER NOT NULL CHECK (rate_bp >= 0),
  tcs_paise       INTEGER NOT NULL CHECK (tcs_paise >= 0),
  pan             TEXT,
  tcs_status      TEXT    NOT NULL DEFAULT 'COLLECTED' CHECK (tcs_status IN ('COLLECTED', 'CANCELLED')),
  journal_id      INTEGER REFERENCES fin_journals (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tcs_collections_invoice ON tcs_collections (invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_tcs_collections_date ON tcs_collections (company_id, collected_on);
CREATE INDEX IF NOT EXISTS ix_tcs_collections_partner ON tcs_collections (partner_id);
CREATE INDEX IF NOT EXISTS ix_tcs_collections_journal ON tcs_collections (journal_id);
INSERT INTO fin_accounts (company_id, group_id, code, name, account_type, normal_side, currency_code, is_control, control_kind, manual_posting_allowed, created_by, source_type)
  SELECT NULL, a.group_id, '230007', 'TCS payable', 'TAX', 'CR', 'INR', 0, NULL, 0, 'migration', 'fin_d736' FROM fin_accounts a WHERE a.company_id IS NULL AND a.code = '230004' AND a.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM fin_accounts x WHERE x.company_id IS NULL AND x.code = '230007');
INSERT INTO fin_accounts (company_id, group_id, code, name, account_type, normal_side, currency_code, is_control, control_kind, manual_posting_allowed, created_by, source_type)
  SELECT a.company_id, a.group_id, '230007', 'TCS payable', 'TAX', 'CR', 'INR', 0, NULL, 0, 'migration', 'fin_d736' FROM fin_accounts a WHERE a.company_id IS NOT NULL AND a.code = '230004' AND a.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM fin_accounts x WHERE x.company_id = a.company_id AND x.code = '230007');
