import { registerModule } from '../../platform/shell/registry.js';
import ApprovalTaskPage from './ApprovalTaskPage.jsx';
import InboxPage from './InboxPage.jsx';
import MobileApprovalsPage from './MobileApprovalsPage.jsx';
import SubmissionsPage from './SubmissionsPage.jsx';
import ApprovalMatrixPage from './ApprovalMatrixPage.jsx';
import ApprovalSimulatorPage from './ApprovalSimulatorPage.jsx';
import AuthorityLimitsPage from './AuthorityLimitsPage.jsx';
import DelegationsPage from './DelegationsPage.jsx';
import EscalationPage from './EscalationPage.jsx';
import MatrixEditorPage from './MatrixEditorPage.jsx';
import CommunicationLogPage from './CommunicationLogPage.jsx';
import ChannelSettingsPage from './ChannelSettingsPage.jsx';
import ConsentRegisterPage from './ConsentRegisterPage.jsx';
import DeliveryLogPage from './DeliveryLogPage.jsx';
import NotificationPreferencesPage from './NotificationPreferencesPage.jsx';
import NotificationTemplatesPage from './NotificationTemplatesPage.jsx';
import NotificationsPage from './NotificationsPage.jsx';
import AccountabilityReportPage from './AccountabilityReportPage.jsx';
import MyAccountabilityPage from './MyAccountabilityPage.jsx';
import RaciMatrixPage from './RaciMatrixPage.jsx';
import ControlPointsPage from './ControlPointsPage.jsx';
import ControlsDashboardPage from './ControlsDashboardPage.jsx';
import ExceptionsPage from './ExceptionsPage.jsx';
import ReasonCodesPage from './ReasonCodesPage.jsx';
import SampleDocsPage from './SampleDocsPage.jsx';
import WorkflowDefinitionsPage from './WorkflowDefinitionsPage.jsx';
import WorkflowEditorPage from './WorkflowEditorPage.jsx';
import WorkflowInstancePage from './WorkflowInstancePage.jsx';
import WorkflowMonitorPage from './WorkflowMonitorPage.jsx';

// Module "eng" (part 04.01): the workflow engine's pages. The Approvals tab of any document links to the Workflow Instance page by its id.
registerModule({
  code: 'eng',
  label: 'Business Engines',
  routes: [
    { path: '/admin/workflows', label: 'Workflow Definitions', icon: 'erp.action.settings', permission: 'eng.workflow.view', flag: 'ff.eng.p0401', Page: WorkflowDefinitionsPage },
    { path: '/admin/workflows/editor', label: 'Workflow Definition Editor', icon: 'erp.action.edit', permission: 'eng.workflow.view', flag: 'ff.eng.p0401', Page: WorkflowEditorPage },
    { path: '/admin/workflows/monitor', label: 'Workflow Monitor', icon: 'erp.insights.metrics', permission: 'eng.workflow.view', flag: 'ff.eng.p0401', Page: WorkflowMonitorPage },
    { path: '/workflow/instance', label: 'Workflow Instance', icon: 'erp.action.inbox', flag: 'ff.eng.p0401', Page: WorkflowInstancePage },
    { path: '/admin/approval-matrix', label: 'Approval Matrix', icon: 'erp.action.settings', permission: 'eng.matrix.view', flag: 'ff.eng.p0402', Page: ApprovalMatrixPage },
    { path: '/admin/approval-matrix/editor', label: 'Matrix Rule Editor', icon: 'erp.action.edit', permission: 'eng.matrix.view', flag: 'ff.eng.p0402', Page: MatrixEditorPage },
    { path: '/admin/authority-limits', label: 'Authority Limits', icon: 'erp.insights.metrics', permission: 'eng.matrix.view', flag: 'ff.eng.p0402', Page: AuthorityLimitsPage },
    { path: '/admin/approval-simulator', label: 'Approval Simulator', icon: 'erp.action.search', permission: 'eng.matrix.view', flag: 'ff.eng.p0402', Page: ApprovalSimulatorPage },
    { path: '/workflow/delegations', label: 'Delegations', icon: 'erp.action.inbox', permission: 'eng.delegation.use', flag: 'ff.eng.p0402', Page: DelegationsPage },
    { path: '/admin/escalation', label: 'Escalation Paths & SLA', icon: 'erp.action.settings', permission: 'eng.matrix.view', flag: 'ff.eng.p0402', Page: EscalationPage },
    { path: '/approvals', label: 'My Approvals', icon: 'erp.action.inbox', flag: 'ff.eng.p0403', Page: InboxPage },
    { path: '/approvals/task', label: 'Approval Task', icon: 'erp.action.info', flag: 'ff.eng.p0403', Page: ApprovalTaskPage },
    { path: '/approvals/submissions', label: 'My Submissions & Watch List', icon: 'erp.action.list', flag: 'ff.eng.p0403', Page: SubmissionsPage },
    { path: '/field/approvals', label: 'Approvals (phone)', icon: 'erp.field.field', flag: 'ff.eng.p0403', Page: MobileApprovalsPage },
    { path: '/admin/controls', label: 'Control Points', icon: 'erp.action.settings', permission: 'eng.pcs.view', flag: 'ff.eng.p0404', Page: ControlPointsPage },
    { path: '/admin/reason-codes', label: 'Reason Codes', icon: 'erp.action.list', permission: 'eng.pcs.view', flag: 'ff.eng.p0404', Page: ReasonCodesPage },
    { path: '/controls/exceptions', label: 'Exceptions Register', icon: 'erp.action.list', flag: 'ff.eng.p0404', Page: ExceptionsPage },
    { path: '/controls/dashboard', label: 'Controls Dashboard', icon: 'erp.insights.metrics', permission: 'eng.pcs.view', flag: 'ff.eng.p0404', Page: ControlsDashboardPage },
    { path: '/admin/raci', label: 'RACI Matrix', icon: 'erp.action.settings', permission: 'acc.raci.view', flag: 'ff.eng.p0405', Page: RaciMatrixPage },
    { path: '/accountability', label: 'My Accountability', icon: 'erp.insights.metrics', flag: 'ff.eng.p0405', Page: MyAccountabilityPage },
    { path: '/reports/accountability', label: 'Accountability Report', icon: 'erp.insights.metrics', permission: 'acc.report.view', flag: 'ff.eng.p0405', Page: AccountabilityReportPage },
    { path: '/notifications', label: 'Notifications', icon: 'erp.action.inbox', flag: 'ff.eng.p0406', Page: NotificationsPage },
    { path: '/notifications/preferences', label: 'Notification Preferences', icon: 'erp.action.settings', flag: 'ff.eng.p0406', Page: NotificationPreferencesPage },
    { path: '/admin/notification-templates', label: 'Notification Templates', icon: 'erp.action.settings', permission: 'ntf.template.view', flag: 'ff.eng.p0406', Page: NotificationTemplatesPage },
    { path: '/admin/notification-deliveries', label: 'Delivery Log', icon: 'erp.insights.metrics', permission: 'ntf.delivery.view', flag: 'ff.eng.p0406', Page: DeliveryLogPage },
    { path: '/admin/communication-log', label: 'Communication Log', icon: 'erp.insights.metrics', permission: 'comm.log.view', flag: 'ff.eng.p0407', Page: CommunicationLogPage },
    { path: '/admin/communication-channels', label: 'Channel Settings', icon: 'erp.action.settings', permission: 'comm.channel.view', flag: 'ff.eng.p0407', Page: ChannelSettingsPage },
    { path: '/admin/communication-consents', label: 'Consent Register', icon: 'erp.action.list', permission: 'comm.consent.view', flag: 'ff.eng.p0407', Page: ConsentRegisterPage },
    { path: '/engine/sample-docs', label: 'Sample Documents', icon: 'erp.group.supply', permission: 'eng.sample.use', flag: 'ff.eng.p0401', Page: SampleDocsPage },
  ],
});
