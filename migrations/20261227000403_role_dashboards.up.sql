-- Part 27.10: role dashboards consolidation. No new table: the role dashboard is a dashboard of the 03.07 framework (code role-dashboard) whose
-- per-role layouts live in code (bi/role-dashboards.js); eight widgets fill the gaps of FR-02; seven older widgets that duplicate an overview card
-- of 166.5 are retired (is_active = 0; an alias keeps saved layouts working); the inventory page is a technical console report.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.bi.p2710', 'Role dashboards consolidation and the dashboard inventory (part 27.10)', 0, 0, 'migration', 'reference_seed');

INSERT OR IGNORE INTO ui_widgets (code,module,title,title_hi,description,type,data_endpoint,permission_key,default_w,default_h,refresh_sec,drill_route,sort_order,created_by,source_type) VALUES
  ('site.wa_today','site','Work authorisations today','आज के कार्य प्राधिकरण','Work authorisations planned for today, waiting for approval and emergency ones.','kpi','/api/v1/ui/widgets/site.wa_today/data','site.work_authorisation.view',3,1,300,'/site/work-authorisations',600,'migration','reference_seed'),
  ('proc.mr_open','proc','Material requests open','खुले सामग्री अनुरोध','Open material requests, those past the required date and those waiting for approval.','kpi','/api/v1/ui/widgets/proc.mr_open/data','proc.material_request.view',3,1,300,'/proc/material-requests',601,'migration','reference_seed'),
  ('engg.rfi_open','engg','RFIs open','खुले RFI','Open requests for information, overdue ones and those holding work.','kpi','/api/v1/ui/widgets/engg.rfi_open/data','engg.rfi.view',3,1,600,'/engg/rfis',602,'migration','reference_seed'),
  ('inv.grn_pending','inv','GRNs awaiting approval','अनुमोदन हेतु GRN','Goods receipts waiting for approval and their value.','kpi','/api/v1/ui/widgets/inv.grn_pending/data','inv.grn.view',3,1,300,'/inv/grns',603,'migration','reference_seed'),
  ('inv.issues_today','inv','Material issued today','आज जारी सामग्री','Material issues of today and their value.','kpi','/api/v1/ui/widgets/inv.issues_today/data','inv.issue.view',3,1,300,'/inv/issues',604,'migration','reference_seed'),
  ('fin.payments_due','fin','Payments due in 7 days','7 दिनों में देय भुगतान','Approved vendor bills due within a week and the overdue part.','kpi','/api/v1/ui/widgets/fin.payments_due/data','fin.bill.view',3,1,600,'/finance/ap-bills',605,'migration','reference_seed'),
  ('fin.bank_unmatched','fin','Bank lines not reconciled','असमायोजित बैंक प्रविष्टियां','Bank statement lines not yet matched.','kpi','/api/v1/ui/widgets/fin.bank_unmatched/data','fin.bank_statement.view',3,1,600,'/finance/bank-reconciliation',606,'migration','reference_seed'),
  ('fin.close_tasks','fin','Month-close tasks open','खुले मासिक समापन कार्य','Mandatory tasks open in the month close in progress.','kpi','/api/v1/ui/widgets/fin.close_tasks/data','fin.period.view',3,1,600,'/finance/period-close',607,'migration','reference_seed');

UPDATE ui_widgets SET is_active = 0, updated_by = 'migration', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), remarks = 'Retired by 27.10: duplicates ov.qs.certified_not_billed' WHERE code = 'bill.certified_not_billed' AND is_active = 1;
UPDATE ui_widgets SET is_active = 0, updated_by = 'migration', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), remarks = 'Retired by 27.10: duplicates ov.qs.unbilled_wip' WHERE code = 'bill.unbilled_wip' AND is_active = 1;
UPDATE ui_widgets SET is_active = 0, updated_by = 'migration', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), remarks = 'Retired by 27.10: duplicates ov.hse.ltifr' WHERE code = 'hse.ltifr' AND is_active = 1;
UPDATE ui_widgets SET is_active = 0, updated_by = 'migration', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), remarks = 'Retired by 27.10: duplicates ov.hse.safe_hours' WHERE code = 'hse.safe_manhours' AND is_active = 1;
UPDATE ui_widgets SET is_active = 0, updated_by = 'migration', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), remarks = 'Retired by 27.10: duplicates ov.qa.first_time_ir' WHERE code = 'qa.first_time_ir' AND is_active = 1;
UPDATE ui_widgets SET is_active = 0, updated_by = 'migration', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), remarks = 'Retired by 27.10: duplicates ov.qa.open_ncr' WHERE code = 'qa.open_ncr' AND is_active = 1;
UPDATE ui_widgets SET is_active = 0, updated_by = 'migration', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), remarks = 'Retired by 27.10: duplicates ov.hr.headcount' WHERE code = 'hr.headcount' AND is_active = 1;

INSERT OR IGNORE INTO ui_dashboards (company_id, code, name, owner_type, owner_ref, permission_key, layout_json, filters_json, is_default, created_by, source_type)
VALUES (NULL, 'role-dashboard', 'My role dashboard', 'system', 'system', 'self', '[{"id":"r1","widget":"ov.todo.mine","w":6,"h":2},{"id":"r2","widget":"ov.feed.notifications","w":6,"h":2}]', '{}', 1, 'migration', 'reference_seed');

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type) VALUES
  ('bi-role-dashboard','g-reports','page','sidebar','My Role Dashboard','मेरा भूमिका डैशबोर्ड','/bi/role-dashboard','erp.insights.rb','self','ff.bi.p2710',10,'role dashboard home kpi my work today',1,'none','migration','reference_seed'),
  ('bi-dashboard-inventory','g-reports','page','sidebar','Dashboard Inventory','डैशबोर्ड सूची','/bi/dashboard-inventory','erp.insights.rb','bi.dashboard_inventory.view','ff.bi.p2710',51,'dashboard inventory widgets technical console duplicates hard coded scan',0,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type) VALUES
  ('bi.role-dashboard','ui','My Role Dashboard','/bi/role-dashboard','/bi/role-dashboard','DASHBOARD','MIGRATED','SYSADM','27.10','system','2026-11-21T00:00:00.000Z','[]','The default dashboard of each role of the catalogue on the 03.07 framework.','migration','reference_seed'),
  ('bi.dashboard-inventory','ui','Dashboard Inventory','/bi/dashboard-inventory','/bi/dashboard-inventory','REPORT','MIGRATED','SYSADM','27.10','system','2026-11-21T00:00:00.000Z','[]','Every widget and dashboard with its source, use and status, and the scan for hard-coded figures.','migration','reference_seed');
