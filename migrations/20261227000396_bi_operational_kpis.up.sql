INSERT OR IGNORE INTO ui_widgets
  (code,module,title,title_hi,description,type,data_endpoint,permission_key,default_w,default_h,refresh_sec,drill_route,sort_order,created_by,source_type)
VALUES
  ('bi.dso','bi','Certified days sales outstanding','प्रमाणित प्राप्य दिवस','Days sales outstanding for the selected project.','kpi','/api/v1/ui/widgets/bi.dso/data','fin.invoice.view',3,1,120,'/bi/metrics',515,'migration','reference_seed'),
  ('bi.stock_turns','bi','Certified stock turns','प्रमाणित स्टॉक आवर्तन','Annualised stock turns for the selected project.','kpi','/api/v1/ui/widgets/bi.stock_turns/data','inv.dashboard.view',3,1,120,'/bi/metrics',516,'migration','reference_seed'),
  ('bi.ltifr','bi','Certified lost-time injury frequency rate','प्रमाणित चोट आवृत्ति दर','Lost-time injury frequency for the selected project.','kpi','/api/v1/ui/widgets/bi.ltifr/data','hse.dashboard.view',3,1,120,'/bi/metrics',517,'migration','reference_seed');

INSERT OR IGNORE INTO proj_360_widgets
  (company_id,widget_code,module,tab,slot,sort_order,permission_key,owner_part,title,title_hi,created_by,source_type)
VALUES
  (NULL,'bi.dso','bi','commercial','main',90,'fin.invoice.view','27.03','Certified days sales outstanding','प्रमाणित प्राप्य दिवस','migration','reference_seed'),
  (NULL,'bi.stock_turns','bi','resources','main',90,'inv.dashboard.view','27.03','Certified stock turns','प्रमाणित स्टॉक आवर्तन','migration','reference_seed'),
  (NULL,'bi.ltifr','bi','quality_hse','main',90,'hse.dashboard.view','27.03','Certified lost-time injury frequency rate','प्रमाणित चोट आवृत्ति दर','migration','reference_seed');
