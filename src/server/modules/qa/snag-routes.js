import { notFound } from '../../platform/http/errors.js';
import { parseReason, parseSnagCreate, parseSnagBulk, parseSnagUpdate, parseSnagPhoto, parseSnagRectify, parseSnagClose, parseSnagStatusQ, parsePlansQ, parseUnitReportQ } from './validators.js';

/** /api/v1/qa snags and punch lists (part 18.06, flag ff.qa.p1806). */
export function snagRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, flags }) {
  const { snags } = svc; const p = '/snags';
  r.use([p, '/snag-status', '/snag-report'], (req, _res, next) => (flags.isOn(req.actor, 'ff.qa.p1806') ? next() : next(notFound('Snag lists are not enabled for your company yet.'))));
  r.get('/snag-status', (req, res) => ok(res, svc.status(req.actor, parseSnagStatusQ(req.query))));
  r.get('/snag-report', (req, res) => ok(res, svc.unitReport(req.actor, parseUnitReportQ(req.query))));
  r.get('/snag-report/pdf', (req, res) => file(res, svc.unitPdf(req.actor, parseUnitReportQ(req.query))));
  r.get(`${p}/options`, (req, res) => ok(res, snags.options(req.actor, req.query.projectId ? { projectId: Number(req.query.projectId) } : {})));
  r.get(`${p}/plans`, (req, res) => ok(res, snags.plans(req.actor, parsePlansQ(req.query).projectId)));
  r.get(`${p}/export`, (req, res) => file(res, svc.exportCsv(req.actor)));
  r.get(p, (req, res) => res.json(snags.list(req.actor, req.query)));
  r.post(p, idempotentRequired, (req, res) => ok(res, snags.create(req.actor, parseSnagCreate(req.body)), 201));
  r.post(`${p}/bulk`, idempotentRequired, (req, res) => ok(res, snags.bulk(req.actor, parseSnagBulk(req.body)), 201));
  r.get(`${p}/:id`, (req, res) => ok(res, snags.get(req.actor, pid(req))));
  r.patch(`${p}/:id`, idempotent, (req, res) => ok(res, snags.update(req.actor, pid(req), parseSnagUpdate(req.body))));
  r.delete(`${p}/:id`, (req, res) => ok(res, snags.remove(req.actor, pid(req))));
  r.post(`${p}/:id/cancel`, idempotent, (req, res) => ok(res, snags.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post(`${p}/:id/photos`, idempotent, (req, res) => ok(res, snags.photo(req.actor, pid(req), parseSnagPhoto(req.body))));
  r.post(`${p}/:id/rectify`, idempotent, (req, res) => ok(res, snags.rectify(req.actor, pid(req), parseSnagRectify(req.body))));
  r.post(`${p}/:id/close`, idempotent, (req, res) => ok(res, snags.close(req.actor, pid(req), parseSnagClose(req.body))));
  r.post(`${p}/:id/reopen`, idempotent, (req, res) => ok(res, snags.reopen(req.actor, pid(req), parseReason(req.body))));
}
