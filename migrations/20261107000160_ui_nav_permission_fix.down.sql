UPDATE ui_navigation_entries SET permission_key = 'self' WHERE code = 'att-punch' AND permission_key = 'att.punch.own';
UPDATE ui_navigation_entries SET permission_key = 'hr.regularisation.view' WHERE code = 'att-approvals' AND permission_key = 'att.register.view';
UPDATE ui_navigation_entries SET permission_key = 'att.period.lock' WHERE code = 'att-lock' AND permission_key = 'att.register.view';
UPDATE ui_navigation_entries SET permission_key = 'hr.claim.create' WHERE code = 'exp-claim-new' AND permission_key = 'hr.claim.view';
UPDATE ui_navigation_entries SET permission_key = 'hr.travel_request.create' WHERE code = 'exp-travel' AND permission_key = 'hr.travel_request.view';
UPDATE ui_navigation_entries SET permission_key = 'hr.advance.create' WHERE code = 'exp-advance' AND permission_key = 'hr.advance.view';
UPDATE ui_navigation_entries SET permission_key = 'proj.version.view' WHERE code = 'proj-boq-import' AND permission_key = 'proj.boq.import';
DELETE FROM ui_navigation_entries WHERE code = 'disciplinary-mine' AND source_type = 'reference_seed';
