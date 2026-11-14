DELETE FROM ntf_templates WHERE code IN ('ctr.sub.alert','ctr.sub_waiver.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '21.04';
DELETE FROM ui_navigation_entries WHERE code IN ('ctr-subcontractors','ctr-sub-compliance','ctr-sub-strength');
DELETE FROM core_feature_flags WHERE key = 'ff.ctr.p2104';
