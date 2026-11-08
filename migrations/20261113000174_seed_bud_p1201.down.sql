DELETE FROM ntf_templates WHERE code IN ('bud.budget.approved', 'bud.budget.margin_warning') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '12.01';
DELETE FROM ui_navigation_entries WHERE code IN ('bud-budgets', 'bud-generate', 'g-bud');
DELETE FROM core_feature_flags WHERE key = 'ff.bud.p1201';
