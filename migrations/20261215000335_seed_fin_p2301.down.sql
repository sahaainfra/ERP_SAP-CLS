DELETE FROM ntf_templates WHERE code IN ('fin.journal.decided','fin.journal.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.01';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-journals','fin-journal-entry','fin-ledger','fin-trial-balance','fin-recurring');
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2301';
