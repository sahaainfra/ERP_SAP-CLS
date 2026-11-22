DELETE FROM ntf_templates WHERE code = 'ai.model.decided' AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE page_code = 'ai.forecasts' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'ai-forecasts' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS aif_anomalies;
DROP TABLE IF EXISTS aif_forecasts;
DROP TABLE IF EXISTS aif_models;
DELETE FROM core_feature_flags WHERE key = 'ff.ai.p2803' AND company_id IS NULL AND source_type = 'reference_seed';
