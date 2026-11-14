DELETE FROM ntf_templates WHERE code IN ('qa.snag.assigned','qa.snag.verified') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '18.06';
DELETE FROM ui_navigation_entries WHERE code IN ('qa-snag-walk','qa-snags','qa-snag-status','qa-snag-report');
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p1806';
