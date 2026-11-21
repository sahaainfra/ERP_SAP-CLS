-- Part 28.01: the AI gateway and its governance. Providers are connectors of the integration hub (01.08, type ai; keys in its vault);
-- ai_providers names the model and price of each; ai_features holds the approved enablement of each registered feature (scope, quotas,
-- prompt version, tools; approval SYSADM → DIR); ai_logs records every call with redacted text and context references; ai_controls holds
-- the kill switch and the log retention of a company.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.ai.p2801', 'AI gateway and governance (part 28.01)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS ai_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  code TEXT NOT NULL CHECK (code GLOB '[a-z]*'),
  provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai_compatible', 'sandbox')),
  model TEXT NOT NULL,
  endpoint_ref TEXT NOT NULL,
  price_in_per_mtok INTEGER NOT NULL DEFAULT 0 CHECK (price_in_per_mtok >= 0),
  price_out_per_mtok INTEGER NOT NULL DEFAULT 0 CHECK (price_out_per_mtok >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
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
  site_id INTEGER,
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS ix_ai_providers_company_status ON ai_providers(company_id, status);

CREATE TABLE IF NOT EXISTS ai_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  doc_no TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  provider_code TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  tools_json TEXT NOT NULL DEFAULT '[]',
  enabled_scope_json TEXT NOT NULL DEFAULT '{"roles":[],"projects":"ALL"}',
  quota_json TEXT NOT NULL DEFAULT '{}',
  eval_json TEXT,
  eval_passed_at TEXT,
  version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  parent_id INTEGER REFERENCES ai_features(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','RETURNED','APPROVED','REJECTED','CANCELLED','SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  cancel_reason TEXT,
  reason TEXT,
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
  site_id INTEGER,
  UNIQUE (company_id, doc_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_features_version ON ai_features(company_id, code, version_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ai_features_company_status ON ai_features(company_id, status);
CREATE INDEX IF NOT EXISTS ix_ai_features_parent ON ai_features(parent_id);
CREATE INDEX IF NOT EXISTS ix_ai_features_workflow ON ai_features(workflow_instance_id);

CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  feature_code TEXT NOT NULL,
  feature_version INTEGER,
  provider_code TEXT,
  model TEXT,
  user_id INTEGER REFERENCES iam_users(id),
  user_name TEXT NOT NULL,
  request_ref TEXT NOT NULL,
  prompt_version TEXT,
  context_refs_json TEXT NOT NULL DEFAULT '[]',
  prompt_redacted TEXT,
  response_redacted TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('OK', 'BLOCKED', 'ERROR')),
  block_reason TEXT,
  latency_ms INTEGER,
  redactions INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT 'AI_GENERATED',
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
  site_id INTEGER,
  UNIQUE (company_id, request_ref)
);
CREATE INDEX IF NOT EXISTS ix_ai_logs_company_created ON ai_logs(company_id, created_at);
CREATE INDEX IF NOT EXISTS ix_ai_logs_feature ON ai_logs(company_id, feature_code, created_at);
CREATE INDEX IF NOT EXISTS ix_ai_logs_user ON ai_logs(company_id, user_name, created_at);
CREATE INDEX IF NOT EXISTS ix_ai_logs_user_id ON ai_logs(user_id);
CREATE INDEX IF NOT EXISTS ix_ai_logs_outcome ON ai_logs(company_id, outcome);
CREATE INDEX IF NOT EXISTS ix_ai_logs_project ON ai_logs(project_id);

CREATE TABLE IF NOT EXISTS ai_controls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  kill_switch INTEGER NOT NULL DEFAULT 0 CHECK (kill_switch IN (0,1)),
  kill_reason TEXT,
  kill_by TEXT,
  kill_at TEXT,
  retention_days INTEGER NOT NULL DEFAULT 180 CHECK (retention_days BETWEEN 7 AND 3650),
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
  site_id INTEGER,
  UNIQUE (company_id)
);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('ai-features','g-administration','page','sidebar','AI Features & Enablement','AI सुविधाएं एवं सक्षमता','/ai/features','erp.insights.rb','ai.feature.view','ff.ai.p2801',90,'ai artificial intelligence gateway features enablement kill switch quota usage cost log provider claude model',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('ai.features','ui','AI Features & Enablement','/ai/features','/ai/features','FORM','MIGRATED','SYSADM','28.01','system','2026-11-22T00:00:00.000Z','[]','AI features, providers, enablement approval, kill switch, usage and cost, and the AI log.','migration','reference_seed');
INSERT OR IGNORE INTO ntf_templates (company_id, code, category, channel, lang, subject, body, variables_json, template_version, status, created_by, source_type) VALUES
  (NULL, 'ai.feature.decided', 'approvals', 'IN_APP', 'en', 'AI feature {{ref}}: {{subject}}', '{{detail}} {{link}}', '["ref","subject","detail","link"]', 1, 'ACTIVE', 'migration', 'reference_seed'),
  (NULL, 'ai.quota.alert', 'alerts', 'IN_APP', 'en', 'AI budget of {{feature}} at {{pct}} %', '{{feature}} has used {{spent}} of its monthly budget {{budget}}.', '["feature","pct","spent","budget"]', 1, 'ACTIVE', 'migration', 'reference_seed'),
  (NULL, 'ai.kill_switch', 'security', 'IN_APP', 'en', 'AI {{state}}', 'All AI features were {{state}} by {{actor}}: {{reason}}', '["state","actor","reason"]', 1, 'ACTIVE', 'migration', 'reference_seed');
