DELETE FROM core_document_types WHERE source_type = 'reference_seed' AND code = 'SAMPLE_DOC';
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.core.p0103';
