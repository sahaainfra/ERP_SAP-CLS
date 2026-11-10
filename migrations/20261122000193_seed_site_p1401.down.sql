DELETE FROM ntf_templates WHERE code IN ('site.wa.approved', 'site.wa.rejected', 'site.wa.regularise') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '14.01';
DELETE FROM ui_navigation_entries WHERE code IN ('site-board', 'site-was', 'site-daily', 'site-wa-mobile');
DELETE FROM core_feature_flags WHERE key = 'ff.site.p1401';
