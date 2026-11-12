DELETE FROM ntf_templates WHERE code IN ('inv.grn.decided','inv.grn.inspection','inv.rtv.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '16.03';
DELETE FROM ui_navigation_entries WHERE code IN ('inv-grn-new','inv-grns','inv-rtvs');
DELETE FROM core_feature_flags WHERE key = 'ff.inv.p1603';
