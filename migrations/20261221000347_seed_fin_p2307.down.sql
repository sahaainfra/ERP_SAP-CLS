DELETE FROM ntf_templates WHERE code IN ('fin.gst.decided','fin.gst.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '23.07';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-einvoices','fin-eway-bills','fin-gst-settings');
DELETE FROM core_feature_flags WHERE key = 'ff.fin.p2307';
