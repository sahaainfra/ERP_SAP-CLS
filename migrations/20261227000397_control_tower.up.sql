-- Part 27.04: enterprise project control tower, executive dashboard and executive early-warning alerts.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.bi.p2704', 'Enterprise control tower and executive alerts (part 27.04)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS exec_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  alert_no TEXT NOT NULL,
  rule_code TEXT NOT NULL CHECK (rule_code IN ('SPI_LOW','CPI_LOW','EAC_GROWTH','COLLECTIONS_OVERDUE','CASH_NEGATIVE','LTI','MATERIAL_SHORTAGE')),
  rule_version INTEGER NOT NULL DEFAULT 0 CHECK (rule_version >= 0),
  dimension TEXT NOT NULL CHECK (dimension IN ('time','cost','quality','safety','cash')),
  project_id INTEGER REFERENCES org_projects(id),
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  message TEXT NOT NULL,
  observed_value NUMERIC(18,4),
  threshold NUMERIC(18,4),
  evidence_key TEXT NOT NULL,
  route TEXT,
  raised_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  owner_id INTEGER REFERENCES iam_users(id),
  owner_user TEXT,
  task_id INTEGER REFERENCES tsk_tasks(id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  resolution TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL,
  source_id TEXT,
  remarks TEXT,
  UNIQUE (company_id, alert_no),
  CHECK (status <> 'RESOLVED' OR resolved_at IS NOT NULL)
);
-- one open alert per rule and project (company-level alerts use project 0)
CREATE UNIQUE INDEX IF NOT EXISTS ux_exec_alerts_open ON exec_alerts(company_id, rule_code, COALESCE(project_id, 0)) WHERE status IN ('OPEN','ACKNOWLEDGED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_exec_alerts_company_status ON exec_alerts(company_id, status, severity, raised_at);
CREATE INDEX IF NOT EXISTS ix_exec_alerts_project ON exec_alerts(project_id, status);
CREATE INDEX IF NOT EXISTS ix_exec_alerts_owner ON exec_alerts(owner_id);
CREATE INDEX IF NOT EXISTS ix_exec_alerts_owner_user ON exec_alerts(company_id, owner_user, status);
CREATE INDEX IF NOT EXISTS ix_exec_alerts_task ON exec_alerts(task_id);
CREATE INDEX IF NOT EXISTS ix_exec_alerts_evidence ON exec_alerts(company_id, rule_code, evidence_key);

CREATE TABLE IF NOT EXISTS exec_alert_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  rule_code TEXT NOT NULL CHECK (rule_code IN ('SPI_LOW','CPI_LOW','EAC_GROWTH','COLLECTIONS_OVERDUE','CASH_NEGATIVE','LTI','MATERIAL_SHORTAGE')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  threshold NUMERIC(18,4) NOT NULL,
  periods INTEGER NOT NULL DEFAULT 1 CHECK (periods BETWEEN 1 AND 6),
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
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
  UNIQUE (company_id, rule_code, version),
  UNIQUE (request_id)
);
CREATE INDEX IF NOT EXISTS ix_exec_alert_settings_company ON exec_alert_settings(company_id, rule_code, version);
CREATE INDEX IF NOT EXISTS ix_exec_alert_settings_company_status ON exec_alert_settings(company_id, status);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES
  ('bi-control-tower','g-reports','page','sidebar','Enterprise Control Tower','उद्यम नियंत्रण टॉवर','/bi/control-tower','erp.insights.rb','bi.control_tower.view','ff.bi.p2704',50,'control tower executive dashboard portfolio health rag early warning director',1,'none','migration','reference_seed'),
  ('bi-exec-alerts','g-reports','page','sidebar','Executive Alerts','कार्यकारी चेतावनियाँ','/bi/exec-alerts','erp.insights.rb','bi.exec_alert.view','ff.bi.p2704',51,'executive alerts early warning spi eac cash lti shortage',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES
  ('bi.control-tower','ui','Enterprise Control Tower','/bi/control-tower','/bi/control-tower','DASHBOARD','MIGRATED','DIR','27.04','system','2026-11-21T00:00:00.000Z','[]','Executive dashboard, health matrix, executive alerts and early-warning settings.','migration','reference_seed'),
  ('bi.exec-alerts','ui','Executive Alerts','/bi/exec-alerts','/bi/exec-alerts','WORKLIST','MIGRATED','DIR','27.04','system','2026-11-21T00:00:00.000Z','[]','The executive alerts worklist of the control tower.','migration','reference_seed');

INSERT OR IGNORE INTO ntf_templates
  (code,category,channel,lang,subject,body,variables_json,status,created_by,source_type)
VALUES
  ('bi.exec_alert.raised','alerts','IN_APP','en','Executive alert {{alertNo}}','{{rule}} ({{severity}}): {{message}}','["alertNo","rule","severity","message"]','ACTIVE','migration','reference_seed'),
  ('bi.exec_alert.settings_decided','system','IN_APP','en','Early-warning threshold approved','The change to {{rule}} is in force (version {{version}}).','["rule","version"]','ACTIVE','migration','reference_seed');

INSERT OR IGNORE INTO ui_widgets
  (code,module,title,title_hi,description,type,data_endpoint,permission_key,default_w,default_h,refresh_sec,drill_route,sort_order,created_by,source_type)
VALUES
  ('bi.exec_alerts','bi','Open executive alerts','खुली कार्यकारी चेतावनियाँ','Open early-warning alerts of the control tower in your scope.','kpi','/api/v1/ui/widgets/bi.exec_alerts/data','bi.exec_alert.view',3,1,120,'/bi/control-tower?tab=alerts',518,'migration','reference_seed'),
  ('bi.revenue_to_date','bi','Certified revenue to date','प्रमाणित आज तक का राजस्व','Revenue to date from the selected project’s frozen monthly P&L.','kpi','/api/v1/ui/widgets/bi.revenue_to_date/data','fin.pl_snapshot.view',3,1,120,'/bi/metrics',519,'migration','reference_seed');

INSERT OR IGNORE INTO proj_360_widgets
  (company_id,widget_code,module,tab,slot,sort_order,permission_key,owner_part,title,title_hi,created_by,source_type)
VALUES
  (NULL,'bi.revenue_to_date','bi','cost','main',93,'fin.pl_snapshot.view','27.04','Certified revenue to date','प्रमाणित आज तक का राजस्व','migration','reference_seed');
