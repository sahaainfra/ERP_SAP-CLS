import { registerModule } from '../../platform/shell/registry.js';
import PlantDashboardPage from './PlantDashboardPage.jsx';
import EquipmentPage from './EquipmentPage.jsx';
import EquipmentNewPage from './EquipmentNewPage.jsx';
import RequisitionsPage from './RequisitionsPage.jsx';
import RequisitionNewPage from './RequisitionNewPage.jsx';
import AllocationsPage from './AllocationsPage.jsx';
import AllocationNewPage from './AllocationNewPage.jsx';
import GanttPage from './GanttPage.jsx';
import LogEntryPage from './LogEntryPage.jsx';
import LogsPage from './LogsPage.jsx';
import LogVerificationPage from './LogVerificationPage.jsx';
import UtilisationPage from './UtilisationPage.jsx';
import FuelIssuePage from './FuelIssuePage.jsx';
import FuelDipPage from './FuelDipPage.jsx';
import FuelIssuesPage from './FuelIssuesPage.jsx';
import FuelTanksPage from './FuelTanksPage.jsx';
import FuelReportsPage from './FuelReportsPage.jsx';
import FuelAnomaliesPage from './FuelAnomaliesPage.jsx';
import MaintenancePage from './MaintenancePage.jsx';
import PmSchedulePage from './PmSchedulePage.jsx';
import JobCardsPage from './JobCardsPage.jsx';

registerModule({
  code: 'plant',
  label: 'Plant and Equipment',
  routes: [
    { path: '/plant/dashboard', label: 'Plant Dashboard', icon: 'erp.group.plant', permission: 'plant.equipment.view', flag: 'ff.plant.p1701', Page: PlantDashboardPage },
    { path: '/plant/equipment', label: 'Equipment Register', icon: 'erp.group.plant', permission: 'plant.equipment.view', flag: 'ff.plant.p1701', Page: EquipmentPage },
    { path: '/plant/equipment/new', label: 'New Equipment', icon: 'erp.group.plant', permission: 'plant.equipment.create', flag: 'ff.plant.p1701', Page: EquipmentNewPage },
    { path: '/plant/requisitions', label: 'Equipment Requisitions', icon: 'erp.group.plant', permission: 'plant.requisition.view', flag: 'ff.plant.p1702', Page: RequisitionsPage },
    { path: '/plant/requisitions/new', label: 'New Equipment Requisition', icon: 'erp.group.plant', permission: 'plant.requisition.create', flag: 'ff.plant.p1702', Page: RequisitionNewPage },
    { path: '/plant/allocations', label: 'Equipment Allocations', icon: 'erp.group.plant', permission: 'plant.allocation.view', flag: 'ff.plant.p1702', Page: AllocationsPage },
    { path: '/plant/allocations/new', label: 'New Allocation', icon: 'erp.group.plant', permission: 'plant.allocation.create', flag: 'ff.plant.p1702', Page: AllocationNewPage },
    { path: '/plant/gantt', label: 'Equipment Availability Gantt', icon: 'erp.group.plant', permission: 'plant.allocation.view', flag: 'ff.plant.p1702', Page: GanttPage },
    { path: '/plant/log-entry', label: 'Daily Equipment Log', icon: 'erp.group.plant', permission: 'plant.log.create', flag: 'ff.plant.p1703', Page: LogEntryPage },
    { path: '/plant/logs', label: 'Equipment Log Books', icon: 'erp.group.plant', permission: 'plant.log.view', flag: 'ff.plant.p1703', Page: LogsPage },
    { path: '/plant/log-verification', label: 'Log Verification', icon: 'erp.group.plant', permission: 'plant.log.approve', flag: 'ff.plant.p1703', Page: LogVerificationPage },
    { path: '/plant/utilisation', label: 'Utilisation and Availability', icon: 'erp.group.plant', permission: 'plant.log.report', flag: 'ff.plant.p1703', Page: UtilisationPage },
    { path: '/plant/fuel-issue', label: 'Fuel Issue', icon: 'erp.group.plant', permission: 'plant.issue.create', flag: 'ff.plant.p1704', Page: FuelIssuePage },
    { path: '/plant/fuel-dip', label: 'Tank Dip Entry', icon: 'erp.group.plant', permission: 'plant.fuel.dip', flag: 'ff.plant.p1704', Page: FuelDipPage },
    { path: '/plant/fuel-issues', label: 'Fuel Issues', icon: 'erp.group.plant', permission: 'plant.issue.view', flag: 'ff.plant.p1704', Page: FuelIssuesPage },
    { path: '/plant/fuel-tanks', label: 'Fuel Stores', icon: 'erp.group.plant', permission: 'plant.fuel.receive', flag: 'ff.plant.p1704', Page: FuelTanksPage },
    { path: '/plant/fuel-reports', label: 'Fuel Reports', icon: 'erp.group.plant', permission: 'plant.fuel.report', flag: 'ff.plant.p1704', Page: FuelReportsPage },
    { path: '/plant/fuel-anomalies', label: 'Fuel Anomalies', icon: 'erp.group.plant', permission: 'plant.fuel.report', flag: 'ff.plant.p1704', Page: FuelAnomaliesPage },
    { path: '/plant/maintenance', label: 'Maintenance Dashboard', icon: 'erp.group.plant', permission: 'plant.maint.report', flag: 'ff.plant.p1705', Page: MaintenancePage },
    { path: '/plant/pm-schedule', label: 'PM Schedule', icon: 'erp.group.plant', permission: 'plant.pm.view', flag: 'ff.plant.p1705', Page: PmSchedulePage },
    { path: '/plant/job-cards', label: 'Job Cards', icon: 'erp.group.plant', permission: 'plant.job_card.view', flag: 'ff.plant.p1705', Page: JobCardsPage },
  ],
});
