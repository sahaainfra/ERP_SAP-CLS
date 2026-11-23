DELETE FROM ui_page_migration WHERE page_code = 'admin.backups' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'admin-backups' AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code = 'admin.backup.alert' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS ops_restore_requests;
DROP TABLE IF EXISTS ops_backup_alerts;
DROP TABLE IF EXISTS ops_restore_tests;
DROP TABLE IF EXISTS ops_backups;
DELETE FROM core_feature_flags WHERE key = 'ff.admin.p2906' AND company_id IS NULL AND source_type = 'reference_seed';
