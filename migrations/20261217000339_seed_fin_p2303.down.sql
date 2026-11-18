DELETE FROM ntf_templates WHERE code IN ('fin.ap_bill.decided','fin.debit_note.decided','fin.ap.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.03';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-ap-bills','fin-debit-notes','fin-payables');
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2303';
