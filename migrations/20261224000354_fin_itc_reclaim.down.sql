-- D-738: back to the decisions of 23.08 (a re-claim line is dropped).
CREATE TABLE gst_itc_review_lines_d738 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  review_id      INTEGER NOT NULL REFERENCES gst_itc_reviews (id),
  bill_id        INTEGER REFERENCES ap_bills (id),
  line_2b_id     INTEGER REFERENCES gst_2b_lines (id),
  supplier_gstin TEXT,
  supplier_name  TEXT,
  invoice_no     TEXT,
  invoice_date   TEXT,
  taxable_paise  INTEGER NOT NULL DEFAULT 0,
  tax_paise      INTEGER NOT NULL DEFAULT 0,
  decision       TEXT    NOT NULL CHECK (decision IN ('ELIGIBLE', 'BLOCKED_17_5', 'HELD_NOT_IN_2B', 'HELD_MISMATCH', 'REVERSED_UNPAID_180', 'INELIGIBLE_2B', 'OVERRIDE_CLAIM')),
  reason         TEXT,
  claim_paise    INTEGER NOT NULL DEFAULT 0,
  reverse_paise  INTEGER NOT NULL DEFAULT 0,
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
INSERT INTO gst_itc_review_lines_d738 SELECT * FROM gst_itc_review_lines WHERE decision <> 'RECLAIMED_PAID';
DROP TABLE gst_itc_review_lines;
ALTER TABLE gst_itc_review_lines_d738 RENAME TO gst_itc_review_lines;
CREATE INDEX IF NOT EXISTS ix_gst_itc_review_lines_review ON gst_itc_review_lines (review_id, decision);
CREATE INDEX IF NOT EXISTS ix_gst_itc_review_lines_bill ON gst_itc_review_lines (bill_id);
CREATE INDEX IF NOT EXISTS ix_gst_itc_review_lines_2b ON gst_itc_review_lines (line_2b_id);
CREATE INDEX IF NOT EXISTS ix_gst_itc_review_lines_company_id ON gst_itc_review_lines (company_id);
