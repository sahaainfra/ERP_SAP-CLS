-- Part 30.04: functional and regression test programme and simulation sandbox. tst_test_catalogue lists every automated test of the
-- repository with its part, the requirements it proves and its last result; tst_test_runs keeps each recorded run of the suites; tst_sandbox_runs
-- keeps what was done in the sandbox (generate, reset, a scenario pack with its expected and actual KPI values).
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.qa.p3004', 'Test programme and simulation sandbox (part 30.04)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS tst_test_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  run_no TEXT NOT NULL,
  run_source TEXT NOT NULL CHECK (run_source IN ('CI', 'LOCAL', 'SANDBOX')),
  suite TEXT NOT NULL CHECK (suite IN ('UNIT_API', 'E2E', 'VISUAL', 'AUTHZ', 'PERF', 'ALL')),
  commit_ref TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  passed_count INTEGER NOT NULL DEFAULT 0 CHECK (passed_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  status TEXT NOT NULL DEFAULT 'DONE' CHECK (status IN ('DONE', 'FAILED')),
  requested_by TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tst_test_runs_no ON tst_test_runs(company_id, run_no);
CREATE INDEX IF NOT EXISTS ix_tst_test_runs_status ON tst_test_runs(company_id, status, id);

CREATE TABLE IF NOT EXISTS tst_test_catalogue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  test_id TEXT NOT NULL,
  part_id TEXT,
  requirement_ref TEXT,
  test_type TEXT NOT NULL CHECK (test_type IN ('UNIT', 'API', 'WORKFLOW', 'PERMISSION', 'E2E', 'VISUAL', 'ACCESSIBILITY', 'PERFORMANCE', 'SECURITY', 'INTEGRATION', 'DATA')),
  automated INTEGER NOT NULL DEFAULT 1 CHECK (automated IN (0,1)),
  file TEXT NOT NULL,
  name TEXT NOT NULL,
  last_result TEXT CHECK (last_result IS NULL OR last_result IN ('PASS', 'FAIL', 'SKIP')),
  last_run_id INTEGER REFERENCES tst_test_runs(id),
  last_run_at TEXT,
  last_duration_ms INTEGER CHECK (last_duration_ms IS NULL OR last_duration_ms >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tst_test_catalogue_id ON tst_test_catalogue(company_id, test_id);
CREATE INDEX IF NOT EXISTS ix_tst_test_catalogue_part ON tst_test_catalogue(company_id, part_id);
CREATE INDEX IF NOT EXISTS ix_tst_test_catalogue_status ON tst_test_catalogue(company_id, status, last_result);
CREATE INDEX IF NOT EXISTS ix_tst_test_catalogue_run ON tst_test_catalogue(last_run_id);

CREATE TABLE IF NOT EXISTS tst_sandbox_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  run_no TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('GENERATE', 'RESET', 'SCENARIO')),
  pack TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
  result_status TEXT CHECK (result_status IS NULL OR result_status IN ('PASS', 'FAIL')),
  params_json TEXT NOT NULL DEFAULT '{}',
  expected_json TEXT,
  actual_json TEXT,
  counts_json TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  requested_by TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tst_sandbox_runs_no ON tst_sandbox_runs(company_id, run_no);
CREATE INDEX IF NOT EXISTS ix_tst_sandbox_runs_status ON tst_sandbox_runs(company_id, status, id);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('tst-test-coverage','g-administration','page','sidebar','Test Coverage & Results','परीक्षण कवरेज और परिणाम','/admin/test-coverage','erp.insights.rb','tst.catalogue.view','ff.qa.p3004',23,'test catalogue coverage traceability requirement regression results sandbox scenario packs reset synthetic data training demo',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.test-coverage','ui','Test Coverage & Results','/admin/test-coverage','/admin/test-coverage','REPORT','MIGRATED','ITADM','30.04','system','2026-11-24T00:00:00.000Z','[]','The test catalogue with traceability and results; the sandbox reset and scenario packs.','migration','reference_seed');
