DELETE FROM ntf_templates WHERE code IN ('site.period.closed','site.period.rejected','site.period.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '14.05';
DELETE FROM ui_navigation_entries WHERE code IN ('site-progress','site-progress-report','site-periods','site-client-progress');
DELETE FROM core_feature_flags WHERE key = 'ff.site.p1405';
