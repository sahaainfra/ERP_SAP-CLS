-- Reference seed (part 03.06): the feature flag (OFF by default, ON in development and test), the two new pages in the navigation registry
-- (Field Home and Scanner) and the tiles of the field home. Other parts add their tiles when they register a page: Punch (07.05), DPR (14.02),
-- Inspections (18.02), Messages (05.01).
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
VALUES ('ff.ui.p0306', 'Part 03.06 responsive layouts, installable app and device capabilities', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
SELECT 'ff.ui.p0306', 'Part 03.06 responsive layouts, installable app and device capabilities', 0, env.name, 1, 'migration', 'reference_seed'
FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;
INSERT OR IGNORE INTO ui_navigation_entries (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, shortcut, tile, created_by, source_type)
VALUES ('field-home', 'g-site', 'page', 'sidebar', 'Field Home', 'फील्ड होम', '/field', 'erp.field.field', 'self', 'ff.ui.p0306', 10, 'field site quick actions punch dpr scan offline', 1, 'none', 'k', 1, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, shortcut, tile, created_by, source_type)
VALUES ('field-scan', 'g-site', 'page', 'sidebar', 'Scan', 'स्कैन', '/field/scan', 'erp.action.scan', 'self', 'ff.ui.p0306', 20, 'scan qr barcode code camera item asset grn badge', 1, 'none', 'q', 1, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_field_tiles (code, nav_code, label, label_hi, sort_order, created_by, source_type) VALUES ('material-request', 'admin-sample-requests', 'Material Request', 'सामग्री अनुरोध', 20, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_field_tiles (code, nav_code, label, label_hi, sort_order, created_by, source_type) VALUES ('scan', 'field-scan', 'Scan', 'स्कैन', 40, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_field_tiles (code, nav_code, label, label_hi, sort_order, created_by, source_type) VALUES ('approvals', 'admin-approvals', 'Approvals', 'स्वीकृतियाँ', 60, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_field_tiles (code, nav_code, label, label_hi, sort_order, created_by, source_type) VALUES ('drafts', 'account-drafts', 'My Drafts', 'मेरे ड्राफ़्ट', 80, 'migration', 'reference_seed');
