-- Navigation registry correction (found by the regression of part 10.06, D-424): seven menu entries carried a permission different from the page they open, so the menu showed
-- a page to people the page refuses, or hid it from people the page admits. Each entry now carries the page's own permission (the page is the guard; the registry follows it).
UPDATE ui_navigation_entries SET permission_key = 'att.punch.own' WHERE code = 'att-punch' AND permission_key = 'self';
UPDATE ui_navigation_entries SET permission_key = 'att.register.view' WHERE code = 'att-approvals' AND permission_key = 'hr.regularisation.view';
UPDATE ui_navigation_entries SET permission_key = 'att.register.view' WHERE code = 'att-lock' AND permission_key = 'att.period.lock';
UPDATE ui_navigation_entries SET permission_key = 'hr.claim.view' WHERE code = 'exp-claim-new' AND permission_key = 'hr.claim.create';
UPDATE ui_navigation_entries SET permission_key = 'hr.travel_request.view' WHERE code = 'exp-travel' AND permission_key = 'hr.travel_request.create';
UPDATE ui_navigation_entries SET permission_key = 'hr.advance.view' WHERE code = 'exp-advance' AND permission_key = 'hr.advance.create';
UPDATE ui_navigation_entries SET permission_key = 'proj.boq.import' WHERE code = 'proj-boq-import' AND permission_key = 'proj.version.view';
-- The self-service list of one's own disciplinary cases (part 07.13) had a page and no menu entry.
INSERT OR IGNORE INTO ui_navigation_entries (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, shortcut, tile, quick_create_label, quick_create_route, created_by, source_type) VALUES ('disciplinary-mine', 'g-hr', 'page', 'sidebar', 'My Disciplinary Cases', 'मेरे अनुशासनात्मक मामले', '/disciplinary/mine', 'erp.group.workforce', 'hr.separation.view', 'ff.hr.p0713', 266, 'my disciplinary cases notice reply hearing', 1, 'none', NULL, 0, NULL, NULL, 'migration', 'reference_seed');
