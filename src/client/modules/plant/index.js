import { registerModule } from '../../platform/shell/registry.js';
import { lazyPage } from '../../platform/shell/lazyPage.js';

// Each page is fetched when it is first opened (part 166.4); the routes themselves stay in the first download.
const PlantDashboardPage = lazyPage(() => import('./PlantDashboardPage.jsx'));
const EquipmentPage = lazyPage(() => import('./EquipmentPage.jsx'));
const EquipmentNewPage = lazyPage(() => import('./EquipmentNewPage.jsx'));
const RequisitionsPage = lazyPage(() => import('./RequisitionsPage.jsx'));
const RequisitionNewPage = lazyPage(() => import('./RequisitionNewPage.jsx'));
const AllocationsPage = lazyPage(() => import('./AllocationsPage.jsx'));
const AllocationNewPage = lazyPage(() => import('./AllocationNewPage.jsx'));
const GanttPage = lazyPage(() => import('./GanttPage.jsx'));
const LogEntryPage = lazyPage(() => import('./LogEntryPage.jsx'));
const LogsPage = lazyPage(() => import('./LogsPage.jsx'));
const LogVerificationPage = lazyPage(() => import('./LogVerificationPage.jsx'));
const UtilisationPage = lazyPage(() => import('./UtilisationPage.jsx'));
const FuelIssuePage = lazyPage(() => import('./FuelIssuePage.jsx'));
const FuelDipPage = lazyPage(() => import('./FuelDipPage.jsx'));
const FuelIssuesPage = lazyPage(() => import('./FuelIssuesPage.jsx'));
const FuelTanksPage = lazyPage(() => import('./FuelTanksPage.jsx'));
const FuelReportsPage = lazyPage(() => import('./FuelReportsPage.jsx'));
const FuelAnomaliesPage = lazyPage(() => import('./FuelAnomaliesPage.jsx'));
const MaintenancePage = lazyPage(() => import('./MaintenancePage.jsx'));
const PmSchedulePage = lazyPage(() => import('./PmSchedulePage.jsx'));
const JobCardsPage = lazyPage(() => import('./JobCardsPage.jsx'));
const HireAgreementsPage = lazyPage(() => import('./HireAgreementsPage.jsx'));
const HireBillPage = lazyPage(() => import('./HireBillPage.jsx'));
const HireComparisonPage = lazyPage(() => import('./HireComparisonPage.jsx'));
const FleetTowerPage = lazyPage(() => import('./FleetTowerPage.jsx'));
const OwningCostPage = lazyPage(() => import('./OwningCostPage.jsx'));
const ReplacementPage = lazyPage(() => import('./ReplacementPage.jsx'));
const CapacityPage = lazyPage(() => import('./CapacityPage.jsx'));
const ShortagePage = lazyPage(() => import('./ShortagePage.jsx'));
const ResourcePlansPage = lazyPage(() => import('./ResourcePlansPage.jsx'));

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
    { path: '/plant/hire-agreements', label: 'Hire Agreements', icon: 'erp.group.plant', permission: 'plant.hire_agreement.view', flag: 'ff.plant.p1706', Page: HireAgreementsPage },
    { path: '/plant/hire-bill', label: 'Compute Hire Bill', icon: 'erp.group.plant', permission: 'plant.hire_bill.create', flag: 'ff.plant.p1706', Page: HireBillPage },
    { path: '/plant/hire-comparison', label: 'Hire Cost vs Owned Cost', icon: 'erp.group.plant', permission: 'plant.hire.report', flag: 'ff.plant.p1706', Page: HireComparisonPage },
    { path: '/plant/fleet-tower', label: 'Fleet Control Tower', icon: 'erp.group.plant', permission: 'plant.fleet.view', flag: 'ff.plant.p1707', Page: FleetTowerPage },
    { path: '/plant/owning-cost', label: 'Owning and Operating Cost', icon: 'erp.group.plant', permission: 'plant.fleet.costs', flag: 'ff.plant.p1707', Page: OwningCostPage },
    { path: '/plant/replacement', label: 'Replacement Candidates', icon: 'erp.group.plant', permission: 'plant.fleet.view', flag: 'ff.plant.p1707', Page: ReplacementPage },
    { path: '/plant/capacity', label: 'Resource Capacity Heat-map', icon: 'erp.group.plant', permission: 'plant.capacity.view', flag: 'ff.plant.p1708', Page: CapacityPage },
    { path: '/plant/shortage-surplus', label: 'Shortage and Surplus', icon: 'erp.group.plant', permission: 'plant.capacity.view', flag: 'ff.plant.p1708', Page: ShortagePage },
    { path: '/plant/resource-plans', label: 'Resource Plan Scenario', icon: 'erp.group.plant', permission: 'plant.resource_plan.view', flag: 'ff.plant.p1708', Page: ResourcePlansPage },
  ],
});
