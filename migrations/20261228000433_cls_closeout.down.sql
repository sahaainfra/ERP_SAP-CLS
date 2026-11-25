DELETE FROM ui_page_migration WHERE page_code IN ('close.closures', 'close.closure', 'close.lessons', 'close.benchmarks') AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code IN ('close-closures', 'close-lessons', 'close-benchmarks') AND source_type = 'reference_seed';
DROP TABLE IF EXISTS kb_benchmarks;
DROP TABLE IF EXISTS kb_lessons;
DROP TABLE IF EXISTS cls_checklist_items;
DROP TABLE IF EXISTS cls_closures;
