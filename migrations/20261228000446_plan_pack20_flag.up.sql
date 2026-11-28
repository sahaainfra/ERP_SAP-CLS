-- PACK-20: the S-curve with planned value, earned value and the actual cost of the closed periods, and Gantt rows of 44 px on a touch
-- screen. Off by default; turned on per company after review.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.plan.pack20', 'S-curve PV/EV/AC and touch-size Gantt rows (PACK-20)', 0, 0, 'migration', 'reference_seed');
