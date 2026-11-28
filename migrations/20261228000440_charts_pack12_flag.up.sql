-- PACK-12: charts say what they show in their accessible summary, draw long lines (over 400 points) without a mark per point, and build
-- their "View as table" rows only when it is opened. Off by default; turned on per company after review.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.charts.pack12', 'Chart summaries, dense lines and lazy tables (PACK-12)', 0, 0, 'migration', 'reference_seed');
