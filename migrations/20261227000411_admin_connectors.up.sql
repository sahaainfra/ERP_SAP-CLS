-- Part 29.02: business connectors on the integration hub. int_mappings translates values between the ERP and a connected system (used only
-- once approved by the accounts, HR or plant manager); int_sync_runs records every run (statement fetch, account validation, punch pull,
-- telematics pull, accounting export) with its counts, errors, outcome and, for an export, the file.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.admin.p2902', 'Business connectors: banking, accounting export, biometrics, telematics (part 29.02)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS int_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  connector_code TEXT NOT NULL,
  entity TEXT NOT NULL CHECK (entity IN ('gl_account', 'gst_rate', 'tds_section', 'biometric_user', 'equipment')),
  internal_value TEXT NOT NULL,
  external_value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  request_id INTEGER REFERENCES core_change_requests(id),
  approved_by TEXT,
  approved_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'api',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_int_mappings_active ON int_mappings(company_id, connector_code, entity, external_value) WHERE status = 'ACTIVE' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_int_mappings_lookup ON int_mappings(company_id, connector_code, entity, status);
CREATE INDEX IF NOT EXISTS ix_int_mappings_request ON int_mappings(request_id);

CREATE TABLE IF NOT EXISTS int_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  connector_code TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('BANK_STATEMENT', 'PENNY_DROP', 'BIOMETRIC', 'TELEMATICS', 'ACCOUNTING_EXPORT')),
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  records INTEGER NOT NULL DEFAULT 0 CHECK (records >= 0),
  errors INTEGER NOT NULL DEFAULT 0 CHECK (errors >= 0),
  errors_json TEXT,
  params_json TEXT,
  detail_json TEXT,
  output_text TEXT,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'api',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_int_sync_runs_list ON int_sync_runs(company_id, connector_code, status, id);
CREATE INDEX IF NOT EXISTS ix_int_sync_runs_company ON int_sync_runs(company_id, id);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('admin-connectors','g-administration','page','sidebar','Business Connectors','व्यावसायिक कनेक्टर','/admin/connectors','erp.insights.rb','adm.connector.view','ff.admin.p2902',2,'connector bank statement penny drop h2h tally export biometric zkteco essl telematics gps mapping sync health',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.connectors','ui','Business Connectors','/admin/connectors','/admin/connectors','LIST','MIGRATED','ITADM','29.02','system','2026-11-22T00:00:00.000Z','[]','Business connectors with health, value mappings with approval, sync runs and errors.','migration','reference_seed');
