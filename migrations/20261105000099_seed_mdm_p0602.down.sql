-- Removes what the 06.02 seed added (system rows only; a company's own rows stay with their tables, dropped by migration 98's down).
DELETE FROM mdm_lookups WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM mdm_lookup_lists WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM mdm_payment_terms WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM mdm_uoms WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM mdm_tds_sections WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM mdm_hsn_sac WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM mdm_gst_rates WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM mdm_currencies WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM mdm_states WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code = 'mdm.common.decided' AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE page_code LIKE 'admin.master-data.common.%' OR page_code = 'admin.master-data.lookup-manager';
DELETE FROM ui_navigation_entries WHERE code LIKE 'mdm-common-%' OR code = 'mdm-lookup-manager';
DELETE FROM core_feature_flags WHERE key = 'ff.mdm.p0602';
