-- Removes what the 06.05 seed added (the template rows; the companies' own rows go with the tables in migration 104's down).
DELETE FROM fin_cost_codes WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM fin_cost_heads WHERE company_id IS NULL AND source_type = 'reference_seed' AND parent_id IS NOT NULL;
DELETE FROM fin_cost_heads WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM fin_dimension_rules WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM fin_accounts WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM fin_account_groups WHERE company_id IS NULL AND source_type = 'reference_seed' AND parent_id IS NOT NULL;
DELETE FROM fin_account_groups WHERE company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code = 'fin.master.decided' AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '06.05';
DELETE FROM ui_navigation_entries WHERE code IN ('fin-coa', 'fin-account', 'fin-cost-codes', 'fin-category-mapping');
DELETE FROM core_feature_flags WHERE key = 'ff.mdm.p0605';
