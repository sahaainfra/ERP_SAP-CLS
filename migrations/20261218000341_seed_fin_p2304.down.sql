DELETE FROM ntf_templates WHERE code IN ('fin.payment.decided','fin.payment.advice','fin.payment.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.04';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-payment-proposals','fin-payments','fin-bank-accounts');
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2304';
