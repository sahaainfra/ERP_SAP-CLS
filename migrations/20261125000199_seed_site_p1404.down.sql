DELETE FROM ntf_templates WHERE code IN ('site.instruction.notice','site.instruction.approved','site.instruction.rejected','site.instruction.overdue') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '14.04';
DELETE FROM ui_navigation_entries WHERE code IN ('site-instructions','site-instruction-issue');
DELETE FROM core_feature_flags WHERE key = 'ff.site.p1404';
