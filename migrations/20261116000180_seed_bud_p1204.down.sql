DELETE FROM ntf_templates WHERE code IN ('bud.dept.approved', 'bud.dept.rejected', 'bud.alloc.posted') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '12.04';
DELETE FROM ui_navigation_entries WHERE code IN ('bud-dept', 'bud-dept-report', 'bud-alloc');
DELETE FROM core_feature_flags WHERE key = 'ff.bud.p1204';
