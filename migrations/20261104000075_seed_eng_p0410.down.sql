DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '04.10';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('documents-register','documents-document','documents-new','admin-document-types');
DELETE FROM ntf_templates WHERE source_type = 'reference_seed' AND code IN ('doc.revision.submitted','doc.revision.issued','doc.distribution.sent','doc.distribution.reminder','doc.document.expiring');
DELETE FROM doc_folder_templates WHERE source_type = 'reference_seed';
DELETE FROM doc_types WHERE source_type = 'reference_seed';
DELETE FROM core_document_types WHERE source_type = 'reference_seed' AND code = 'DMS_DOC';
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.eng.p0410';
