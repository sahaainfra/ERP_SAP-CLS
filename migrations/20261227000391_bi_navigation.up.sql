INSERT OR IGNORE INTO ui_navigation_entries
  (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, created_by, source_type)
VALUES
  ('bi-report-catalogue', 'g-reports', 'page', 'sidebar', 'Report Catalogue', 'रिपोर्ट सूची', '/bi/reports', 'erp.insights.rb', 'self', 'ff.bi.p2701', 30, 'standard report project status export', 1, 'none', 'migration', 'reference_seed'),
  ('bi-report-builder', 'g-reports', 'page', 'sidebar', 'Report Builder', 'रिपोर्ट निर्माता', '/bi/builder', 'erp.insights.rb', 'proj.project.view', 'ff.bi.p2702', 40, 'custom report dataset preview', 1, 'none', 'migration', 'reference_seed');

INSERT OR IGNORE INTO ui_page_migration
  (page_code, module, label, old_route, new_route, page_type, status, owner_role, migrated_in_part, migrated_by, migrated_at, defects_json, notes, created_by, source_type)
VALUES
  ('bi.reports', 'ui', 'Report Catalogue', '/bi/reports', '/bi/reports', 'REPORT', 'MIGRATED', 'SYSADM', '27.01', 'system', '2026-11-21T00:00:00.000Z', '[]', 'Project Status report and exports.', 'migration', 'reference_seed'),
  ('bi.builder', 'ui', 'Report Builder', '/bi/builder', '/bi/builder', 'FORM', 'MIGRATED', 'SYSADM', '27.02', 'system', '2026-11-21T00:00:00.000Z', '[]', 'Project Status dataset previews and saved reports.', 'migration', 'reference_seed');
