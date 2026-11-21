-- Part 27.07: monthly closing protocol of a project, Project MIS and Budget Master.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.bi.p2707', 'Monthly closing protocol, Project MIS and Budget Master (part 27.07)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS mc_monthly_closes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  doc_no TEXT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES org_projects(id),
  period TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  period_id INTEGER REFERENCES core_periods(id),
  version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  parent_close_id INTEGER REFERENCES mc_monthly_closes(id),
  checklist_json TEXT,
  mis_json TEXT,
  budget_master_json TEXT,
  mis_file_id INTEGER REFERENCES core_files(id),
  snapshot_at TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','RETURNED','APPROVED','REJECTED','CANCELLED','SUPERSEDED')),
  lock_state TEXT NOT NULL DEFAULT 'OPEN' CHECK (lock_state IN ('OPEN','LOCKED','SUPERSEDED')),
  locked_at TEXT,
  workflow_instance_id INTEGER,
  requested_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  reason TEXT,
  created_by TEXT NOT NULL,
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
  UNIQUE (company_id, doc_no),
  CHECK (lock_state <> 'LOCKED' OR (status = 'APPROVED' AND locked_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mc_monthly_closes_active ON mc_monthly_closes(company_id, project_id, period, version_no) WHERE deleted_at IS NULL AND status NOT IN ('CANCELLED','REJECTED');
CREATE INDEX IF NOT EXISTS ix_mc_monthly_closes_company_status ON mc_monthly_closes(company_id, status);
CREATE INDEX IF NOT EXISTS ix_mc_monthly_closes_project ON mc_monthly_closes(project_id, period, lock_state);
CREATE INDEX IF NOT EXISTS ix_mc_monthly_closes_period ON mc_monthly_closes(company_id, period);
CREATE INDEX IF NOT EXISTS ix_mc_monthly_closes_period_id ON mc_monthly_closes(period_id);
CREATE INDEX IF NOT EXISTS ix_mc_monthly_closes_parent ON mc_monthly_closes(parent_close_id);
CREATE INDEX IF NOT EXISTS ix_mc_monthly_closes_file ON mc_monthly_closes(mis_file_id);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('bi-monthly-close','g-reports','page','sidebar','Monthly Close Status','मासिक समापन स्थिति','/bi/monthly-close','erp.insights.rb','bi.monthly_close.view','ff.bi.p2707',48,'monthly close protocol project mis budget master lock checklist',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('bi.monthly-close','ui','Monthly Close Status','/bi/monthly-close','/bi/monthly-close','WORKLIST','MIGRATED','PD','27.07','system','2026-11-21T00:00:00.000Z','[]','Board of project monthly closes, the close record, Project MIS and Budget Master.','migration','reference_seed');
INSERT OR IGNORE INTO ntf_templates (company_id, code, category, channel, lang, subject, body, variables_json, template_version, status, created_by, source_type)
VALUES (NULL, 'bi.monthly_close.decided', 'approvals', 'IN_APP', 'en', 'Monthly close {{ref}}: {{subject}}', '{detail} {link}', '["ref","subject","detail","link"]', 1, 'ACTIVE', 'migration', 'reference_seed');
