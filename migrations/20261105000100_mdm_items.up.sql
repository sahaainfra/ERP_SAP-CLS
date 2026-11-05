-- Part 06.03: the item master. mdm_item_categories: the category tree with its code prefix, the item types it holds, the attribute template of its items, the default HSN/SAC and the steward role that
-- approves its new items (a category without a company is a system category). mdm_items: every version of an item (code + version_no), with its specification, base unit, tax codes, tracking flags,
-- reorder defaults and rates (paise). mdm_item_uoms: item-specific conversions to the base unit; mdm_item_resources: the bill of resources of a composite or work item; mdm_item_makes: makes and models,
-- approved or not; mdm_item_alternates: alternate items; mdm_item_code_counters: the code series of a category per company; mdm_item_user_marks: favourites and recent items of the selector;
-- mdm_item_legacy_map: how a free-text material of the system before this part maps to an item (references stay as they were).

CREATE TABLE IF NOT EXISTS mdm_item_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  parent_id       INTEGER REFERENCES mdm_item_categories (id),
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  name_hi         TEXT,
  code_prefix     TEXT    NOT NULL CHECK (length(code_prefix) BETWEEN 2 AND 6),
  item_types_json TEXT    NOT NULL DEFAULT '[]',
  attribute_template_json TEXT NOT NULL DEFAULT '[]',
  default_hsn_code TEXT,
  gl_mapping_code TEXT,
  steward_role    TEXT    NOT NULL CHECK (steward_role IN ('PROCMGR', 'STOREMGR', 'EST', 'PLANTMGR')),
  category_status TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (category_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_item_categories_code ON mdm_item_categories (COALESCE(company_id, 0), code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_item_categories_parent ON mdm_item_categories (parent_id);
CREATE INDEX IF NOT EXISTS ix_mdm_item_categories_company ON mdm_item_categories (company_id, category_status);

CREATE TABLE IF NOT EXISTS mdm_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  name            TEXT    NOT NULL,
  name_hi         TEXT,
  item_type       TEXT    NOT NULL CHECK (item_type IN ('MATERIAL', 'CONSUMABLE', 'SPARE', 'TOOL', 'RETURNABLE', 'LABOUR', 'EQUIPMENT', 'SERVICE', 'SUBCONTRACT', 'WORK_ITEM', 'COMPOSITE')),
  category_id     INTEGER NOT NULL REFERENCES mdm_item_categories (id),
  description     TEXT,
  spec_json       TEXT    NOT NULL DEFAULT '{}',
  spec_key        TEXT    NOT NULL DEFAULT '',
  search_text     TEXT    NOT NULL DEFAULT '',
  base_uom        TEXT    NOT NULL,
  hsn_sac_code    TEXT,
  gst_code   TEXT,
  stock_tracked   INTEGER NOT NULL DEFAULT 0 CHECK (stock_tracked IN (0, 1)),
  batch_tracked   INTEGER NOT NULL DEFAULT 0 CHECK (batch_tracked IN (0, 1)),
  serial_tracked  INTEGER NOT NULL DEFAULT 0 CHECK (serial_tracked IN (0, 1)),
  shelf_life_days INTEGER CHECK (shelf_life_days IS NULL OR shelf_life_days > 0),
  reorder_level   INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  reorder_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reorder_quantity >= 0),
  standard_amount INTEGER NOT NULL DEFAULT 0 CHECK (standard_amount >= 0),
  last_purchase_amount INTEGER CHECK (last_purchase_amount IS NULL OR last_purchase_amount >= 0),
  last_purchase_at TEXT,
  preferred_brands_json TEXT NOT NULL DEFAULT '[]',
  image_file_id   INTEGER,
  item_status     TEXT    NOT NULL DEFAULT 'SUBMITTED' CHECK (item_status IN ('SUBMITTED', 'ACTIVE', 'INACTIVE', 'SUPERSEDED', 'REJECTED')),
  effective_from  TEXT    NOT NULL,
  effective_to    TEXT,
  supersedes_id   INTEGER REFERENCES mdm_items (id),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  legacy_code     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_items_code ON mdm_items (company_id, code, version_no);
CREATE INDEX IF NOT EXISTS ix_mdm_items_list ON mdm_items (company_id, item_status, item_type, category_id);
CREATE INDEX IF NOT EXISTS ix_mdm_items_category ON mdm_items (category_id);
CREATE INDEX IF NOT EXISTS ix_mdm_items_spec ON mdm_items (company_id, category_id, spec_key);
CREATE INDEX IF NOT EXISTS ix_mdm_items_supersedes ON mdm_items (supersedes_id);
CREATE INDEX IF NOT EXISTS ix_mdm_items_name ON mdm_items (company_id, name);

CREATE TABLE IF NOT EXISTS mdm_item_uoms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  uom             TEXT    NOT NULL,
  factor_to_base  TEXT    NOT NULL CHECK (factor_to_base GLOB '[0-9]*' AND factor_to_base NOT GLOB '*[^0-9.]*'),
  purpose         TEXT    NOT NULL DEFAULT 'ANY' CHECK (purpose IN ('ANY', 'PURCHASE', 'ISSUE', 'SALE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_item_uoms ON mdm_item_uoms (item_id, uom) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_item_uoms_company ON mdm_item_uoms (company_id);

CREATE TABLE IF NOT EXISTS mdm_item_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  parent_item_id  INTEGER NOT NULL REFERENCES mdm_items (id),
  component_item_id INTEGER NOT NULL REFERENCES mdm_items (id),
  qty_per_unit    INTEGER NOT NULL CHECK (qty_per_unit > 0),
  uom             TEXT    NOT NULL,
  wastage_pct     INTEGER NOT NULL DEFAULT 0 CHECK (wastage_pct BETWEEN 0 AND 1000000),
  sort_order      INTEGER NOT NULL DEFAULT 0,
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
  CHECK (parent_item_id != component_item_id)
);
CREATE INDEX IF NOT EXISTS ix_mdm_item_resources_parent ON mdm_item_resources (parent_item_id);
CREATE INDEX IF NOT EXISTS ix_mdm_item_resources_component ON mdm_item_resources (component_item_id);
CREATE INDEX IF NOT EXISTS ix_mdm_item_resources_company ON mdm_item_resources (company_id);

CREATE TABLE IF NOT EXISTS mdm_item_makes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  make            TEXT    NOT NULL,
  model           TEXT,
  approved        INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
  approved_by     TEXT,
  approved_at     TEXT,
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
CREATE INDEX IF NOT EXISTS ix_mdm_item_makes_item ON mdm_item_makes (item_id);
CREATE INDEX IF NOT EXISTS ix_mdm_item_makes_company ON mdm_item_makes (company_id);

CREATE TABLE IF NOT EXISTS mdm_item_alternates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  alternate_item_id INTEGER NOT NULL REFERENCES mdm_items (id),
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
  CHECK (item_id != alternate_item_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_item_alternates ON mdm_item_alternates (item_id, alternate_item_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_item_alternates_alt ON mdm_item_alternates (alternate_item_id);
CREATE INDEX IF NOT EXISTS ix_mdm_item_alternates_company ON mdm_item_alternates (company_id);

CREATE TABLE IF NOT EXISTS mdm_item_code_counters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  category_id     INTEGER NOT NULL REFERENCES mdm_item_categories (id),
  next_seq        INTEGER NOT NULL DEFAULT 1 CHECK (next_seq >= 1),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_item_code_counters ON mdm_item_code_counters (company_id, category_id);
CREATE INDEX IF NOT EXISTS ix_mdm_item_code_counters_category ON mdm_item_code_counters (category_id);

CREATE TABLE IF NOT EXISTS mdm_item_user_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  user_ref        TEXT    NOT NULL,
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  mark            TEXT    NOT NULL CHECK (mark IN ('FAVOURITE', 'RECENT')),
  used_at         TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_item_user_marks ON mdm_item_user_marks (company_id, user_ref, item_id, mark);
CREATE INDEX IF NOT EXISTS ix_mdm_item_user_marks_item ON mdm_item_user_marks (item_id);
CREATE INDEX IF NOT EXISTS ix_mdm_item_user_marks_user ON mdm_item_user_marks (company_id, user_ref, mark, used_at);

CREATE TABLE IF NOT EXISTS mdm_item_legacy_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  legacy_source   TEXT    NOT NULL,
  legacy_key      TEXT    NOT NULL,
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  mapped_by       TEXT    NOT NULL,
  mapped_at       TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_item_legacy_map ON mdm_item_legacy_map (company_id, legacy_source, legacy_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_item_legacy_map_item ON mdm_item_legacy_map (item_id);
