-- Part 29.01: the Super Admin Enterprise Control Center. Configuration change requests use the shared approval engine (core_change_requests,
-- types admin_config_change and admin_emergency_ratify). adm_controls holds the company's emergency read-only mode; adm_emergency_actions logs
-- every emergency control with its 24-hour ratification; adm_config_snapshots keeps configuration exports with their checksum.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.admin.p2901', 'Super Admin Enterprise Control Center (part 29.01)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS adm_controls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL UNIQUE REFERENCES org_companies(id),
  read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0,1)),
  read_only_reason TEXT,
  read_only_by TEXT,
  read_only_at TEXT,
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

CREATE TABLE IF NOT EXISTS adm_emergency_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  action TEXT NOT NULL CHECK (action IN ('READ_ONLY_ON', 'READ_ONLY_OFF', 'FEATURE_KILL', 'FORCE_LOGOUT')),
  reason TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  executed_by TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  ratify_due TEXT NOT NULL,
  ratification_request_id INTEGER REFERENCES core_change_requests(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RATIFIED')),
  ratified_by TEXT,
  ratified_at TEXT,
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
CREATE INDEX IF NOT EXISTS ix_adm_emergency_company ON adm_emergency_actions(company_id, status, ratify_due);
CREATE INDEX IF NOT EXISTS ix_adm_emergency_request ON adm_emergency_actions(ratification_request_id);

CREATE TABLE IF NOT EXISTS adm_config_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  environment TEXT NOT NULL,
  taken_at TEXT NOT NULL,
  checksum TEXT NOT NULL,
  content_json TEXT NOT NULL,
  file_id INTEGER REFERENCES core_files(id),
  note TEXT,
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
CREATE INDEX IF NOT EXISTS ix_adm_snapshots_company ON adm_config_snapshots(company_id, taken_at);
CREATE INDEX IF NOT EXISTS ix_adm_snapshots_file ON adm_config_snapshots(file_id);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('admin-control','g-administration','page','sidebar','Enterprise Control Center','एंटरप्राइज़ नियंत्रण केंद्र','/admin/control','erp.insights.rb','adm.control.view','ff.admin.p2901',1,'admin control center governance maker checker change request emergency read only kill switch force logout snapshot diff onboarding',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.control','ui','Enterprise Control Center','/admin/control','/admin/control','DASHBOARD','MIGRATED','SYSADM','29.01','system','2026-11-22T00:00:00.000Z','[]','Governance dashboard, admin change approvals, emergency controls, configuration export/import with diff, onboarding checklist.','migration','reference_seed');
