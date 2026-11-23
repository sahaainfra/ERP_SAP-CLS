-- Part 30.09: user manuals and the documentation package. man_captures is each capture of the screens of the build (Playwright), with the
-- comparison against the accepted baseline (FR-03 drift); man_screens each captured screen (route, viewport, signature of what it shows, image);
-- man_packages each generated package (PDF and DOCX of every manual in one ZIP); man_manuals each manual of a package (per role, per module,
-- the guides, quick reference cards and sandbox exercises), its owner and its approval.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.qa.p3009', 'User manuals and documentation package (part 30.09)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS man_captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  capture_no TEXT NOT NULL,
  build_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPARED', 'ACCEPTED', 'SUPERSEDED')),
  baseline_id INTEGER REFERENCES man_captures(id),
  screens_count INTEGER NOT NULL DEFAULT 0 CHECK (screens_count >= 0),
  same_count INTEGER NOT NULL DEFAULT 0 CHECK (same_count >= 0),
  changed_count INTEGER NOT NULL DEFAULT 0 CHECK (changed_count >= 0),
  new_count INTEGER NOT NULL DEFAULT 0 CHECK (new_count >= 0),
  removed_count INTEGER NOT NULL DEFAULT 0 CHECK (removed_count >= 0),
  removed_json TEXT NOT NULL DEFAULT '[]',
  compared_at TEXT,
  accepted_by TEXT,
  accepted_at TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_man_captures_no ON man_captures(company_id, capture_no);
CREATE INDEX IF NOT EXISTS ix_man_captures_status ON man_captures(company_id, status);
CREATE INDEX IF NOT EXISTS ix_man_captures_baseline ON man_captures(baseline_id);

CREATE TABLE IF NOT EXISTS man_screens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  capture_id INTEGER NOT NULL REFERENCES man_captures(id),
  route TEXT NOT NULL,
  viewport TEXT NOT NULL CHECK (viewport IN ('DESKTOP', 'MOBILE')),
  role_code TEXT,
  title TEXT,
  signature_hash TEXT NOT NULL,
  signature_json TEXT NOT NULL,
  image_path TEXT,
  image_sha256 TEXT,
  image_bytes INTEGER CHECK (image_bytes IS NULL OR image_bytes >= 0),
  drift TEXT NOT NULL DEFAULT 'NEW' CHECK (drift IN ('SAME', 'CHANGED', 'NEW')),
  diff_json TEXT,
  captured_at TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_man_screens_route ON man_screens(capture_id, route, viewport);
CREATE INDEX IF NOT EXISTS ix_man_screens_company ON man_screens(company_id, route);
CREATE INDEX IF NOT EXISTS ix_man_screens_drift ON man_screens(capture_id, drift);

CREATE TABLE IF NOT EXISTS man_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  package_no TEXT NOT NULL,
  build_id TEXT NOT NULL,
  version_label TEXT,
  capture_id INTEGER REFERENCES man_captures(id),
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'GENERATING', 'READY', 'FAILED', 'APPROVED', 'SUPERSEDED')),
  zip_path TEXT,
  zip_sha256 TEXT,
  zip_bytes INTEGER CHECK (zip_bytes IS NULL OR zip_bytes >= 0),
  manuals_count INTEGER NOT NULL DEFAULT 0 CHECK (manuals_count >= 0),
  files_count INTEGER NOT NULL DEFAULT 0 CHECK (files_count >= 0),
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  error TEXT,
  requested_by TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_man_packages_no ON man_packages(company_id, package_no);
CREATE INDEX IF NOT EXISTS ix_man_packages_status ON man_packages(company_id, status);
CREATE INDEX IF NOT EXISTS ix_man_packages_capture ON man_packages(capture_id);

CREATE TABLE IF NOT EXISTS man_manuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  package_id INTEGER NOT NULL REFERENCES man_packages(id),
  code TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ROLE', 'MODULE', 'GUIDE', 'QUICKREF', 'EXERCISES')),
  role_or_module TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'hi')),
  title TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  build_id TEXT NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no >= 1),
  content_hash TEXT NOT NULL,
  sections_count INTEGER NOT NULL DEFAULT 0 CHECK (sections_count >= 0),
  pages_count INTEGER NOT NULL DEFAULT 0 CHECK (pages_count >= 0),
  screens_count INTEGER NOT NULL DEFAULT 0 CHECK (screens_count >= 0),
  routes_json TEXT NOT NULL DEFAULT '[]',
  files_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'STALE', 'SUPERSEDED')),
  stale_reason TEXT,
  request_id INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_man_manuals_code ON man_manuals(company_id, code, version_no);
CREATE INDEX IF NOT EXISTS ix_man_manuals_package ON man_manuals(package_id);
CREATE INDEX IF NOT EXISTS ix_man_manuals_list ON man_manuals(company_id, kind, status);
CREATE INDEX IF NOT EXISTS ix_man_manuals_owner ON man_manuals(company_id, owner_role, status);
CREATE INDEX IF NOT EXISTS ix_man_manuals_request ON man_manuals(request_id);

INSERT OR IGNORE INTO ntf_templates (code,category,channel,lang,subject,body,variables_json,status,created_by,source_type) VALUES
  ('man.manual.review','approvals','IN_APP','en','Manual to approve: {{title}}','{{title}} of build {{build}} waits for your approval in the Documentation Library.','["title","build"]','ACTIVE','migration','reference_seed'),
  ('man.package.ready','system','IN_APP','en','Documentation package {{packageNo}} is ready','{{manuals}} manuals as PDF and DOCX, build {{build}}.','["packageNo","manuals","build"]','ACTIVE','migration','reference_seed'),
  ('man.drift.flagged','system','IN_APP','en','{{changed}} screens changed since the manuals','Capture {{captureNo}}: {{changed}} changed, {{added}} new, {{removed}} removed; {{stale}} manuals need regenerating.','["captureNo","changed","added","removed","stale"]','ACTIVE','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('help-documentation','g-administration','page','sidebar','Documentation Library','दस्तावेज़ पुस्तकालय','/help/documentation','erp.insights.rb','hd.ticket.raise','ff.qa.p3009',9,'documentation library manual user guide role module administrator installation api import report security recovery quick reference training exercises pdf docx zip',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('help.documentation','ui','Documentation Library','/help/documentation','/help/documentation','LIST','MIGRATED','ITADM','30.09','system','2026-11-24T00:00:00.000Z','[]','Role and module manuals, guides, quick reference cards and exercises as PDF and DOCX; the drift check of the screens; approvals by the owners.','migration','reference_seed');
