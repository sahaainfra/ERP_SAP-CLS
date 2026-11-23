DELETE FROM ui_page_migration WHERE page_code = 'admin.reconciliation-health' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'tst-reconciliation-health' AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code = 'tst.recon.alert' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS tst_recon_results;
DROP TABLE IF EXISTS tst_recon_runs;
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p3002' AND company_id IS NULL AND source_type = 'reference_seed';
