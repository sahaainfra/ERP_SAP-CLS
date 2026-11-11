DELETE FROM ntf_templates WHERE code IN ('site.dpr.approved', 'site.dpr.rejected', 'site.dpr.daily') AND source_type = 'reference_seed';
DELETE FROM ui_widgets WHERE code = 'site.dpr_compliance';
DELETE FROM ui_page_migration WHERE migrated_in_part = '14.02';
DELETE FROM ui_navigation_entries WHERE code IN ('site-dpr-entry','site-dprs','site-dpr-report','site-dpr-compliance');
DELETE FROM core_feature_flags WHERE key = 'ff.site.p1402';
