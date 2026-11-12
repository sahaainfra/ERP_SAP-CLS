DELETE FROM ntf_templates WHERE code IN ('inv.store.decided','inv.integrity','inv.adjustment.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '16.01';
DELETE FROM ui_navigation_entries WHERE code IN ('inv-dashboard','inv-stores','inv-balances','inv-ledger','inv-valuation','inv-adjustments','inv-posting');
DELETE FROM core_feature_flags WHERE key = 'ff.inv.p1601';
