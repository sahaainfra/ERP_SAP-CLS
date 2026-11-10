import { Router } from 'express';
import {
  parseActivityCreate, parseActivityList, parseActivityUpdate, parseAmend, parseBoqLinks, parseBulk, parseCalendarCreate, parseCalendarDays, parseCalendarUpdate, parseDepCreate, parseGenerate, parseId, parseImport,
  parseProgress, parseProjectQ, parseReason, parseScheduleCreate, parseScheduleUpdate, parseTemplateCreate,
  parseCapacity, parseDrillQ, parseGanttEdit, parseHistogramExportQ, parseHistogramQ, parseProgrammeQ, parseResourceOptionsQ, parseResources, parseUndo,
  parseConstraintCreate, parseConstraintUpdate, parseDailyPlanQ, parseLookaheadQ, parseLookaheadSave, parseNote, parsePpcExportQ, parsePpcQ, parseRecord, parseWeeklyCreate, parseWeeklyUpdate,
  parseBaselineAmend, parseBaselineCreate, parseBaselineUpdate, parseExchangeQ, parseImportApply, parseImportFileQ, parseImportListQ, parseImportUpdate, parseQualityExportQ, parseQualityQ, parseVarianceExportQ, parseVarianceQ,
} from './validators.js';

/** /api/v1/plan: the schedule core (part 13.01). Rights and scope are checked in the service. */
export function planRoutes(svc, { exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router(); const p = svc.plan;
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const csv = (res, out) => res.status(200).set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.name}"`, 'cache-control': 'no-store' }).send(out.body);
  r.get('/projects', (req, res) => ok(res, p.schedules.projects(req.actor)));
  r.get('/options', (req, res) => ok(res, p.schedules.options(req.actor, parseId(req.query.projectId))));
  r.get('/current', (req, res) => ok(res, p.schedules.current(req.actor, parseId(req.query.projectId), { working: req.query.working === 'true' })));
  // calendars
  r.get('/calendars', (req, res) => ok(res, p.calendars.list(req.actor, parseProjectQ(req.query))));
  r.post('/calendars', idempotentRequired, (req, res) => ok(res, p.calendars.create(req.actor, parseCalendarCreate(req.body)), 201));
  r.get('/calendars/:id', (req, res) => ok(res, p.calendars.get(req.actor, pid(req))));
  r.patch('/calendars/:id', idempotent, (req, res) => ok(res, p.calendars.update(req.actor, pid(req), parseCalendarUpdate(req.body))));
  r.post('/calendars/:id/activate', idempotentRequired, (req, res) => ok(res, p.calendars.activate(req.actor, pid(req))));
  r.post('/calendars/:id/cancel', idempotent, (req, res) => ok(res, p.calendars.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/calendars/:id/days', (req, res) => ok(res, p.calendars.days(req.actor, pid(req), parseCalendarDays(req.query))));
  r.get('/calendars/:id/history', (req, res) => ok(res, p.calendars.history(req.actor, pid(req))));
  // templates
  r.get('/templates', (req, res) => ok(res, p.templates.list(req.actor)));
  r.post('/templates', idempotentRequired, (req, res) => ok(res, p.templates.create(req.actor, parseTemplateCreate(req.body)), 201));
  r.post('/templates/:id/activate', idempotentRequired, (req, res) => ok(res, p.templates.activate(req.actor, pid(req))));
  r.post('/templates/:id/cancel', idempotent, (req, res) => ok(res, p.templates.cancel(req.actor, pid(req), parseReason(req.body))));
  // schedules
  r.get('/schedules', (req, res) => res.json(p.schedules.list(req.actor, req.query)));
  r.get('/schedules/export', (req, res) => {
    const x = exportsOf(); if (!x) throw new Error('The list export service is not running');
    const out = x.start(req.actor, 'plan.schedules', req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  });
  r.post('/schedules', idempotentRequired, (req, res) => ok(res, p.schedules.create(req.actor, parseScheduleCreate(req.body)), 201));
  r.get('/schedules/:id', (req, res) => ok(res, p.schedules.get(req.actor, pid(req))));
  r.patch('/schedules/:id', idempotent, (req, res) => ok(res, p.schedules.update(req.actor, pid(req), parseScheduleUpdate(req.body))));
  r.delete('/schedules/:id', (req, res) => ok(res, p.schedules.remove(req.actor, pid(req))));
  r.post('/schedules/:id/submit', idempotentRequired, (req, res) => ok(res, p.schedules.submit(req.actor, pid(req)), 202));
  r.post('/schedules/:id/withdraw', idempotent, (req, res) => ok(res, p.schedules.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/schedules/:id/cancel', idempotent, (req, res) => ok(res, p.schedules.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/schedules/:id/amend', idempotentRequired, (req, res) => ok(res, p.schedules.amend(req.actor, pid(req), parseAmend(req.body)), 201));
  r.get('/schedules/:id/history', (req, res) => ok(res, p.schedules.history(req.actor, pid(req))));
  r.get('/schedules/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(p.schedules.print(req.actor, pid(req))));
  r.post('/schedules/:id/import', idempotentRequired, (req, res) => ok(res, p.schedules.import(req.actor, pid(req), parseImport(req.body)), 201));
  r.post('/schedules/:id/calculate', idempotent, (req, res) => ok(res, p.schedules.calculate(req.actor, pid(req))));
  r.post('/schedules/:id/update-progress', idempotentRequired, (req, res) => ok(res, p.schedules.progress(req.actor, pid(req), parseProgress(req.body))));
  r.get('/schedules/:id/critical', (req, res) => ok(res, p.critical(req.actor, pid(req), { near: Math.max(0, Math.min(100, Number(req.query.near ?? 5) || 0)) })));
  r.get('/schedules/:id/critical/export', (req, res) => csv(res, p.criticalCsv(req.actor, pid(req))));
  r.post('/schedules/:id/generate/preview', (req, res) => ok(res, p.generate.preview(req.actor, pid(req), parseGenerate(req.body))));
  r.post('/schedules/:id/generate', idempotentRequired, (req, res) => ok(res, p.generate.run(req.actor, pid(req), parseGenerate(req.body)), 201));
  // activities and links
  r.get('/schedules/:id/activities', (req, res) => ok(res, p.activities.list(req.actor, pid(req), parseActivityList(req.query))));
  r.post('/schedules/:id/activities', idempotentRequired, (req, res) => ok(res, p.activities.create(req.actor, pid(req), parseActivityCreate(req.body)), 201));
  r.patch('/schedules/:id/activities', idempotent, (req, res) => ok(res, p.activities.bulk(req.actor, pid(req), parseBulk(req.body))));
  r.post('/schedules/:id/dependencies', idempotentRequired, (req, res) => ok(res, p.links.create(req.actor, pid(req), parseDepCreate(req.body)), 201));
  r.get('/activities/:id', (req, res) => ok(res, p.activities.get(req.actor, pid(req))));
  r.patch('/activities/:id', idempotent, (req, res) => ok(res, p.activities.update(req.actor, pid(req), parseActivityUpdate(req.body))));
  r.delete('/activities/:id', (req, res) => ok(res, p.activities.remove(req.actor, pid(req))));
  r.put('/activities/:id/boq', idempotent, (req, res) => ok(res, p.activities.setBoq(req.actor, pid(req), parseBoqLinks(req.body))));
  r.delete('/dependencies/:id', (req, res) => ok(res, p.links.remove(req.actor, pid(req))));
  return r;
}

/** /api/v1/plan: the Gantt, its edits, resources, availability, histograms and the printable programme (part 13.02, behind ff.plan.p1302). */
export function ganttRoutes(g, programme, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  r.get('/schedules/:id/gantt', (req, res) => ok(res, g.data(req.actor, pid(req))));
  r.post('/schedules/:id/gantt/check', (req, res) => ok(res, g.edit(req.actor, pid(req), parseGanttEdit(req.body), { dryRun: true })));
  r.post('/schedules/:id/gantt/edits', idempotentRequired, (req, res) => ok(res, g.edit(req.actor, pid(req), parseGanttEdit(req.body)), 201));
  r.get('/schedules/:id/gantt/edits', (req, res) => ok(res, g.edits(req.actor, pid(req))));
  r.post('/schedules/:id/gantt/undo', idempotentRequired, (req, res) => ok(res, g.undo(req.actor, pid(req), parseUndo(req.body))));
  r.get('/schedules/:id/histogram', (req, res) => ok(res, g.histogram(req.actor, pid(req), parseHistogramQ(req.query))));
  r.get('/schedules/:id/histogram/drill', (req, res) => ok(res, g.drill(req.actor, pid(req), parseDrillQ(req.query))));
  r.get('/schedules/:id/histogram/export', (req, res) => { const out = g.histogramExport(req.actor, pid(req), parseHistogramExportQ(req.query)); res.status(200).set({ 'content-type': out.type, 'content-disposition': `attachment; filename="${out.name}"`, 'cache-control': 'no-store' }).send(out.body); });
  r.get('/schedules/:id/loading', (req, res) => ok(res, g.loading(req.actor, pid(req))));
  r.get('/schedules/:id/programme', async (req, res, next) => {
    try {
      const out = await programme.render(req.actor, pid(req), parseProgrammeQ(req.query));
      if (out.kind === 'json') return ok(res, out.body);
      const type = out.kind === 'svg' ? 'image/svg+xml' : 'application/pdf';
      return res.status(200).set({ 'content-type': type, 'content-disposition': `attachment; filename="${out.name}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', ...(out.pages ? { 'x-pages': String(out.pages) } : {}) }).send(out.body);
    } catch (e) { return next(e); }
  });
  r.get('/resource-options', (req, res) => ok(res, g.resourceOptions(req.actor, parseResourceOptionsQ(req.query))));
  r.get('/activities/:id/resources', (req, res) => ok(res, g.resourcesOf(req.actor, pid(req))));
  r.put('/activities/:id/resources', idempotent, (req, res) => ok(res, g.saveResources(req.actor, pid(req), parseResources(req.body))));
  r.get('/activities/:id/resources/norms', (req, res) => ok(res, g.norms(req.actor, pid(req))));
  r.get('/capacity', (req, res) => ok(res, g.capacity.list(req.actor, parseProjectQ(req.query))));
  r.post('/capacity', idempotentRequired, (req, res) => ok(res, g.capacity.create(req.actor, parseCapacity(req.body)), 201));
  r.post('/capacity/:id/activate', idempotentRequired, (req, res) => ok(res, g.capacity.activate(req.actor, pid(req))));
  r.post('/capacity/:id/cancel', idempotent, (req, res) => ok(res, g.capacity.cancel(req.actor, pid(req), parseReason(req.body))));
  return r;
}

/** /api/v1/plan: baselines, the comparison, the quality check and the files of MS Project and Primavera (part 13.03, behind ff.plan.p1303). */
export function baselineRoutes(b, { exportsOf, fileBody }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-export-rows': String(out.rows ?? 0) }).send(out.buffer);
  r.get('/baselines', (req, res) => res.json(b.baselines.list(req.actor, req.query)));
  r.get('/baselines/export', async (req, res, next) => { try { const out = await exportsOf().start(req.actor, 'plan.baselines', req.query); if (out.job) return res.status(202).json({ data: out.job }); return res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' }).send(out.buffer); } catch (e) { return next(e); } });
  r.get('/baselines/project', (req, res) => ok(res, b.baselines.ofProject(req.actor, parseId(req.query.projectId))));
  r.get('/baselines/current', (req, res) => ok(res, b.baselines.current(req.actor, parseId(req.query.projectId))));
  r.post('/baselines', idempotentRequired, (req, res) => ok(res, b.baselines.create(req.actor, parseBaselineCreate(req.body)), 201));
  r.get('/baselines/:id', (req, res) => ok(res, b.baselines.get(req.actor, pid(req))));
  r.patch('/baselines/:id', idempotent, (req, res) => ok(res, b.baselines.update(req.actor, pid(req), parseBaselineUpdate(req.body))));
  r.delete('/baselines/:id', (req, res) => ok(res, b.baselines.remove(req.actor, pid(req))));
  r.post('/baselines/:id/submit', idempotentRequired, (req, res) => ok(res, b.baselines.submit(req.actor, pid(req)), 202));
  r.post('/baselines/:id/withdraw', idempotent, (req, res) => ok(res, b.baselines.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/baselines/:id/cancel', idempotent, (req, res) => ok(res, b.baselines.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/baselines/:id/amend', idempotentRequired, (req, res) => ok(res, b.baselines.amend(req.actor, pid(req), parseBaselineAmend(req.body)), 201));
  r.get('/baselines/:id/history', (req, res) => ok(res, b.baselines.history(req.actor, pid(req))));
  r.get('/baselines/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(b.baselines.print(req.actor, pid(req))));
  r.get('/baselines/:id/variance', (req, res) => ok(res, b.variance(req.actor, pid(req), parseVarianceQ(req.query))));
  r.get('/baselines/:id/variance/export', (req, res) => file(res, b.varianceExport(req.actor, pid(req), parseVarianceExportQ(req.query))));
  r.get('/baselines/:id/quality', (req, res) => ok(res, b.quality(req.actor, parseQualityQ(req.query), { baselineId: pid(req) })));
  r.get('/baselines/:id/quality/export', (req, res) => file(res, b.qualityExport(req.actor, parseQualityExportQ(req.query), { baselineId: pid(req) })));
  r.get('/baselines/:id/exchange', (req, res) => file(res, b.exchangeFile(req.actor, { baselineId: pid(req) }, parseExchangeQ(req.query))));
  // the working schedule: its quality check and its file for MS Project or Primavera
  r.get('/schedules/:id/quality', (req, res) => ok(res, b.quality(req.actor, parseQualityQ(req.query), { scheduleId: pid(req) })));
  r.get('/schedules/:id/quality/export', (req, res) => file(res, b.qualityExport(req.actor, parseQualityExportQ(req.query), { scheduleId: pid(req) })));
  r.get('/schedules/:id/exchange', (req, res) => file(res, b.exchangeFile(req.actor, { scheduleId: pid(req) }, parseExchangeQ(req.query))));
  // the import wizard: read and check a file, change its mapping, apply it to the working schedule
  r.get('/imports', (req, res) => ok(res, b.imports.list(req.actor, parseImportListQ(req.query))));
  r.post('/imports', fileBody, (req, res) => ok(res, b.imports.analyse(req.actor, parseImportFileQ(req.query), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)), 201));
  r.get('/imports/:id', (req, res) => ok(res, b.imports.get(req.actor, pid(req))));
  r.patch('/imports/:id', idempotent, (req, res) => ok(res, b.imports.update(req.actor, pid(req), parseImportUpdate(req.body))));
  r.post('/imports/:id/apply', idempotentRequired, (req, res) => ok(res, b.imports.apply(req.actor, pid(req), parseImportApply(req.body))));
  r.post('/imports/:id/discard', idempotent, (req, res) => ok(res, b.imports.discard(req.actor, pid(req))));
  return r;
}

/** /api/v1/plan: the look-ahead board, the constraint log and the weekly work plans (part 13.04, behind ff.plan.p1304). */
export function lookaheadRoutes(l, { exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-export-rows': String(out.rows ?? 0) }).send(out.buffer);
  const exported = (name) => async (req, res, next) => { try { const out = await exportsOf().start(req.actor, name, req.query); if (out.job) return res.status(202).json({ data: out.job }); return res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' }).send(out.buffer); } catch (e) { return next(e); } };
  r.get('/lookahead/options', (req, res) => ok(res, l.lookaheads.options(req.actor, parseId(req.query.projectId))));
  r.get('/schedules/:id/lookahead', (req, res) => ok(res, l.lookaheads.board(req.actor, pid(req), parseLookaheadQ(req.query))));
  r.get('/schedules/:id/lookaheads', (req, res) => ok(res, l.lookaheads.list(req.actor, pid(req))));
  r.post('/schedules/:id/lookaheads', idempotentRequired, (req, res) => ok(res, l.lookaheads.create(req.actor, pid(req), parseLookaheadSave(req.body)), 201));
  r.post('/schedules/:id/constraints/detect', idempotent, (req, res) => ok(res, l.constraints.detect(req.actor, pid(req))));
  r.get('/constraints', (req, res) => res.json(l.constraints.list(req.actor, req.query)));
  r.get('/constraints/export', exported('plan.constraints'));
  r.post('/constraints', idempotentRequired, (req, res) => ok(res, l.constraints.create(req.actor, parseConstraintCreate(req.body)), 201));
  r.get('/constraints/:id', (req, res) => ok(res, l.constraints.get(req.actor, pid(req))));
  r.patch('/constraints/:id', idempotent, (req, res) => ok(res, l.constraints.update(req.actor, pid(req), parseConstraintUpdate(req.body))));
  r.post('/constraints/:id/clear', idempotent, (req, res) => ok(res, l.constraints.clear(req.actor, pid(req), parseNote(req.body))));
  r.post('/constraints/:id/waive', idempotent, (req, res) => ok(res, l.constraints.waive(req.actor, pid(req), parseReason(req.body))));
  r.get('/activities/:id/constraints', (req, res) => ok(res, l.constraints.ofActivity(req.actor, pid(req))));
  r.get('/weekly-plans', (req, res) => res.json(l.weekly.list(req.actor, req.query)));
  r.get('/weekly-plans/export', exported('plan.weekly_plans'));
  r.post('/weekly-plans', idempotentRequired, (req, res) => ok(res, l.weekly.create(req.actor, parseWeeklyCreate(req.body)), 201));
  r.get('/weekly-plans/:id', (req, res) => ok(res, l.weekly.get(req.actor, pid(req))));
  r.patch('/weekly-plans/:id', idempotent, (req, res) => ok(res, l.weekly.update(req.actor, pid(req), parseWeeklyUpdate(req.body))));
  r.delete('/weekly-plans/:id', (req, res) => ok(res, l.weekly.remove(req.actor, pid(req))));
  r.post('/weekly-plans/:id/submit', idempotentRequired, (req, res) => ok(res, l.weekly.submit(req.actor, pid(req)), 202));
  r.post('/weekly-plans/:id/withdraw', idempotent, (req, res) => ok(res, l.weekly.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/weekly-plans/:id/cancel', idempotent, (req, res) => ok(res, l.weekly.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/weekly-plans/:id/amend', idempotentRequired, (req, res) => ok(res, l.weekly.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.post('/weekly-plans/:id/record', idempotent, (req, res) => ok(res, l.weekly.record(req.actor, pid(req), parseRecord(req.body))));
  r.post('/weekly-plans/:id/close', idempotentRequired, (req, res) => ok(res, l.weekly.close(req.actor, pid(req))));
  r.get('/weekly-plans/:id/history', (req, res) => ok(res, l.weekly.history(req.actor, pid(req))));
  r.get('/weekly-plans/:id/daily', (req, res) => ok(res, l.weekly.daily(req.actor, pid(req))));
  r.get('/weekly-plans/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(l.weekly.print(req.actor, pid(req))));
  r.get('/ppc', (req, res) => ok(res, l.ppcReport(req.actor, parsePpcQ(req.query))));
  r.get('/ppc/export', (req, res) => file(res, l.ppcExport(req.actor, parsePpcExportQ(req.query))));
  r.get('/daily-plan', (req, res) => { const q = parseDailyPlanQ(req.query); ok(res, l.dailyPlan(req.actor, q.projectId, q.date)); });
  return r;
}
