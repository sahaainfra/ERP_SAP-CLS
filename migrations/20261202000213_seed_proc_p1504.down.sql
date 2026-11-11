DELETE FROM ntf_templates WHERE code IN ('proc.cs.approved','proc.cs.rejected','proc.cs.returned') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '15.04';
DELETE FROM ui_navigation_entries WHERE code = 'proc-comparative-statements';
DELETE FROM core_feature_flags WHERE key = 'ff.proc.p1504';
