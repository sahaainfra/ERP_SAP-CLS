DELETE FROM ui_page_migration WHERE page_code IN ('bi.role-dashboard','bi.dashboard-inventory') AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code IN ('bi-role-dashboard','bi-dashboard-inventory') AND source_type = 'reference_seed';
DELETE FROM ui_dashboards WHERE code = 'role-dashboard' AND source_type = 'reference_seed';
UPDATE ui_widgets SET is_active = 1, remarks = NULL WHERE code IN ('bill.certified_not_billed','bill.unbilled_wip','hse.ltifr','hse.safe_manhours','qa.first_time_ir','qa.open_ncr','hr.headcount') AND remarks LIKE 'Retired by 27.10%';
DELETE FROM ui_widgets WHERE code IN ('site.wa_today','proc.mr_open','engg.rfi_open','inv.grn_pending','inv.issues_today','fin.payments_due','fin.bank_unmatched','fin.close_tasks') AND source_type = 'reference_seed';
DELETE FROM core_feature_flags WHERE key = 'ff.bi.p2710' AND company_id IS NULL AND source_type = 'reference_seed';
