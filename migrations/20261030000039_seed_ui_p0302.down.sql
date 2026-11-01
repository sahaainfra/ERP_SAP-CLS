DELETE FROM ui_form_metadata WHERE source_type = 'reference_seed' AND form_code = 'ui.sample_request';
DELETE FROM core_document_types WHERE source_type = 'reference_seed' AND code = 'SAMPLE_MR';
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.ui.p0302';
