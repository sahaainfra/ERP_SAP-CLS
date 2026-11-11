DELETE FROM ui_page_migration WHERE migrated_in_part = '15.09';
DELETE FROM ui_navigation_entries WHERE code IN ('proc-rate-intelligence','proc-rate-exposure','proc-rate-survey');
DELETE FROM core_feature_flags WHERE key = 'ff.proc.p1509';
