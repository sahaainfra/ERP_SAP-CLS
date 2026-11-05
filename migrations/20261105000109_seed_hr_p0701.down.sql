-- Removes what the 07.01 seed added.
DELETE FROM ui_widgets WHERE code = 'hr.headcount';
DELETE FROM ntf_templates WHERE code IN ('hr.employee.decided', 'hr.employee.document_expiry', 'hr.employee.separated') AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '07.01';
DELETE FROM ui_navigation_entries WHERE code IN ('hr-overview', 'hr-employees', 'hr-employee', 'hr-employee-new');
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0701';
