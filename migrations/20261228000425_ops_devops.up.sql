-- Part 30.08: DevOps, environments, deployment and operations runbooks. ops_environments is the inventory of the environments (provisioned by
-- code: infra/environments, infra/ansible, docker-compose.yml); ops_deployments keeps every deploy, rollback and rehearsal (production only
-- through the pipeline, BR-01); ops_runbooks keeps each version of each runbook and its approval; ops_oncall is the on-call rota (L1, L2, L3)
-- and ops_pages each page of an on-call engineer for an alert (01.07), with its acknowledgement or escalation.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.qa.p3008', 'DevOps, environments, deployment and operations runbooks (part 30.08)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS ops_environments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  code TEXT NOT NULL CHECK (code IN ('dev', 'test', 'staging', 'production', 'sandbox')),
  name TEXT NOT NULL,
  url TEXT,
  hosts TEXT,
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'PROVISIONED', 'RETIRED')),
  active_build TEXT,
  active_slot TEXT CHECK (active_slot IS NULL OR active_slot IN ('blue', 'green')),
  last_deploy_at TEXT,
  last_health_at TEXT,
  health_status TEXT CHECK (health_status IS NULL OR health_status IN ('UP', 'DEGRADED', 'DOWN')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ops_environments_code ON ops_environments(company_id, code);
CREATE INDEX IF NOT EXISTS ix_ops_environments_status ON ops_environments(company_id, status);

CREATE TABLE IF NOT EXISTS ops_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  deploy_no TEXT NOT NULL,
  environment_id INTEGER NOT NULL REFERENCES ops_environments(id),
  kind TEXT NOT NULL CHECK (kind IN ('DEPLOY', 'ROLLBACK', 'REHEARSAL')),
  method TEXT NOT NULL DEFAULT 'BLUE_GREEN' CHECK (method IN ('BLUE_GREEN', 'IN_PLACE')),
  build_id TEXT,
  version_label TEXT,
  commit_ref TEXT,
  artifact_sha256 TEXT,
  pipeline_run TEXT,
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED', 'ROLLED_BACK')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  requests_count INTEGER CHECK (requests_count IS NULL OR requests_count >= 0),
  failed_requests INTEGER CHECK (failed_requests IS NULL OR failed_requests >= 0),
  steps_json TEXT,
  reason TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ops_deployments_no ON ops_deployments(company_id, deploy_no);
CREATE INDEX IF NOT EXISTS ix_ops_deployments_env ON ops_deployments(environment_id, id);
CREATE INDEX IF NOT EXISTS ix_ops_deployments_status ON ops_deployments(company_id, status);

CREATE TABLE IF NOT EXISTS ops_runbooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ops_runbooks_version ON ops_runbooks(company_id, code, version_no);
CREATE INDEX IF NOT EXISTS ix_ops_runbooks_status ON ops_runbooks(company_id, status);
CREATE INDEX IF NOT EXISTS ix_ops_runbooks_request ON ops_runbooks(request_id);

CREATE TABLE IF NOT EXISTS ops_oncall (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  username TEXT NOT NULL,
  support_level TEXT NOT NULL CHECK (support_level IN ('L1', 'L2', 'L3')),
  from_at TEXT NOT NULL,
  to_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
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
CREATE INDEX IF NOT EXISTS ix_ops_oncall_window ON ops_oncall(company_id, support_level, from_at, to_at);
CREATE INDEX IF NOT EXISTS ix_ops_oncall_status ON ops_oncall(company_id, status);

CREATE TABLE IF NOT EXISTS ops_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  alert_id INTEGER NOT NULL,
  rule_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  username TEXT,
  support_level TEXT NOT NULL CHECK (support_level IN ('L1', 'L2', 'L3')),
  status TEXT NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'ACKNOWLEDGED', 'ESCALATED', 'UNCOVERED')),
  paged_at TEXT NOT NULL,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  escalated_page_id INTEGER REFERENCES ops_pages(id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ops_pages_alert ON ops_pages(company_id, alert_id, support_level);
CREATE INDEX IF NOT EXISTS ix_ops_pages_status ON ops_pages(company_id, status);
CREATE INDEX IF NOT EXISTS ix_ops_pages_escalated ON ops_pages(escalated_page_id);

INSERT OR IGNORE INTO ntf_templates (code,category,channel,lang,subject,body,variables_json,status,created_by,source_type) VALUES
  ('ops.oncall.page','alerts','IN_APP','en','On call: {{rule}} ({{severity}})','{{message}} — acknowledge on the Operations page.','["rule","severity","message"]','ACTIVE','migration','reference_seed'),
  ('ops.oncall.page','alerts','SMS','en','On call: {{rule}}','ERP alert {{rule}} ({{severity}}): {{message}}. Acknowledge on the Operations page.','["rule","severity","message"]','ACTIVE','migration','reference_seed'),
  ('ops.oncall.page','alerts','EMAIL','en','On call: {{rule}} ({{severity}})','{{message}} — acknowledge on the Operations page; the runbook is linked there.','["rule","severity","message"]','ACTIVE','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('ops-runbooks','g-administration','page','sidebar','Operations Runbooks & Environments','संचालन रनबुक और परिवेश','/admin/operations','erp.insights.rb','ops.runbook.view','ff.qa.p3008',27,'operations runbooks environments inventory deploy rollback blue green zero downtime pipeline on-call rota incident restore scale secrets certificate devops sla support',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.operations','ui','Operations Runbooks & Environments','/admin/operations','/admin/operations','REPORT','MIGRATED','ITADM','30.08','system','2026-11-24T00:00:00.000Z','[]','Environment inventory and parity, deployments and rehearsals, runbooks with their approval, the on-call rota and its pages.','migration','reference_seed');
