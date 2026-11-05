-- Part 06.05: the chart of accounts, cost heads, cost codes and financial dimensions. fin_account_groups: the group tree (nature, Schedule III line); fin_accounts: the ledgers (type, normal
-- balance, control account kind, manual posting allowed, blocked); fin_dimension_rules: per account, which dimensions a posting must have, may have or must not have; fin_cost_heads / fin_cost_codes:
-- the cost structure mapped to accounts; fin_category_mappings: item category to inventory account, expense account and cost code, dated; fin_master_changes: every new or changed group,
-- account, cost head, cost code or mapping, approved before it is applied. Rows without a company are the template a company copies the first time it opens its chart of accounts.

CREATE TABLE IF NOT EXISTS fin_account_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  parent_id       INTEGER REFERENCES fin_account_groups (id),
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  nature          TEXT    NOT NULL CHECK (nature IN ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE')),
  schedule3_ref   TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  group_status    TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (group_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_account_groups_code ON fin_account_groups (COALESCE(company_id, 0), code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fin_account_groups_parent ON fin_account_groups (parent_id);
CREATE INDEX IF NOT EXISTS ix_fin_account_groups_company ON fin_account_groups (company_id, nature);

CREATE TABLE IF NOT EXISTS fin_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  group_id        INTEGER NOT NULL REFERENCES fin_account_groups (id),
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  account_type    TEXT    NOT NULL CHECK (account_type IN ('GENERAL', 'BANK', 'CASH', 'RECEIVABLE', 'PAYABLE', 'TAX', 'INVENTORY', 'WIP', 'RETENTION', 'FIXED_ASSET', 'REVENUE', 'EXPENSE', 'EQUITY')),
  normal_side  TEXT    NOT NULL CHECK (normal_side IN ('DR', 'CR')),
  currency_code   TEXT    NOT NULL DEFAULT 'INR',
  is_control      INTEGER NOT NULL DEFAULT 0 CHECK (is_control IN (0, 1)),
  control_kind    TEXT    CHECK (control_kind IS NULL OR control_kind IN ('AP', 'AR', 'GST_INPUT', 'GST_OUTPUT', 'TDS_PAYABLE', 'TDS_RECEIVABLE', 'RETENTION_PAYABLE', 'RETENTION_RECEIVABLE', 'INVENTORY', 'WIP')),
  manual_posting_allowed INTEGER NOT NULL DEFAULT 1 CHECK (manual_posting_allowed IN (0, 1)),
  account_status  TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'BLOCKED')),
  block_reason    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_accounts_code ON fin_accounts (COALESCE(company_id, 0), code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fin_accounts_group ON fin_accounts (group_id);
CREATE INDEX IF NOT EXISTS ix_fin_accounts_list ON fin_accounts (company_id, account_status, account_type);

CREATE TABLE IF NOT EXISTS fin_cost_heads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  parent_id       INTEGER REFERENCES fin_cost_heads (id),
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  default_account_id INTEGER REFERENCES fin_accounts (id),
  default_account_code TEXT,
  head_status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (head_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_cost_heads_code ON fin_cost_heads (COALESCE(company_id, 0), code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fin_cost_heads_parent ON fin_cost_heads (parent_id);
CREATE INDEX IF NOT EXISTS ix_fin_cost_heads_account ON fin_cost_heads (default_account_id);
CREATE INDEX IF NOT EXISTS ix_fin_cost_heads_company ON fin_cost_heads (company_id);

CREATE TABLE IF NOT EXISTS fin_cost_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  cost_head_id    INTEGER NOT NULL REFERENCES fin_cost_heads (id),
  uom             TEXT,
  code_status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (code_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_cost_codes_code ON fin_cost_codes (COALESCE(company_id, 0), code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fin_cost_codes_head ON fin_cost_codes (cost_head_id);
CREATE INDEX IF NOT EXISTS ix_fin_cost_codes_company ON fin_cost_codes (company_id, code_status);

CREATE TABLE IF NOT EXISTS fin_dimension_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  account_id      INTEGER NOT NULL REFERENCES fin_accounts (id),
  dimension       TEXT    NOT NULL CHECK (dimension IN ('BRANCH', 'PROJECT', 'SITE', 'WBS', 'COST_CENTRE', 'PROFIT_CENTRE', 'DEPARTMENT', 'EMPLOYEE', 'EQUIPMENT')),
  requirement     TEXT    NOT NULL CHECK (requirement IN ('MANDATORY', 'OPTIONAL', 'NOT_ALLOWED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_dimension_rules ON fin_dimension_rules (account_id, dimension) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_fin_dimension_rules_company ON fin_dimension_rules (company_id);

CREATE TABLE IF NOT EXISTS fin_category_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  item_category_id INTEGER NOT NULL REFERENCES mdm_item_categories (id),
  inventory_account_id INTEGER REFERENCES fin_accounts (id),
  expense_account_id INTEGER NOT NULL REFERENCES fin_accounts (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  effective_from  TEXT    NOT NULL,
  effective_to    TEXT,
  mapping_status  TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (mapping_status IN ('ACTIVE', 'RETIRED')),
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
  remarks     TEXT
);
CREATE INDEX IF NOT EXISTS ix_fin_category_mappings_category ON fin_category_mappings (item_category_id, mapping_status);
CREATE INDEX IF NOT EXISTS ix_fin_category_mappings_company ON fin_category_mappings (company_id, mapping_status);
CREATE INDEX IF NOT EXISTS ix_fin_category_mappings_inv ON fin_category_mappings (inventory_account_id);
CREATE INDEX IF NOT EXISTS ix_fin_category_mappings_exp ON fin_category_mappings (expense_account_id);
CREATE INDEX IF NOT EXISTS ix_fin_category_mappings_cc ON fin_category_mappings (cost_code_id);

CREATE TABLE IF NOT EXISTS fin_master_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  entity          TEXT    NOT NULL CHECK (entity IN ('GROUP', 'ACCOUNT', 'COST_HEAD', 'COST_CODE', 'MAPPING')),
  action          TEXT    NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'BLOCK', 'UNBLOCK')),
  entity_id       INTEGER,
  change_json     TEXT    NOT NULL DEFAULT '{}',
  before_json     TEXT    NOT NULL DEFAULT '{}',
  reason          TEXT    NOT NULL,
  maker_role      TEXT    NOT NULL,
  request_status  TEXT    NOT NULL DEFAULT 'PENDING' CHECK (request_status IN ('PENDING', 'RETURNED', 'APPLIED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  decided_by      TEXT,
  decided_at      TEXT,
  applied_entity_id INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_fin_master_changes_list ON fin_master_changes (company_id, request_status, entity);
CREATE INDEX IF NOT EXISTS ix_fin_master_changes_entity ON fin_master_changes (entity, entity_id);
