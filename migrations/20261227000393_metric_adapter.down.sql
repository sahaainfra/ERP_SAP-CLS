DELETE FROM core_feature_flags
WHERE key = 'ff.bi.p2703' AND company_id IS NULL AND project_id IS NULL
  AND environment IS NULL AND source_type = 'reference_seed';
