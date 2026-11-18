import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseEinvCancel, parseEinvDoc, parseEwbCancel, parseEwbCreate, parseEwbDoc, parseEwbExtend, parseEwbVehicle, parseGstResolve, parseGstSettingsCreate, parseGstSettingsImport, parseGstSettingsUpdate, parseGstinCheck, parseId, parseJournalReason } from './validators.js';

/** Part 23.07: the GST API under /api/v1/fin (the tax engine, GSTIN checks, the settings, e-invoices and e-way bills), behind ff.fin.p2307. Rights are checked in the service. */
export function gstRoutes(gs, { idempotent, idempotentRequired, flags }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use(['/gst', '/einvoices', '/ewaybills'], (req, _res, next) => (flags.isOn(req.actor, 'ff.fin.p2307') ? next() : next(notFound('GST e-invoicing and e-way bills are not enabled for your company yet (feature flag ff.fin.p2307 is OFF).'))));
  const { settings: s, einvoices: e, ewaybills: w } = gs;
  r.post('/gst/resolve', (req, res) => ok(res, gs.resolve(req.actor, parseGstResolve(req.body))));
  r.post('/gst/gstin-check', idempotent, async (req, res) => ok(res, await gs.gstins.check(req.actor, parseGstinCheck(req.body))));
  r.get('/gst/settings', (req, res) => ok(res, s.current(req.actor)));
  r.get('/gst/settings/export', (req, res) => file(res, s.exportJson(req.actor)));
  r.post('/gst/settings/import', idempotentRequired, (req, res) => ok(res, s.importJson(req.actor, parseGstSettingsImport(req.body)), 201));
  r.post('/gst/settings', idempotentRequired, (req, res) => ok(res, s.create(req.actor, parseGstSettingsCreate(req.body)), 201));
  r.get('/gst/settings/:id', (req, res) => ok(res, s.get(req.actor, pid(req))));
  r.patch('/gst/settings/:id', idempotent, (req, res) => ok(res, s.update(req.actor, pid(req), parseGstSettingsUpdate(req.body))));
  r.delete('/gst/settings/:id', (req, res) => ok(res, s.remove(req.actor, pid(req))));
  r.post('/gst/settings/:id/submit', idempotentRequired, (req, res) => ok(res, s.submit(req.actor, pid(req)), 202));
  r.post('/gst/settings/:id/withdraw', idempotent, (req, res) => ok(res, s.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/gst/settings/:id/cancel', idempotent, (req, res) => ok(res, s.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.get('/gst/settings/:id/history', (req, res) => ok(res, s.history(req.actor, pid(req))));
  r.get('/einvoices/due', (req, res) => ok(res, e.due(req.actor)));
  r.get('/einvoices/export', (req, res) => file(res, e.exportCsv(req.actor, req.query)));
  r.get('/einvoices', (req, res) => res.json(e.list(req.actor, req.query)));
  r.post('/einvoices', idempotentRequired, async (req, res) => ok(res, await e.generate(req.actor, parseEinvDoc(req.body)), 201));
  r.get('/einvoices/:id', (req, res) => ok(res, e.get(req.actor, pid(req))));
  r.get('/einvoices/:id/log', (req, res) => ok(res, e.log(req.actor, pid(req))));
  r.get('/einvoices/:id/qr', async (req, res) => res.status(200).set({ 'content-type': 'image/svg+xml', 'cache-control': 'no-store' }).send(await e.qrSvg(req.actor, pid(req))));
  r.get('/einvoices/:id/print', async (req, res) => file(res, await e.print(req.actor, pid(req))));
  r.post('/einvoices/:id/retry', idempotentRequired, async (req, res) => ok(res, await e.retry(req.actor, pid(req))));
  r.post('/einvoices/:id/cancel', idempotentRequired, async (req, res) => ok(res, await e.cancel(req.actor, pid(req), parseEinvCancel(req.body))));
  r.get('/ewaybills/sources', (req, res) => ok(res, w.sources(req.actor)));
  r.get('/ewaybills/prepare', (req, res) => ok(res, w.prepare(req.actor, parseEwbDoc(req.query))));
  r.get('/ewaybills/export', (req, res) => file(res, w.exportCsv(req.actor, req.query)));
  r.get('/ewaybills', (req, res) => res.json(w.list(req.actor, req.query)));
  r.post('/ewaybills', idempotentRequired, async (req, res) => ok(res, await w.generate(req.actor, parseEwbCreate(req.body)), 201));
  r.get('/ewaybills/:id', (req, res) => ok(res, w.get(req.actor, pid(req))));
  r.post('/ewaybills/:id/retry', idempotentRequired, async (req, res) => ok(res, await w.retry(req.actor, pid(req))));
  r.post('/ewaybills/:id/vehicle', idempotentRequired, async (req, res) => ok(res, await w.vehicle(req.actor, pid(req), parseEwbVehicle(req.body))));
  r.post('/ewaybills/:id/extend', idempotentRequired, async (req, res) => ok(res, await w.extend(req.actor, pid(req), parseEwbExtend(req.body))));
  r.post('/ewaybills/:id/cancel', idempotentRequired, async (req, res) => ok(res, await w.cancel(req.actor, pid(req), parseEwbCancel(req.body))));
  return r;
}
