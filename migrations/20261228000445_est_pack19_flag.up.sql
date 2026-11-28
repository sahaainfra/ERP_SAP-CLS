-- PACK-19: "Show calculation" on a rate analysis (the stored traces of ra.line_amount and ra.unit_rate) and the bar bending schedule checks
-- of this pack. Off by default; turned on per company after review.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.est.pack19', 'Rate analysis calculation trace on screen (PACK-19)', 0, 0, 'migration', 'reference_seed');
