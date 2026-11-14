import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/hse HSE dashboard and safety KPIs (part 19.08, flag ff.hse.p1908). */
export function kpiRoutes(r, svc, { ok, file, flags }) {
  const { kpi } = svc; const q = (req) => req.query;
  r.use('/dashboard', (req, _res, next) => (flags.isOn(req.actor, 'ff.hse.p1908') ? next() : next(notFound('The HSE dashboard is not enabled for your company yet.'))));
  r.get('/dashboard', (req, res) => ok(res, kpi.dashboard(req.actor, v.parseKpiQ(q(req)))));
  r.get('/dashboard/export', (req, res) => file(res, kpi.exportCsv(req.actor, v.parseKpiQ(q(req)))));
  r.get('/dashboard/report', (req, res) => file(res, kpi.monthlyReport(req.actor, v.parseReportQ(q(req)))));
}
