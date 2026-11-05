-- Removes what the 06.03 seed added (the system categories; a company's own rows are dropped with the tables by migration 100's down).
DELETE FROM mdm_item_categories WHERE company_id IS NULL AND source_type = 'reference_seed' AND parent_id IS NOT NULL;
DELETE FROM mdm_item_categories WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code = 'mdm.item.decided' AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '06.03';
DELETE FROM ui_navigation_entries WHERE code IN ('mdm-items', 'mdm-item', 'mdm-item-new', 'mdm-item-categories', 'mdm-item-migration');
DELETE FROM core_feature_flags WHERE key = 'ff.mdm.p0603';
