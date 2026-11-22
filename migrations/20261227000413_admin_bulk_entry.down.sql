DELETE FROM ui_page_migration WHERE page_code = 'admin.bulk' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'admin-bulk' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS xl_bulk_batches;
DROP TABLE IF EXISTS xl_packs;
DELETE FROM core_feature_flags WHERE key = 'ff.admin.p2904' AND company_id IS NULL AND source_type = 'reference_seed';
