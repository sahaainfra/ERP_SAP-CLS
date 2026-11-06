DELETE FROM ui_widgets WHERE code = 'trn.certs_expiring';
DELETE FROM ntf_templates WHERE code IN ('trn.decided', 'trn.nominated', 'trn.cert_expiring') AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE page_code IN ('training','training.certifications','training.skills','training.compliance','training.mine','training.setup', 'training.session');
DELETE FROM ui_navigation_entries WHERE code IN ('training-calendar','training-certs','training-skills','training-compliance','training-mine','training-setup');
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0710';
