-- Part 27.08: "Why?" variance explainability and drill-down navigation. No new table: the explainer reads the owners' facts (14.07, 22.09, 04.14).
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.bi.p2708', '"Why?" variance explainability and drill-down navigation (part 27.08)', 0, 0, 'migration', 'reference_seed');

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('bi-explain','g-reports','page','sidebar','Variance Explainer','विचलन विश्लेषक','/bi/explain','erp.insights.rb','bi.explain.view','ff.bi.p2708',49,'why variance explain drill down cost overrun schedule margin bridge waterfall breadcrumb',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('bi.explain','ui','Variance Explainer','/bi/explain','/bi/explain','DASHBOARD','MIGRATED','PM','27.08','system','2026-11-21T00:00:00.000Z','[]','Why? waterfall and contributors of cost, schedule and margin variance, and the drill-down breadcrumb from company to audit trail.','migration','reference_seed');
INSERT OR IGNORE INTO ui_widgets
  (code,module,title,title_hi,description,type,data_endpoint,permission_key,default_w,default_h,refresh_sec,drill_route,sort_order,created_by,source_type)
VALUES ('bi.why_cost','bi','Why? cost variance','क्यों? लागत विचलन','Cost variance of the project and its largest component.','kpi','/api/v1/ui/widgets/bi.why_cost/data','bi.explain.view',3,1,600,'/bi/explain',530,'migration','reference_seed');
INSERT OR IGNORE INTO proj_360_widgets
  (company_id,widget_code,module,tab,slot,sort_order,permission_key,owner_part,title,title_hi,created_by,source_type)
VALUES (NULL,'bi.why_cost','bi','cost','main',96,'bi.explain.view','27.08','Why? cost variance','क्यों? लागत विचलन','migration','reference_seed');
