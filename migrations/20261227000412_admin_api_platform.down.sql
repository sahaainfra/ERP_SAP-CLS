DELETE FROM ui_page_migration WHERE page_code = 'admin.api' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'admin-api' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS api_usage;
DROP TABLE IF EXISTS api_webhook_deliveries;
DROP TABLE IF EXISTS api_webhooks;
DROP TABLE IF EXISTS api_tokens;
DROP TABLE IF EXISTS api_clients;
DELETE FROM core_feature_flags WHERE key = 'ff.admin.p2903' AND company_id IS NULL AND source_type = 'reference_seed';
