DELETE FROM ntf_templates WHERE code IN ('inv.mrc.generated','inv.mrc.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '16.10';
DELETE FROM ui_navigation_entries WHERE code IN ('inv-reconciliations','inv-wastage-trend');
DELETE FROM core_feature_flags WHERE key = 'ff.inv.p1610';
