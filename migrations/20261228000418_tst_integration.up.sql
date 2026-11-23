-- Part 30.01: cross-module integration and real-time propagation (module tst, M30). tst_integration_runs keeps each integration check
-- (threads and hand-offs, re-keying audit, the event matrix of producers and consumers, latency) as a snapshot; tst_latency_probes keeps each
-- probe sent through the outbox and bus to the person's real-time room and notifications, with its times.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.qa.p3001', 'Cross-module integration matrix and real-time latency (part 30.01)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS tst_integration_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  run_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
  result_status TEXT CHECK (result_status IS NULL OR result_status IN ('GREEN', 'RED')),
  started_at TEXT,
  finished_at TEXT,
  totals_json TEXT,
  result_json TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tst_integration_runs_no ON tst_integration_runs(company_id, run_no);
CREATE INDEX IF NOT EXISTS ix_tst_integration_runs_status ON tst_integration_runs(company_id, status, id);

CREATE TABLE IF NOT EXISTS tst_latency_probes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  probe_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'PASS', 'FAIL')),
  sent_at TEXT NOT NULL,
  consumed_at TEXT,
  realtime_at TEXT,
  notified_at TEXT,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  target_ms INTEGER NOT NULL CHECK (target_ms > 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tst_latency_probes_no ON tst_latency_probes(company_id, probe_no);
CREATE INDEX IF NOT EXISTS ix_tst_latency_probes_status ON tst_latency_probes(company_id, status, id);

INSERT OR IGNORE INTO ntf_templates (code,category,channel,lang,subject,body,variables_json,status,created_by,source_type) VALUES
  ('tst.probe.delivered','system','IN_APP','en','Latency probe {{probe}} delivered','The probe {{probe}} reached your screen through the event bus.','["probe"]','ACTIVE','migration','reference_seed'),
  ('tst.check.completed','system','IN_APP','en','{{kind}} {{run}}: {{result}}','{{kind}} {{run}} finished: {{result}}.','["kind","run","result"]','ACTIVE','migration','reference_seed'),
  ('tst.check.completed','system','EMAIL','en','{{kind}} {{run}}: {{result}}','{{kind}} {{run}} finished: {{result}}. Open the Integration Matrix for the threads, the matrix and the latency.','["kind","run","result"]','ACTIVE','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('tst-integration-matrix','g-administration','page','sidebar','Integration Matrix','एकीकरण मैट्रिक्स','/admin/integration-matrix','erp.insights.rb','tst.integration.view','ff.qa.p3001',20,'integration matrix events producers consumers threads hand-off re-keying latency real time technical console go-live',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.integration-matrix','ui','Integration Matrix & Test Results','/admin/integration-matrix','/admin/integration-matrix','REPORT','MIGRATED','ITADM','30.01','system','2026-11-23T00:00:00.000Z','[]','Threads, hand-offs, re-keying, the event matrix and real-time latency (technical console).','migration','reference_seed');
