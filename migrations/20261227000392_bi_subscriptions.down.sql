DELETE FROM ui_page_migration WHERE page_code IN ('bi.subscriptions', 'bi.usage') AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code IN ('bi-report-subscriptions', 'bi-report-usage') AND source_type = 'reference_seed';
DELETE FROM ntf_templates
WHERE code = 'bi.report.ready' AND source_type = 'reference_seed' AND company_id IS NULL;
DELETE FROM core_jobs WHERE type = 'bi.subscriptions';
DELETE FROM core_schedules WHERE code = 'bi.subscriptions';
DROP TABLE IF EXISTS rpt_runs;
DROP TABLE IF EXISTS rpt_subscriptions;
