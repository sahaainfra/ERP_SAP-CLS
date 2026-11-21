DELETE FROM ui_widgets WHERE code = 'bi.project_count' AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code IN ('bi.snapshot.ready', 'bi.metric.decided') AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE page_code = 'bi.metrics' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'bi-metric-catalogue' AND source_type = 'reference_seed';
DELETE FROM core_jobs WHERE type = 'bi.project_snapshot';
DELETE FROM core_schedules WHERE code = 'bi.project_snapshot';
DROP TABLE IF EXISTS bi_project_snapshots;
DROP TABLE IF EXISTS bi_refresh_log;
DROP TABLE IF EXISTS bi_metrics;
