DELETE FROM ntf_templates WHERE code IN ('hse.security.alert','hse.roster.decided','hse.security_incident.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '19.06';
DELETE FROM ui_navigation_entries WHERE code IN ('scy-visitor','scy-visitors','scy-patrol','scy-patrol-report','scy-roster','scy-incidents','scy-posts');
DELETE FROM core_feature_flags WHERE key = 'ff.hse.p1906';
