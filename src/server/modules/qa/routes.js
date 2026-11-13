import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseId, parseReason, parseFileAttach, parseExportQ, parsePlanCreate, parsePlanUpdate, parseItpCreate, parseItpUpdate, parseItpApply, parseItpImport, parsePlannedQ, parseTemplateCreate, parseTemplateUpdate, parseTemplatePreview, parseModuleQ, parseInspectionCreate, parseInspectionUpdate, parsePhoto, parseSign, parseInspectionImport } from './validators.js';

/** /api/v1/qa: quality plans, ITPs, checklist templates and inspections (part 18.01), later the requests, tests, NCRs, pours, snags and the dashboard. Each part behind its own flag. */
export function qaRoutes(svc, { idempotent, idempotentRequired, flags, parts = {} }) {
  const r = Router(); const { plans, itps, templates, inspections, planned } = svc; const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  r.use((req, _res, next) => (flags.isOn(req.actor, 'ff.qa.p1801') ? next() : next(notFound('Quality management is not enabled for your company yet.'))));
  const crud = (path, s, parseCreate, parseUpdate) => {
    r.get(path, (req, res) => res.json(s.list(req.actor, req.query)));
    r.post(path, idempotentRequired, (req, res) => ok(res, s.create(req.actor, parseCreate(req.body)), 201));
    r.get(`${path}/:id`, (req, res) => ok(res, s.get(req.actor, pid(req))));
    r.patch(`${path}/:id`, idempotent, (req, res) => ok(res, s.update(req.actor, pid(req), parseUpdate(req.body))));
    r.delete(`${path}/:id`, (req, res) => ok(res, s.remove(req.actor, pid(req))));
    r.post(`${path}/:id/submit`, idempotentRequired, (req, res) => ok(res, s.submit(req.actor, pid(req)), 202));
    r.post(`${path}/:id/withdraw`, idempotent, (req, res) => ok(res, s.withdraw(req.actor, pid(req), parseReason(req.body))));
    r.post(`${path}/:id/cancel`, idempotent, (req, res) => ok(res, s.cancel(req.actor, pid(req), parseReason(req.body))));
    r.post(`${path}/:id/amend`, idempotent, (req, res) => ok(res, s.amend(req.actor, pid(req), parseReason(req.body))));
    r.get(`${path}/:id/history`, (req, res) => ok(res, s.history(req.actor, pid(req))));
    r.get(`${path}/:id/print`, (req, res) => file(res, s.print(req.actor, pid(req))));
  };
  r.get('/export', (req, res) => file(res, svc.exportCsv(req.actor, parseExportQ(req.query))));
  r.get('/activities', (req, res) => ok(res, planned.activities(req.actor, parsePlannedQ(req.query).projectId)));
  r.get('/planned-points', (req, res) => ok(res, planned.list(req.actor, parsePlannedQ(req.query))));
  r.get('/inspections/options', (req, res) => ok(res, inspections.options(req.actor, parseModuleQ(req.query))));
  r.get('/templates/active', (req, res) => ok(res, templates.active(req.actor, parseModuleQ(req.query).module)));
  r.post('/templates/preview', idempotent, (req, res) => ok(res, templates.preview(req.actor, parseTemplatePreview(req.body))));
  r.post('/itps/import', idempotentRequired, (req, res) => ok(res, itps.importRows(req.actor, parseItpImport(req.body)), 201));
  r.post('/inspections/import', idempotentRequired, (req, res) => ok(res, inspections.importRows(req.actor, parseInspectionImport(req.body)), 201));
  crud('/quality-plans', plans, parsePlanCreate, parsePlanUpdate); r.post('/quality-plans/:id/file', idempotent, (req, res) => ok(res, plans.attach(req.actor, pid(req), parseFileAttach(req.body))));
  crud('/itps', itps, parseItpCreate, parseItpUpdate); r.post('/itps/:id/apply', idempotentRequired, (req, res) => ok(res, itps.apply(req.actor, pid(req), parseItpApply(req.body)), 201));
  crud('/templates', templates, parseTemplateCreate, parseTemplateUpdate);
  crud('/inspections', inspections, parseInspectionCreate, parseInspectionUpdate);
  r.post('/inspections/:id/photos', idempotent, (req, res) => ok(res, inspections.photo(req.actor, pid(req), parsePhoto(req.body))));
  r.post('/inspections/:id/signatures', idempotent, (req, res) => ok(res, inspections.sign(req.actor, pid(req), parseSign(req.body))));
  for (const mount of Object.values(parts)) mount(r, { ok, pid, file, idempotent, idempotentRequired, flags });
  return r;
}
