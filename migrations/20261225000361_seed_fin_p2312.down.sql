DELETE FROM pl_structure WHERE source_type = 'reference_seed_p2312';
DELETE FROM ntf_templates WHERE code IN ('fin.pl.decided', 'fin.pl.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.12';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-project-pl', 'fin-profitability');
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2312';
