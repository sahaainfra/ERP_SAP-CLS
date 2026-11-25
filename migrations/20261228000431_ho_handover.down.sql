DELETE FROM ui_page_migration WHERE page_code IN ('close.handovers', 'close.handover', 'close.client-assets') AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code IN ('close-handovers', 'close-client-assets') AND source_type = 'reference_seed';
DROP TABLE IF EXISTS ho_client_assets;
DROP TABLE IF EXISTS ho_checklist_items;
DROP TABLE IF EXISTS ho_handovers;
