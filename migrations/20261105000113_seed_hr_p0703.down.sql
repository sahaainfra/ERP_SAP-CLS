DELETE FROM ui_widgets WHERE code = 'hr.deployed';
DELETE FROM ntf_templates WHERE code IN ('hr.deploy.decided', 'hr.deploy.posted') AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '07.03';
DELETE FROM ui_navigation_entries WHERE code IN ('hr-deployment-board','hr-deployments','hr-deployment','hr-deployment-new','hr-crews','hr-crew','hr-transfers','hr-transfer','hr-transfer-new');
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0703';
