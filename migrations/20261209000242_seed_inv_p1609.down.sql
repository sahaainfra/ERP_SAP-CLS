DELETE FROM ntf_templates WHERE code IN ('inv.asset.otp','inv.asset.decided','inv.asset.due') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '16.09';
DELETE FROM ui_navigation_entries WHERE code IN ('inv-small-assets','inv-asset-scan','inv-custody');
DELETE FROM core_feature_flags WHERE key = 'ff.inv.p1609';
