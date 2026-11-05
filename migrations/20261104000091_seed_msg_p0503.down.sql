DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '05.03';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND (code IN ('secure-policy', 'secure-licences', 'secure-safety') OR route IN ('/admin/secure-messaging', '/admin/licences', '/collab/safety-number'));
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.msg.p0503';
