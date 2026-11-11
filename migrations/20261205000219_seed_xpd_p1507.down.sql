DELETE FROM ntf_templates WHERE code IN ('proc.xpd.delay','proc.xpd.milestone_late','proc.xpd.decided','proc.xpd.irn','proc.xpd.shipment') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '15.07';
DELETE FROM ui_navigation_entries WHERE code IN ('proc-expediting','proc-expediting-plans','proc-inspections','proc-shipments');
DELETE FROM core_feature_flags WHERE key = 'ff.proc.p1507';
