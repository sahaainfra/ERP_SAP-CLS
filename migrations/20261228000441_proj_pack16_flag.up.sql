-- PACK-16: a cost committed to a project still in set-up is a budget-check warning (ADR-783), and the project portfolio filters by state,
-- client, type and stage. Off by default; turned on per company after review.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.proj.pack16', 'Set-up warning on commitments and portfolio filters (PACK-16)', 0, 0, 'migration', 'reference_seed');
