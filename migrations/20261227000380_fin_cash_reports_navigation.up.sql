-- Align the seeded navigation permission with the existing Cash Reports route.
UPDATE ui_navigation_entries SET permission_key = 'fin.cash_curve.view'
WHERE code = 'fin-cash-reports' AND permission_key = 'fin.cash_forecast.view' AND source_type = 'reference_seed';
