CREATE TABLE IF NOT EXISTS bi_domain_refreshes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  metric_code TEXT NOT NULL,
  dataset_version INTEGER NOT NULL,
  period TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  missing_count INTEGER NOT NULL DEFAULT 0 CHECK (missing_count >= 0 AND missing_count <= row_count),
  status TEXT NOT NULL DEFAULT 'COMPLETE' CHECK (status = 'COMPLETE'),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'metric_capture',
  source_id TEXT,
  remarks TEXT,
  UNIQUE (company_id, metric_code, dataset_version, period)
);
CREATE INDEX IF NOT EXISTS ix_bi_domain_refreshes_company_status ON bi_domain_refreshes(company_id,status);

CREATE TABLE IF NOT EXISTS bi_domain_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  refresh_id INTEGER NOT NULL REFERENCES bi_domain_refreshes(id),
  project_id INTEGER NOT NULL REFERENCES org_projects(id),
  value_scaled INTEGER,
  source_period TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'CAPTURED' CHECK (status = 'CAPTURED'),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  remarks TEXT,
  UNIQUE (refresh_id, project_id)
);
CREATE INDEX IF NOT EXISTS ix_bi_domain_observations_project ON bi_domain_observations(project_id, refresh_id);
CREATE INDEX IF NOT EXISTS ix_bi_domain_observations_company_status ON bi_domain_observations(company_id,status);

INSERT OR IGNORE INTO ntf_templates
  (code,category,channel,lang,subject,body,variables_json,status,created_by,source_type)
VALUES ('bi.domain_metric.decided','system','IN_APP','en','Metric certification updated','Certification for {{metric}} was {{outcome}}.','["metric","outcome"]','ACTIVE','migration','reference_seed');
INSERT OR IGNORE INTO ui_widgets
  (code,module,title,title_hi,description,type,data_endpoint,permission_key,default_w,default_h,refresh_sec,drill_route,sort_order,created_by,source_type)
VALUES
  ('bi.spi','bi','Certified schedule performance index','प्रमाणित समय-सारणी प्रदर्शन सूचकांक','SPI from the selected project’s approved progress period.','kpi','/api/v1/ui/widgets/bi.spi/data','site.period.view',3,1,120,'/bi/metrics',511,'migration','reference_seed'),
  ('bi.cpi','bi','Certified cost performance index','प्रमाणित लागत प्रदर्शन सूचकांक','CPI from the selected project’s approved progress period.','kpi','/api/v1/ui/widgets/bi.cpi/data','site.period.cost',3,1,120,'/bi/metrics',512,'migration','reference_seed'),
  ('bi.eac','bi','Certified estimate at completion','प्रमाणित पूर्णता लागत अनुमान','EAC from the selected project’s approved cost forecast.','kpi','/api/v1/ui/widgets/bi.eac/data','fin.forecast.view',3,1,120,'/bi/metrics',513,'migration','reference_seed'),
  ('bi.gross_margin','bi','Certified gross margin','प्रमाणित सकल मार्जिन','Gross margin from the selected project’s frozen monthly P&L.','kpi','/api/v1/ui/widgets/bi.gross_margin/data','fin.pl_snapshot.view',3,1,120,'/bi/metrics',514,'migration','reference_seed');

INSERT OR IGNORE INTO proj_360_widgets
  (company_id,widget_code,module,tab,slot,sort_order,permission_key,owner_part,title,title_hi,created_by,source_type)
VALUES
  (NULL,'bi.spi','bi','time','main',90,'site.period.view','27.03','Certified schedule performance index','प्रमाणित समय-सारणी प्रदर्शन सूचकांक','migration','reference_seed'),
  (NULL,'bi.cpi','bi','cost','main',90,'site.period.cost','27.03','Certified cost performance index','प्रमाणित लागत प्रदर्शन सूचकांक','migration','reference_seed'),
  (NULL,'bi.eac','bi','cost','main',91,'fin.forecast.view','27.03','Certified estimate at completion','प्रमाणित पूर्णता लागत अनुमान','migration','reference_seed'),
  (NULL,'bi.gross_margin','bi','cost','main',92,'fin.pl_snapshot.view','27.03','Certified gross margin','प्रमाणित सकल मार्जिन','migration','reference_seed');
