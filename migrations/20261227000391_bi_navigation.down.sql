DELETE FROM ui_page_migration WHERE page_code IN ('bi.reports', 'bi.builder') AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code IN ('bi-report-catalogue', 'bi-report-builder') AND source_type = 'reference_seed';
