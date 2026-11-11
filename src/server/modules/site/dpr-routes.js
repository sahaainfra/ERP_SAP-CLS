import { Router } from 'express';
import { parseDprCreate, parseDprRangeQ, parseDprReportExportQ, parseDprReportQ, parseDprSiteQ, parseDprUpdate, parseId, parsePhoto, parsePrefillQ, parseReason } from './validators.js';

/** /api/v1/site/dprs: the daily progress report, its reports and its compliance (part 14.02). Rights and scope are checked in the services. */
export function dprRoutes(svc, { exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router(); const d = svc.dpr.dprs; const rep = svc.dprReports;
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-export-rows': String(out.rows ?? 0) }).send(out.buffer);
  r.get('/', (req, res) => res.json(d.list(req.actor, req.query)));
  r.get('/export', async (req, res, next) => { try { const out = await exportsOf().start(req.actor, 'site.dprs', req.query); if (out.job) return res.status(202).json({ data: out.job }); return res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' }).send(out.buffer); } catch (e) { return next(e); } });
  r.get('/sites', (req, res) => ok(res, d.sites(req.actor)));
  r.get('/options', (req, res) => ok(res, d.options(req.actor, parseDprSiteQ(req.query).siteId)));
  r.get('/prefill', (req, res) => ok(res, d.prefill(req.actor, parsePrefillQ(req.query))));
  r.get('/missing', (req, res) => ok(res, rep.missing(req.actor, parseDprRangeQ(req.query))));
  r.get('/compliance', (req, res) => ok(res, rep.compliance(req.actor, parseDprRangeQ(req.query))));
  r.get('/report', (req, res) => ok(res, rep.report(req.actor, parseDprReportQ(req.query))));
  r.get('/report/export', (req, res) => file(res, rep.reportExport(req.actor, parseDprReportExportQ(req.query))));
  r.post('/', idempotentRequired, (req, res) => ok(res, d.create(req.actor, parseDprCreate(req.body)), 201));
  r.get('/:id', (req, res) => ok(res, d.get(req.actor, pid(req))));
  r.patch('/:id', idempotent, (req, res) => ok(res, d.update(req.actor, pid(req), parseDprUpdate(req.body))));
  r.delete('/:id', (req, res) => ok(res, d.remove(req.actor, pid(req))));
  r.post('/:id/submit', idempotentRequired, (req, res) => ok(res, d.submit(req.actor, pid(req)), 202));
  r.post('/:id/withdraw', idempotent, (req, res) => ok(res, d.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/:id/cancel', idempotent, (req, res) => ok(res, d.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/:id/amend', idempotentRequired, (req, res) => ok(res, d.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.get('/:id/history', (req, res) => ok(res, d.history(req.actor, pid(req))));
  r.get('/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(d.print(req.actor, pid(req))));
  r.get('/:id/pdf', (req, res) => file(res, d.pdf(req.actor, pid(req))));
  r.patch('/:id/photos/:fileId', idempotent, (req, res) => ok(res, d.photo(req.actor, pid(req), parseId(req.params.fileId), parsePhoto(req.body))));
  return r;
}
