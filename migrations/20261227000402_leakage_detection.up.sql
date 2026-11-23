-- Part 27.09: wastage, leakage and duplication detection. det_rules holds the approved settings of each detection rule per company (a new
-- version per approved change; the defaults live with the rule in code); det_findings holds the findings with their evidence, value at risk,
-- owner, status and outcome. Findings are advisory (BR-01): a closure always carries an outcome, and a false positive is approved by the auditor.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.bi.p2709', 'Wastage, leakage and duplication detection tower (part 27.09)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS det_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  code TEXT NOT NULL CHECK (code GLOB '[A-Z]*'),
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  query_ref TEXT NOT NULL,
  threshold_json TEXT NOT NULL DEFAULT '{}',
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  request_id INTEGER REFERENCES core_change_requests(id),
  status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status = 'APPROVED'),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  source_type TEXT NOT NULL DEFAULT 'change_request',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER,
  UNIQUE (company_id, code, version)
);
CREATE INDEX IF NOT EXISTS ix_det_rules_company_status ON det_rules(company_id, status);
CREATE INDEX IF NOT EXISTS ix_det_rules_request ON det_rules(request_id);

CREATE TABLE IF NOT EXISTS det_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  doc_no TEXT NOT NULL,
  rule_code TEXT NOT NULL,
  rule_version INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER REFERENCES org_projects(id),
  site_id INTEGER REFERENCES org_sites(id),
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_ref TEXT,
  title TEXT NOT NULL,
  value_at_risk INTEGER NOT NULL DEFAULT 0 CHECK (value_at_risk >= 0),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  owner_id INTEGER REFERENCES iam_users(id),
  owner_user TEXT,
  owner_role TEXT,
  owner_basis TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_REVIEW','PENDING_FP','CLOSED')),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('CONFIRMED_LOSS','PREVENTED','FALSE_POSITIVE')),
  loss_amount INTEGER CHECK (loss_amount IS NULL OR loss_amount >= 0),
  resolution TEXT,
  detected_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  due_at TEXT,
  escalated_at TEXT,
  closed_by TEXT,
  closed_at TEXT,
  task_id INTEGER,
  workflow_instance_id INTEGER,
  requested_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'detection',
  source_id TEXT,
  remarks TEXT,
  UNIQUE (company_id, doc_no),
  UNIQUE (company_id, dedupe_key),
  CHECK (status <> 'CLOSED' OR (outcome IS NOT NULL AND closed_at IS NOT NULL)),
  CHECK (outcome IS NULL OR status = 'CLOSED')
);
CREATE INDEX IF NOT EXISTS ix_det_findings_company_status ON det_findings(company_id, status);
CREATE INDEX IF NOT EXISTS ix_det_findings_project ON det_findings(project_id, status);
CREATE INDEX IF NOT EXISTS ix_det_findings_site ON det_findings(site_id);
CREATE INDEX IF NOT EXISTS ix_det_findings_rule ON det_findings(company_id, rule_code, status);
CREATE INDEX IF NOT EXISTS ix_det_findings_owner ON det_findings(owner_id);
CREATE INDEX IF NOT EXISTS ix_det_findings_owner_user ON det_findings(company_id, owner_user, status);
CREATE INDEX IF NOT EXISTS ix_det_findings_detected ON det_findings(company_id, detected_at);
CREATE INDEX IF NOT EXISTS ix_det_findings_value ON det_findings(company_id, value_at_risk);
CREATE INDEX IF NOT EXISTS ix_det_findings_task ON det_findings(task_id);
CREATE INDEX IF NOT EXISTS ix_det_findings_workflow ON det_findings(workflow_instance_id);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('bi-leakage','g-reports','page','sidebar','Leakage & Controls Tower','रिसाव एवं नियंत्रण टॉवर','/bi/leakage','erp.insights.rb','self','ff.bi.p2709',50,'leakage wastage duplication detection findings controls tower fraud duplicate invoice split po fuel ghost worker idle hire stock ageing',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('bi.leakage','ui','Leakage & Controls Tower','/bi/leakage','/bi/leakage','DASHBOARD','MIGRATED','AUD','27.09','system','2026-11-21T00:00:00.000Z','[]','Tower of detection findings and controls compliance, the findings worklist and the detection rules (configuration).','migration','reference_seed');
INSERT OR IGNORE INTO ui_widgets
  (code,module,title,title_hi,description,type,data_endpoint,permission_key,default_w,default_h,refresh_sec,drill_route,sort_order,created_by,source_type)
VALUES ('bi.leakage_open','bi','Leakage findings open','खुले रिसाव निष्कर्ष','Open detection findings and their value at risk.','kpi','/api/v1/ui/widgets/bi.leakage_open/data','bi.leakage.view',3,1,600,'/bi/leakage',540,'migration','reference_seed');
INSERT OR IGNORE INTO proj_360_widgets
  (company_id,widget_code,module,tab,slot,sort_order,permission_key,owner_part,title,title_hi,created_by,source_type)
VALUES (NULL,'bi.leakage_open','bi','cost','side',97,'bi.leakage.view','27.09','Leakage findings open','खुले रिसाव निष्कर्ष','migration','reference_seed');
INSERT OR IGNORE INTO ntf_templates (company_id, code, category, channel, lang, subject, body, variables_json, template_version, status, created_by, source_type)
VALUES (NULL, 'bi.finding.raised', 'alerts', 'IN_APP', 'en', 'Finding {{findingNo}}: {{rule}}', '{{title}}. Value at risk {{value}}. Review it and record the outcome.', '["findingNo","rule","title","value"]', 1, 'ACTIVE', 'migration', 'reference_seed');
INSERT OR IGNORE INTO ntf_templates (company_id, code, category, channel, lang, subject, body, variables_json, template_version, status, created_by, source_type)
VALUES (NULL, 'bi.finding.escalated', 'alerts', 'IN_APP', 'en', 'Finding {{findingNo}} is overdue', '{{title}} is still open after its due date (owner {{owner}}).', '["findingNo","title","owner"]', 1, 'ACTIVE', 'migration', 'reference_seed');
