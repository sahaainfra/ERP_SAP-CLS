-- Part 27.05: the daily morning management report.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.bi.p2705', 'Daily morning management report (part 27.05)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS mr_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('ROLE','USER')),
  scope_ref TEXT NOT NULL,
  sections_json TEXT NOT NULL,
  delivery_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  request_id INTEGER NOT NULL REFERENCES core_change_requests(id),
  status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status = 'APPROVED'),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  source_type TEXT NOT NULL DEFAULT 'change_request',
  source_id TEXT,
  remarks TEXT,
  UNIQUE (company_id, scope_type, scope_ref, version),
  UNIQUE (request_id)
);
CREATE INDEX IF NOT EXISTS ix_mr_configs_company_status ON mr_configs(company_id, status);
CREATE INDEX IF NOT EXISTS ix_mr_configs_scope ON mr_configs(company_id, scope_type, scope_ref, version);

CREATE TABLE IF NOT EXISTS mr_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  report_no TEXT NOT NULL,
  report_date TEXT NOT NULL,
  recipient_id INTEGER REFERENCES iam_users(id),
  recipient_user TEXT NOT NULL,
  config_id INTEGER REFERENCES mr_configs(id),
  file_id INTEGER REFERENCES core_files(id),
  cutoff_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  data_snapshot_ref TEXT NOT NULL,
  exceptions INTEGER NOT NULL DEFAULT 0 CHECK (exceptions >= 0),
  generated_at TEXT NOT NULL,
  delivered_at TEXT,
  channels_json TEXT,
  trigger TEXT NOT NULL CHECK (trigger IN ('schedule','on_demand')),
  status TEXT NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED','DELIVERED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'mr_config',
  source_id TEXT,
  remarks TEXT,
  UNIQUE (company_id, report_no),
  UNIQUE (company_id, report_date, recipient_user)
);
CREATE INDEX IF NOT EXISTS ix_mr_reports_company_status ON mr_reports(company_id, status);
CREATE INDEX IF NOT EXISTS ix_mr_reports_recipient ON mr_reports(company_id, recipient_user, report_date);
CREATE INDEX IF NOT EXISTS ix_mr_reports_recipient_id ON mr_reports(recipient_id);
CREATE INDEX IF NOT EXISTS ix_mr_reports_config ON mr_reports(config_id);
CREATE INDEX IF NOT EXISTS ix_mr_reports_file ON mr_reports(file_id);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES
  ('bi-morning-report','g-reports','page','sidebar','Morning Report','प्रातः प्रबंधन रिपोर्ट','/bi/morning-report','erp.insights.rb','bi.morning_report.view','ff.bi.p2705',45,'morning report daily management summary exceptions',1,'none','migration','reference_seed'),
  ('bi-morning-reports','g-reports','page','sidebar','Report Archive','रिपोर्ट संग्रह','/bi/morning-reports','erp.insights.rb','bi.morning_report.view','ff.bi.p2705',46,'morning report archive past reports',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES
  ('bi.morning-report','ui','Morning Report','/bi/morning-report','/bi/morning-report','REPORT','MIGRATED','DIR','27.05','system','2026-11-21T00:00:00.000Z','[]','Interactive morning management report with settings.','migration','reference_seed'),
  ('bi.morning-reports','ui','Report Archive','/bi/morning-reports','/bi/morning-reports','LIST','MIGRATED','DIR','27.05','system','2026-11-21T00:00:00.000Z','[]','Archive of past morning reports.','migration','reference_seed');
INSERT OR IGNORE INTO ntf_templates
  (code,category,channel,lang,subject,body,variables_json,status,created_by,source_type)
VALUES ('bi.morning_report.ready','alerts','IN_APP','en','Morning report {{reportDate}}','{{exceptions}} exception(s). {{headline}}','["reportDate","exceptions","headline"]','ACTIVE','migration','reference_seed');
