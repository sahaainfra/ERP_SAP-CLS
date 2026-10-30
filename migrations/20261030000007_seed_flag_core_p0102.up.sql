-- Reference seed: flag for part 01.02 (default OFF; ON in development and test).
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
VALUES ('ff.core.p0102', 'Part 01.02 database foundation, migration framework and data integrity', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
SELECT 'ff.core.p0102', 'Part 01.02 database foundation, migration framework and data integrity', 0, env.name, 1, 'migration', 'reference_seed'
FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;
