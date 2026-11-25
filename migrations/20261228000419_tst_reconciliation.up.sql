-- Part 30.02: data traceability and the reconciliation suite. tst_recon_runs keeps each run (nightly or on demand) with its checks, trace
-- completeness and the tolerances it used; tst_recon_results keeps every compared figure (expected, actual, difference) for drill-down.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.qa.p3002', 'Reconciliation suite and trace completeness (part 30.02)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS tst_recon_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  run_no TEXT NOT NULL,
  as_of TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
  result_status TEXT CHECK (result_status IS NULL OR result_status IN ('GREEN', 'RED')),
  checks_count INTEGER NOT NULL DEFAULT 0 CHECK (checks_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  critical_count INTEGER NOT NULL DEFAULT 0 CHECK (critical_count >= 0),
  trace_bp INTEGER CHECK (trace_bp IS NULL OR trace_bp BETWEEN 0 AND 10000),
  trace_json TEXT,
  tolerance_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tst_recon_runs_no ON tst_recon_runs(company_id, run_no);
CREATE INDEX IF NOT EXISTS ix_tst_recon_runs_status ON tst_recon_runs(company_id, status, id);

CREATE TABLE IF NOT EXISTS tst_recon_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  run_id INTEGER NOT NULL REFERENCES tst_recon_runs(id),
  check_code TEXT NOT NULL CHECK (check_code IN ('QTY_CHAIN', 'COST_CHAIN', 'SUBLEDGER_GL', 'STOCK_BALANCES', 'PAYROLL_GL', 'BANK_BOOK')),
  scope_key TEXT,
  label TEXT NOT NULL,
  expected_value NUMERIC,
  actual_value NUMERIC,
  difference_value NUMERIC NOT NULL DEFAULT 0 CHECK (difference_value >= 0),
  unit TEXT NOT NULL CHECK (unit IN ('money', 'qty', 'count')),
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL', 'INFO', 'SKIPPED', 'ERROR')),
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('CRITICAL', 'MAJOR', 'INFO')),
  drill_route TEXT,
  detail TEXT,
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
CREATE INDEX IF NOT EXISTS ix_tst_recon_results_run ON tst_recon_results(run_id, status, check_code);
CREATE INDEX IF NOT EXISTS ix_tst_recon_results_company ON tst_recon_results(company_id, check_code);
CREATE INDEX IF NOT EXISTS ix_tst_recon_results_status ON tst_recon_results(company_id, status);

INSERT OR IGNORE INTO ntf_templates (code,category,channel,lang,subject,body,variables_json,status,created_by,source_type) VALUES
  ('tst.recon.alert','alerts','IN_APP','en','Reconciliation {{run}}: {{result}}','{{findings}} difference(s) above tolerance ({{checks}}); trace completeness {{trace}} %.','["run","result","findings","checks","trace"]','ACTIVE','migration','reference_seed'),
  ('tst.recon.alert','alerts','EMAIL','en','Reconciliation {{run}}: {{result}}','{{findings}} difference(s) above tolerance ({{checks}}); trace completeness {{trace}} %. Open Reconciliation Health for the differences and their records.','["run","result","findings","checks","trace"]','ACTIVE','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('tst-reconciliation-health','g-administration','page','sidebar','Reconciliation Health','मिलान स्वास्थ्य','/admin/reconciliation-health','erp.insights.rb','tst.recon.view','ff.qa.p3002',21,'reconciliation health trace completeness sub-ledger gl stock payroll bank quantity boq mb billed budget commitment actual double counting',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.reconciliation-health','ui','Reconciliation Health','/admin/reconciliation-health','/admin/reconciliation-health','DASHBOARD','MIGRATED','CFO','30.02','system','2026-11-23T00:00:00.000Z','[]','The reconciliation checks, their differences, trace completeness and the nightly runs.','migration','reference_seed');
