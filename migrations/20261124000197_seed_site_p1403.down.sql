DELETE FROM ntf_templates WHERE code IN ('site.hindrance.approved', 'site.hindrance.rejected', 'site.hindrance.escalated', 'site.weather.shutdown') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '14.03';
DELETE FROM ui_navigation_entries WHERE code IN ('site-weather','site-hindrances','site-diary','site-visitors');
DELETE FROM core_feature_flags WHERE key = 'ff.site.p1403';
