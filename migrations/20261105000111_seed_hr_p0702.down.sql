DELETE FROM ntf_templates WHERE code IN ('hr.recruit.decided', 'hr.recruit.offer_response', 'hr.recruit.onboarding_due') AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '07.02';
DELETE FROM ui_navigation_entries WHERE code IN ('hr-requisitions', 'hr-requisition', 'hr-requisition-new', 'hr-pipeline', 'hr-candidate', 'hr-offers', 'hr-offer', 'hr-onboarding');
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0702';
