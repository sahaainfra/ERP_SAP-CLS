import { Router } from 'express';
import { HttpError } from '../../platform/http/errors.js';
import { parseXlCommit, parseXlDesigner, parseXlExport, parseXlJobs, parseXlPage, parseXlType, parseXlUpload, parseSigConfig, parseSigExport, parseSigProfile, parseSigQuery, parseSigReason, parseSigSign, parseVerifyCode, parseTplBulk, parseTplCatalogue, parseTplCreate, parseTplDeliver, parseTplGenerate, parseTplGeneratedExport, parseTplGeneratedQuery, parseTplLink, parseTplPreview, parseTplQuery, parseTplRecord, parseTplRecordQuery, parseTplRule, parseTplUpdate, parseTplValidate, parseTplVerify, parseAcknowledge, parseAnnotation, parseAnnotationSet, parseFolderTemplate, parseBulkQuery, parseCompare, parseContentQuery, parseDistribute, parseDocConfig, parseDocCreate, parseDocExport, parseDocNote, parseDocQuery, parseDocUpdate, parseFolderCreate, parseFolderQuery, parseReason, parseRevision, parseShare, parseZip, parseAdopt, parseAlertAct, parseAlertBulk, parseAlertDraft, parseAlertExport, parseAlertQuery, parseAlertRule, parseEnable, parseRuleCode, parseRunsQuery, parseRoutePreview, parseRoutingChange, parseTaskAct, parseTaskChecklist, parseTaskComment, parseTaskCreate, parseTaskDashboard, parseTaskDepend, parseTaskExport, parseTaskPeople, parseTskQuery, parseTaskUpdate, parseInstruction, parseChannelChange, parseConsent, parseConsentImport, parseConsentQuery, parseMessageExport, parseMessageQuery, parseMessageSummary, parseOtpSend, parseOtpVerify, parseSample, parseDeliveryExport, parseDeliveryQuery, parseDeliverySummary, parseNotificationQuery, parsePreferencesBody, parseReadAll, parseTemplateChange, parseTemplateCode, parseTemplatePreview, parseTemplateQuery, parseApplyTemplate, parseGapQuery, parseLedgerQuery, parseMeQuery, parseRaciChange, parseRaciHistory, parseRaciScope, parseResolveQuery, parseScoreExport, parseScoreQuery, parseControlCode, parseControlCreate, parseControlQuery, parseControlUpdate, parseCycleTarget, parseDashboardQuery, parseExceptionCreate, parseExceptionExport, parseExceptionQuery, parseExceptionUpdate, parseReasonQuery, parseReasonSave, parseSampleImport, parseBulkAct, parseInboxQuery, parseLinkDecide, parseLinkIssue, parseLinkToken, parsePolicyChange, parseSubmissionsQuery, parseActivate, parseDelegation, parseDelegationQuery, parseLimitChanges, parseLimitHistory, parseMatrixCreate, parseMatrixQuery, parseMatrixUpdate, parsePathChange, parseRevoke, parseSimulate, parseSlaChange, parseAct, parseAssign, parseCancel, parseComment, parseDefinitionCreate, parseDefinitionQuery, parseDefinitionUpdate, parseDocId, parseDocType, parseDraftFrom, parseId, parseInstanceQuery, parseMonitorQuery, parseSampleDoc, parseSampleQuery, parseSubmit, parseTaskQuery, parseColRecord, parseColComment, parseColEdit, parseColDelete, parseColReaction, parseColTimeline, parseColFeed, parseColTrace, parseColLink, parseColMentions, parseColRead } from './validators.js';

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

/** /api/v1/alr: the alert rules and the alerts they raise (part 04.09). */
export function alertRoutes({ service, alertsFile }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/builder', (req, res) => ok(res, service.rules.builder(req.actor)));
  r.get('/runs', (req, res) => ok(res, service.rules.runs(req.actor, parseRunsQuery(req.query))));
  r.get('/rules', (req, res) => ok(res, service.rules.list(req.actor)));
  r.post('/rules', idempotentRequired, (req, res) => { const out = service.rules.propose(req.actor, parseAlertRule(req.body)); ok(res, out, out.status === 'PENDING' ? 202 : 201); });
  r.post('/rules/dry-run', idempotent, (req, res) => ok(res, service.rules.dryRun(req.actor, null, parseAlertDraft(req.body))));
  r.post('/rules/library/:code/adopt', idempotentRequired, (req, res) => { const out = service.rules.adopt(req.actor, parseRuleCode(req.params.code), parseAdopt(req.body)); ok(res, out, out.status === 'PENDING' ? 202 : 201); });
  r.get('/rules/:code', (req, res) => ok(res, service.rules.get(req.actor, parseRuleCode(req.params.code))));
  r.post('/rules/:code/dry-run', idempotent, (req, res) => ok(res, service.rules.dryRun(req.actor, parseRuleCode(req.params.code))));
  r.post('/rules/:code/enabled', idempotentRequired, (req, res) => { const b = parseEnable(req.body); ok(res, service.rules.setEnabled(req.actor, parseRuleCode(req.params.code), b.enabled, b.reason)); });
  r.post('/rules/:code/run', idempotentRequired, (req, res) => ok(res, service.rules.run(req.actor, parseRuleCode(req.params.code))));
  r.get('/alerts/summary', (req, res) => ok(res, service.alerts.summary(req.actor)));
  r.get('/alerts/export', (req, res) => { const out = alertsFile(req.actor, parseAlertExport(req.query)); res.set({ 'content-type': out.type, 'content-disposition': `attachment; filename="${out.fileName}"` }).send(out.buffer); });
  r.get('/alerts', (req, res) => ok(res, service.alerts.list(req.actor, parseAlertQuery(req.query))));
  r.post('/alerts/bulk', idempotentRequired, (req, res) => ok(res, service.alerts.bulk(req.actor, parseAlertBulk(req.body))));
  r.get('/alerts/:id', (req, res) => ok(res, service.alerts.get(req.actor, parseId(req.params.id))));
  r.post('/alerts/:id/ack', idempotent, (req, res) => ok(res, service.alerts.act(req.actor, parseId(req.params.id), 'ack', parseAlertAct(req.body).note)));
  r.post('/alerts/:id/resolve', idempotent, (req, res) => ok(res, service.alerts.act(req.actor, parseId(req.params.id), 'resolve', parseAlertAct(req.body).note)));
  return r;
}

/** /api/v1/doc: the document register and what goes with it (part 04.10). The files themselves go in and out through the file service (as `doc_version`) and the content route here. */
export function documentRoutes({ service, ops, config, documentsFile, bulkBody }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const d = service.documents;
  r.get('/types', (req, res) => ok(res, { types: service.types.list(req.actor.companyId), templates: service.templates.list(req.actor.companyId) }));
  r.get('/documents/export', (req, res) => { const out = documentsFile(req.actor, parseDocExport(req.query)); res.set({ 'content-type': out.type, 'content-disposition': `attachment; filename="${out.fileName}"` }).send(out.buffer); });
  r.post('/documents/zip', idempotent, async (req, res, next) => { try { const out = await ops.zip(req.actor, parseZip(req.body).ids); res.set({ 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-included': String(out.included), 'x-not-included': String(out.left.length) }).send(out.buffer); } catch (e) { next(e); } });
  r.get('/documents', (req, res) => ok(res, d.list(req.actor, parseDocQuery(req.query))));
  r.post('/documents', idempotentRequired, (req, res) => ok(res, d.create(req.actor, parseDocCreate(req.body)), 201));
  r.get('/documents/:id', (req, res) => ok(res, d.get(req.actor, parseId(req.params.id))));
  r.patch('/documents/:id', idempotent, (req, res) => ok(res, d.update(req.actor, parseId(req.params.id), parseDocUpdate(req.body))));
  r.get('/documents/:id/compare', (req, res) => { const q = parseCompare(req.query); ok(res, d.compare(req.actor, parseId(req.params.id), q.from, q.to)); });
  r.post('/documents/:id/checkout', idempotent, (req, res) => ok(res, d.checkOut(req.actor, parseId(req.params.id), parseDocNote(req.body).note)));
  r.post('/documents/:id/checkin', idempotent, (req, res) => ok(res, d.checkIn(req.actor, parseId(req.params.id), { reason: parseDocNote(req.body).reason })));
  r.post('/documents/:id/revisions', idempotentRequired, (req, res) => ok(res, d.newRevision(req.actor, parseId(req.params.id), parseRevision(req.body)), 201));
  r.post('/documents/:id/submit', idempotentRequired, (req, res) => ok(res, d.submit(req.actor, parseId(req.params.id)), 202));
  r.post('/documents/:id/archive', idempotent, (req, res) => ok(res, d.archive(req.actor, parseId(req.params.id), parseReason(req.body).reason)));
  r.post('/documents/:id/cancel', idempotent, (req, res) => ok(res, d.cancel(req.actor, parseId(req.params.id), parseReason(req.body).reason)));
  r.post('/documents/:id/distribute', idempotentRequired, (req, res) => ok(res, service.distribution.send(req.actor, parseId(req.params.id), parseDistribute(req.body)), 201));
  r.post('/documents/:id/acknowledge', idempotent, (req, res) => ok(res, service.distribution.acknowledge(req.actor, parseId(req.params.id), parseAcknowledge(req.body).note)));
  r.post('/documents/:id/shares', idempotent, (req, res) => ok(res, service.shares.add(req.actor, parseId(req.params.id), parseShare(req.body)), 201));
  r.delete('/documents/:id/shares/:shareId', idempotent, (req, res) => ok(res, service.shares.remove(req.actor, parseId(req.params.id), parseId(req.params.shareId))));
  r.get('/versions/:id', (req, res) => ok(res, service.versions.locate(req.actor, parseId(req.params.id))));
  r.get('/versions/:id/content', async (req, res, next) => {
    try {
      const out = await ops.content(req.actor, parseId(req.params.id), { download: parseContentQuery(req.query).download, range: req.get('range') });
      res.status(out.status).set(out.headers);
      if (out.stream) out.stream.on('error', next).pipe(res); else res.end(out.buffer);
    } catch (e) { next(e); }
  });
  r.get('/versions/:id/annotations', (req, res) => ok(res, service.annotations.list(req.actor, parseId(req.params.id))));
  r.post('/versions/:id/annotations', idempotent, (req, res) => ok(res, service.annotations.add(req.actor, parseId(req.params.id), parseAnnotation(req.body)), 201));
  r.patch('/annotations/:id', idempotent, (req, res) => ok(res, service.annotations.set(req.actor, parseId(req.params.id), parseAnnotationSet(req.body))));
  r.get('/folders', (req, res) => ok(res, service.folders.tree(req.actor, parseFolderQuery(req.query).projectId ?? null)));
  r.post('/folders', idempotent, (req, res) => ok(res, service.folders.create(req.actor, parseFolderCreate(req.body)), 201));
  r.post('/projects/:id/folder-template', idempotent, (req, res) => ok(res, service.folders.applyTemplate(req.actor, parseId(req.params.id), parseFolderTemplate(req.body).template), 201));
  r.get('/bulk-template', (req, res) => res.set({ 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': 'attachment; filename="documents-to-register.xlsx"' }).send(ops.template()));
  r.post('/bulk-upload', bulkBody, async (req, res, next) => { try { const q = parseBulkQuery(req.query); ok(res, await ops.bulkImport(req.actor, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), { commit: q.commit === '1' }), q.commit === '1' ? 201 : 200); } catch (e) { next(e); } });
  r.get('/config', (req, res) => ok(res, config.get(req.actor)));
  r.post('/config/changes', idempotentRequired, (req, res) => ok(res, config.propose(req.actor, parseDocConfig(req.body)), 202));
  return r;
}

/** Part 04.11: templates, records, generation, delivery. `signed` is the public router (signed download link and verification). */
export function templateRoutes({ service, generatedFile }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const t = service.templates;
  const pipe = (res, out, next) => { res.status(200).set(out.headers); out.stream.on('error', next).pipe(res); };
  r.get('/templates', (req, res) => ok(res, t.list(req.actor, parseTplQuery(req.query))));
  r.get('/templates/catalogue', (req, res) => ok(res, t.catalogue(req.actor, parseTplCatalogue(req.query).docType)));
  r.post('/templates/validate', (req, res) => ok(res, t.validate(req.actor, parseTplValidate(req.body))));
  r.post('/templates/preview', async (req, res, next) => { try { const out = await service.preview(req.actor, parseTplPreview(req.body)); res.status(200).set({ 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${out.fileName}"`, 'cache-control': 'no-store', 'x-pdf-pages': String(out.pages) }).send(out.buffer); } catch (e) { next(e); } });
  r.post('/templates', idempotentRequired, (req, res) => ok(res, t.create(req.actor, parseTplCreate(req.body)), 201));
  r.get('/templates/:id', (req, res) => ok(res, t.get(req.actor, parseId(req.params.id))));
  r.patch('/templates/:id', idempotent, (req, res) => ok(res, t.update(req.actor, parseId(req.params.id), parseTplUpdate(req.body))));
  r.post('/templates/:id/submit', idempotentRequired, (req, res) => ok(res, t.submit(req.actor, parseId(req.params.id)), 202));
  r.delete('/templates/:id', idempotent, (req, res) => ok(res, t.discard(req.actor, parseId(req.params.id))));
  r.get('/records', (req, res) => ok(res, service.records.list(req.actor, parseTplRecordQuery(req.query))));
  r.put('/records', idempotentRequired, (req, res) => ok(res, service.records.publish(req.actor, parseTplRecord(req.body))));
  r.get('/records/:id', (req, res) => ok(res, service.records.get(req.actor, parseId(req.params.id))));
  r.post('/generate', idempotentRequired, async (req, res, next) => { try { ok(res, await service.generate(req.actor, parseTplGenerate(req.body)), 201); } catch (e) { next(e); } });
  r.post('/generate/bulk', idempotentRequired, async (req, res, next) => { try { ok(res, await service.bulk.start(req.actor, parseTplBulk(req.body)), 202); } catch (e) { next(e); } });
  r.get('/generate/bulk/:id', (req, res) => ok(res, service.bulk.get(req.actor, parseId(req.params.id))));
  r.get('/generated', (req, res) => ok(res, service.generated.list(req.actor, parseTplGeneratedQuery(req.query))));
  r.get('/generated/export', (req, res) => { const out = generatedFile(req.actor, parseTplGeneratedExport(req.query)); res.set({ 'content-type': out.type, 'content-disposition': `attachment; filename="${out.fileName}"` }).send(out.buffer); });
  r.get('/generated/:id', (req, res) => ok(res, service.generated.get(req.actor, parseId(req.params.id))));
  r.get('/generated/:id/content', async (req, res, next) => { try { pipe(res, await service.generated.content(req.actor, parseId(req.params.id), { download: req.query.download === '1' }), next); } catch (e) { next(e); } });
  r.post('/generated/:id/deliver', idempotentRequired, (req, res) => ok(res, service.delivery.send(req.actor, parseId(req.params.id), parseTplDeliver(req.body)), 201));
  r.get('/deliveries', (req, res) => ok(res, service.delivery.list(req.actor, { limit: req.query.limit })));
  r.get('/rules', (req, res) => ok(res, service.rules.list(req.actor)));
  r.put('/rules', idempotent, (req, res) => ok(res, service.rules.set(req.actor, parseTplRule(req.body))));
  return r;
}

/** The two routes that need no sign-in: the signed link in a delivered message, and the page a QR code leads to. */
export function templatePublicRoutes({ service }) {
  const r = Router();
  r.get('/tpl/generated/:id/file', async (req, res, next) => {
    try {
      const q = parseTplLink(req.query);
      const out = await service.generated.linked(parseId(req.params.id), q);
      res.status(200).set(out.headers);
      out.stream.on('error', next).pipe(res);
    } catch (e) { next(e); }
  });
  r.get('/tpl/verify/:code', (req, res) => res.status(200).json({ data: service.generated.verify(parseTplVerify(req.params.code)) }));
  return r;
}

/** Part 04.12: signatures, the register, the settings (signed-in people). */
export function signatureRoutes({ service, registerFile }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/register', (req, res) => ok(res, service.register.list(req.actor, parseSigQuery(req.query))));
  r.get('/register/export', (req, res) => { const out = registerFile(req.actor, parseSigExport(req.query)); res.set({ 'content-type': out.type, 'content-disposition': `attachment; filename="${out.fileName}"` }).send(out.buffer); });
  r.get('/documents/:id', (req, res) => ok(res, service.signer.detail(req.actor, parseId(req.params.id))));
  r.post('/documents/:id/sign', idempotentRequired, async (req, res, next) => { try { ok(res, await service.signer.sign(req.actor, parseId(req.params.id), parseSigSign(req.body), req.ip), 201); } catch (e) { next(e); } });
  r.post('/documents/:id/cancel', idempotentRequired, (req, res) => ok(res, service.signer.cancel(req.actor, parseId(req.params.id), parseSigReason(req.body).reason)));
  r.get('/documents/:id/signed', async (req, res, next) => { try { const out = await service.signer.content(req.actor, parseId(req.params.id)); res.status(200).set(out.headers); out.stream.on('error', next).pipe(res); } catch (e) { next(e); } });
  r.post('/signatures/:id/revoke', idempotentRequired, async (req, res, next) => { try { ok(res, await service.signer.revoke(req.actor, parseId(req.params.id), parseSigReason(req.body).reason)); } catch (e) { next(e); } });
  r.get('/verify/:code', (req, res) => ok(res, service.signer.detailByCode(req.actor, parseVerifyCode(req.params.code))));
  r.get('/profile', (req, res) => ok(res, service.profile.get(req.actor)));
  r.put('/profile', idempotent, async (req, res, next) => { try { ok(res, await service.profile.put(req.actor, parseSigProfile(req.body).image)); } catch (e) { next(e); } });
  r.delete('/profile', idempotent, (req, res) => ok(res, service.profile.remove(req.actor)));
  r.get('/config', (req, res) => ok(res, service.config.get(req.actor)));
  r.post('/config/changes', idempotentRequired, (req, res) => ok(res, service.config.propose(req.actor, parseSigConfig(req.body)), 202));
  return r;
}

/** The public check (no sign-in): what a QR code leads to, and the comparison of a file with the stored hash. `fileBody` reads the raw file. */
export function verifyPublicRoutes({ service, fileBody, isOn }) {
  const r = Router();
  r.use('/verify/:code', (req, res, next) => (isOn(service.companyOfCode(req.params.code)) ? next() : next(new HttpError(404, 'NOT_FOUND', 'No document of this system carries this code.'))));
  r.get('/verify/:code', (req, res) => res.status(200).json({ data: service.signer.verify(parseVerifyCode(req.params.code)) }));
  r.post('/verify/:code/file', fileBody, (req, res) => {
    const code = parseVerifyCode(req.params.code);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'VALIDATION_FAILED', 'Send the file to compare as the body of the request.', [{ field: 'file', message: 'The file is empty.' }]);
    res.status(200).json({ data: service.signer.verify(code, { file: req.body }) });
  });
  return r;
}

/** Part 04.13: the Excel engine. `fileBody` reads the raw workbook of an upload. */
export function excelRoutes({ service, fileBody }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const send = (res, out, type) => res.status(200).set({ 'content-type': type, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  r.get('/templates', (req, res) => ok(res, { types: service.templates.types(req.actor) }));
  r.get('/templates/:type/download', (req, res) => send(res, service.templates.download(req.actor, parseXlType(req.params.type)), XLSX));
  r.get('/templates/:type/export', (req, res) => send(res, service.templates.exportData(req.actor, parseXlType(req.params.type)), XLSX));
  r.get('/designer', (req, res) => ok(res, service.templates.config(req.actor)));
  r.post('/designer/changes', idempotentRequired, (req, res) => ok(res, service.templates.propose(req.actor, parseXlDesigner(req.body)), 202));
  r.post('/jobs', fileBody, idempotentRequired, async (req, res, next) => { try { const q = parseXlUpload(req.query); ok(res, await service.job.upload(req.actor, { importType: q.type, fileName: q.fileName, buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), onExisting: q.onExisting }), 202); } catch (e) { next(e); } });
  r.get('/jobs', (req, res) => ok(res, service.job.list(req.actor, parseXlJobs(req.query))));
  r.get('/jobs/:id', (req, res) => ok(res, service.job.get(req.actor, parseId(req.params.id))));
  r.get('/jobs/:id/preview', async (req, res, next) => { try { const q = parseXlPage(req.query); ok(res, await service.job.preview(req.actor, parseId(req.params.id), q)); } catch (e) { next(e); } });
  r.get('/jobs/:id/errors', async (req, res, next) => { try { const q = parseXlPage(req.query); if (q.format === 'xlsx') send(res, await service.job.errorFile(req.actor, parseId(req.params.id)), XLSX); else ok(res, service.job.errors(req.actor, parseId(req.params.id), q)); } catch (e) { next(e); } });
  r.post('/jobs/:id/commit', idempotentRequired, (req, res) => ok(res, service.job.commit(req.actor, parseId(req.params.id), parseXlCommit(req.body)), 202));
  r.post('/jobs/:id/cancel', idempotent, (req, res) => ok(res, service.job.cancel(req.actor, parseId(req.params.id))));
  r.get('/exports', (req, res) => ok(res, { exports: service.exports.list(req.actor) }));
  r.get('/exports/:code', (req, res) => { const q = parseXlExport(req.query); const out = service.exports.run(req.actor, String(req.params.code).slice(0, 60), { format: q.format, filters: { status: q.status, importType: q.importType } }); res.status(200).set({ 'content-type': out.type, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store' }).send(out.buffer); });
  return r;
}

/** Part 04.14: comments, mentions, activity timeline and record trace links. The record is reached through the object type registry, so every route checks the person's right to the record itself. */
export function collabRoutes({ service }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/comments', (req, res) => ok(res, service.comments.list(req.actor, parseColRecord(req.query))));
  r.post('/comments', idempotentRequired, (req, res) => ok(res, service.comments.create(req.actor, parseColComment(req.body)), 201));
  r.patch('/comments/:id', idempotentRequired, (req, res) => ok(res, service.comments.edit(req.actor, parseId(req.params.id), parseColEdit(req.body))));
  r.delete('/comments/:id', idempotent, (req, res) => ok(res, service.comments.remove(req.actor, parseId(req.params.id), parseColDelete(Object.keys(req.body ?? {}).length ? req.body : { reason: req.query.reason }))));
  r.post('/comments/:id/reactions', idempotent, (req, res) => ok(res, service.comments.react(req.actor, parseId(req.params.id), parseColReaction(req.body))));
  r.get('/timeline', (req, res) => ok(res, service.timeline.record(req.actor, parseColTimeline(req.query))));
  r.get('/feed', (req, res) => ok(res, service.timeline.project(req.actor, parseColFeed(req.query))));
  r.get('/trace', (req, res) => ok(res, service.trace.graph(req.actor, parseColTrace(req.query))));
  r.post('/trace/links', idempotentRequired, (req, res) => ok(res, service.trace.addManual(req.actor, parseColLink(req.body)), 201));
  r.delete('/trace/links/:id', idempotent, (req, res) => ok(res, service.trace.removeManual(req.actor, parseId(req.params.id), parseColDelete(Object.keys(req.body ?? {}).length ? req.body : { reason: req.query.reason }))));
  r.get('/mentions', (req, res) => ok(res, service.mentions.list(req.actor, parseColMentions(req.query))));
  r.post('/mentions/read', idempotent, (req, res) => ok(res, service.mentions.markRead(req.actor, parseColRead(req.body))));
  return r;
}
