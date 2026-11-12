-- Part 16.06: physical verification (count plans and lines), the scrap register and scrap disposals. The stock adjustment (inv_adjustments, 16.01) is reused: an adjustment made from a count carries source_type inv_count_plan. Quantities are thousandths, rates and values paise.
CREATE TABLE IF NOT EXISTS inv_count_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  plan_type       TEXT    NOT NULL CHECK (plan_type IN ('FULL', 'CYCLE')),
  abc_class       TEXT    CHECK (abc_class IS NULL OR abc_class IN ('A', 'B', 'C')),
  scheduled_date  TEXT    NOT NULL,
  freeze          INTEGER NOT NULL DEFAULT 1 CHECK (freeze IN (0, 1)),
  scope_json      TEXT    NOT NULL DEFAULT '{}',
  tolerance_pct   INTEGER NOT NULL DEFAULT 0 CHECK (tolerance_pct >= 0),
  adjustment_id   INTEGER REFERENCES inv_adjustments (id),
  started_at      TEXT,
  closed_at       TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'COUNTING', 'REVIEW', 'ADJUSTED', 'CLOSED', 'REJECTED', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_cpl_doc ON inv_count_plans (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_cpl_list ON inv_count_plans (company_id, status, scheduled_date);
CREATE INDEX IF NOT EXISTS ix_inv_cpl_store ON inv_count_plans (store_id, status);
CREATE INDEX IF NOT EXISTS ix_inv_cpl_project ON inv_count_plans (org_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_cpl_adj ON inv_count_plans (adjustment_id);

CREATE TABLE IF NOT EXISTS inv_count_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  plan_id         INTEGER NOT NULL REFERENCES inv_count_plans (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  bin_id          INTEGER NOT NULL REFERENCES inv_bins (id),
  batch_no        TEXT    NOT NULL DEFAULT '',
  owner_project_id INTEGER REFERENCES org_projects (id),
  abc_class       TEXT    CHECK (abc_class IS NULL OR abc_class IN ('A', 'B', 'C')),
  book_qty        INTEGER NOT NULL DEFAULT 0 CHECK (book_qty >= 0),
  rate            INTEGER NOT NULL DEFAULT 0 CHECK (rate >= 0),
  counted_qty     INTEGER CHECK (counted_qty IS NULL OR counted_qty >= 0),
  recount_qty     INTEGER CHECK (recount_qty IS NULL OR recount_qty >= 0),
  final_qty       INTEGER CHECK (final_qty IS NULL OR final_qty >= 0),
  variance_qty    INTEGER NOT NULL DEFAULT 0,
  variance_value  INTEGER NOT NULL DEFAULT 0,
  needs_recount   INTEGER NOT NULL DEFAULT 0 CHECK (needs_recount IN (0, 1)),
  reason          TEXT,
  counted_by      TEXT,
  counted_at      TEXT,
  recounted_by    TEXT,
  recounted_at    TEXT,
  line_status     TEXT    NOT NULL DEFAULT 'PENDING' CHECK (line_status IN ('PENDING', 'COUNTED', 'RECOUNT', 'FINAL')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_cln_no ON inv_count_lines (plan_id, line_no);
CREATE INDEX IF NOT EXISTS ix_inv_cln_company ON inv_count_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_inv_cln_item ON inv_count_lines (item_id);
CREATE INDEX IF NOT EXISTS ix_inv_cln_bin ON inv_count_lines (bin_id);
CREATE INDEX IF NOT EXISTS ix_inv_cln_owner ON inv_count_lines (owner_project_id);

CREATE TABLE IF NOT EXISTS inv_scrap_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  entry_date      TEXT    NOT NULL,
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  item_id         INTEGER REFERENCES mdm_items (id),
  description     TEXT    NOT NULL,
  scrap_source    TEXT    NOT NULL CHECK (scrap_source IN ('CUT_PIECES', 'DAMAGED', 'EXPIRED', 'COUNT_LOSS', 'OTHER')),
  from_stock      INTEGER NOT NULL DEFAULT 0 CHECK (from_stock IN (0, 1)),
  batch_no        TEXT,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  uom             TEXT    NOT NULL,
  weight_kg       INTEGER NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
  book_value      INTEGER NOT NULL DEFAULT 0 CHECK (book_value >= 0),
  entry_status    TEXT    NOT NULL DEFAULT 'HELD' CHECK (entry_status IN ('HELD', 'IN_DISPOSAL', 'DISPOSED', 'CANCELLED')),
  disposal_id     INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_scr_doc ON inv_scrap_entries (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_scr_list ON inv_scrap_entries (company_id, entry_status, entry_date);
CREATE INDEX IF NOT EXISTS ix_inv_scr_store ON inv_scrap_entries (store_id);
CREATE INDEX IF NOT EXISTS ix_inv_scr_project ON inv_scrap_entries (org_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_scr_item ON inv_scrap_entries (item_id);
CREATE INDEX IF NOT EXISTS ix_inv_scr_disposal ON inv_scrap_entries (disposal_id);

CREATE TABLE IF NOT EXISTS inv_scrap_disposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  disposal_date   TEXT    NOT NULL,
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  method          TEXT    NOT NULL CHECK (method IN ('SALE', 'AUCTION', 'WRITE_OFF')),
  buyer_partner_id INTEGER REFERENCES mdm_partners (id),
  invoice_no      TEXT,
  items_json      TEXT    NOT NULL DEFAULT '[]',
  weight_kg       INTEGER NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
  book_value      INTEGER NOT NULL DEFAULT 0 CHECK (book_value >= 0),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  gate_pass_id    INTEGER REFERENCES inv_gate_passes (id),
  reason          TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  approved_by     TEXT,
  approved_at     TEXT,
  posted_at       TEXT,
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
  CHECK (method = 'WRITE_OFF' OR buyer_partner_id IS NOT NULL OR status = 'DRAFT')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_dsp_doc ON inv_scrap_disposals (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_dsp_list ON inv_scrap_disposals (company_id, status, disposal_date);
CREATE INDEX IF NOT EXISTS ix_inv_dsp_store ON inv_scrap_disposals (store_id);
CREATE INDEX IF NOT EXISTS ix_inv_dsp_project ON inv_scrap_disposals (org_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_dsp_buyer ON inv_scrap_disposals (buyer_partner_id);
CREATE INDEX IF NOT EXISTS ix_inv_dsp_pass ON inv_scrap_disposals (gate_pass_id);
