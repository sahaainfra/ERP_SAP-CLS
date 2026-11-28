-- PACK-21: a schedule written as MS Project XML carries the current approved baseline of its project as baseline 0. Off by default.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.plan.pack21', 'Approved baseline written into MS Project XML exports (PACK-21)', 0, 0, 'migration', 'reference_seed');
