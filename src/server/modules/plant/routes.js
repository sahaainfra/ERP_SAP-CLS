import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseDashQ, parseDocAttach, parseDocCreate, parseDocUpdate, parseDrillQ, parseEquipCreate, parseEquipImport, parseEquipUpdate, parseExportQ, parseId, parseReason, parseScanQ, parseState } from './validators.js';

/** /api/v1/plant: the equipment register, its documents and certificates, status, dashboard and exports (part 17.01). Behind its own flag, ff.plant.p1701. */
export function plantRoutes(svc, { idempotent, idempotentRequired, flags }) {
  const r = Router(); const { equipment, documents } = svc; const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  r.use((req, _res, next) => (flags.isOn(req.actor, 'ff.plant.p1701') ? next() : next(notFound('Plant and equipment is not enabled for your company yet.'))));
  r.get('/dashboard', (req, res) => ok(res, svc.dashboard(req.actor, parseDashQ(req.query))));
  r.get('/dashboard/drill', (req, res) => ok(res, svc.drill(req.actor, parseDrillQ(req.query))));
  r.get('/dashboard/export', (req, res) => file(res, svc.exportCsv(req.actor, parseExportQ(req.query))));
  r.get('/equipment/options', (req, res) => ok(res, equipment.options(req.actor)));
  r.get('/equipment/scan', (req, res) => ok(res, equipment.scan(req.actor, parseScanQ(req.query).code)));
  r.get('/equipment', (req, res) => res.json(equipment.list(req.actor, req.query)));
  r.post('/equipment', idempotentRequired, (req, res) => ok(res, equipment.create(req.actor, parseEquipCreate(req.body)), 201));
  r.post('/equipment/import', idempotentRequired, (req, res) => ok(res, equipment.importRows(req.actor, parseEquipImport(req.body)), 201));
  r.get('/equipment/:id', (req, res) => ok(res, equipment.get(req.actor, pid(req))));
  r.patch('/equipment/:id', idempotent, (req, res) => ok(res, equipment.update(req.actor, pid(req), parseEquipUpdate(req.body))));
  r.delete('/equipment/:id', (req, res) => ok(res, equipment.remove(req.actor, pid(req))));
  r.post('/equipment/:id/submit', idempotentRequired, (req, res) => ok(res, equipment.submit(req.actor, pid(req)), 202));
  r.post('/equipment/:id/withdraw', idempotent, (req, res) => ok(res, equipment.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/equipment/:id/cancel', idempotent, (req, res) => ok(res, equipment.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/equipment/:id/amend', idempotent, (req, res) => ok(res, equipment.amend(req.actor, pid(req), parseReason(req.body))));
  r.post('/equipment/:id/status', idempotentRequired, (req, res) => ok(res, equipment.setState(req.actor, pid(req), parseState(req.body))));
  r.get('/equipment/:id/allocatable', (req, res) => ok(res, equipment.allocatable(req.actor, pid(req))));
  r.get('/equipment/:id/history', (req, res) => ok(res, equipment.history(req.actor, pid(req))));
  r.get('/equipment/:id/print', (req, res) => file(res, equipment.print(req.actor, pid(req))));
  r.get('/equipment/:id/tag', (req, res) => ok(res, equipment.tag(req.actor, pid(req))));
  r.get('/equipment/:id/documents', (req, res) => ok(res, documents.list(req.actor, pid(req))));
  r.post('/equipment/:id/documents', idempotentRequired, (req, res) => ok(res, documents.add(req.actor, pid(req), parseDocCreate(req.body)), 201));
  r.patch('/documents/:id', idempotent, (req, res) => ok(res, documents.update(req.actor, pid(req), parseDocUpdate(req.body))));
  r.post('/documents/:id/file', idempotent, (req, res) => ok(res, documents.attach(req.actor, pid(req), parseDocAttach(req.body))));
  r.delete('/documents/:id', (req, res) => ok(res, documents.remove(req.actor, pid(req), parseReason(req.body))));
  return r;
}
