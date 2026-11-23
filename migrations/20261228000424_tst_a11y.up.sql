-- Part 30.07: accessibility, responsive and device validation. tst_devices is the device and browser matrix (phones, tablets, desktop
-- browsers; emulated or real); tst_a11y_runs is each sweep or journey run (axe and responsive sweeps of every page at one width and theme,
-- device journeys, screen-reader sessions); tst_a11y_results is what one page or journey showed in a run, with its issues and their fix
-- and re-test.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.qa.p3007', 'Accessibility, responsive and device validation (part 30.07)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS tst_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies(id),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  device_class TEXT NOT NULL CHECK (device_class IN ('PHONE', 'TABLET', 'DESKTOP')),
  os TEXT NOT NULL,
  browser TEXT NOT NULL,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  ram_gb NUMERIC(18,3),
  cpu_slowdown INTEGER NOT NULL DEFAULT 1 CHECK (cpu_slowdown >= 1),
  network TEXT NOT NULL DEFAULT 'FAST' CHECK (network IN ('FAST', 'FAST_3G', 'SLOW_3G', 'OFFLINE')),
  automation TEXT NOT NULL CHECK (automation IN ('EMULATED', 'MANUAL')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tst_devices_code ON tst_devices(COALESCE(company_id, 0), code);
CREATE INDEX IF NOT EXISTS ix_tst_devices_status ON tst_devices(company_id, status);

CREATE TABLE IF NOT EXISTS tst_a11y_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  run_no TEXT NOT NULL,
  run_kind TEXT NOT NULL CHECK (run_kind IN ('AXE', 'RESPONSIVE', 'DEVICE', 'SCREEN_READER')),
  device_id INTEGER REFERENCES tst_devices(id),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'high-contrast')),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi', 'te')),
  network TEXT NOT NULL DEFAULT 'FAST' CHECK (network IN ('FAST', 'FAST_3G', 'SLOW_3G', 'OFFLINE')),
  assistive_tech TEXT,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'DONE')),
  items_count INTEGER NOT NULL DEFAULT 0 CHECK (items_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  serious_count INTEGER NOT NULL DEFAULT 0 CHECK (serious_count >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tst_a11y_runs_no ON tst_a11y_runs(company_id, run_no);
CREATE INDEX IF NOT EXISTS ix_tst_a11y_runs_kind ON tst_a11y_runs(company_id, run_kind, id);
CREATE INDEX IF NOT EXISTS ix_tst_a11y_runs_status ON tst_a11y_runs(company_id, status);
CREATE INDEX IF NOT EXISTS ix_tst_a11y_runs_device ON tst_a11y_runs(device_id);

CREATE TABLE IF NOT EXISTS tst_a11y_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  run_id INTEGER NOT NULL REFERENCES tst_a11y_runs(id),
  page_code TEXT,
  route TEXT,
  journey TEXT,
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL', 'ERROR')),
  critical_count INTEGER NOT NULL DEFAULT 0 CHECK (critical_count >= 0),
  serious_count INTEGER NOT NULL DEFAULT 0 CHECK (serious_count >= 0),
  moderate_count INTEGER NOT NULL DEFAULT 0 CHECK (moderate_count >= 0),
  minor_count INTEGER NOT NULL DEFAULT 0 CHECK (minor_count >= 0),
  violations_json TEXT NOT NULL DEFAULT '[]',
  overflow_px INTEGER NOT NULL DEFAULT 0 CHECK (overflow_px >= 0),
  small_targets INTEGER NOT NULL DEFAULT 0 CHECK (small_targets >= 0),
  tiny_inputs INTEGER NOT NULL DEFAULT 0 CHECK (tiny_inputs >= 0),
  load_ms INTEGER CHECK (load_ms IS NULL OR load_ms >= 0),
  steps_json TEXT,
  notes TEXT,
  issue_status TEXT NOT NULL DEFAULT 'NONE' CHECK (issue_status IN ('NONE', 'OPEN', 'FIXED', 'RETESTED')),
  fixed_in TEXT,
  fixed_by TEXT,
  fixed_at TEXT,
  retested_run_id INTEGER REFERENCES tst_a11y_runs(id),
  retested_at TEXT,
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
CREATE INDEX IF NOT EXISTS ix_tst_a11y_results_run ON tst_a11y_results(run_id, status);
CREATE INDEX IF NOT EXISTS ix_tst_a11y_results_page ON tst_a11y_results(company_id, page_code, id);
CREATE INDEX IF NOT EXISTS ix_tst_a11y_results_issue ON tst_a11y_results(company_id, issue_status);
CREATE INDEX IF NOT EXISTS ix_tst_a11y_results_retest ON tst_a11y_results(retested_run_id);

-- the device and browser matrix (FR-01): what CI emulates in Chromium on every sweep, and what a tester runs by hand on the real thing
INSERT OR IGNORE INTO tst_devices (company_id, code, label, device_class, os, browser, width, height, ram_gb, cpu_slowdown, network, automation, sort_order, created_by, source_type) VALUES
  (NULL, 'android-low', 'Low-end Android phone (2 GB RAM)', 'PHONE', 'Android 11', 'Chrome 110+', 360, 640, 2, 6, 'SLOW_3G', 'EMULATED', 10, 'migration', 'reference_seed'),
  (NULL, 'android-mid', 'Mid-range Android phone', 'PHONE', 'Android 14', 'Chrome', 393, 851, 6, 2, 'FAST_3G', 'EMULATED', 20, 'migration', 'reference_seed'),
  (NULL, 'iphone-se', 'iPhone SE size', 'PHONE', 'iOS 17', 'Safari', 375, 667, 3, 2, 'FAST_3G', 'EMULATED', 30, 'migration', 'reference_seed'),
  (NULL, 'tablet-10', '10-inch tablet', 'TABLET', 'Android 14', 'Chrome', 800, 1280, 4, 2, 'FAST', 'EMULATED', 40, 'migration', 'reference_seed'),
  (NULL, 'desktop-1280', 'Desktop 1280 px', 'DESKTOP', 'Windows 11', 'Chrome / Edge', 1280, 800, 8, 1, 'FAST', 'EMULATED', 50, 'migration', 'reference_seed'),
  (NULL, 'desktop-1920', 'Desktop 1920 px', 'DESKTOP', 'Windows 11', 'Chrome / Edge', 1920, 1080, 16, 1, 'FAST', 'EMULATED', 60, 'migration', 'reference_seed'),
  (NULL, 'android-real', 'Real low-end Android phone on site', 'PHONE', 'Android 11', 'Chrome 110+', 360, 640, 2, 1, 'SLOW_3G', 'MANUAL', 70, 'migration', 'reference_seed'),
  (NULL, 'iphone-real', 'Real iPhone', 'PHONE', 'iOS 17', 'Safari', 375, 667, 3, 1, 'FAST_3G', 'MANUAL', 80, 'migration', 'reference_seed'),
  (NULL, 'firefox-desktop', 'Firefox desktop', 'DESKTOP', 'Windows 11', 'Firefox', 1280, 800, 8, 1, 'FAST', 'MANUAL', 90, 'migration', 'reference_seed'),
  (NULL, 'safari-desktop', 'Safari desktop', 'DESKTOP', 'macOS 14', 'Safari', 1280, 800, 8, 1, 'FAST', 'MANUAL', 100, 'migration', 'reference_seed');

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('tst-a11y-validation','g-administration','page','sidebar','Accessibility & Device Validation','सुगम्यता और डिवाइस सत्यापन','/admin/accessibility-validation','erp.insights.rb','tst.a11y.view','ff.qa.p3007',26,'accessibility wcag axe screen reader nvda voiceover responsive device matrix android iphone tablet offline throttled hindi telugu validation',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.accessibility-validation','ui','Accessibility & Device Validation','/admin/accessibility-validation','/admin/accessibility-validation','REPORT','MIGRATED','ITADM','30.07','system','2026-11-24T00:00:00.000Z','[]','Axe and responsive sweeps of every page, device journeys and screen-reader sessions, issues fixed and re-tested, the sign-off.','migration','reference_seed');
