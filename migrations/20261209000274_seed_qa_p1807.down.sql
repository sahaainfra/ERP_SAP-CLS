DELETE FROM ntf_templates WHERE code IN ('qa.rating.published') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '18.07';
DELETE FROM ui_navigation_entries WHERE code IN ('qa-dashboard','qa-control-charts','qa-ratings');
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p1807';
DELETE FROM ui_widgets WHERE code IN ('qa.first_time_ir', 'qa.open_ncr');
