-- Part 29.05: legacy data migration and opening balances. mig_objects is the plan (each kind of data with its owner role, phase,
-- sequence, mapping workbook and status); mig_runs keeps every trial load (run and rolled back) and final load with its counts, errors
-- and reconciliation; mig_cutovers is the cut-over runbook with its freeze window and rollback point. Sign-off goes through
-- core_change_requests (type mig_object_signoff): the owner, then the CFO for financial objects.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.admin.p2905', 'Legacy data migration cockpit and opening balances (part 29.05)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS mig_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('MASTERS', 'OPEN_DOCUMENTS', 'BALANCES')),
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  owner_role TEXT NOT NULL,
  owner_user TEXT,
  financial INTEGER NOT NULL DEFAULT 0 CHECK (financial IN (0,1)),
  mapping_json TEXT NOT NULL,
  mapping_version INTEGER NOT NULL DEFAULT 1 CHECK (mapping_version >= 1),
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'TRIAL', 'READY', 'SIGNOFF', 'SIGNED_OFF', 'LOADED')),
  request_id INTEGER REFERENCES core_change_requests(id),
  signed_off_by TEXT,
  signed_off_at TEXT,
  last_trial_at TEXT,
  loaded_at TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mig_objects_code ON mig_objects(company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mig_objects_board ON mig_objects(company_id, phase, sequence);
CREATE INDEX IF NOT EXISTS ix_mig_objects_request ON mig_objects(request_id);

CREATE TABLE IF NOT EXISTS mig_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  object_code TEXT NOT NULL,
  environment TEXT NOT NULL,
  run_type TEXT NOT NULL CHECK (run_type IN ('TRIAL', 'FINAL')),
  mode TEXT NOT NULL DEFAULT 'FULL' CHECK (mode IN ('FULL', 'DELTA')),
  status TEXT NOT NULL CHECK (status IN ('PASSED', 'FAILED', 'LOADED', 'ROLLED_BACK')),
  records INTEGER NOT NULL DEFAULT 0 CHECK (records >= 0),
  errors INTEGER NOT NULL DEFAULT 0 CHECK (errors >= 0),
  legacy_rows INTEGER NOT NULL DEFAULT 0 CHECK (legacy_rows >= 0),
  dropped INTEGER NOT NULL DEFAULT 0 CHECK (dropped >= 0),
  mapping_version INTEGER NOT NULL,
  input_hash TEXT NOT NULL,
  reconciliation_json TEXT,
  errors_json TEXT,
  detail_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
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
CREATE INDEX IF NOT EXISTS ix_mig_runs_object ON mig_runs(company_id, object_code, run_type, status, mapping_version);
CREATE INDEX IF NOT EXISTS ix_mig_runs_company ON mig_runs(company_id, id);

CREATE TABLE IF NOT EXISTS mig_cutovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  name TEXT NOT NULL,
  freeze_from TEXT NOT NULL,
  freeze_to TEXT NOT NULL,
  rollback_point TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'FROZEN', 'CLOSED')),
  frozen_at TEXT,
  closed_at TEXT,
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
CREATE INDEX IF NOT EXISTS ix_mig_cutovers_company ON mig_cutovers(company_id, status);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('admin-data-migration','g-administration','page','sidebar','Migration Cockpit','माइग्रेशन कॉकपिट','/admin/data-migration','erp.insights.rb','adm.migration.view','ff.admin.p2905',5,'migration legacy data opening balance trial balance opening stock mapping cleansing trial load cut-over freeze sign-off reconciliation',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.data_migration','ui','Migration Cockpit','/admin/data-migration','/admin/data-migration','WORKLIST','MIGRATED','ITADM','29.05','system','2026-11-22T00:00:00.000Z','[]','Migration objects board with mapping, trial and final loads, reconciliation, sign-off and the cut-over runbook.','migration','reference_seed');
