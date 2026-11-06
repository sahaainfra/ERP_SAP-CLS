DELETE FROM ui_widgets WHERE code = 'bd.tender_deadlines';
DELETE FROM ntf_templates WHERE code = 'bd.tender.reminder' AND company_id IS NULL;
DELETE FROM doc_types WHERE code = 'TENDER_DOCUMENT' AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '08.02';
DELETE FROM ui_navigation_entries WHERE code IN ('bd-tender-dashboard','bd-tenders','bd-bid-decisions','bd-tender-calendar');
DELETE FROM core_feature_flags WHERE key = 'ff.bd.p0802';
