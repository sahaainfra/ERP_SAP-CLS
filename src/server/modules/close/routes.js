import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseId, parseTncQ, parseSystemCreate, parseTagCreate, parseSheetCreate, parseSheetRecord, parsePackCreate, parsePackRecord, parsePunchLink, parseCertRequest, parseClientSign, parseHoQ, parseHandoverCreate, parseItemCreate, parseItemRecord, parseAssetCreate, parseHandoverSign, parseReason, parseDlpQ, parsePeriodOpen, parseComplaintCreate, parseComplaintAssign, parseComplaintRectify, parseComplaintVerify, parseClaimCreate, parseClaimUpdate, parseClsQ, parseClosureCreate, parseClosureUpdate, parseClosureItem, parseBenchmark, parseLessonQ, parseLessonCreate, parseBenchmarkQ } from './validators.js';

/** /api/v1/close: project closeout (module M26). Each part behind its own flag; later parts add their routes through `parts`. */
export function closeRoutes({ idempotent, idempotentRequired, flags, parts = {} }) {
  const r = Router(); const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  const gate = (flag, what) => (req, _res, next) => (flags.isOn(req.actor, flag) ? next() : next(notFound(`${what} is not enabled for your company yet.`)));
  for (const mount of Object.values(parts)) mount(r, { ok, pid, file, idempotent, idempotentRequired, flags, gate });
  return r;
}

/** 26.01 testing, pre-commissioning and commissioning (flag ff.close.p2601). */
export function commissioningRoutes(r, svc, { ok, pid, idempotent, idempotentRequired, gate }) {
  const p = '/commissioning';
  r.use(p, gate('ff.close.p2601', 'Commissioning'));
  r.get(`${p}/dashboard`, (req, res) => ok(res, svc.dashboard(req.actor, parseTncQ(req.query))));
  r.get(`${p}/options`, (req, res) => ok(res, svc.options(req.actor, parseTncQ(req.query))));
  r.get(`${p}/systems`, (req, res) => ok(res, svc.systems.list(req.actor, parseTncQ(req.query))));
  r.post(`${p}/systems`, idempotentRequired, (req, res) => ok(res, svc.systems.create(req.actor, parseSystemCreate(req.body)), 201));
  r.get(`${p}/systems/:id`, (req, res) => ok(res, svc.systems.get(req.actor, pid(req))));
  r.post(`${p}/systems/:id/tags`, idempotentRequired, (req, res) => ok(res, svc.tags.create(req.actor, pid(req), parseTagCreate(req.body)), 201));
  r.post(`${p}/systems/:id/test-packs`, idempotentRequired, (req, res) => ok(res, svc.packs.create(req.actor, pid(req), parsePackCreate(req.body)), 201));
  r.post(`${p}/systems/:id/punches`, idempotent, (req, res) => ok(res, svc.punches.link(req.actor, pid(req), parsePunchLink(req.body))));
  r.post(`${p}/systems/:id/certificates`, idempotentRequired, (req, res) => ok(res, svc.certificates.request(req.actor, pid(req), parseCertRequest(req.body)), 201));
  r.post(`${p}/tags/:id/sheets`, idempotentRequired, (req, res) => ok(res, svc.sheets.create(req.actor, pid(req), parseSheetCreate(req.body)), 201));
  r.post(`${p}/sheets/:id/record`, idempotent, (req, res) => ok(res, svc.sheets.record(req.actor, pid(req), parseSheetRecord(req.body))));
  r.get(`${p}/test-packs`, (req, res) => ok(res, svc.packs.list(req.actor, parseTncQ(req.query))));
  r.post(`${p}/test-packs/:id/record`, idempotent, (req, res) => ok(res, svc.packs.record(req.actor, pid(req), parsePackRecord(req.body))));
  r.get(`${p}/certificates`, (req, res) => ok(res, svc.certificates.list(req.actor, parseTncQ(req.query))));
  r.post(`${p}/certificates/:id/client-sign`, idempotent, (req, res) => ok(res, svc.certificates.clientSign(req.actor, pid(req), parseClientSign(req.body))));
}

/** 26.02 project handover, dossier and client asset register (flag ff.close.p2602). */
export function handoverRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, gate }) {
  const p = '/handovers';
  r.use([p, '/handover-items', '/client-assets'], gate('ff.close.p2602', 'Project handover'));
  r.get(`${p}/options`, (req, res) => ok(res, svc.options(req.actor, parseHoQ(req.query))));
  r.get(p, (req, res) => ok(res, svc.list(req.actor, parseHoQ(req.query))));
  r.post(p, idempotentRequired, (req, res) => ok(res, svc.create(req.actor, parseHandoverCreate(req.body)), 201));
  r.get(`${p}/:id`, (req, res) => ok(res, svc.get(req.actor, pid(req))));
  r.post(`${p}/:id/items`, idempotentRequired, (req, res) => ok(res, svc.addItem(req.actor, pid(req), parseItemCreate(req.body)), 201));
  r.post(`${p}/:id/assets`, idempotentRequired, (req, res) => ok(res, svc.addAsset(req.actor, pid(req), parseAssetCreate(req.body)), 201));
  r.get(`${p}/:id/dossier`, (req, res) => ok(res, svc.dossier(req.actor, pid(req))));
  r.get(`${p}/:id/dossier/export`, (req, res) => file(res, svc.dossierExport(req.actor, pid(req))));
  r.post(`${p}/:id/request`, idempotentRequired, (req, res) => ok(res, svc.request(req.actor, pid(req)), 202));
  r.post(`${p}/:id/client-sign`, idempotent, (req, res) => ok(res, svc.clientSign(req.actor, pid(req), parseHandoverSign(req.body))));
  r.post(`${p}/:id/cancel`, idempotent, (req, res) => ok(res, svc.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/handover-items/:id/record', idempotent, (req, res) => ok(res, svc.recordItem(req.actor, pid(req), parseItemRecord(req.body))));
  r.get('/client-assets/export', (req, res) => file(res, svc.assetExport(req.actor, parseHoQ(req.query))));
  r.get('/client-assets', (req, res) => ok(res, svc.assetRegister(req.actor, parseHoQ(req.query))));
  r.delete('/client-assets/:id', (req, res) => ok(res, svc.removeAsset(req.actor, pid(req))));
}

/** 26.03 defects liability period and warranty management (flag ff.close.p2603). */
export function dlpRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, gate }) {
  const p = '/dlp';
  r.use(p, gate('ff.close.p2603', 'Defects liability'));
  r.get(`${p}/dashboard`, (req, res) => ok(res, svc.periods.dashboard(req.actor)));
  r.get(`${p}/periods`, (req, res) => ok(res, svc.periods.list(req.actor, parseDlpQ(req.query))));
  r.post(`${p}/periods`, idempotentRequired, (req, res) => ok(res, svc.periods.open(req.actor, parsePeriodOpen(req.body)), 201));
  r.get(`${p}/periods/:id`, (req, res) => ok(res, svc.periods.get(req.actor, pid(req))));
  r.post(`${p}/periods/:id/complaints`, idempotentRequired, (req, res) => ok(res, svc.complaints.create(req.actor, pid(req), parseComplaintCreate(req.body)), 201));
  r.post(`${p}/periods/:id/claims`, idempotentRequired, (req, res) => ok(res, svc.claims.create(req.actor, pid(req), parseClaimCreate(req.body)), 201));
  r.post(`${p}/periods/:id/complete`, idempotentRequired, (req, res) => ok(res, svc.requestCompletion(req.actor, pid(req)), 202));
  r.get(`${p}/complaints/export`, (req, res) => file(res, svc.complaints.exportCsv(req.actor, parseDlpQ(req.query))));
  r.get(`${p}/complaints`, (req, res) => ok(res, svc.complaints.list(req.actor, parseDlpQ(req.query))));
  r.post(`${p}/complaints/:id/assign`, idempotent, (req, res) => ok(res, svc.complaints.assign(req.actor, pid(req), parseComplaintAssign(req.body))));
  r.post(`${p}/complaints/:id/rectify`, idempotent, (req, res) => ok(res, svc.complaints.rectify(req.actor, pid(req), parseComplaintRectify(req.body))));
  r.post(`${p}/complaints/:id/verify`, idempotent, (req, res) => ok(res, svc.complaints.verify(req.actor, pid(req), parseComplaintVerify(req.body))));
  r.post(`${p}/complaints/:id/reject`, idempotent, (req, res) => ok(res, svc.complaints.reject(req.actor, pid(req), parseReason(req.body))));
  r.post(`${p}/claims/:id`, idempotent, (req, res) => ok(res, svc.claims.update(req.actor, pid(req), parseClaimUpdate(req.body))));
}

/** 26.04 project closeout, final account, lessons learned and benchmarks (flag ff.close.p2604). */
export function closureRoutes(r, svc, { ok, pid, file, idempotent, idempotentRequired, gate }) {
  r.use(['/closures', '/closure-items', '/lessons', '/benchmarks'], gate('ff.close.p2604', 'Project closeout'));
  r.get('/closures/options', (req, res) => ok(res, svc.options(req.actor)));
  r.get('/closures/export', (req, res) => file(res, svc.exportCsv(req.actor)));
  r.get('/closures', (req, res) => ok(res, svc.list(req.actor, parseClsQ(req.query))));
  r.post('/closures', idempotentRequired, (req, res) => ok(res, svc.create(req.actor, parseClosureCreate(req.body)), 201));
  r.get('/closures/:id', (req, res) => ok(res, svc.get(req.actor, pid(req))));
  r.patch('/closures/:id', idempotent, (req, res) => ok(res, svc.update(req.actor, pid(req), parseClosureUpdate(req.body))));
  r.post('/closures/:id/benchmarks', idempotentRequired, (req, res) => ok(res, svc.addBenchmark(req.actor, pid(req), parseBenchmark(req.body)), 201));
  r.post('/closures/:id/request', idempotentRequired, (req, res) => ok(res, svc.request(req.actor, pid(req)), 202));
  r.post('/closure-items/:id/record', idempotent, (req, res) => ok(res, svc.recordItem(req.actor, pid(req), parseClosureItem(req.body))));
  r.get('/lessons', (req, res) => ok(res, svc.lessons.list(req.actor, parseLessonQ(req.query))));
  r.post('/lessons', idempotentRequired, (req, res) => ok(res, svc.lessons.create(req.actor, parseLessonCreate(req.body)), 201));
  r.post('/lessons/:id/submit', idempotentRequired, (req, res) => ok(res, svc.lessons.submit(req.actor, pid(req)), 202));
  r.get('/benchmarks', (req, res) => ok(res, svc.benchmarks(req.actor, parseBenchmarkQ(req.query))));
}
