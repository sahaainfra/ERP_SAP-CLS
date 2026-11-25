DELETE FROM ui_page_migration WHERE page_code IN ('close.commissioning', 'close.commissioning-system', 'close.test-packs', 'close.certificates') AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code IN ('close-commissioning', 'close-test-packs', 'close-certificates', 'g-closeout') AND source_type = 'reference_seed';
DROP TABLE IF EXISTS tnc_certificates;
DROP TABLE IF EXISTS tnc_punch_links;
DROP TABLE IF EXISTS tnc_test_packs;
DROP TABLE IF EXISTS tnc_checksheets;
DROP TABLE IF EXISTS tnc_tags;
DROP TABLE IF EXISTS tnc_systems;
