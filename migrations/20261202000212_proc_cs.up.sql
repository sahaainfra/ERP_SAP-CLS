-- Part 15.04: comparative statements and vendor selection.
-- proc_comparative_statements: the statement of an RFQ (its recommendation, the split award, the justification of a non-L1 choice, totals, approval).
-- proc_cs_lines: one row for each RFQ line and vendor that quoted (the landed rate, its rank, the benchmarks, the technical compliance) and the quantity selected.
-- proc_cs_negotiations: the negotiation rounds, with the quotation before and after.

CREATE TABLE IF NOT EXISTS proc_comparative_statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  rfq_id          INTEGER NOT NULL REFERENCES proc_rfqs (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  recommendation_type TEXT NOT NULL DEFAULT 'OVERALL_L1' CHECK (recommendation_type IN ('OVERALL_L1', 'SPLIT_L1', 'CUSTOM')),
  recommended_split_json TEXT,
  non_l1          INTEGER NOT NULL DEFAULT 0 CHECK (non_l1 IN (0, 1)),
  reason_code     TEXT    CHECK (reason_code IS NULL OR reason_code IN ('TECHNICAL', 'DELIVERY', 'QUALITY', 'OTHER')),
  justification   TEXT,
  total_value     INTEGER NOT NULL DEFAULT 0 CHECK (total_value >= 0),
  savings_vs_budget INTEGER NOT NULL DEFAULT 0,
  round_no        INTEGER NOT NULL DEFAULT 0 CHECK (round_no >= 0),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  parent_id       INTEGER REFERENCES proc_comparative_statements (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_cs_doc ON proc_comparative_statements (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_proc_cs_company ON proc_comparative_statements (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_cs_rfq ON proc_comparative_statements (rfq_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_cs_project ON proc_comparative_statements (org_project_id, status);
CREATE INDEX IF NOT EXISTS ix_proc_cs_parent ON proc_comparative_statements (parent_id);

CREATE TABLE IF NOT EXISTS proc_cs_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  cs_id           INTEGER NOT NULL REFERENCES proc_comparative_statements (id),
  rfq_line_id     INTEGER NOT NULL REFERENCES proc_rfq_lines (id),
  vendor_id       INTEGER NOT NULL REFERENCES mdm_partners (id),
  quotation_id    INTEGER NOT NULL REFERENCES proc_quotations (id),
  quotation_line_id INTEGER NOT NULL REFERENCES proc_quotation_lines (id),
  offered_qty     INTEGER NOT NULL DEFAULT 0 CHECK (offered_qty >= 0),
  landed_rate     INTEGER NOT NULL DEFAULT 0 CHECK (landed_rate >= 0),
  rank_no         INTEGER NOT NULL DEFAULT 0 CHECK (rank_no >= 0),
  is_l1           INTEGER NOT NULL DEFAULT 0 CHECK (is_l1 IN (0, 1)),
  compliance      TEXT    NOT NULL DEFAULT 'YES' CHECK (compliance IN ('YES', 'NO', 'DEVIATION')),
  selected_qty    INTEGER NOT NULL DEFAULT 0 CHECK (selected_qty >= 0),
  last_po_rate    INTEGER,
  last_project_rate INTEGER,
  budget_rate     INTEGER,
  rc_rate         INTEGER,
  market_rate     INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proc_cs_lines ON proc_cs_lines (cs_id, rfq_line_id, vendor_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proc_cs_lines_company ON proc_cs_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_cs_lines_rfq_line ON proc_cs_lines (rfq_line_id);
CREATE INDEX IF NOT EXISTS ix_proc_cs_lines_vendor ON proc_cs_lines (vendor_id);
CREATE INDEX IF NOT EXISTS ix_proc_cs_lines_quotation ON proc_cs_lines (quotation_id);
CREATE INDEX IF NOT EXISTS ix_proc_cs_lines_quotation_line ON proc_cs_lines (quotation_line_id);

CREATE TABLE IF NOT EXISTS proc_cs_negotiations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  cs_id           INTEGER NOT NULL REFERENCES proc_comparative_statements (id),
  round_no        INTEGER NOT NULL CHECK (round_no >= 1),
  vendor_id       INTEGER NOT NULL REFERENCES mdm_partners (id),
  note            TEXT    NOT NULL,
  quotation_before_id INTEGER REFERENCES proc_quotations (id),
  quotation_after_id INTEGER REFERENCES proc_quotations (id),
  recorded_by     TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_proc_cs_neg_company ON proc_cs_negotiations (company_id);
CREATE INDEX IF NOT EXISTS ix_proc_cs_neg_cs ON proc_cs_negotiations (cs_id, round_no);
CREATE INDEX IF NOT EXISTS ix_proc_cs_neg_vendor ON proc_cs_negotiations (vendor_id);
CREATE INDEX IF NOT EXISTS ix_proc_cs_neg_before ON proc_cs_negotiations (quotation_before_id);
CREATE INDEX IF NOT EXISTS ix_proc_cs_neg_after ON proc_cs_negotiations (quotation_after_id);
