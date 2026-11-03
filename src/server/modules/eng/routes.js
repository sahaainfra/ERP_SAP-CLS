import { Router } from 'express';
import { HttpError } from '../../platform/http/errors.js';
import { parseRoutePreview, parseRoutingChange, parseTaskAct, parseTaskChecklist, parseTaskComment, parseTaskCreate, parseTaskDashboard, parseTaskDepend, parseTaskExport, parseTaskPeople, parseTskQuery, parseTaskUpdate, parseInstruction, parseChannelChange, parseConsent, parseConsentImport, parseConsentQuery, parseMessageExport, parseMessageQuery, parseMessageSummary, parseOtpSend, parseOtpVerify, parseSample, parseDeliveryExport, parseDeliveryQuery, parseDeliverySummary, parseNotificationQuery, parsePreferencesBody, parseReadAll, parseTemplateChange, parseTemplateCode, parseTemplatePreview, parseTemplateQuery, parseApplyTemplate, parseGapQuery, parseLedgerQuery, parseMeQuery, parseRaciChange, parseRaciHistory, parseRaciScope, parseResolveQuery, parseScoreExport, parseScoreQuery, parseControlCode, parseControlCreate, parseControlQuery, parseControlUpdate, parseCycleTarget, parseDashboardQuery, parseExceptionCreate, parseExceptionExport, parseExceptionQuery, parseExceptionUpdate, parseReasonQuery, parseReasonSave, parseSampleImport, parseBulkAct, parseInboxQuery, parseLinkDecide, parseLinkIssue, parseLinkToken, parsePolicyChange, parseSubmissionsQuery, parseActivate, parseDelegation, parseDelegationQuery, parseLimitChanges, parseLimitHistory, parseMatrixCreate, parseMatrixQuery, parseMatrixUpdate, parsePathChange, parseRevoke, parseSimulate, parseSlaChange, parseAct, parseAssign, parseCancel, parseComment, parseDefinitionCreate, parseDefinitionQuery, parseDefinitionUpdate, parseDocId, parseDocType, parseDraftFrom, parseId, parseInstanceQuery, parseMonitorQuery, parseSampleDoc, parseSampleQuery, parseSubmit, parseTaskQuery } from './validators.js';

/** /api/v1/workflow: the engine's API (FR-05, FR-06, FR-08). Writes carry an Idempotency-Key. */
export function workflowRoutes({ engine, definitions, monitorFile, matrix, limits, delegations, paths, sla, inbox }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/doc-types', (req, res) => ok(res, definitions.options().docTypes));
  r.post('/submit', idempotentRequired, (req, res) => ok(res, engine.submit(req.actor, parseSubmit(req.body)), 201));
  r.get('/tasks', (req, res) => ok(res, engine.listTasks(req.actor, parseTaskQuery(req.query))));
  r.get('/tasks/count', (req, res) => ok(res, { open: engine.openCount(req.actor) }));
  // part 04.03: the approval inbox
  r.get('/inbox', (req, res) => ok(res, inbox.inbox(req.actor, parseInboxQuery(req.query))));
  r.get('/inbox/counts', (req, res) => ok(res, inbox.counts(req.actor)));
  r.get('/inbox/submissions', (req, res) => ok(res, inbox.submissions(req.actor, parseSubmissionsQuery(req.query))));
  r.post('/tasks/bulk-act', idempotentRequired, (req, res) => ok(res, inbox.bulkAct(req.actor, parseBulkAct(req.body))));
  r.get('/tasks/:id/evidence', async (req, res, next) => { try { ok(res, await inbox.evidenceFor(req.actor, parseId(req.params.id))); } catch (e) { next(e); } });
  r.post('/tasks/:id/links', idempotent, (req, res) => ok(res, inbox.issueLink(req.actor, parseId(req.params.id), parseLinkIssue(req.body)), 201));
  r.post('/links/:token/confirm', idempotentRequired, (req, res) => ok(res, inbox.decideLink(parseLinkToken(req.params.token), parseLinkDecide(req.body), req.actor, 'link+session')));
  r.get('/approval-policies', (req, res) => ok(res, inbox.listPolicies(req.actor)));
  r.post('/approval-policies/changes', idempotentRequired, (req, res) => ok(res, inbox.proposePolicies(req.actor, parsePolicyChange(req.body)), 202));
  r.post('/tasks/:id/act', idempotentRequired, (req, res) => ok(res, engine.act(req.actor, parseId(req.params.id), parseAct(req.body))));
  r.post('/tasks/:id/assign', idempotent, (req, res) => ok(res, engine.assign(req.actor, parseId(req.params.id), parseAssign(req.body))));
  r.get('/instances', (req, res) => ok(res, engine.listInstances(req.actor, parseInstanceQuery(req.query))));
  r.get('/instances/:id', (req, res) => ok(res, engine.get(req.actor, parseId(req.params.id))));
  r.get('/documents/:docType/:docId', (req, res) => {
    const found = engine.forDocument(req.actor, parseDocType(req.params.docType), parseDocId(req.params.docId));
    ok(res, found);
  });
  r.get('/documents/:docType/:docId/history', (req, res) => ok(res, engine.history(req.actor, parseDocType(req.params.docType), parseDocId(req.params.docId))));
  r.post('/instances/:id/withdraw', idempotentRequired, (req, res) => ok(res, engine.withdraw(req.actor, parseId(req.params.id), parseComment(req.body))));
  r.post('/instances/:id/cancel', idempotentRequired, (req, res) => ok(res, engine.cancel(req.actor, parseId(req.params.id), parseCancel(req.body))));
  r.post('/instances/:id/resubmit', idempotentRequired, (req, res) => ok(res, engine.resubmit(req.actor, parseId(req.params.id), parseComment(req.body))));
  r.post('/instances/:id/watch', idempotent, (req, res) => ok(res, engine.watch(req.actor, parseId(req.params.id), true)));
  r.post('/instances/:id/unwatch', idempotent, (req, res) => ok(res, engine.watch(req.actor, parseId(req.params.id), false)));
  r.get('/monitor', (req, res) => {
    const q = parseMonitorQuery(req.query);
    if (q.format === 'json') return ok(res, engine.monitor(req.actor, q));
    const out = monitorFile(req.actor, q);
    return res.set({ 'content-type': out.type, 'content-disposition': `attachment; filename="${out.fileName}"` }).send(out.buffer);
  });
  // definitions
  r.get('/definitions', (req, res) => ok(res, definitions.list(req.actor, parseDefinitionQuery(req.query))));
  r.get('/definitions/options', (req, res) => ok(res, definitions.options()));
  r.post('/definitions/draft', idempotent, (req, res) => ok(res, definitions.draftFrom(req.actor, parseDraftFrom(req.body).docType), 201));
  r.post('/definitions', idempotent, (req, res) => ok(res, definitions.create(req.actor, parseDefinitionCreate(req.body)), 201));
  r.get('/definitions/:a/compare/:b', (req, res) => ok(res, definitions.compare(req.actor, parseId(req.params.a), parseId(req.params.b))));
  r.get('/definitions/:id', (req, res) => ok(res, definitions.get(req.actor, parseId(req.params.id))));
  r.put('/definitions/:id', idempotent, (req, res) => { const b = parseDefinitionUpdate(req.body); ok(res, definitions.update(req.actor, parseId(req.params.id), b.definition, b.version)); });
  r.delete('/definitions/:id', idempotent, (req, res) => ok(res, definitions.remove(req.actor, parseId(req.params.id))));
  r.post('/definitions/:id/activate', idempotentRequired, (req, res) => ok(res, definitions.activate(req.actor, parseId(req.params.id)), 202));
  // part 04.02: the approval matrix
  r.get('/matrix', (req, res) => ok(res, matrix.list(req.actor, parseMatrixQuery(req.query))));
  r.post('/matrix', idempotent, (req, res) => ok(res, matrix.create(req.actor, parseMatrixCreate(req.body)), 201));
  r.post('/matrix/simulate', (req, res) => ok(res, matrix.simulate(req.actor, parseSimulate(req.body))));
  r.get('/matrix/history/:docType', (req, res) => ok(res, matrix.history(req.actor, parseDocType(req.params.docType))));
  r.get('/matrix/:a/compare/:b', (req, res) => ok(res, matrix.compare(req.actor, parseId(req.params.a), parseId(req.params.b))));
  r.get('/matrix/:id', (req, res) => ok(res, matrix.get(req.actor, parseId(req.params.id))));
  r.put('/matrix/:id', idempotent, (req, res) => { const b = parseMatrixUpdate(req.body); ok(res, matrix.update(req.actor, parseId(req.params.id), b)); });
  r.delete('/matrix/:id', idempotent, (req, res) => ok(res, matrix.remove(req.actor, parseId(req.params.id))));
  r.post('/matrix/:id/validate', (req, res) => ok(res, matrix.validate(req.actor, parseId(req.params.id))));
  r.post('/matrix/:id/activate', idempotentRequired, (req, res) => ok(res, matrix.activate(req.actor, parseId(req.params.id), parseActivate(req.body)), 202));
  r.get('/authority-limits', (req, res) => ok(res, limits.grid(req.actor)));
  r.get('/authority-limits/history', (req, res) => ok(res, limits.history(req.actor, parseLimitHistory(req.query))));
  r.post('/authority-limits/changes', idempotentRequired, (req, res) => ok(res, limits.propose(req.actor, parseLimitChanges(req.body)), 202));
  r.get('/delegations', (req, res) => ok(res, delegations.list(req.actor, parseDelegationQuery(req.query))));
  r.post('/delegations', idempotentRequired, (req, res) => ok(res, delegations.create(req.actor, parseDelegation(req.body)), 201));
  r.get('/delegations/:id', (req, res) => ok(res, delegations.get(req.actor, parseId(req.params.id))));
  r.post('/delegations/:id/revoke', idempotent, (req, res) => ok(res, delegations.revoke(req.actor, parseId(req.params.id), parseRevoke(req.body))));
  r.get('/escalation-paths', (req, res) => ok(res, paths.list(req.actor)));
  r.post('/escalation-paths/changes', idempotentRequired, (req, res) => ok(res, paths.propose(req.actor, parsePathChange(req.body)), 202));
  r.get('/sla-settings', (req, res) => ok(res, sla.list(req.actor)));
  r.post('/sla-settings/changes', idempotentRequired, (req, res) => ok(res, sla.propose(req.actor, parseSlaChange(req.body)), 202));
  return r;
}

/** /api/v1/eng: the sample document type. */
export function sampleDocRoutes({ docs }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/sample-docs', (req, res) => ok(res, docs.list(req.actor, parseSampleQuery(req.query))));
  r.post('/sample-docs', idempotent, (req, res) => ok(res, docs.create(req.actor, parseSampleDoc(req.body)), 201));
  r.get('/sample-docs/:id', (req, res) => ok(res, docs.get(req.actor, parseId(req.params.id))));
  r.put('/sample-docs/:id', idempotent, (req, res) => { const b = parseSampleDoc(req.body); ok(res, docs.update(req.actor, parseId(req.params.id), b)); });
  r.post('/sample-docs/:id/submit', idempotentRequired, (req, res) => ok(res, docs.submit(req.actor, parseId(req.params.id), parseComment(req.body)), 201));
  r.post('/sample-docs/import', idempotentRequired, (req, res) => ok(res, docs.importRows(req.actor, parseSampleImport(req.body).rows), 201));
  r.post('/sample-docs/:id/amend', idempotentRequired, (req, res) => ok(res, docs.amend(req.actor, parseId(req.params.id)), 201));
  return r;
}

/**
 * The two routes a secure link opens before anybody is signed in (part 04.03, FR-06). The token is the proof of access: for one task and one person, short-lived, used
 * once. Each answer for a token that is not valid is the same, so a guess learns nothing; attempts are counted per address.
 */
export function approvalLinkRoutes({ inbox, isOn, companyOfToken }) {
  const r = Router();
  const hits = new Map();
  const limit = (req) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
    list.push(now);
    hits.set(key, list);
    if (list.length > 30) throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.');
  };
  const gate = (token) => { const c = companyOfToken(token); if (c == null || !isOn(c)) throw new HttpError(410, 'LINK_INVALID', 'This link has expired, was already used, or is not valid. Open the approval from your inbox instead.'); };
  r.get('/workflow/links/:token', (req, res, next) => { try { limit(req); const t = parseLinkToken(req.params.token); gate(t); res.json({ data: inbox.peekLink(t) }); } catch (e) { next(e); } });
  r.post('/workflow/links/:token/decide', (req, res, next) => { try { limit(req); const t = parseLinkToken(req.params.token); gate(t); res.json({ data: inbox.decideLink(t, parseLinkDecide(req.body), null, 'link') }); } catch (e) { next(e); } });
  return r;
}

/** /api/v1/pcs: the Protocol & Control Engine (part 04.04): control points, exceptions, reason codes, the dashboard and the control cycle of an object. */
export function protocolRoutes({ service, exportFile }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/control-points', (req, res) => ok(res, service.controls.list(req.actor, parseControlQuery(req.query))));
  r.get('/control-points/options', (req, res) => ok(res, service.controls.options()));
  r.post('/control-points', idempotent, (req, res) => ok(res, service.controls.create(req.actor, parseControlCreate(req.body)), 201));
  r.get('/control-points/:code', (req, res) => ok(res, service.controls.get(req.actor, parseControlCode(req.params.code))));
  r.put('/control-points/:code', idempotentRequired, (req, res) => { const out = service.controls.update(req.actor, parseControlCode(req.params.code), parseControlUpdate(req.body)); ok(res, out, out.applied ? 200 : 202); });
  r.delete('/control-points/:code', idempotent, (req, res) => ok(res, service.controls.remove(req.actor, parseControlCode(req.params.code))));
  r.get('/reason-codes', (req, res) => { const q = parseReasonQuery(req.query); ok(res, service.reasons.list(req.actor, { actionType: q.actionType, all: q.all })); });
  r.post('/reason-codes', idempotent, (req, res) => ok(res, service.reasons.save(req.actor, parseReasonSave(req.body)), 201));
  r.put('/reason-codes', idempotent, (req, res) => ok(res, service.reasons.save(req.actor, parseReasonSave(req.body))));
  r.get('/exceptions', (req, res) => ok(res, service.exceptions.list(req.actor, parseExceptionQuery(req.query))));
  r.get('/exceptions/export', (req, res) => { const out = exportFile(req.actor, parseExceptionExport(req.query)); res.set({ 'content-type': out.type, 'content-disposition': `attachment; filename="${out.fileName}"` }).send(out.buffer); });
  r.post('/exceptions', idempotent, (req, res) => ok(res, service.exceptions.create(req.actor, parseExceptionCreate(req.body)), 201));
  r.get('/exceptions/:id', (req, res) => ok(res, service.exceptions.get(req.actor, parseId(req.params.id))));
  r.put('/exceptions/:id', idempotent, (req, res) => ok(res, service.exceptions.update(req.actor, parseId(req.params.id), parseExceptionUpdate(req.body))));
  r.post('/exceptions/:id/submit', idempotentRequired, (req, res) => ok(res, service.exceptions.submit(req.actor, parseId(req.params.id), parseComment(req.body)), 201));
  r.post('/exceptions/:id/cancel', idempotentRequired, (req, res) => ok(res, service.exceptions.cancel(req.actor, parseId(req.params.id), parseCancel(req.body))));
  r.get('/dashboard', (req, res) => ok(res, service.dashboard(req.actor, parseDashboardQuery(req.query))));
  r.get('/cycle/:entity/:id', (req, res) => { const t = parseCycleTarget(req.params); ok(res, service.cycle(req.actor, t.entity, t.id)); });
  return r;
}

/** /api/v1/acc: accountability (part 04.05): the RACI of a scope, its gaps, the action ledger, the scores and My Accountability. */
export function accountabilityRoutes({ service, exportFile }, { idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/raci/scopes', (req, res) => ok(res, service.raci.scopes(req.actor)));
  r.get('/raci/templates', (req, res) => ok(res, service.raci.templates(req.actor)));
  r.get('/raci/gaps', (req, res) => { const q = parseGapQuery(req.query); ok(res, service.raci.gaps(req.actor, { projectId: q.projectId, onlyGaps: !q.all })); });
  r.get('/raci/resolve', (req, res) => ok(res, service.raci.resolve(req.actor, parseResolveQuery(req.query))));
  r.get('/raci/history', (req, res) => ok(res, service.raci.history(req.actor, parseRaciHistory(req.query))));
  r.get('/raci', (req, res) => ok(res, service.raci.get(req.actor, parseRaciScope(req.query))));
  r.post('/raci/changes', idempotentRequired, (req, res) => { const out = service.raci.propose(req.actor, parseRaciChange(req.body)); ok(res, out, out.applied ? 200 : 202); });
  r.post('/raci/apply-template', idempotentRequired, (req, res) => { const out = service.raci.applyTemplate(req.actor, parseApplyTemplate(req.body)); ok(res, out, out.applied ? 200 : 202); });
  r.get('/ledger', (req, res) => ok(res, service.ledger.list(req.actor, parseLedgerQuery(req.query))));
  r.get('/scores/export', (req, res) => { const out = exportFile(req.actor, parseScoreExport(req.query)); res.set({ 'content-type': out.type, 'content-disposition': `attachment; filename="${out.fileName}"` }).send(out.buffer); });
  r.get('/scores', (req, res) => ok(res, service.scores.list(req.actor, parseScoreQuery(req.query))));
  r.get('/me', (req, res) => ok(res, service.me(req.actor, parseMeQuery(req.query))));
  return r;
}

/** /api/v1/ntf: the notification engine (part 04.06): a person's notifications and preferences, the templates, the delivery log. */
export function notificationRoutes({ service, deliveriesFile }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/notifications', (req, res) => ok(res, service.centre.list(req.actor, parseNotificationQuery(req.query))));
  r.get('/notifications/counts', (req, res) => ok(res, service.centre.counts(req.actor)));
  r.post('/notifications/read-all', idempotent, (req, res) => ok(res, service.centre.readAll(req.actor, parseReadAll(req.body))));
  r.post('/notifications/test', idempotent, (req, res) => ok(res, service.centre.test(req.actor), 201));
  r.post('/notifications/:id/read', idempotent, (req, res) => ok(res, service.centre.mark(req.actor, parseId(req.params.id), true)));
  r.post('/notifications/:id/unread', idempotent, (req, res) => ok(res, service.centre.mark(req.actor, parseId(req.params.id), false)));
  r.post('/notifications/:id/archive', idempotent, (req, res) => ok(res, service.centre.archive(req.actor, parseId(req.params.id), true)));
  r.post('/notifications/:id/unarchive', idempotent, (req, res) => ok(res, service.centre.archive(req.actor, parseId(req.params.id), false)));
  r.get('/preferences', (req, res) => ok(res, service.preferences.get(req.actor)));
  r.put('/preferences', idempotent, (req, res) => ok(res, service.preferences.save(req.actor, parsePreferencesBody(req.body))));
  r.get('/templates', (req, res) => ok(res, service.templates.list(req.actor, parseTemplateQuery(req.query))));
  r.post('/templates/preview', (req, res) => ok(res, service.templates.preview(req.actor, parseTemplatePreview(req.body))));
  r.post('/templates/changes', idempotentRequired, (req, res) => ok(res, service.templates.propose(req.actor, parseTemplateChange(req.body)), 202));
  r.get('/templates/:code', (req, res) => ok(res, service.templates.get(req.actor, parseTemplateCode(req.params.code))));
  r.get('/deliveries/summary', (req, res) => ok(res, service.deliveries.summary(req.actor, parseDeliverySummary(req.query))));
  r.get('/deliveries/export', (req, res) => { const out = deliveriesFile(req.actor, parseDeliveryExport(req.query)); res.set({ 'content-type': out.type, 'content-disposition': `attachment; filename="${out.fileName}"` }).send(out.buffer); });
  r.get('/deliveries', (req, res) => ok(res, service.deliveries.list(req.actor, parseDeliveryQuery(req.query))));
  r.post('/deliveries/:id/retry', idempotent, (req, res) => ok(res, service.deliveries.retry(req.actor, parseId(req.params.id))));
  return r;
}

/** /api/v1/comm: the communication gateway (part 04.07): the log, the channel settings, consent and one-time codes. Providers' receipts arrive at /api/v1/core/webhooks/:connector (the hub, 01.08). */
export function communicationRoutes({ service, messagesFile }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/messages/summary', (req, res) => ok(res, service.messages.summary(req.actor, parseMessageSummary(req.query))));
  r.get('/messages/export', (req, res) => { const out = messagesFile(req.actor, parseMessageExport(req.query)); res.set({ 'content-type': out.type, 'content-disposition': `attachment; filename="${out.fileName}"` }).send(out.buffer); });
  r.get('/messages', (req, res) => ok(res, service.messages.list(req.actor, parseMessageQuery(req.query))));
  r.get('/messages/:id', (req, res) => ok(res, service.messages.get(req.actor, parseId(req.params.id))));
  r.post('/messages/:id/retry', idempotent, (req, res) => ok(res, service.messages.retry(req.actor, parseId(req.params.id))));
  r.get('/channels', (req, res) => ok(res, service.channels.get(req.actor)));
  r.post('/channels/changes', idempotentRequired, (req, res) => ok(res, service.channels.propose(req.actor, parseChannelChange(req.body)), 202));
  r.post('/channels/sample', idempotentRequired, async (req, res, next) => { try { ok(res, await service.channels.sample(req.actor, parseSample(req.body)), 201); } catch (e) { next(e); } });
  r.post('/whatsapp/templates/sync', idempotent, async (req, res, next) => { try { ok(res, await service.channels.syncWhatsapp(req.actor)); } catch (e) { next(e); } });
  r.get('/consents', (req, res) => ok(res, service.consents.list(req.actor, parseConsentQuery(req.query))));
  r.post('/consents', idempotent, (req, res) => ok(res, service.consents.set(req.actor, parseConsent(req.body)), 201));
  r.post('/consents/import', idempotentRequired, (req, res) => ok(res, service.consents.import(req.actor, parseConsentImport(req.body).rows), 201));
  r.get('/consents/:id/history', (req, res) => ok(res, service.consents.history(req.actor, parseId(req.params.id))));
  r.post('/otp/send', idempotentRequired, async (req, res, next) => { try { ok(res, await service.otps.send(req.actor, parseOtpSend(req.body)), 201); } catch (e) { next(e); } });
  r.post('/otp/verify', idempotent, (req, res) => ok(res, service.otps.verify(req.actor, parseOtpVerify(req.body))));
  return r;
}

/** /api/v1/tsk: tasks (part 04.08): your own, your team's, instructions from seniors, and the department responsibility matrix. Other modules make tasks through tasksOf(db).create. */
export function taskRoutes({ service, tasksFile }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/tasks/counts', (req, res) => ok(res, service.tasks.counts(req.actor)));
  r.get('/tasks/route', (req, res) => ok(res, service.tasks.routePreview(req.actor, parseRoutePreview(req.query))));
  r.get('/tasks/export', (req, res) => { const out = tasksFile(req.actor, parseTaskExport(req.query)); res.set({ 'content-type': out.type, 'content-disposition': `attachment; filename="${out.fileName}"` }).send(out.buffer); });
  r.get('/tasks', (req, res) => ok(res, service.tasks.list(req.actor, parseTskQuery(req.query))));
  r.post('/tasks', idempotentRequired, (req, res) => ok(res, service.tasks.create(req.actor, parseTaskCreate(req.body)), 201));
  r.post('/instructions', idempotentRequired, (req, res) => ok(res, service.tasks.instruct(req.actor, parseInstruction(req.body)), 201));
  r.get('/tasks/:id', (req, res) => ok(res, service.tasks.get(req.actor, parseId(req.params.id))));
  r.patch('/tasks/:id', idempotent, (req, res) => ok(res, service.tasks.update(req.actor, parseId(req.params.id), parseTaskUpdate(req.body))));
  for (const action of ['accept', 'start', 'block', 'unblock', 'complete', 'verify', 'close', 'reopen', 'cancel']) r.post(`/tasks/:id/${action}`, idempotent, (req, res) => ok(res, service.tasks.act(req.actor, parseId(req.params.id), action, parseTaskAct(req.body))));
  r.post('/tasks/:id/comments', idempotent, (req, res) => ok(res, service.tasks.comment(req.actor, parseId(req.params.id), parseTaskComment(req.body).body), 201));
  r.post('/tasks/:id/checklist', idempotent, (req, res) => ok(res, service.tasks.checklist(req.actor, parseId(req.params.id), parseTaskChecklist(req.body))));
  r.post('/tasks/:id/dependencies', idempotent, (req, res) => ok(res, service.tasks.depend(req.actor, parseId(req.params.id), parseTaskDepend(req.body))));
  r.put('/tasks/:id/people', idempotent, (req, res) => ok(res, service.tasks.people(req.actor, parseId(req.params.id), parseTaskPeople(req.body))));
  r.get('/dashboard', (req, res) => ok(res, service.dashboard(req.actor, parseTaskDashboard(req.query))));
  r.get('/routing', (req, res) => ok(res, service.routing.list(req.actor)));
  r.post('/routing/changes', idempotentRequired, (req, res) => ok(res, service.routing.propose(req.actor, parseRoutingChange(req.body)), 202));
  return r;
}
