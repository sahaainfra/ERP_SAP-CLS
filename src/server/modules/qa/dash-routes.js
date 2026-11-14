import { notFound } from '../../platform/http/errors.js';
import { parseDashQ, parseChartQ, parseRatingsQ, parseDashExportQ } from './validators.js';

/** /api/v1/qa dashboard, control charts and ratings (part 18.07, flag ff.qa.p1807). */
export function dashRoutes(r, svc, { ok, file, flags }) {
  r.use(['/dashboard', '/control-charts', '/ratings'], (req, _res, next) => (flags.isOn(req.actor, 'ff.qa.p1807') ? next() : next(notFound('The quality dashboard is not enabled for your company yet.'))));
  r.get('/dashboard', (req, res) => ok(res, svc.dashboard(req.actor, parseDashQ(req.query))));
  r.get('/dashboard/export', (req, res) => file(res, svc.exportCsv(req.actor, parseDashExportQ(req.query))));
  r.get('/dashboard/pdf', (req, res) => file(res, svc.exportPdf(req.actor, parseDashQ(req.query))));
  r.get('/control-charts', (req, res) => ok(res, svc.controlChart(req.actor, parseChartQ(req.query))));
  r.get('/ratings', (req, res) => ok(res, svc.ratings(req.actor, parseRatingsQ(req.query))));
}
