DELETE FROM core_feature_flags
WHERE key = 'ff.portal.p2504' AND company_id IS NULL AND environment IS NULL AND source_type = 'reference_seed';
