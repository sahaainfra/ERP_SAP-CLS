-- Reference seed: flag for part 00.03 (default OFF; ON in development and test).
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
VALUES ('ff.prog.p0003', 'Part 00.03 CI/CD, quality gates and release engineering', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
SELECT 'ff.prog.p0003', 'Part 00.03 CI/CD, quality gates and release engineering', 0, env.name, 1, 'migration', 'reference_seed'
FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;
