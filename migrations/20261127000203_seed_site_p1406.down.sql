DELETE FROM ntf_templates WHERE code IN ('site.productivity.low','site.productivity.norm_approved','site.productivity.norm_rejected') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '14.06';
DELETE FROM ui_navigation_entries WHERE code IN ('site-productivity','site-productivity-report','site-productivity-norms','site-productivity-records');
DELETE FROM core_feature_flags WHERE key = 'ff.site.p1406';
