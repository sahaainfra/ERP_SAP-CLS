import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';
import { parseSampleRequest } from './sample-requests.js';
import { parseVersionBody, parseViewCreate, parseViewList, parseViewUpdate } from './lists.js';
import { parseQr, parseSubscription, parseUnsubscribe } from './device.js';
import { parseDashboardCode, parseHistory, parsePersonal, parseRoleDefault, parseWidgetCode, parseWidgetQuery } from './widgets.js';
import { parseContext, parseFavourite, parseFavouriteOrder, parseNavChange, parseNavImport, parseVisit } from './shell.js';
import { parseComment, parseCompare, parseDocumentLink, parseReasonFor, parseTypeId } from './objects.js';
import {
  parseCreateFrom, parseDraftBulkDelete, parseDraftDelete, parseDraftList, parseDraftSave, parseDuplicateCheck, parseEntityKey, parseFormCode, parseId, parsePreferences, parseRequestAction, parseDecision,
} from './validators.js';

/** The ui module's routes (part 03.01), mounted at /api/v1/ui. */
export function uiRoutes(service) {
  const r = Router();
  r.get('/preferences', (req, res) => res.json({ data: service.get(req.actor) }));
  r.patch('/preferences', (req, res) => res.json({ data: service.update(req.actor, parsePreferences(req.body)) }));
  r.get('/style-guide', (req, res) => res.json({ data: service.styleGuide(req.actor) }));
  return r;
}

const version = (b) => parse(z.object({ version: z.number({ error: 'Send the version you loaded' }).int().positive() }).passthrough(), b).version;

/** The data-entry framework's routes (part 03.02): drafts, form definitions, duplicate checks, create-from and the reference form. */
export function formRoutes({ drafts, forms, requests }, { idempotent, idempotentRequired }) {
  const r = Router();
  r.get('/drafts', (req, res) => res.json(drafts.list(req.actor, parseDraftList(req.query))));
  r.post('/drafts/discard', (req, res) => res.json({ data: drafts.removeMany(req.actor, parseDraftBulkDelete(req.body).ids) }));
  const key = (req) => [parseFormCode(req.params.formCode), parseEntityKey(req.params.entityId)];
  for (const path of ['/drafts/:formCode', '/drafts/:formCode/:entityId']) {
    r.get(path, (req, res) => res.json({ data: drafts.get(req.actor, ...key(req)) }));
    r.put(path, (req, res) => res.json({ data: drafts.save(req.actor, ...key(req), parseDraftSave(req.body)) }));
    r.delete(path, (req, res) => res.json({ data: drafts.remove(req.actor, ...key(req), parseDraftDelete(req.body)) }));
  }

  r.get('/forms', (req, res) => res.json({ data: forms.list(req.actor) }));
  r.get('/forms/:code', (req, res) => res.json({ data: forms.get(req.actor, parseFormCode(req.params.code)) }));
  r.get('/form-registry', (req, res) => res.json({ data: forms.registry(req.actor) }));
  r.post('/duplicate-check/:name', (req, res) => res.json({ data: forms.duplicates(req.actor, req.params.name, parseDuplicateCheck(req.body).fields) }));
  r.get('/create-from/:target', (req, res) => res.json({ data: forms.createFrom(req.actor, parseFormCode(req.params.target), parseCreateFrom(req.query)) }));

  r.get('/sample-requests', (req, res) => res.json(requests.list(req.actor, req.query)));
  r.post('/sample-requests', idempotent, (req, res) => res.status(201).json({ data: requests.create(req.actor, parseSampleRequest(req.body), req.correlationId) }));
  r.get('/sample-requests/:id', (req, res) => res.json({ data: requests.get(req.actor, parseId(req.params.id)) }));
  r.put('/sample-requests/:id', idempotent, (req, res) => res.json({ data: requests.update(req.actor, parseId(req.params.id), parseSampleRequest(req.body), version(req.body), req.correlationId) }));
  r.post('/sample-requests/:id/submit', idempotentRequired, (req, res) => res.json({ data: requests.submit(req.actor, parseId(req.params.id), parseRequestAction(req.body), req.correlationId) }));
  r.post('/sample-requests/:id/decision', idempotentRequired, (req, res) => res.json({ data: requests.decide(req.actor, parseId(req.params.id), parseDecision(req.body)) }));
  r.post('/sample-requests/:id/cancel', idempotentRequired, (req, res) => res.json({ data: requests.cancel(req.actor, parseId(req.params.id), parseRequestAction(req.body), req.correlationId) }));
  return r;
}

const bulkBody = (b) => parse(z.object({ action: z.enum(['submit', 'cancel']), ids: z.array(z.number().int().positive()).min(1, 'Select at least one request').max(200), reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,30}$/).optional(), reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500).optional() }).strict()
  .refine((v) => v.action !== 'cancel' || v.reason, { message: 'Give a reason of at least 5 characters', path: ['reason'] }), b);

/** Send an export: the file itself (direct), or 202 with the queued job (large exports, FR-06). */
const sendExport = (res, out) => {
  if (out.kind === 'job') return res.status(202).json({ data: out });
  res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
  return res.send(out.buffer);
};

/** The List Report's routes (part 03.03): list descriptions, saved views, exports and the reference register's export and bulk actions. */
export function listRoutes({ views, exports, requests, describe }, { idempotentRequired }) {
  const r = Router();
  r.get('/lists/:code', (req, res) => res.json({ data: describe(req.actor, String(req.params.code)) }));
  r.get('/saved-views', (req, res) => res.json({ data: views.list(req.actor, parseViewList(req.query).list) }));
  r.post('/saved-views', (req, res) => res.status(201).json({ data: views.create(req.actor, parseViewCreate(req.body)) }));
  r.patch('/saved-views/:id', (req, res) => res.json({ data: views.update(req.actor, parseId(req.params.id), parseViewUpdate(req.body)) }));
  r.delete('/saved-views/:id', (req, res) => res.json({ data: views.remove(req.actor, parseId(req.params.id), parseVersionBody(req.body)) }));
  r.get('/exports', (req, res) => res.json({ data: exports.mine(req.actor) }));
  r.get('/exports/:id/download', (req, res) => sendExport(res, { kind: 'file', ...exports.download(req.actor, parseId(req.params.id)) }));
  r.get('/sample-requests/export', (req, res) => sendExport(res, exports.start(req.actor, 'ui.sample_requests', req.query)));
  r.post('/sample-requests/bulk', idempotentRequired, (req, res) => res.json({ data: requests.bulk(req.actor, bulkBody(req.body), req.correlationId) }));
  return r;
}

/** The Object Page's shared routes (part 03.04): the parts of a record every module's record page has, for any registered record type. */
export function objectRoutes({ objects, reasonCodes }, { idempotent }) {
  const r = Router();
  const at = (req) => parseTypeId(req.params.type, req.params.id);
  r.get('/reason-codes', (req, res) => res.json({ data: reasonCodes(req.actor, parseReasonFor(req.query).for) }));
  r.get('/objects/:type/:id/approvals', (req, res) => res.json({ data: objects.approvalsOf(req.actor, ...at(req)) }));
  r.get('/objects/:type/:id/timeline', (req, res) => res.json({ data: objects.timeline(req.actor, ...at(req)) }));
  r.get('/objects/:type/:id/related', (req, res) => res.json({ data: objects.related(req.actor, ...at(req)) }));
  r.get('/objects/:type/:id/comments', (req, res) => res.json({ data: objects.comments(req.actor, ...at(req)) }));
  r.post('/objects/:type/:id/comments', idempotent, (req, res) => res.status(201).json({ data: objects.addComment(req.actor, ...at(req), parseComment(req.body)) }));
  r.get('/objects/:type/:id/documents', (req, res) => res.json({ data: objects.documents(req.actor, ...at(req)) }));
  r.post('/objects/:type/:id/documents', idempotent, (req, res) => res.status(201).json({ data: objects.linkDocument(req.actor, ...at(req), parseDocumentLink(req.body)) }));
  r.delete('/objects/:type/:id/documents/:linkId', (req, res) => res.json({ data: objects.unlinkDocument(req.actor, ...at(req), parseId(req.params.linkId)) }));
  r.get('/objects/:type/:id/versions', (req, res) => res.json({ data: objects.versions(req.actor, ...at(req)) }));
  r.get('/objects/:type/:id/compare', (req, res) => res.json({ data: objects.compare(req.actor, ...at(req), parseCompare(req.query)) }));
  r.get('/objects/:type/:id/print', (req, res) => {
    const out = objects.print(req.actor, ...at(req));
    res.set({ 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store' });
    res.send(out.buffer);
  });
  return r;
}

/** The application shell's routes (part 03.05): the navigation registry, favourites, recent records, working context and the launchpad. */
export function shellRoutes(shell, { idempotent }) {
  const r = Router();
  r.get('/navigation', (req, res) => res.json({ data: shell.navigation(req.actor) }));
  r.get('/navigation/registry', (req, res) => res.json({ data: shell.registry(req.actor) }));
  r.get('/navigation/registry/export', (req, res) => res.json({ data: shell.exportSettings(req.actor) }));
  r.post('/navigation/registry/import', idempotent, (req, res) => res.status(201).json({ data: shell.importSettings(req.actor, parseNavImport(req.body)) }));
  r.get('/navigation/registry/:code/history', (req, res) => res.json({ data: shell.history(req.actor, parseCode(req.params.code)) }));
  r.post('/navigation/changes', idempotent, (req, res) => res.status(201).json({ data: shell.propose(req.actor, parseNavChange(req.body)) }));
  r.get('/favourites', (req, res) => res.json({ data: shell.favourites(req.actor) }));
  r.post('/favourites', idempotent, (req, res) => res.status(201).json({ data: shell.addFavourite(req.actor, parseFavourite(req.body)) }));
  r.put('/favourites/order', (req, res) => res.json({ data: shell.orderFavourites(req.actor, parseFavouriteOrder(req.body)) }));
  r.delete('/favourites/:id', (req, res) => res.json({ data: shell.removeFavourite(req.actor, parseId(req.params.id)) }));
  r.get('/recent', (req, res) => res.json({ data: shell.recent(req.actor) }));
  r.post('/recent', (req, res) => res.status(201).json({ data: shell.visit(req.actor, parseVisit(req.body)) }));
  r.get('/context-options', (req, res) => res.json({ data: shell.contextOptions(req.actor) }));
  r.put('/context', (req, res) => res.json({ data: shell.setContext(req.actor, parseContext(req.body)) }));
  r.get('/launchpad', (req, res) => res.json({ data: shell.launchpad(req.actor) }));
  r.get('/bell', (req, res) => res.json({ data: shell.bell(req.actor) }));
  return r;
}
const parseCode = (v) => parse(z.string().regex(/^[a-z][a-z0-9-]{0,59}$/, 'Not a navigation code'), v);

/** The device routes (part 03.06): camera settings, push subscriptions of the signed-in person's own browsers, and the QR resolver. */
export function deviceRoutes(device, { idempotent }) {
  const r = Router();
  r.get('/device-settings', (req, res) => res.json({ data: device.settings(req.actor) }));
  r.get('/push-subscriptions', (req, res) => res.json({ data: device.subscriptions(req.actor) }));
  r.post('/push-subscriptions', idempotent, (req, res) => res.status(201).json({ data: device.subscribe(req.actor, parseSubscription(req.body), String(req.get('user-agent') ?? '')) }));
  r.delete('/push-subscriptions', (req, res) => res.json({ data: device.unsubscribe(req.actor, parseUnsubscribe(req.body)) }));
  r.delete('/push-subscriptions/:id', (req, res) => res.json({ data: device.unsubscribe(req.actor, { id: parseId(req.params.id) }) }));
  r.post('/push/test', idempotent, async (req, res) => res.json({ data: await device.sendTest(req.actor) }));
  r.get('/qr/resolve', (req, res) => res.json({ data: device.qrResolve(req.actor, parseQr(req.query).code) }));
  return r;
}

/** The dashboard and widget routes (part 03.07): the catalogue, the data of one widget, and dashboards with a person's own copy and the defaults of roles. */
export function dashboardRoutes(service, { idempotent }) {
  const r = Router();
  r.get('/widgets', (req, res) => res.json({ data: service.catalogue(req.actor) }));
  r.get('/widgets/:code/data', (req, res) => res.json({ data: service.data(req.actor, parseWidgetCode(req.params.code), parseWidgetQuery(req.query)) }));
  r.get('/dashboards', (req, res) => res.json({ data: service.list(req.actor) }));
  r.get('/dashboards/:code', (req, res) => res.json({ data: service.resolve(req.actor, parseDashboardCode(req.params.code)) }));
  r.put('/dashboards/:code/personal', (req, res) => res.json({ data: service.savePersonal(req.actor, parseDashboardCode(req.params.code), parsePersonal(req.body)) }));
  r.delete('/dashboards/:code/personal', (req, res) => res.json({ data: service.resetPersonal(req.actor, parseDashboardCode(req.params.code)) }));
  r.get('/dashboards/:code/role-defaults', (req, res) => res.json({ data: service.roleDefaults(req.actor, parseDashboardCode(req.params.code)) }));
  r.post('/dashboards/:code/role-defaults', idempotent, (req, res) => res.status(201).json({ data: service.proposeRoleDefault(req.actor, parseDashboardCode(req.params.code), parseRoleDefault(req.body)) }));
  r.get('/dashboards/:code/history', (req, res) => res.json({ data: service.history(req.actor, parseDashboardCode(req.params.code), parseHistory(req.query).role) }));
  return r;
}
