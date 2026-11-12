DELETE FROM ntf_templates WHERE code IN ('inv.gate.decided','inv.gate.flag','inv.pass.overdue') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '16.02';
DELETE FROM ui_navigation_entries WHERE code IN ('inv-gate-entry','inv-gate-exit','inv-gate-register','inv-gate-passes','inv-gate-pass');
DELETE FROM core_feature_flags WHERE key = 'ff.inv.p1602';
