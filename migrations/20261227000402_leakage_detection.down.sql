DELETE FROM ntf_templates WHERE code IN ('bi.finding.raised','bi.finding.escalated') AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM proj_360_widgets WHERE widget_code = 'bi.leakage_open' AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ui_widgets WHERE code = 'bi.leakage_open' AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE page_code = 'bi.leakage' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'bi-leakage' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS det_findings;
DROP TABLE IF EXISTS det_rules;
DELETE FROM core_feature_flags WHERE key = 'ff.bi.p2709' AND company_id IS NULL AND source_type = 'reference_seed';
