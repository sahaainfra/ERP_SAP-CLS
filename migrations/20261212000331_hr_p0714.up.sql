-- Part 07.14 (HR & workforce dashboards and the Workforce-First Gate), built in 166.6. Written by scripts/p0714_seed.mjs.
-- The flag; the gates G1–G4 of each company (hr_gates) and their criteria (hr_gate_criteria: status, note, reviewer, date; the evidence links come
-- from the catalogue in code); the menu entries; the 9 cards of the workforce dashboard as widgets and its system layout.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type) VALUES ('ff.hr.p0714', 'HR: workforce dashboard and the gates G1–G4 with their sign-off (part 07.14, built in 166.6)', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type) SELECT 'ff.hr.p0714', 'HR: workforce dashboard and the gates G1–G4 with their sign-off (part 07.14, built in 166.6)', 0, env.name, 1, 'migration', 'reference_seed' FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;
CREATE TABLE IF NOT EXISTS hr_gates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code TEXT NOT NULL CHECK (code IN ('G1', 'G2', 'G3', 'G4')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SUBMITTED', 'PASSED', 'RETURNED')),
  catalogue_version TEXT NOT NULL,
  workflow_instance_id INTEGER,
  submitted_by TEXT,
  submitted_at TEXT,
  passed_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at TEXT,
  deleted_by TEXT,
  source_type TEXT,
  source_id TEXT,
  remarks TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_gates_company_code ON hr_gates (company_id, code);
CREATE TABLE IF NOT EXISTS hr_gate_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  gate_id INTEGER NOT NULL REFERENCES hr_gates (id),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  part_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('PART', 'DEFECTS')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'MET', 'NOT_MET')),
  note TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  extra_evidence_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at TEXT,
  deleted_by TEXT,
  source_type TEXT,
  source_id TEXT,
  remarks TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_gate_criteria_gate_code ON hr_gate_criteria (gate_id, code);
CREATE INDEX IF NOT EXISTS ix_hr_gate_criteria_company ON hr_gate_criteria (company_id, status);
INSERT OR IGNORE INTO ui_navigation_entries (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, shortcut, tile, quick_create_label, quick_create_route, created_by, source_type) VALUES ('hr-workforce', 'g-hr', 'page', 'sidebar', 'Workforce Dashboard', 'कार्यबल डैशबोर्ड', '/hr/workforce', 'erp.group.workforce', 'hr.workforce.view', 'ff.hr.p0714', 141, 'workforce attendance today present absent late leave contract labour overtime leave liability attrition expiring documents', 1, 'none', NULL, 0, NULL, NULL, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, shortcut, tile, quick_create_label, quick_create_route, created_by, source_type) VALUES ('admin-gates', 'g-administration', 'page', 'sidebar', 'Programme Gates', 'कार्यक्रम गेट', '/admin/gates', 'erp.state.approved', 'hr.gate.view', 'ff.hr.p0714', 405, 'gate gates sign-off checklist evidence platform workforce baseline execution g1 g2 g3 g4', 1, 'none', NULL, 0, NULL, NULL, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_widgets (code, module, title, description, type, data_endpoint, permission_key, default_w, default_h, refresh_sec, drill_route, sort_order, created_by, source_type) VALUES ('ov.wf.attendance_today', 'hr', 'Attendance today', 'Attendance today, from the Attendance, today''s report and leave. Opens /att/today.', 'bar', '/api/v1/ui/widgets/ov.wf.attendance_today/data', 'hr.workforce.view', 6, 2, 300, '/att/today', 700, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_widgets (code, module, title, description, type, data_endpoint, permission_key, default_w, default_h, refresh_sec, drill_route, sort_order, created_by, source_type) VALUES ('ov.wf.present', 'hr', 'Present today', 'Present today, from the Attendance, today''s report. Opens /att/today.', 'kpi', '/api/v1/ui/widgets/ov.wf.present/data', 'hr.workforce.view', 3, 1, 300, '/att/today', 701, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_widgets (code, module, title, description, type, data_endpoint, permission_key, default_w, default_h, refresh_sec, drill_route, sort_order, created_by, source_type) VALUES ('ov.wf.labour_on_site', 'hr', 'Contract labour on site', 'Contract labour on site, from the Contract labour strength. Opens /labour/contractors.', 'topn', '/api/v1/ui/widgets/ov.wf.labour_on_site/data', 'hr.workforce.view', 3, 2, 300, '/labour/contractors', 702, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_widgets (code, module, title, description, type, data_endpoint, permission_key, default_w, default_h, refresh_sec, drill_route, sort_order, created_by, source_type) VALUES ('ov.wf.headcount_by_site', 'hr', 'Headcount by site', 'Headcount by site, from the HR employee overview. Opens /hr/employees.', 'topn', '/api/v1/ui/widgets/ov.wf.headcount_by_site/data', 'hr.workforce.view', 6, 2, 300, '/hr/employees', 703, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_widgets (code, module, title, description, type, data_endpoint, permission_key, default_w, default_h, refresh_sec, drill_route, sort_order, created_by, source_type) VALUES ('ov.wf.overtime', 'hr', 'Overtime this month', 'Overtime this month, from the Attendance register. Opens /att/register.', 'kpi', '/api/v1/ui/widgets/ov.wf.overtime/data', 'hr.workforce.view', 3, 1, 300, '/att/register', 704, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_widgets (code, module, title, description, type, data_endpoint, permission_key, default_w, default_h, refresh_sec, drill_route, sort_order, created_by, source_type) VALUES ('ov.wf.leave_liability', 'hr', 'Leave liability', 'Leave liability, from the Leave balances. Opens /leave/balances.', 'kpi', '/api/v1/ui/widgets/ov.wf.leave_liability/data', 'hr.workforce.view', 3, 1, 300, '/leave/balances', 705, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_widgets (code, module, title, description, type, data_endpoint, permission_key, default_w, default_h, refresh_sec, drill_route, sort_order, created_by, source_type) VALUES ('ov.wf.attrition', 'hr', 'Attrition', 'Attrition, from the HR employee overview. Opens /hr/employees?filter[status]=SEPARATED.', 'kpi', '/api/v1/ui/widgets/ov.wf.attrition/data', 'hr.workforce.view', 3, 1, 300, '/hr/employees?filter[status]=SEPARATED', 706, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_widgets (code, module, title, description, type, data_endpoint, permission_key, default_w, default_h, refresh_sec, drill_route, sort_order, created_by, source_type) VALUES ('ov.wf.pending', 'hr', 'HR approvals waiting', 'HR approvals waiting, from the My open approvals and tasks. Opens /approvals.', 'todo', '/api/v1/ui/widgets/ov.wf.pending/data', 'hr.workforce.view', 6, 2, 60, '/approvals', 707, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_widgets (code, module, title, description, type, data_endpoint, permission_key, default_w, default_h, refresh_sec, drill_route, sort_order, created_by, source_type) VALUES ('ov.wf.expiring', 'hr', 'Documents expired or expiring', 'Documents expired or expiring, from the HR employee overview and contract labour. Opens /hr/employees.', 'alerts', '/api/v1/ui/widgets/ov.wf.expiring/data', 'hr.workforce.view', 6, 2, 60, '/hr/employees', 708, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_dashboards (company_id, code, name, owner_type, owner_ref, permission_key, layout_json, filters_json, is_default, created_by, source_type) VALUES (NULL, 'ov-workforce', 'Workforce Dashboard', 'system', 'system', 'hr.workforce.view', '[{"id":"c1","widget":"ov.wf.attendance_today","w":6,"h":2},{"id":"c2","widget":"ov.wf.present","w":3,"h":1},{"id":"c3","widget":"ov.wf.labour_on_site","w":3,"h":2},{"id":"c4","widget":"ov.wf.headcount_by_site","w":6,"h":2},{"id":"c5","widget":"ov.wf.overtime","w":3,"h":1},{"id":"c6","widget":"ov.wf.leave_liability","w":3,"h":1},{"id":"c7","widget":"ov.wf.attrition","w":3,"h":1},{"id":"c8","widget":"ov.wf.pending","w":6,"h":2},{"id":"c9","widget":"ov.wf.expiring","w":6,"h":2}]', '{}', 1, 'migration', 'reference_seed');
