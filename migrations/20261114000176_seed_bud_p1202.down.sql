DELETE FROM ntf_templates WHERE code IN ('bud.change.approved', 'bud.change.variation_draft') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '12.02';
DELETE FROM ui_navigation_entries WHERE code IN ('bud-changes', 'bud-compare');
DELETE FROM core_feature_flags WHERE key = 'ff.bud.p1202';
