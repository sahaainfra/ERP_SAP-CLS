DELETE FROM ntf_templates WHERE code IN ('ai.feature.decided','ai.quota.alert','ai.kill_switch') AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE page_code = 'ai.features' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'ai-features' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS ai_controls;
DROP TABLE IF EXISTS ai_logs;
DROP TABLE IF EXISTS ai_features;
DROP TABLE IF EXISTS ai_providers;
DELETE FROM core_feature_flags WHERE key = 'ff.ai.p2801' AND company_id IS NULL AND source_type = 'reference_seed';
