DELETE FROM ntf_templates WHERE code IN ('inv.count.decided','inv.count.due','inv.scrap.decided','inv.expiry.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '16.06';
DELETE FROM ui_navigation_entries WHERE code IN ('inv-count-plans','inv-blind-count','inv-count-variance','inv-scrap');
DELETE FROM core_feature_flags WHERE key = 'ff.inv.p1606';
