-- Audit AUD-DEF-019: the Leakage & Controls Tower shows business data and its API requires bi.leakage.view, so its menu entry asks for the
-- same permission (it said 'self', and the menu offered the page to people who would only get an error).
UPDATE ui_navigation_entries SET permission_key = 'bi.leakage.view' WHERE code = 'bi-leakage' AND route = '/bi/leakage' AND permission_key = 'self';
