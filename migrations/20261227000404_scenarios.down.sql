DELETE FROM ntf_templates WHERE code = 'bi.scenario.shared' AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE page_code = 'bi.scenarios' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'bi-scenarios' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS scn_scenarios;
DELETE FROM core_feature_flags WHERE key = 'ff.bi.p2711' AND company_id IS NULL AND source_type = 'reference_seed';
