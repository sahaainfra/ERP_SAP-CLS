UPDATE ui_navigation_entries SET permission_key = 'fin.cash_forecast.view'
WHERE code = 'fin-cash-reports' AND permission_key = 'fin.cash_curve.view' AND source_type = 'reference_seed';
