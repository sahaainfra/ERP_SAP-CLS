-- Part 16.07: reorder parameters (live values), their maker-checker change sets, the reorder suggestions that lead to draft material requests, and the label print log. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS inv_reorder_params (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  min_qty         INTEGER NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  max_qty         INTEGER NOT NULL DEFAULT 0 CHECK (max_qty >= 0),
  reorder_level   INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  reorder_qty     INTEGER NOT NULL DEFAULT 0 CHECK (reorder_qty >= 0),
  lead_days       INTEGER NOT NULL DEFAULT 0 CHECK (lead_days >= 0),
  auto_calc       INTEGER NOT NULL DEFAULT 0 CHECK (auto_calc IN (0, 1)),
  effective_from  TEXT    NOT NULL,
  change_id       INTEGER,
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
  CHECK (min_qty <= reorder_level AND reorder_level <= max_qty OR max_qty = 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_rop_key ON inv_reorder_params (company_id, store_id, item_id);
CREATE INDEX IF NOT EXISTS ix_inv_rop_store ON inv_reorder_params (store_id);
CREATE INDEX IF NOT EXISTS ix_inv_rop_item ON inv_reorder_params (item_id);
CREATE INDEX IF NOT EXISTS ix_inv_rop_project ON inv_reorder_params (org_project_id);

CREATE TABLE IF NOT EXISTS inv_reorder_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  change_date     TEXT    NOT NULL,
  effective_from  TEXT    NOT NULL,
  lines_json      TEXT    NOT NULL DEFAULT '[]',
  reason          TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_roc_doc ON inv_reorder_changes (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_roc_list ON inv_reorder_changes (company_id, status, change_date);
CREATE INDEX IF NOT EXISTS ix_inv_roc_store ON inv_reorder_changes (store_id);
CREATE INDEX IF NOT EXISTS ix_inv_roc_project ON inv_reorder_changes (org_project_id);

CREATE TABLE IF NOT EXISTS inv_reorder_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  param_id        INTEGER REFERENCES inv_reorder_params (id),
  projected_qty   INTEGER NOT NULL,
  reorder_level   INTEGER NOT NULL,
  min_qty         INTEGER NOT NULL DEFAULT 0,
  suggested_qty   INTEGER NOT NULL CHECK (suggested_qty > 0),
  required_by     TEXT    NOT NULL,
  priority        TEXT    NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('URGENT', 'NORMAL')),
  status          TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CONVERTED', 'DISMISSED', 'SUPERSEDED')),
  mr_id           INTEGER,
  decided_by      TEXT,
  decided_at      TEXT,
  dismiss_reason  TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_rsg_doc ON inv_reorder_suggestions (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_rsg_open ON inv_reorder_suggestions (store_id, item_id) WHERE status = 'OPEN' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_inv_rsg_list ON inv_reorder_suggestions (company_id, status, priority);
CREATE INDEX IF NOT EXISTS ix_inv_rsg_item ON inv_reorder_suggestions (item_id);
CREATE INDEX IF NOT EXISTS ix_inv_rsg_project ON inv_reorder_suggestions (org_project_id);

CREATE TABLE IF NOT EXISTS inv_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  label_type      TEXT    NOT NULL CHECK (label_type IN ('ITEM', 'BIN', 'BATCH')),
  ref_id          INTEGER NOT NULL,
  store_id        INTEGER REFERENCES inv_stores (id),
  batch_no        TEXT,
  code_value      TEXT    NOT NULL,
  format          TEXT    NOT NULL CHECK (format IN ('THERMAL', 'A4')),
  copies          INTEGER NOT NULL DEFAULT 1 CHECK (copies >= 1),
  printed_at      TEXT    NOT NULL,
  printed_by      TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_inv_lbl_list ON inv_labels (company_id, printed_at);
CREATE INDEX IF NOT EXISTS ix_inv_lbl_ref ON inv_labels (label_type, ref_id);
CREATE INDEX IF NOT EXISTS ix_inv_lbl_store ON inv_labels (store_id);
