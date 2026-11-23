-- Part 28.02: the AI assistant and role copilots. Drafts written by AI wait in ai_drafts until the person saves them as a DRAFT record of the
-- target module (or discards them); feedback (thumbs) on any AI answer is kept in ai_feedback for the evaluation of the features.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.ai.p2802', 'AI assistant and role copilots (part 28.02)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS ai_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  log_id INTEGER NOT NULL REFERENCES ai_logs(id),
  kind TEXT NOT NULL CHECK (kind IN ('RFI', 'LETTER', 'RFQ', 'MOM', 'DPR_NARRATIVE', 'MIS_COMMENTARY')),
  owner_user TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_entity TEXT,
  target_id TEXT,
  target_ref TEXT,
  status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPLIED', 'DISCARDED')),
  applied_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'ai_assistant',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER REFERENCES org_projects(id),
  site_id INTEGER,
  CHECK (status <> 'APPLIED' OR (target_entity IS NOT NULL AND target_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_ai_drafts_owner ON ai_drafts(company_id, owner_user, status);
CREATE INDEX IF NOT EXISTS ix_ai_drafts_log ON ai_drafts(log_id);
CREATE INDEX IF NOT EXISTS ix_ai_drafts_company_status ON ai_drafts(company_id, status);
CREATE INDEX IF NOT EXISTS ix_ai_drafts_project ON ai_drafts(project_id);

CREATE TABLE IF NOT EXISTS ai_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  log_id INTEGER NOT NULL REFERENCES ai_logs(id),
  feature_code TEXT NOT NULL,
  user_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating IN (-1, 1)),
  comment TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'ai_assistant',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER,
  UNIQUE (log_id, user_name)
);
CREATE INDEX IF NOT EXISTS ix_ai_feedback_feature ON ai_feedback(company_id, feature_code, rating);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('ai-assistant','g-mywork','page','sidebar','AI Assistant','AI सहायक','/ai/assistant','erp.insights.rb','self','ff.ai.p2802',95,'ai assistant ask question copilot draft letter rfi summary',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('ai.assistant','ui','AI Assistant','/ai/assistant','/ai/assistant','FORM','MIGRATED','SYSADM','28.02','system','2026-11-22T00:00:00.000Z','[]','The assistant panel full page: ask, copilots, drafts and feedback.','migration','reference_seed');
