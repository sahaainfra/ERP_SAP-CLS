DELETE FROM ntf_templates WHERE code IN ('proc.vnd.reeval','proc.vnd.suspend','proc.vnd.decided','proc.vnd.action') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '15.08';
DELETE FROM ui_navigation_entries WHERE code IN ('proc-prequalifications','proc-avl','proc-vendor-scorecards','proc-vendor-ranking');
DELETE FROM core_feature_flags WHERE key = 'ff.proc.p1508';
