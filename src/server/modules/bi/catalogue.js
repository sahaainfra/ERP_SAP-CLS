import { hasPermissionAnywhere } from '../../platform/auth/index.js';

export const projectStatusReport = {
  code: 'project-status', module: 'proj', title: 'Project Status',
  description: 'Project lifecycle, approval status and health.',
  formats: ['csv', 'xlsx', 'pdf'],
};

// These reports run on their owner pages, which apply their own parameters, scope and field masks.
const ownerReports = [
  ['progress', 'site', 'Progress by WBS and Activity', '/site/progress-report', 'site.period.view', 'ff.site.p1405'],
  ['budget-actual', 'bud', 'Budget vs Committed vs Actual', '/bud/ledger', 'bud.ledger.view', 'ff.bud.p1203'],
  ['procurement', 'proc', 'Purchase Order Register', '/proc/purchase-orders', 'proc.purchase_order.view', 'ff.proc.p1505'],
  ['open-po', 'proc', 'Open PO and Delivery Tracker', '/proc/po-tracker', 'proc.purchase_order.view', 'ff.proc.p1505'],
  ['stock', 'inv', 'Stock Balances', '/inv/balances', 'inv.stock.view', 'ff.inv.p1601'],
  ['consumption', 'rmc', 'Theoretical vs Actual Concrete Consumption', '/rmc/consumption', 'rmc.consumption.view', 'ff.rmc.p2002'],
  ['plant', 'plant', 'Plant Utilisation and Availability', '/plant/utilisation', 'plant.log.report', 'ff.plant.p1703'],
  ['attendance', 'hr', 'Monthly Attendance Register', '/att/register', 'att.register.view', 'ff.hr.p0706'],
  ['payroll', 'pay', 'Payroll Register and Variance', '/payroll/register', 'pay.run.view', 'ff.pay.p2402'],
  ['qa', 'qa', 'Inspection Register', '/qa/inspections', 'qa.inspection.view', 'ff.qa.p1801'],
  ['hse', 'hse', 'Incident Register', '/hse/incidents', 'hse.incident.view', 'ff.hse.p1903'],
  ['billing', 'bill', 'Client Bills', '/bill/client-bills', 'bill.client_bill.view', 'ff.bill.p2203'],
  ['collections', 'fin', 'Collections Follow-up', '/finance/collections', 'fin.followup.view', 'ff.fin.p2305'],
  ['ageing', 'fin', 'Vendor Ledger and Payables Ageing', '/finance/payables', 'fin.bill.view', 'ff.fin.p2303'],
  ['cash', 'fin', 'Daily Cash and Bank Position', '/finance/cash-position', 'fin.cash_position.view', 'ff.fin.p2306'],
];

export function reportsFor(flags, actor) {
  const allowed = (permission, flag) => hasPermissionAnywhere(actor, permission) && flags.isOn(actor, flag);
  const reports = allowed('proj.project.view', 'ff.proj.p1001') ? [projectStatusReport] : [];
  return [
    ...reports,
    ...ownerReports.flatMap(([code, module, title, route, permission, flag]) => (
      allowed(permission, flag) ? [{ code, module, title, route }] : []
    )),
  ];
}
