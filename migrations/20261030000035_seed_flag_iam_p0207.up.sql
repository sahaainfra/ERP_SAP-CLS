-- Reference seed (part 02.07): the feature flag, OFF by default and ON in development and test.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
VALUES ('ff.iam.p0207', 'Part 02.07 secure request pipeline, route registry, secrets and security headers', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
SELECT 'ff.iam.p0207', 'Part 02.07 secure request pipeline, route registry, secrets and security headers', 0, env.name, 1, 'migration', 'reference_seed'
FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;
