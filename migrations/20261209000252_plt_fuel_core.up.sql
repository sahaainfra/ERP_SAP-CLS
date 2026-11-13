-- Part 17.04: fuel tanks, bowsers and cards, receipts, issues to equipment (approval-controlled), dip readings with the daily tank reconciliation, and the anomalies the detection rules raise. Nothing here changes an existing table. Litres and meters are thousandths, money paise (rate: paise a litre).
CREATE TABLE IF NOT EXISTS plt_fuel_tanks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  tank_type       TEXT    NOT NULL CHECK (tank_type IN ('TANK', 'BOWSER', 'CARD')),
  fuel_type       TEXT    NOT NULL DEFAULT 'DIESEL' CHECK (fuel_type IN ('DIESEL', 'PETROL', 'CNG')),
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  capacity        INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  opening_litres  INTEGER NOT NULL DEFAULT 0 CHECK (opening_litres >= 0),
  opening_date    TEXT    NOT NULL,
  opening_rate    INTEGER NOT NULL DEFAULT 0 CHECK (opening_rate >= 0),
  card_no         TEXT,
  tank_status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (tank_status IN ('ACTIVE', 'INACTIVE')),
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
  CHECK (tank_type = 'CARD' OR capacity > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_ft_code ON plt_fuel_tanks (company_id, code);
CREATE INDEX IF NOT EXISTS ix_plt_ft_project ON plt_fuel_tanks (org_project_id);
CREATE INDEX IF NOT EXISTS ix_plt_ft_site ON plt_fuel_tanks (org_site_id);

CREATE TABLE IF NOT EXISTS plt_fuel_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  tank_id         INTEGER NOT NULL REFERENCES plt_fuel_tanks (id),
  receipt_date    TEXT    NOT NULL,
  source          TEXT    NOT NULL CHECK (source IN ('GRN', 'PUMP')),
  grn_id          INTEGER REFERENCES inv_grns (id),
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  bill_no         TEXT,
  petty_ref       TEXT,
  litres          INTEGER NOT NULL CHECK (litres > 0),
  rate            INTEGER NOT NULL DEFAULT 0 CHECK (rate >= 0),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  received_by     TEXT    NOT NULL,
  receipt_status  TEXT    NOT NULL DEFAULT 'LIVE' CHECK (receipt_status IN ('LIVE', 'CANCELLED')),
  cancel_reason   TEXT,
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
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
  CHECK (source <> 'GRN' OR grn_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_fr_doc ON plt_fuel_receipts (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_plt_fr_tank ON plt_fuel_receipts (tank_id, receipt_date);
CREATE INDEX IF NOT EXISTS ix_plt_fr_grn ON plt_fuel_receipts (grn_id);
CREATE INDEX IF NOT EXISTS ix_plt_fr_vendor ON plt_fuel_receipts (vendor_id);
CREATE INDEX IF NOT EXISTS ix_plt_fr_project ON plt_fuel_receipts (org_project_id);
CREATE INDEX IF NOT EXISTS ix_plt_fr_site ON plt_fuel_receipts (org_site_id);

CREATE TABLE IF NOT EXISTS plt_fuel_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  tank_id         INTEGER NOT NULL REFERENCES plt_fuel_tanks (id),
  equipment_id    INTEGER NOT NULL REFERENCES plt_equipment (id),
  allocation_id   INTEGER REFERENCES plt_allocations (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  issue_at        TEXT    NOT NULL,
  issue_date      TEXT    NOT NULL,
  meter_reading   INTEGER NOT NULL CHECK (meter_reading >= 0),
  prev_issue_id   INTEGER REFERENCES plt_fuel_issues (id),
  prev_meter      INTEGER,
  no_advance_reason TEXT,
  litres          INTEGER NOT NULL CHECK (litres > 0),
  full_tank       INTEGER NOT NULL DEFAULT 1 CHECK (full_tank IN (0, 1)),
  issued_by       TEXT    NOT NULL,
  received_by     TEXT    NOT NULL,
  photo_file_id   INTEGER REFERENCES core_files (id),
  rate            INTEGER NOT NULL DEFAULT 0 CHECK (rate >= 0),
  cost_amount     INTEGER NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  consumption     INTEGER,
  norm            INTEGER,
  deviation_pct   INTEGER,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_fi_doc ON plt_fuel_issues (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_plt_fi_tank ON plt_fuel_issues (tank_id, issue_date);
CREATE INDEX IF NOT EXISTS ix_plt_fi_eq ON plt_fuel_issues (equipment_id, issue_at);
CREATE INDEX IF NOT EXISTS ix_plt_fi_alloc ON plt_fuel_issues (allocation_id);
CREATE INDEX IF NOT EXISTS ix_plt_fi_project ON plt_fuel_issues (org_project_id, issue_date);
CREATE INDEX IF NOT EXISTS ix_plt_fi_site ON plt_fuel_issues (org_site_id);
CREATE INDEX IF NOT EXISTS ix_plt_fi_prev ON plt_fuel_issues (prev_issue_id);
CREATE INDEX IF NOT EXISTS ix_plt_fi_photo ON plt_fuel_issues (photo_file_id);
CREATE INDEX IF NOT EXISTS ix_plt_fi_list ON plt_fuel_issues (company_id, status, issue_date);

CREATE TABLE IF NOT EXISTS plt_fuel_dips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  tank_id         INTEGER NOT NULL REFERENCES plt_fuel_tanks (id),
  dip_date        TEXT    NOT NULL,
  dip_litres      INTEGER NOT NULL CHECK (dip_litres >= 0),
  opening_litres  INTEGER NOT NULL DEFAULT 0,
  receipts        INTEGER NOT NULL DEFAULT 0,
  issues          INTEGER NOT NULL DEFAULT 0,
  book_litres     INTEGER NOT NULL DEFAULT 0,
  variance        INTEGER NOT NULL DEFAULT 0,
  tolerance       INTEGER NOT NULL DEFAULT 0,
  within_tolerance INTEGER NOT NULL DEFAULT 1 CHECK (within_tolerance IN (0, 1)),
  photo_file_id   INTEGER REFERENCES core_files (id),
  recorded_by     TEXT    NOT NULL,
  note            TEXT,
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_fd_tank_date ON plt_fuel_dips (tank_id, dip_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_plt_fd_company ON plt_fuel_dips (company_id, dip_date);
CREATE INDEX IF NOT EXISTS ix_plt_fd_photo ON plt_fuel_dips (photo_file_id);
CREATE INDEX IF NOT EXISTS ix_plt_fd_project ON plt_fuel_dips (org_project_id);
CREATE INDEX IF NOT EXISTS ix_plt_fd_site ON plt_fuel_dips (org_site_id);

CREATE TABLE IF NOT EXISTS plt_fuel_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  rule_code       TEXT    NOT NULL CHECK (rule_code IN ('OVER_NORM', 'NOT_WORKING', 'DUPLICATE_ISSUE', 'OVER_CAPACITY', 'METER_NOT_ADVANCING', 'TANK_VARIANCE', 'LOG_MISMATCH')),
  severity        TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  equipment_id    INTEGER REFERENCES plt_equipment (id),
  tank_id         INTEGER REFERENCES plt_fuel_tanks (id),
  issue_id        INTEGER REFERENCES plt_fuel_issues (id),
  dip_id          INTEGER REFERENCES plt_fuel_dips (id),
  log_id          INTEGER REFERENCES plt_logs (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  detected_on     TEXT    NOT NULL,
  details_json    TEXT    NOT NULL DEFAULT '{}',
  dedupe_key      TEXT    NOT NULL,
  litres_at_risk  INTEGER NOT NULL DEFAULT 0,
  anomaly_status  TEXT    NOT NULL DEFAULT 'OPEN' CHECK (anomaly_status IN ('OPEN', 'SUBMITTED', 'ACCEPTED', 'CONFIRMED', 'VOID')),
  reason_code     TEXT,
  explanation     TEXT,
  workflow_instance_id INTEGER,
  explained_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  review_comment  TEXT,
  confirmed_by    TEXT,
  confirmed_at    TEXT,
  confirm_note    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_fa_doc ON plt_fuel_anomalies (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_fa_key ON plt_fuel_anomalies (company_id, dedupe_key);
CREATE INDEX IF NOT EXISTS ix_plt_fa_eq ON plt_fuel_anomalies (equipment_id);
CREATE INDEX IF NOT EXISTS ix_plt_fa_tank ON plt_fuel_anomalies (tank_id);
CREATE INDEX IF NOT EXISTS ix_plt_fa_issue ON plt_fuel_anomalies (issue_id);
CREATE INDEX IF NOT EXISTS ix_plt_fa_dip ON plt_fuel_anomalies (dip_id);
CREATE INDEX IF NOT EXISTS ix_plt_fa_log ON plt_fuel_anomalies (log_id);
CREATE INDEX IF NOT EXISTS ix_plt_fa_project ON plt_fuel_anomalies (org_project_id);
CREATE INDEX IF NOT EXISTS ix_plt_fa_site ON plt_fuel_anomalies (org_site_id);
CREATE INDEX IF NOT EXISTS ix_plt_fa_list ON plt_fuel_anomalies (company_id, anomaly_status, detected_on);
