DELETE FROM ntf_templates WHERE code IN ('inv.rta.overdue','inv.rta.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '16.08';
DELETE FROM ui_navigation_entries WHERE code IN ('inv-rta','inv-rta-movements','inv-rta-issue','inv-rta-hire');
DELETE FROM core_feature_flags WHERE key = 'ff.inv.p1608';
