DELETE FROM ntf_templates WHERE code IN ('ctr.security.alert','ctr.bank_guarantee.decided','ctr.insurance.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '21.02';
DELETE FROM ui_navigation_entries WHERE code IN ('ctr-bank-guarantees','ctr-insurances','ctr-securities');
DELETE FROM core_feature_flags WHERE key = 'ff.ctr.p2102';
