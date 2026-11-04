DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '04.06';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('notifications', 'notification-preferences', 'admin-notification-templates', 'admin-notification-deliveries');
DELETE FROM ntf_templates WHERE source_type = 'reference_seed';
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.eng.p0406';
