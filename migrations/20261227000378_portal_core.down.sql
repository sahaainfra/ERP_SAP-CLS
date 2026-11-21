DROP TABLE IF EXISTS ptl_sessions;
DROP TABLE IF EXISTS ptl_accounts;
DELETE FROM core_feature_flags WHERE key = 'ff.portal.p2501';
DELETE FROM ui_navigation_entries WHERE code IN ('admin-portal-users', 'admin-portal-invite') AND source_type = 'ptl_p2501';
DELETE FROM ui_page_migration WHERE page_code IN ('admin.portal-users', 'admin.portal-invite') AND source_type = 'ptl_p2501';
