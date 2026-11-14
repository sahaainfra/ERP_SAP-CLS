import { registerModule } from '../../platform/shell/registry.js';
import ItpPage from './ItpPage.jsx';
import TemplatesPage from './TemplatesPage.jsx';
import PerformPage from './PerformPage.jsx';
import InspectionsPage from './InspectionsPage.jsx';
import InspectionRequestsPage, { IrRaisePage } from './InspectionRequestsPage.jsx';
import IrAnalysisPage from './IrAnalysisPage.jsx';
import ReceivingPage from './ReceivingPage.jsx';
import TestRequestsPage from './TestRequestsPage.jsx';
import ComplianceReportPage from './ComplianceReportPage.jsx';
import LabEquipmentPage from './LabEquipmentPage.jsx';
import TestCataloguePage from './TestCataloguePage.jsx';
import NcrsPage, { NcrRaisePage } from './NcrsPage.jsx';
import NcrAnalysisPage from './NcrAnalysisPage.jsx';

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
    { path: '/qa/receiving', label: 'Receiving Inspections', icon: 'erp.qhse.qa', permission: 'qa.test_request.view', flag: 'ff.qa.p1803', Page: ReceivingPage },
    { path: '/qa/test-requests', label: 'Test Requests', icon: 'erp.qhse.qa', permission: 'qa.test_request.view', flag: 'ff.qa.p1803', Page: TestRequestsPage },
    { path: '/qa/test-compliance', label: 'Test Frequency Compliance', icon: 'erp.qhse.qa', permission: 'qa.test_request.view', flag: 'ff.qa.p1803', Page: ComplianceReportPage },
    { path: '/qa/lab-equipment', label: 'Lab Equipment and Calibration', icon: 'erp.qhse.qa', permission: 'qa.lab_equipment.view', flag: 'ff.qa.p1803', Page: LabEquipmentPage },
    { path: '/qa/test-catalogue', label: 'Test Catalogue', icon: 'erp.qhse.qa', permission: 'qa.test_catalogue.view', flag: 'ff.qa.p1803', Page: TestCataloguePage },
    { path: '/qa/ncrs', label: 'NCR Register', icon: 'erp.qhse.qa', permission: 'qa.ncr.view', flag: 'ff.qa.p1804', Page: NcrsPage },
    { path: '/qa/ncrs/new', label: 'Raise NCR', icon: 'erp.qhse.qa', permission: 'qa.ncr.create', flag: 'ff.qa.p1804', Page: NcrRaisePage },
    { path: '/qa/ncr-analysis', label: 'NCR Analysis', icon: 'erp.qhse.qa', permission: 'qa.ncr.view', flag: 'ff.qa.p1804', Page: NcrAnalysisPage },
    { path: '/qa/inspections', label: 'Inspections', icon: 'erp.qhse.qa', permission: 'qa.inspection.view', flag: 'ff.qa.p1801', Page: InspectionsPage },
  ],
});
