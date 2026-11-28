-- PACK-22: a purchase order over a blocking budget is stopped when it is sent for approval (the approved exception first), not at its last
-- approval. Off by default.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.proc.pack22', 'Budget check of a purchase order at submit (PACK-22)', 0, 0, 'migration', 'reference_seed');
