DELETE FROM ntf_templates WHERE code IN ('bill.advance.decided','bill.release.decided','bill.retention.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '22.07';
DELETE FROM ui_navigation_entries WHERE code IN ('bill-retention','bill-advances','bill-releases');
DELETE FROM core_feature_flags WHERE key = 'ff.bill.p2207';
