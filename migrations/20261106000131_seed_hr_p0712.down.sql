DELETE FROM ui_widgets WHERE code = 'exp.claims_to_pass';
DELETE FROM ntf_templates WHERE code IN ('exp.decided', 'exp.recovery') AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '07.12';
DELETE FROM ui_navigation_entries WHERE code IN ('exp-my','exp-claim-new','exp-travel','exp-advance','exp-approvals','exp-analysis','exp-policies');
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0712';
