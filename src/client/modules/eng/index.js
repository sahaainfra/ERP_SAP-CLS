import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const ApprovalTaskPage = lazyPage(() => import('./ApprovalTaskPage.jsx'));
const InboxPage = lazyPage(() => import('./InboxPage.jsx'));
const MobileApprovalsPage = lazyPage(() => import('./MobileApprovalsPage.jsx'));
const SubmissionsPage = lazyPage(() => import('./SubmissionsPage.jsx'));
const ApprovalMatrixPage = lazyPage(() => import('./ApprovalMatrixPage.jsx'));
const ApprovalSimulatorPage = lazyPage(() => import('./ApprovalSimulatorPage.jsx'));
const AuthorityLimitsPage = lazyPage(() => import('./AuthorityLimitsPage.jsx'));
const DelegationsPage = lazyPage(() => import('./DelegationsPage.jsx'));
const EscalationPage = lazyPage(() => import('./EscalationPage.jsx'));
const MatrixEditorPage = lazyPage(() => import('./MatrixEditorPage.jsx'));
const AlertRulesPage = lazyPage(() => import('./AlertRulesPage.jsx'));
const RuleBuilderPage = lazyPage(() => import('./RuleBuilderPage.jsx'));
const AlertCentrePage = lazyPage(() => import('./AlertCentrePage.jsx'));
const MyTasksPage = lazyPage(() => import('./MyTasksPage.jsx'));
const TaskPage = lazyPage(() => import('./TaskPage.jsx'));
const NewTaskPage = lazyPage(() => import('./NewTaskPage.jsx'));
const TeamTasksPage = lazyPage(() => import('./TeamTasksPage.jsx'));
const ResponsibilityMatrixPage = lazyPage(() => import('./ResponsibilityMatrixPage.jsx'));
const CommunicationLogPage = lazyPage(() => import('./CommunicationLogPage.jsx'));
const ChannelSettingsPage = lazyPage(() => import('./ChannelSettingsPage.jsx'));
const ConsentRegisterPage = lazyPage(() => import('./ConsentRegisterPage.jsx'));
const DeliveryLogPage = lazyPage(() => import('./DeliveryLogPage.jsx'));
const NotificationPreferencesPage = lazyPage(() => import('./NotificationPreferencesPage.jsx'));
const NotificationTemplatesPage = lazyPage(() => import('./NotificationTemplatesPage.jsx'));
const NotificationsPage = lazyPage(() => import('./NotificationsPage.jsx'));
const AccountabilityReportPage = lazyPage(() => import('./AccountabilityReportPage.jsx'));
const MyAccountabilityPage = lazyPage(() => import('./MyAccountabilityPage.jsx'));
const RaciMatrixPage = lazyPage(() => import('./RaciMatrixPage.jsx'));
const ControlPointsPage = lazyPage(() => import('./ControlPointsPage.jsx'));
const ControlsDashboardPage = lazyPage(() => import('./ControlsDashboardPage.jsx'));
const ExceptionsPage = lazyPage(() => import('./ExceptionsPage.jsx'));
const ReasonCodesPage = lazyPage(() => import('./ReasonCodesPage.jsx'));
const ProjectActivityPage = lazyPage(() => import('./ProjectActivityPage.jsx'));
const FieldFormsPage = lazyPage(() => import('./FieldFormsPage.jsx'));
const SyncStatusPage = lazyPage(() => import('./SyncStatusPage.jsx'));
const ConflictPage = lazyPage(() => import('./ConflictPage.jsx'));
const DevicesPage = lazyPage(() => import('./DevicesPage.jsx'));
const SampleDocsPage = lazyPage(() => import('./SampleDocsPage.jsx'));
const DocumentRegisterPage = lazyPage(() => import('./DocumentRegisterPage.jsx'));
const DocumentPage = lazyPage(() => import('./DocumentPage.jsx'));
const NewDocumentPage = lazyPage(() => import('./NewDocumentPage.jsx'));
const DocumentTypesPage = lazyPage(() => import('./DocumentTypesPage.jsx'));
const TemplateLibraryPage = lazyPage(() => import('./TemplateLibraryPage.jsx'));
const TemplateEditorPage = lazyPage(() => import('./TemplateEditorPage.jsx'));
const GeneratedDocumentsPage = lazyPage(() => import('./GeneratedDocumentsPage.jsx'));
const SignatureRegisterPage = lazyPage(() => import('./SignatureRegisterPage.jsx'));
const ImportCenterPage = lazyPage(() => import('./ImportCenterPage.jsx'));
const ImportJobPage = lazyPage(() => import('./ImportJobPage.jsx'));
const ImportTemplateDesignerPage = lazyPage(() => import('./ImportTemplateDesignerPage.jsx'));
const WorkflowDefinitionsPage = lazyPage(() => import('./WorkflowDefinitionsPage.jsx'));
const WorkflowEditorPage = lazyPage(() => import('./WorkflowEditorPage.jsx'));
const WorkflowInstancePage = lazyPage(() => import('./WorkflowInstancePage.jsx'));
const WorkflowMonitorPage = lazyPage(() => import('./WorkflowMonitorPage.jsx'));

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
    { path: '/tasks', label: 'My Tasks', icon: 'erp.action.inbox', flag: 'ff.eng.p0408', Page: MyTasksPage },
    { path: '/tasks/task', label: 'Task', icon: 'erp.action.info', flag: 'ff.eng.p0408', Page: TaskPage },
    { path: '/tasks/new', label: 'New Task / Senior Instruction', icon: 'erp.action.create', flag: 'ff.eng.p0408', Page: NewTaskPage },
    { path: '/tasks/team', label: 'Team Tasks', icon: 'erp.insights.metrics', permission: 'tsk.team.view', flag: 'ff.eng.p0408', Page: TeamTasksPage },
    { path: '/admin/task-routing', label: 'Department Responsibility Matrix', icon: 'erp.action.settings', permission: 'tsk.routing.view', flag: 'ff.eng.p0408', Page: ResponsibilityMatrixPage },
    { path: '/alerts', label: 'Alert Centre', icon: 'erp.action.notify', flag: 'ff.eng.p0409', Page: AlertCentrePage },
    { path: '/admin/alert-rules', label: 'Alert Rules', icon: 'erp.action.settings', permission: 'alr.rule.view', flag: 'ff.eng.p0409', Page: AlertRulesPage },
    { path: '/admin/alert-rules/editor', label: 'Rule Builder', icon: 'erp.action.edit', permission: 'alr.rule.view', flag: 'ff.eng.p0409', Page: RuleBuilderPage },
    { path: '/documents', label: 'Document Register', icon: 'erp.action.list', permission: 'doc.document.view', flag: 'ff.eng.p0410', Page: DocumentRegisterPage },
    { path: '/documents/document', label: 'Document', icon: 'erp.action.info', permission: 'doc.document.view', flag: 'ff.eng.p0410', Page: DocumentPage },
    { path: '/documents/new', label: 'Upload / New Revision', icon: 'erp.action.create', permission: 'doc.document.create', flag: 'ff.eng.p0410', Page: NewDocumentPage },
    { path: '/admin/document-types', label: 'Document Types & Folder Templates', icon: 'erp.action.settings', permission: 'doc.config.view', flag: 'ff.eng.p0410', Page: DocumentTypesPage },
    { path: '/admin/templates', label: 'Templates', icon: 'erp.action.settings', permission: 'tpl.template.view', flag: 'ff.eng.p0411', Page: TemplateLibraryPage },
    { path: '/admin/templates/editor', label: 'Template Editor', icon: 'erp.action.edit', permission: 'tpl.template.view', flag: 'ff.eng.p0411', Page: TemplateEditorPage },
    { path: '/documents/generated', label: 'Generated Documents', icon: 'erp.insights.metrics', permission: 'tpl.document.view', flag: 'ff.eng.p0411', Page: GeneratedDocumentsPage },
    { path: '/admin/signatures', label: 'Signature Register', icon: 'erp.insights.metrics', permission: 'sig.register.view', flag: 'ff.eng.p0412', Page: SignatureRegisterPage },
    { path: '/import', label: 'Import Center', icon: 'erp.action.import', permission: 'xl.import.use', flag: 'ff.eng.p0413', Page: ImportCenterPage },
    { path: '/import/job', label: 'Import Job', icon: 'erp.action.info', permission: 'xl.import.use', flag: 'ff.eng.p0413', Page: ImportJobPage },
    { path: '/admin/import-templates', label: 'Import Template Designer', icon: 'erp.action.settings', permission: 'xl.template.view', flag: 'ff.eng.p0413', Page: ImportTemplateDesignerPage },
    { path: '/field/forms', label: 'Field Forms', icon: 'erp.field.field', flag: 'ff.eng.p0415', Page: FieldFormsPage },
    { path: '/field/sync', label: 'Sync Status', icon: 'erp.action.info', flag: 'ff.eng.p0415', Page: SyncStatusPage },
    { path: '/field/sync/conflicts', label: 'Conflict Resolution', icon: 'erp.action.info', flag: 'ff.eng.p0415', Page: ConflictPage },
    { path: '/admin/devices', label: 'Devices', icon: 'erp.action.settings', permission: 'off.device.manage', flag: 'ff.eng.p0415', Page: DevicesPage },
    { path: '/projects/activity', label: 'Project Activity Feed', icon: 'erp.action.info', permission: 'col.activity.view', flag: 'ff.eng.p0414', Page: ProjectActivityPage },
    { path: '/engine/sample-docs', label: 'Sample Documents', icon: 'erp.group.supply', permission: 'eng.sample.use', flag: 'ff.eng.p0401', Page: SampleDocsPage },
  ],
});
