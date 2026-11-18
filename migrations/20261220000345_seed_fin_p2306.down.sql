DELETE FROM ntf_templates WHERE code IN ('fin.cash.decided','fin.cash.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.06';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-bank-reconciliation','fin-imprest','fin-cash-position');
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2306';
