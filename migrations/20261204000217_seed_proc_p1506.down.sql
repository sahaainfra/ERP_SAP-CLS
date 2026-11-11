DELETE FROM ntf_templates WHERE code IN ('proc.rc.consumption','proc.rc.expiry','proc.rc.pv_due','proc.rc.decided','proc.so.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '15.06';
DELETE FROM ui_navigation_entries WHERE code IN ('proc-rate-contracts','proc-service-orders','proc-service-entries');
DELETE FROM core_feature_flags WHERE key = 'ff.proc.p1506';
