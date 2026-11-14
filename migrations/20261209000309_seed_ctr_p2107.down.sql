DELETE FROM ntf_templates WHERE code IN ('ctr.escalation.decided','ctr.ld.alert','ctr.pvc.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '21.07';
DELETE FROM ui_navigation_entries WHERE code IN ('ctr-pvc','ctr-escalations','ctr-ld-exposure');
DELETE FROM core_feature_flags WHERE key = 'ff.ctr.p2107';
