CREATE TABLE IF NOT EXISTS bi_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  code TEXT NOT NULL,
  dataset_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CERTIFIED','REVOKED')),
  request_id INTEGER NOT NULL REFERENCES core_change_requests(id),
  version INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'metric_certification',
  source_id TEXT,
  remarks TEXT,
  UNIQUE (company_id, code, dataset_version, version),
  UNIQUE (request_id)
);
CREATE INDEX IF NOT EXISTS ix_bi_metrics_company_status ON bi_metrics(company_id, status);

CREATE TABLE IF NOT EXISTS bi_refresh_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  period TEXT NOT NULL,
  dataset_version INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  status TEXT NOT NULL CHECK (status = 'COMPLETE'),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'project_snapshot',
  source_id TEXT,
  remarks TEXT,
  UNIQUE (company_id, period, dataset_version)
);
CREATE INDEX IF NOT EXISTS ix_bi_refresh_log_company_status ON bi_refresh_log(company_id, status);

CREATE TABLE IF NOT EXISTS bi_project_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  refresh_id INTEGER NOT NULL REFERENCES bi_refresh_log(id),
  project_id INTEGER NOT NULL REFERENCES org_projects(id),
  lifecycle_state TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'CAPTURED' CHECK (status = 'CAPTURED'),
  source_type TEXT NOT NULL DEFAULT 'project_status',
  source_id TEXT NOT NULL,
  remarks TEXT,
  UNIQUE (refresh_id, project_id)
);
CREATE INDEX IF NOT EXISTS ix_bi_project_snapshots_project ON bi_project_snapshots(project_id);
CREATE INDEX IF NOT EXISTS ix_bi_project_snapshots_company_status ON bi_project_snapshots(company_id, status);
CREATE INDEX IF NOT EXISTS ix_bi_project_snapshots_company_refresh ON bi_project_snapshots(company_id, refresh_id, project_id);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('bi-metric-catalogue','g-reports','page','sidebar','Metric Catalogue','मेट्रिक सूची','/bi/metrics','erp.insights.rb','bi.metric.catalogue.view','ff.bi.p2703',55,'metrics lineage snapshots freshness',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('bi.metrics','ui','Metric Catalogue','/bi/metrics','/bi/metrics','REPORT','MIGRATED','PCMGR','27.03','system','2026-11-21T00:00:00.000Z','[]','Metric lineage and monthly captures.','migration','reference_seed');

INSERT OR IGNORE INTO ui_widgets
  (code,module,title,title_hi,description,type,data_endpoint,permission_key,default_w,default_h,refresh_sec,drill_route,sort_order,created_by,source_type)
VALUES ('bi.project_count','bi','Certified project count','प्रमाणित परियोजना संख्या','Live project count in the current project scope.','kpi',
  '/api/v1/ui/widgets/bi.project_count/data','proj.project.view',3,1,120,'/bi/metrics',510,'migration','reference_seed');

INSERT OR IGNORE INTO ntf_templates
  (code,category,channel,lang,subject,body,variables_json,status,created_by,source_type)
VALUES
  ('bi.snapshot.ready','system','IN_APP','en','Monthly project capture complete','The project lifecycle capture for {{period}} is ready.','["period"]','ACTIVE','migration','reference_seed'),
  ('bi.metric.decided','system','IN_APP','en','Project Count certification updated','The Project Count certification was {{outcome}}.','["outcome"]','ACTIVE','migration','reference_seed');
