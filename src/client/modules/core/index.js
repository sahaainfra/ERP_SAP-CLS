import { registerModule } from '../../platform/shell/registry.js';
import AboutPage from './pages/AboutPage.jsx';
import ArchitecturePage from './pages/ArchitecturePage.jsx';
import DataHealthPage from './pages/DataHealthPage.jsx';
import CompanySettingsPage from './pages/CompanySettingsPage.jsx';
import FinancialYearsPage from './pages/FinancialYearsPage.jsx';
import HolidaysPage from './pages/HolidaysPage.jsx';
import NumberingPage from './pages/NumberingPage.jsx';
import ParametersPage from './pages/ParametersPage.jsx';
import DeadLettersPage from './pages/DeadLettersPage.jsx';
import JobsPage from './pages/JobsPage.jsx';
import OperationsPage from './pages/OperationsPage.jsx';
import OperationsHealthPage from './pages/OperationsHealthPage.jsx';
import ConnectorsPage from './pages/ConnectorsPage.jsx';
import ConnectorConfigPage from './pages/ConnectorConfigPage.jsx';
import IntegrationLogPage from './pages/IntegrationLogPage.jsx';
import SchedulesPage from './pages/SchedulesPage.jsx';
import FileSettingsPage from './pages/FileSettingsPage.jsx';
import SampleDocumentsPage from './pages/SampleDocumentsPage.jsx';
import ApprovalsPage from './pages/ApprovalsPage.jsx';
import FormulaRegistryPage from './pages/FormulaRegistryPage.jsx';
import SampleBillsPage from './pages/SampleBillsPage.jsx';
import ShadowReportPage from './pages/ShadowReportPage.jsx';
import FlagsPage from './pages/FlagsPage.jsx';
import AuditExplorerPage from './pages/AuditExplorerPage.jsx';
import SecurityEventsPage from './pages/SecurityEventsPage.jsx';
import RouteRegistryPage from './pages/RouteRegistryPage.jsx';
import SecuritySettingsPage from './pages/SecuritySettingsPage.jsx';

// Module "core" registers its pages once. The shell builds navigation and routing from the registry.
registerModule({
  code: 'core',
  label: 'Core',
  routes: [
    { path: '/admin/feature-flags', label: 'Feature Flags', permission: 'core.flag.view', Page: FlagsPage },
    { path: '/admin/audit', label: 'Audit Explorer', permission: 'core.audit.view', flag: 'ff.iam.p0206', Page: AuditExplorerPage },
    { path: '/admin/security-events', label: 'Security Events', permission: 'core.security.view', flag: 'ff.iam.p0206', Page: SecurityEventsPage },
    { path: '/admin/security/routes', label: 'Route Registry', permission: 'core.routes.view', flag: 'ff.iam.p0207', Page: RouteRegistryPage },
    { path: '/admin/security/settings', label: 'Security Settings', permission: 'core.routes.view', flag: 'ff.iam.p0207', Page: SecuritySettingsPage },
    { path: '/admin/about', label: 'About', permission: 'core.about.view', Page: AboutPage },
    { path: '/admin/data-health', label: 'Data Health', permission: 'core.integrity.view', flag: 'ff.core.p0102', Page: DataHealthPage },
    { path: '/admin/architecture', label: 'Architecture', permission: 'core.arch.view', flag: 'ff.core.p0101', Page: ArchitecturePage },
    { path: '/admin/company-settings', label: 'Company Settings', permission: 'core.settings.view', flag: 'ff.core.p0103', Page: CompanySettingsPage },
    { path: '/admin/financial-years', label: 'Financial Years', permission: 'core.fy.view', flag: 'ff.core.p0103', Page: FinancialYearsPage },
    { path: '/admin/numbering', label: 'Numbering', permission: 'core.numbering.view', flag: 'ff.core.p0103', Page: NumberingPage },
    { path: '/admin/parameters', label: 'Parameters', permission: 'core.param.view', flag: 'ff.core.p0103', Page: ParametersPage },
    { path: '/admin/holidays', label: 'Holidays', flag: 'ff.core.p0103', Page: HolidaysPage },
    { path: '/admin/operations', label: 'Operations', permission: 'core.events.view', flag: 'ff.core.p0104', Page: OperationsPage },
    { path: '/admin/operations/health', label: 'Operations Health', permission: 'core.ops.view', flag: 'ff.core.p0107', Page: OperationsHealthPage },
    { path: '/admin/integrations', label: 'Connectors', permission: 'core.connectors.view', flag: 'ff.core.p0108', Page: ConnectorsPage },
    { path: '/admin/integrations/connector', label: 'Connector Configuration', permission: 'core.connectors.view', flag: 'ff.core.p0108', Page: ConnectorConfigPage },
    { path: '/admin/integrations/log', label: 'Integration Log', permission: 'core.connectors.view', flag: 'ff.core.p0108', Page: IntegrationLogPage },
    { path: '/admin/operations/dead-letters', label: 'Dead Letters', permission: 'core.events.view', flag: 'ff.core.p0104', Page: DeadLettersPage },
    { path: '/admin/operations/jobs', label: 'Jobs', permission: 'core.jobs.view', flag: 'ff.core.p0104', Page: JobsPage },
    { path: '/admin/operations/schedules', label: 'Schedules', permission: 'core.schedule.view', flag: 'ff.core.p0104', Page: SchedulesPage },
    { path: '/admin/file-storage', label: 'File Storage', permission: 'core.files.admin', flag: 'ff.core.p0105', Page: FileSettingsPage },
    { path: '/admin/sample-documents', label: 'Sample Documents', permission: 'core.sample.use', flag: 'ff.core.p0105', Page: SampleDocumentsPage },
    { path: '/admin/formulas', label: 'Formulas', permission: 'core.calc.view', flag: 'ff.core.p0106', Page: FormulaRegistryPage },
    { path: '/admin/formulas/shadow', label: 'Shadow Report', permission: 'core.calc.view', flag: 'ff.core.p0106', Page: ShadowReportPage },
    { path: '/admin/sample-bills', label: 'Sample Bills', permission: 'core.sample.use', flag: 'ff.core.p0106', Page: SampleBillsPage },
    { path: '/admin/approvals', label: 'Approvals', permission: 'core.requests.view', flag: 'ff.core.p0106', Page: ApprovalsPage },
  ],
});
