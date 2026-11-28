-- PACK-18: what a measurement captured on a phone adds to the entry (one row per entry): the deduction lines, each measured like the entry
-- (the entry's deduction is their sum), and the position where it was measured (degrees x 1,000,000, the accuracy in metres). Written only
-- where ff.bill.pack18 is on; the entry itself is unchanged.
CREATE TABLE IF NOT EXISTS bill_mb_capture (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  mb_entry_id   INTEGER NOT NULL REFERENCES bill_mb_entries (id),
  deductions_json TEXT  NOT NULL DEFAULT '[]',
  geo_lat_e6    INTEGER CHECK (geo_lat_e6 IS NULL OR geo_lat_e6 BETWEEN -90000000 AND 90000000),
  geo_lng_e6    INTEGER CHECK (geo_lng_e6 IS NULL OR geo_lng_e6 BETWEEN -180000000 AND 180000000),
  geo_accuracy_m INTEGER CHECK (geo_accuracy_m IS NULL OR geo_accuracy_m >= 0),
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_mb_capture_entry ON bill_mb_capture (mb_entry_id);
CREATE INDEX IF NOT EXISTS ix_bill_mb_capture_company ON bill_mb_capture (company_id);
CREATE INDEX IF NOT EXISTS ix_bill_mb_capture_project ON bill_mb_capture (project_id);
