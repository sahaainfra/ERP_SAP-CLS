UPDATE proj_360_widgets SET drill_route = NULL WHERE widget_code = 'plant' AND company_id IS NULL AND drill_route = '/plant/equipment?filter[project]={projectCode}';
