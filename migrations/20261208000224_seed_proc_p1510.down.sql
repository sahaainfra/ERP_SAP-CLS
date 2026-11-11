DELETE FROM ui_page_migration WHERE migrated_in_part = '15.10';
DELETE FROM ui_navigation_entries WHERE code IN ('proc-dashboard','proc-spend-analysis','proc-cycle-time','proc-compliance');
DELETE FROM core_feature_flags WHERE key = 'ff.proc.p1510';
