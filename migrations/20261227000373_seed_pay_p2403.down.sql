DELETE FROM pay_statutory_params WHERE doc_no = 'SYS/MIN_WAGE/ALL/2025-11-21' AND source_type = 'reference_seed';
UPDATE pay_statutory_params SET params_json = '{"multiplier": 2}', legal_ref = replace(legal_ref, '; OSH Code, 2020 s.25 (8 hours a day with a rest interval)', '') WHERE doc_no = 'SYS/OT/ALL/2025-11-21' AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code IN ('pay.wage_run.decided', 'pay.wage_check.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '24.03';
DELETE FROM ui_navigation_entries WHERE code IN ('pay-wage-runs', 'pay-wage-register', 'pay-wage-checks');
DELETE FROM core_feature_flags WHERE key = 'ff.pay.p2403';
