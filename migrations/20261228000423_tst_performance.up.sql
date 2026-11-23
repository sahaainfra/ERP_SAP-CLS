-- Part 30.06: performance, scalability and load testing. tst_perf_runs keeps each load, stress, smoke or soak run (load model, users, duration,
-- requests, errors, memory at start, end and peak, result against the SLOs); tst_perf_results keeps each journey of a run with its percentiles,
-- throughput and the SLO it is held to.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.qa.p3006', 'Performance test results (part 30.06)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS tst_perf_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  run_no TEXT NOT NULL,
  profile TEXT NOT NULL CHECK (profile IN ('SMOKE', 'LOAD', 'STRESS', 'SOAK')),
  tool TEXT NOT NULL CHECK (tool IN ('NODE', 'K6')),
  environment TEXT NOT NULL,
  machine TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_s INTEGER NOT NULL CHECK (duration_s >= 0),
  users_count INTEGER NOT NULL DEFAULT 0 CHECK (users_count >= 0),
  requests_count INTEGER NOT NULL DEFAULT 0 CHECK (requests_count >= 0),
  errors_count INTEGER NOT NULL DEFAULT 0 CHECK (errors_count >= 0),
  rss_start_mb INTEGER CHECK (rss_start_mb IS NULL OR rss_start_mb >= 0),
  rss_end_mb INTEGER CHECK (rss_end_mb IS NULL OR rss_end_mb >= 0),
  rss_max_mb INTEGER CHECK (rss_max_mb IS NULL OR rss_max_mb >= 0),
  memory_json TEXT,
  result_status TEXT NOT NULL CHECK (result_status IN ('PASS', 'FAIL')),
  commit_ref TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tst_perf_runs_no ON tst_perf_runs(company_id, run_no);
CREATE INDEX IF NOT EXISTS ix_tst_perf_runs_profile ON tst_perf_runs(company_id, profile, id);
CREATE INDEX IF NOT EXISTS ix_tst_perf_runs_status ON tst_perf_runs(company_id, result_status);

CREATE TABLE IF NOT EXISTS tst_perf_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  run_id INTEGER NOT NULL REFERENCES tst_perf_runs(id),
  model TEXT NOT NULL,
  journey TEXT NOT NULL,
  slo_kind TEXT NOT NULL CHECK (slo_kind IN ('LIST', 'RECORD', 'SAVE', 'REPORT', 'REALTIME', 'BURST')),
  slo_ms INTEGER NOT NULL CHECK (slo_ms > 0),
  requests_count INTEGER NOT NULL CHECK (requests_count >= 0),
  errors_count INTEGER NOT NULL DEFAULT 0 CHECK (errors_count >= 0),
  p50_ms NUMERIC NOT NULL CHECK (p50_ms >= 0),
  p95_ms NUMERIC NOT NULL CHECK (p95_ms >= 0),
  p99_ms NUMERIC NOT NULL CHECK (p99_ms >= 0),
  max_ms NUMERIC NOT NULL CHECK (max_ms >= 0),
  throughput_rps NUMERIC NOT NULL CHECK (throughput_rps >= 0),
  target_rps NUMERIC CHECK (target_rps IS NULL OR target_rps >= 0),
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL')),
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
CREATE INDEX IF NOT EXISTS ix_tst_perf_results_run ON tst_perf_results(run_id, status);
CREATE INDEX IF NOT EXISTS ix_tst_perf_results_status ON tst_perf_results(company_id, status);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('tst-performance','g-administration','page','sidebar','Performance Test Results','प्रदर्शन परीक्षण परिणाम','/admin/performance-tests','erp.insights.rb','tst.perf.view','ff.qa.p3006',25,'performance load stress soak test slo latency throughput p95 capacity k6 technical console',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.performance-tests','ui','Performance Test Results','/admin/performance-tests','/admin/performance-tests','REPORT','MIGRATED','ITADM','30.06','system','2026-11-24T00:00:00.000Z','[]','Load, stress, smoke and soak runs against the SLOs, with memory over time (technical console).','migration','reference_seed');

-- 30.06 FR-03 (BR-01: additive only): the list of sample documents counted and paged 20,000 rows through the table on every call (the
-- slowest list of the load test); this index covers both the count and the newest-first page.
CREATE INDEX IF NOT EXISTS ix_core_sample_documents_list ON core_sample_documents(company_id, is_active, id);
