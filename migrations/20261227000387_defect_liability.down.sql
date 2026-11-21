DELETE FROM core_feature_flags
WHERE key = 'ff.close.p2603' AND company_id IS NULL AND project_id IS NULL
  AND environment IS NULL AND source_type = 'reference_seed';
