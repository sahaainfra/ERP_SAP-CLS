DELETE FROM ui_page_migration WHERE page_code = 'admin.integration-matrix' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'tst-integration-matrix' AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code IN ('tst.probe.delivered', 'tst.check.completed') AND source_type = 'reference_seed';
DROP TABLE IF EXISTS tst_latency_probes;
DROP TABLE IF EXISTS tst_integration_runs;
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p3001' AND company_id IS NULL AND source_type = 'reference_seed';
