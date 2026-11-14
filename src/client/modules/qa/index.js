import { registerModule } from '../../platform/shell/registry.js';
import ItpPage from './ItpPage.jsx';
import TemplatesPage from './TemplatesPage.jsx';
import PerformPage from './PerformPage.jsx';
import InspectionsPage from './InspectionsPage.jsx';
import InspectionRequestsPage, { IrRaisePage } from './InspectionRequestsPage.jsx';
import IrAnalysisPage from './IrAnalysisPage.jsx';

registerModule({
  code: 'qa',
  label: 'Quality',
  routes: [
    { path: '/qa/itps', label: 'ITP Library', icon: 'erp.qhse.qa', permission: 'qa.itp.view', flag: 'ff.qa.p1801', Page: ItpPage },
    { path: '/qa/templates', label: 'Checklist Templates', icon: 'erp.qhse.qa', permission: 'qa.template.view', flag: 'ff.qa.p1801', Page: TemplatesPage },
    { path: '/qa/perform', label: 'Perform Inspection', icon: 'erp.qhse.qa', permission: 'qa.inspection.create', flag: 'ff.qa.p1801', Page: PerformPage },
    { path: '/qa/inspection-requests', label: 'Inspection Requests', icon: 'erp.qhse.qa', permission: 'qa.inspection_request.view', flag: 'ff.qa.p1802', Page: InspectionRequestsPage },
    { path: '/qa/inspection-requests/new', label: 'Raise Inspection Request', icon: 'erp.qhse.qa', permission: 'qa.inspection_request.create', flag: 'ff.qa.p1802', Page: IrRaisePage },
    { path: '/qa/ir-analysis', label: 'IR Rejection Analysis', icon: 'erp.qhse.qa', permission: 'qa.inspection_request.view', flag: 'ff.qa.p1802', Page: IrAnalysisPage },
    { path: '/qa/inspections', label: 'Inspections', icon: 'erp.qhse.qa', permission: 'qa.inspection.view', flag: 'ff.qa.p1801', Page: InspectionsPage },
  ],
});
