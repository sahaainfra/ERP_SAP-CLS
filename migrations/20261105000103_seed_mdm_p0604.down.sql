-- Removes what the 06.04 seed added.
DELETE FROM ntf_templates WHERE code IN ('mdm.partner.decided', 'mdm.partner.document_expiry', 'mdm.partner.bank_confirm') AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '06.04';
DELETE FROM ui_navigation_entries WHERE code IN ('mdm-partners', 'mdm-partner', 'mdm-partner-new', 'mdm-partner-approvals');
DELETE FROM core_feature_flags WHERE key = 'ff.mdm.p0604';
