-- Part 30.03: page-by-page completion audit. tst_page_audit holds each audit of a page: the route crawl (per viewport), the static scan of
-- its source and the manual exploratory test by a role (the 13 points of the Page Completion Checklist, defects, evidence files);
-- tst_page_audit_runs groups the automated audits of one crawl or scan.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.qa.p3003', 'Page-by-page completion audit (part 30.03)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS tst_page_audit_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  run_no TEXT NOT NULL,
  run_kind TEXT NOT NULL CHECK (run_kind IN ('CRAWL', 'STATIC')),
  viewport TEXT CHECK (viewport IS NULL OR viewport IN ('desktop', 'mobile')),
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'DONE', 'FAILED')),
  pages_count INTEGER NOT NULL DEFAULT 0 CHECK (pages_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  started_at TEXT NOT NULL,
  finished_at TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tst_page_audit_runs_no ON tst_page_audit_runs(company_id, run_no);
CREATE INDEX IF NOT EXISTS ix_tst_page_audit_runs_kind ON tst_page_audit_runs(company_id, run_kind, id);
CREATE INDEX IF NOT EXISTS ix_tst_page_audit_runs_status ON tst_page_audit_runs(company_id, status);

CREATE TABLE IF NOT EXISTS tst_page_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  page_code TEXT NOT NULL,
  route TEXT NOT NULL,
  audit_kind TEXT NOT NULL CHECK (audit_kind IN ('CRAWL', 'STATIC', 'MANUAL')),
  viewport TEXT CHECK (viewport IS NULL OR viewport IN ('desktop', 'mobile')),
  role_tested TEXT NOT NULL,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  defects_json TEXT NOT NULL DEFAULT '[]',
  evidence_file_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL')),
  notes TEXT,
  run_id INTEGER REFERENCES tst_page_audit_runs(id),
  tested_by TEXT NOT NULL,
  tested_at TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_tst_page_audit_page ON tst_page_audit(company_id, page_code, audit_kind, id);
CREATE INDEX IF NOT EXISTS ix_tst_page_audit_status ON tst_page_audit(company_id, status);
CREATE INDEX IF NOT EXISTS ix_tst_page_audit_run ON tst_page_audit(run_id);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('tst-page-audit','g-administration','page','sidebar','Page Completion Audit','पृष्ठ पूर्णता ऑडिट','/admin/page-audit','erp.insights.rb','tst.page_audit.view','ff.qa.p3003',22,'page completion audit checklist placeholder crawler dead link button handler go-live technical console',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.page-audit','ui','Page Completion Audit','/admin/page-audit','/admin/page-audit','REPORT','MIGRATED','ITADM','30.03','system','2026-11-23T00:00:00.000Z','[]','Every page against the Page Completion Checklist: crawl, static scan and manual audits by role (technical console).','migration','reference_seed');

-- The page inventory names each page by its route (pageCode: the route without its first slash, slashes as dots); two rows seeded by 29.05 and
-- 29.08 used other codes, so the tracker and the registry disagreed (tests/migration-api.test.js). Corrected here, reversed by the down migration.
UPDATE ui_page_migration SET page_code = 'admin.data-migration' WHERE page_code = 'admin.data_migration' AND source_type = 'reference_seed';
UPDATE ui_page_migration SET page_code = 'help' WHERE page_code = 'help.raise' AND source_type = 'reference_seed';
