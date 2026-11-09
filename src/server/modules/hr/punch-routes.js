import { Router } from 'express';
import { parseAnomalyList, parseBulkReview, parseCrewPunch, parseDevicePunch, parseId, parseKiosk, parsePunch, parsePunchList, parseReport, parseReview, parseSettings, parseToday } from './punch-validators.js';

/** Part 07.05: punches, anomalies, the report of the day and the site settings, under /api/v1/att. Rights and scope are checked in the service. */
export function punchRoutes({ punch: s }, { idempotent }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const keyOf = (req) => req.get('idempotency-key') ?? undefined;
  const status = (out) => (out.replayed ? 200 : 201);
  r.get('/punches/context', (req, res) => ok(res, s.punches.context(req.actor)));
  r.get('/punches/today', (req, res) => ok(res, s.punches.today(req.actor, parseToday(req.query))));
  r.get('/punches', (req, res) => { const q = parsePunchList(req.query); const out = s.punches.list(req.actor, q); res.json({ data: out.rows, meta: { total: out.total, limit: q.limit ?? 100, offset: q.offset ?? 0 } }); });
  r.post('/punches', async (req, res) => { const out = await s.punches.mobile(req.actor, parsePunch(req.body, keyOf(req))); ok(res, out, status(out)); });
  r.post('/punches/crew', async (req, res) => ok(res, await s.punches.crew(req.actor, parseCrewPunch(req.body)), 201));
  r.post('/punches/kiosk', async (req, res) => { const out = await s.punches.kiosk(req.actor, parseKiosk(req.body, keyOf(req))); ok(res, out, status(out)); });
  r.post('/punches/device', async (req, res) => { const out = await s.punches.device(req.actor, parseDevicePunch(req.body)); ok(res, out, status(out)); });
  r.get('/punches/:id/selfie', async (req, res) => { const f = await s.punches.selfie(req.actor, parseId(req.params.id)); res.set({ 'content-type': f.mime, 'cache-control': 'private, no-store' }).send(f.buffer); });
  r.get('/anomalies', (req, res) => { const q = parseAnomalyList(req.query); const out = s.anomalies.list(req.actor, q); res.json({ data: out.rows, meta: { total: out.total, limit: q.limit ?? 100, offset: q.offset ?? 0 } }); });
  r.post('/anomalies/bulk-review', idempotent, (req, res) => ok(res, s.anomalies.bulk(req.actor, parseBulkReview(req.body))));
  r.get('/anomalies/:id', (req, res) => ok(res, s.anomalies.get(req.actor, parseId(req.params.id))));
  r.post('/anomalies/:id/review', idempotent, (req, res) => ok(res, s.anomalies.review(req.actor, parseId(req.params.id), parseReview(req.body))));
  r.get('/report/today', (req, res) => ok(res, s.report.today(req.actor, parseReport(req.query))));
  r.get('/report/today/export', (req, res) => res.status(200).set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="attendance-today.csv"', 'cache-control': 'no-store' }).send(s.report.csv(req.actor, parseReport(req.query))));
  r.get('/site-settings/:siteId', (req, res) => ok(res, s.settings.get(req.actor, parseId(req.params.siteId))));
  r.put('/site-settings/:siteId', idempotent, (req, res) => ok(res, s.settings.set(req.actor, parseId(req.params.siteId), parseSettings(req.body))));
  return r;
}
