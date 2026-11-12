DELETE FROM ntf_templates WHERE code IN ('inv.transfer.decided','inv.transfer.dispatched','inv.transfer.discrepancy','inv.transfer.aged') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '16.05';
DELETE FROM ui_navigation_entries WHERE code IN ('inv-transfers','inv-transfer-new','inv-transfer-receive','inv-in-transit');
DELETE FROM core_feature_flags WHERE key = 'ff.inv.p1605';
