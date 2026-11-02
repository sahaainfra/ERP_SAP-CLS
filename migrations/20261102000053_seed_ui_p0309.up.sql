-- Reference seed (part 03.09): the feature flag (OFF by default, ON in development and test) and the Translations page in the navigation registry.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
VALUES ('ff.ui.p0309', 'Part 03.09 localisation, Indian formats and accessibility', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
SELECT 'ff.ui.p0309', 'Part 03.09 localisation, Indian formats and accessibility', 0, env.name, 1, 'migration', 'reference_seed'
FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;
INSERT OR IGNORE INTO ui_navigation_entries (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, shortcut, tile, created_by, source_type) VALUES ('admin-translations', 'g-administration', 'page', 'sidebar', 'Translations', 'अनुवाद', '/admin/translations', 'erp.action.edit', 'ui.translation.manage', 'ff.ui.p0309', 36, 'translations hindi english language strings text wording missing keys', 1, 'none', NULL, 1, 'migration', 'reference_seed');
