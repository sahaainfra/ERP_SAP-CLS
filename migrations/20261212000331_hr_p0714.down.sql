-- Part 07.14 down: the dashboard, its widgets, the menu entries, the gates and the flag.
DELETE FROM ui_dashboards WHERE code = 'ov-workforce';
DELETE FROM ui_widgets WHERE code IN ('ov.wf.attendance_today', 'ov.wf.present', 'ov.wf.labour_on_site', 'ov.wf.headcount_by_site', 'ov.wf.overtime', 'ov.wf.leave_liability', 'ov.wf.attrition', 'ov.wf.pending', 'ov.wf.expiring');
DELETE FROM ui_navigation_entries WHERE code IN ('hr-workforce', 'admin-gates');
DROP TABLE IF EXISTS hr_gate_criteria;
DROP TABLE IF EXISTS hr_gates;
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0714';
