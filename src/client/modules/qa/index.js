import { registerModule } from '../../platform/shell/registry.js';
import ItpPage from './ItpPage.jsx';
import TemplatesPage from './TemplatesPage.jsx';
import PerformPage from './PerformPage.jsx';
import InspectionsPage from './InspectionsPage.jsx';

registerModule({
  code: 'qa',
  label: 'Quality',
  routes: [
    { path: '/qa/itps', label: 'ITP Library', icon: 'erp.qhse.qa', permission: 'qa.itp.view', flag: 'ff.qa.p1801', Page: ItpPage },
    { path: '/qa/templates', label: 'Checklist Templates', icon: 'erp.qhse.qa', permission: 'qa.template.view', flag: 'ff.qa.p1801', Page: TemplatesPage },
    { path: '/qa/perform', label: 'Perform Inspection', icon: 'erp.qhse.qa', permission: 'qa.inspection.create', flag: 'ff.qa.p1801', Page: PerformPage },
    { path: '/qa/inspections', label: 'Inspections', icon: 'erp.qhse.qa', permission: 'qa.inspection.view', flag: 'ff.qa.p1801', Page: InspectionsPage },
  ],
});
