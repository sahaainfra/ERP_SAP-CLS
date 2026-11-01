DELETE FROM ui_required_documents WHERE source_type = 'reference_seed' AND doc_type = 'SAMPLE_MR';
DELETE FROM ui_reason_codes WHERE source_type = 'reference_seed';
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.ui.p0304';
