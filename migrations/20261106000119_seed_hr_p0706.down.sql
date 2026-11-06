DELETE FROM ntf_templates WHERE code = 'att.reg.decided' AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '07.06';
DELETE FROM ui_navigation_entries WHERE code IN ('att-register','att-daily','att-regularise','att-overtime','att-approvals','att-lock');
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0706';
