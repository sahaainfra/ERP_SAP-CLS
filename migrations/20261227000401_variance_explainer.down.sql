DELETE FROM proj_360_widgets WHERE widget_code = 'bi.why_cost' AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ui_widgets WHERE code = 'bi.why_cost' AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE page_code = 'bi.explain' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'bi-explain' AND source_type = 'reference_seed';
DELETE FROM core_feature_flags WHERE key = 'ff.bi.p2708' AND company_id IS NULL AND source_type = 'reference_seed';
