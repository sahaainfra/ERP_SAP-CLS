-- PACK-16: the Project 360 "Plant and equipment" tile links to the equipment register filtered to the project (it had no link of its own).
UPDATE proj_360_widgets SET drill_route = '/plant/equipment?filter[project]={projectCode}', updated_by = 'migration', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE widget_code = 'plant' AND company_id IS NULL AND drill_route IS NULL;
