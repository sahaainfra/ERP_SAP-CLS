import { Router } from 'express';
import { parseBoqAmend, parseBoqImport, parseBoqStage, parseBulkMap, parseCompare, parseLineCreate, parseLineUpdate, parseNorms, parseRevised, parseSplits, parseUnmapped, parseVersionCreate, parseVersionQuery, parseVersionUpdate, parseLocCreate, parseLocMove, parseLocUpdate, parseMatrix, parseWbsBaseline, parseWbsBulk, parseWbsChange, parseWbsCopy, parseWbsCreate, parseWbsFormat, parseWbsMove, parseWbsNormalise, parseWbsTemplate, parseWbsUpdate, parseWpCreate, parseWpUpdate, parseFromAward, parseMeeting, parseMeetingUpdate, parsePackAmend, parsePackCreate, parsePackFormat, parsePackUpdate, parseProjectQuery, parseAmend, parseId, parseMilestone, parseMilestoneUpdate, parsePrefill, parseReason, parseSubmit, parseTransition, parseUpdate, parseWizard } from './validators.js';

/** Part 10.01: the project master. Rights and scope are checked in the service. */
export function projectRoutes({ svc, exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const p = svc.projects; const t = svc.transitions; const m = svc.milestones;
  r.get('/projects', (req, res) => res.json(p.list(req.actor, req.query)));
  r.get('/projects/export', (req, res) => {
    const x = exportsOf(); if (!x) throw new Error('The list export service is not running');
    const out = x.start(req.actor, 'proj.projects', req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  });
  r.get('/project-options', (req, res) => ok(res, p.options(req.actor)));
  r.get('/project-prefill', (req, res) => ok(res, p.prefill(req.actor, parsePrefill(req.query).tenderId)));
  r.post('/projects', idempotentRequired, (req, res) => ok(res, p.create(req.actor, parseWizard(req.body)), 201));
  r.get('/projects/:id', (req, res) => ok(res, p.get(req.actor, pid(req))));
  r.patch('/projects/:id', idempotent, (req, res) => ok(res, p.update(req.actor, pid(req), parseUpdate(req.body))));
  r.delete('/projects/:id', (req, res) => ok(res, p.remove(req.actor, pid(req))));
  r.post('/projects/:id/submit', idempotentRequired, (req, res) => ok(res, p.submit(req.actor, pid(req), parseSubmit(req.body)), 202));
  r.post('/projects/:id/withdraw', idempotent, (req, res) => ok(res, p.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/projects/:id/cancel', idempotent, (req, res) => ok(res, p.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/projects/:id/amend', idempotentRequired, (req, res) => ok(res, p.amend(req.actor, pid(req), parseAmend(req.body)), 202));
  r.post('/projects/:id/transitions', idempotentRequired, (req, res) => ok(res, t.move(req.actor, pid(req), parseTransition(req.body)), 202));
  r.post('/projects/:id/transitions/withdraw', idempotent, (req, res) => ok(res, t.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.get('/projects/:id/history', (req, res) => ok(res, p.history(req.actor, pid(req))));
  r.get('/projects/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(p.print(req.actor, pid(req))));
  r.get('/projects/:id/milestones', (req, res) => ok(res, m.list(req.actor, pid(req))));
  r.post('/projects/:id/milestones', idempotentRequired, (req, res) => ok(res, m.create(req.actor, pid(req), parseMilestone(req.body)), 201));
  r.patch('/milestones/:id', idempotent, (req, res) => ok(res, m.update(req.actor, pid(req), parseMilestoneUpdate(req.body))));
  r.delete('/milestones/:id', (req, res) => ok(res, m.remove(req.actor, pid(req))));
  return r;
}

/** Part 10.02: the project from an award, the baseline pack, the handover meetings, the BOQ of the project and the baseline report. */
export function baselineRoutes(bl, { exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id); const k = bl.packs; const m = bl.meetings;
  r.get('/award-candidates', (req, res) => ok(res, bl.fromAward.candidates(req.actor)));
  r.get('/award-preview', (req, res) => ok(res, bl.fromAward.preview(req.actor, parsePrefill(req.query).tenderId)));
  r.post('/projects/from-award', idempotentRequired, (req, res) => ok(res, bl.fromAward.create(req.actor, parseFromAward(req.body)), 201));
  r.get('/baseline-packs', (req, res) => res.json(k.list(req.actor, req.query)));
  r.get('/baseline-packs/export', (req, res) => {
    const x = exportsOf(); if (!x) throw new Error('The list export service is not running');
    const out = x.start(req.actor, 'proj.baseline_packs', req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  });
  r.post('/baseline-packs', idempotentRequired, (req, res) => ok(res, k.create(req.actor, parsePackCreate(req.body)), 201));
  r.get('/baseline-packs/:id', (req, res) => ok(res, k.get(req.actor, pid(req))));
  r.patch('/baseline-packs/:id', idempotent, (req, res) => ok(res, k.update(req.actor, pid(req), parsePackUpdate(req.body))));
  r.delete('/baseline-packs/:id', (req, res) => ok(res, k.remove(req.actor, pid(req))));
  r.post('/baseline-packs/:id/refresh', idempotent, (req, res) => ok(res, k.refresh(req.actor, pid(req))));
  r.post('/baseline-packs/:id/submit', idempotentRequired, (req, res) => ok(res, k.submit(req.actor, pid(req)), 202));
  r.post('/baseline-packs/:id/withdraw', idempotent, (req, res) => ok(res, k.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/baseline-packs/:id/cancel', idempotent, (req, res) => ok(res, k.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/baseline-packs/:id/amend', idempotentRequired, (req, res) => ok(res, k.amend(req.actor, pid(req), parsePackAmend(req.body)), 201));
  r.get('/baseline-packs/:id/history', (req, res) => ok(res, k.history(req.actor, pid(req))));
  r.get('/baseline-packs/:id/verify', (req, res) => ok(res, k.verify(req.actor, pid(req))));
  r.get('/baseline-packs/:id/compare', (req, res) => ok(res, k.compare(req.actor, pid(req))));
  const doc = (req, res) => {
    const out = k.document(req.actor, pid(req), parsePackFormat(req.query).format);
    if (out.kind === 'html') return res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(out.body);
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store' });
    return res.send(out.buffer);
  };
  r.get('/baseline-packs/:id/print', doc); r.get('/baseline-packs/:id/document', doc);
  r.get('/baseline-packs/:id/meetings', (req, res) => ok(res, m.list(req.actor, pid(req))));
  r.post('/baseline-packs/:id/meetings', idempotentRequired, (req, res) => ok(res, m.create(req.actor, pid(req), parseMeeting(req.body)), 201));
  r.patch('/handover-meetings/:id', idempotent, (req, res) => ok(res, m.update(req.actor, pid(req), parseMeetingUpdate(req.body))));
  r.delete('/handover-meetings/:id', (req, res) => ok(res, m.remove(req.actor, pid(req))));
  r.get('/boq', (req, res) => ok(res, bl.boq.list(req.actor, parseProjectQuery(req.query).projectId)));
  r.get('/baseline-report', (req, res) => ok(res, bl.report.get(req.actor, parseProjectQuery(req.query).projectId)));
  return r;
}

/** Part 10.03: the WBS, its versions and changes, the locations, the matrix and the work packages. The project is the organisation project (projectId). */
export function structureRoutes(sv, { exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pj = (req) => parseProjectQuery(req.query).projectId; const pid = (req) => parseId(req.params.id);
  const w = sv.wbs; const c = sv.changes; const l = sv.locations; const k = sv.packages;
  r.get('/wbs-projects', (req, res) => ok(res, sv.projectsList(req.actor)));
  r.get('/wbs', (req, res) => ok(res, w.tree(req.actor, pj(req))));
  r.post('/wbs', idempotent, (req, res) => ok(res, w.create(req.actor, pj(req), parseWbsCreate(req.body)), 201));
  r.get('/wbs/validate', (req, res) => ok(res, w.validate(req.actor, pj(req))));
  r.get('/wbs/export', (req, res) => { const q = parseWbsFormat(req.query); const out = w.exportFile(req.actor, q.projectId, q.format); res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store' }); res.send(out.buffer); });
  r.post('/wbs/bulk', idempotent, (req, res) => ok(res, w.bulk(req.actor, pj(req), parseWbsBulk(req.body))));
  r.post('/wbs/normalise', idempotent, (req, res) => ok(res, w.normalise(req.actor, pj(req), parseWbsNormalise(req.body))));
  r.post('/wbs/template', idempotentRequired, (req, res) => ok(res, w.applyTemplate(req.actor, pj(req), parseWbsTemplate(req.body)), 201));
  r.post('/wbs/copy', idempotentRequired, (req, res) => ok(res, w.copyFrom(req.actor, pj(req), parseWbsCopy(req.body)), 201));
  r.post('/wbs/baseline', idempotentRequired, (req, res) => ok(res, w.baseline(req.actor, pj(req), parseWbsBaseline(req.body)), 201));
  r.patch('/wbs/:id', idempotent, (req, res) => ok(res, w.update(req.actor, pj(req), pid(req), parseWbsUpdate(req.body))));
  r.delete('/wbs/:id', (req, res) => ok(res, w.remove(req.actor, pj(req), pid(req))));
  r.post('/wbs/:id/move', idempotent, (req, res) => ok(res, w.move(req.actor, pj(req), pid(req), parseWbsMove(req.body))));
  r.post('/wbs/:id/activate', idempotent, (req, res) => ok(res, w.setStatus(req.actor, pj(req), pid(req), true)));
  r.post('/wbs/:id/deactivate', idempotent, (req, res) => ok(res, w.setStatus(req.actor, pj(req), pid(req), false)));
  r.get('/wbs-versions', (req, res) => ok(res, w.versions(req.actor, pj(req))));
  r.get('/wbs-versions/:id', (req, res) => ok(res, w.version(req.actor, pj(req), pid(req))));
  r.get('/wbs-changes', (req, res) => ok(res, c.list(req.actor, pj(req))));
  r.post('/wbs-changes', idempotentRequired, (req, res) => ok(res, c.create(req.actor, pj(req), parseWbsChange(req.body)), 201));
  r.get('/wbs-changes/:id/locate', (req, res) => ok(res, c.locate(req.actor, pid(req))));
  r.get('/wbs-changes/:id', (req, res) => ok(res, c.get(req.actor, pj(req), pid(req))));
  r.post('/wbs-changes/:id/submit', idempotentRequired, (req, res) => ok(res, c.submit(req.actor, pj(req), pid(req)), 202));
  r.post('/wbs-changes/:id/withdraw', idempotent, (req, res) => ok(res, c.withdraw(req.actor, pj(req), pid(req), parseReason(req.body))));
  r.post('/wbs-changes/:id/cancel', idempotent, (req, res) => ok(res, c.cancel(req.actor, pj(req), pid(req), parseReason(req.body))));
  r.get('/wbs-changes/:id/history', (req, res) => ok(res, c.history(req.actor, pj(req), pid(req))));
  r.get('/locations', (req, res) => ok(res, l.tree(req.actor, pj(req))));
  r.post('/locations', idempotent, (req, res) => ok(res, l.create(req.actor, pj(req), parseLocCreate(req.body)), 201));
  r.patch('/locations/:id', idempotent, (req, res) => ok(res, l.update(req.actor, pj(req), pid(req), parseLocUpdate(req.body))));
  r.delete('/locations/:id', (req, res) => ok(res, l.remove(req.actor, pj(req), pid(req))));
  r.post('/locations/:id/move', idempotent, (req, res) => ok(res, l.move(req.actor, pj(req), pid(req), parseLocMove(req.body))));
  r.post('/locations/:id/activate', idempotent, (req, res) => ok(res, l.setStatus(req.actor, pj(req), pid(req), true)));
  r.post('/locations/:id/deactivate', idempotent, (req, res) => ok(res, l.setStatus(req.actor, pj(req), pid(req), false)));
  r.get('/wbs-matrix', (req, res) => ok(res, sv.matrix.get(req.actor, pj(req))));
  r.put('/wbs-matrix', idempotent, (req, res) => ok(res, sv.matrix.set(req.actor, pj(req), parseMatrix(req.body))));
  r.get('/work-packages', (req, res) => res.json(k.list(req.actor, req.query)));
  r.get('/work-packages/export', (req, res) => {
    const x = exportsOf(); if (!x) throw new Error('The list export service is not running');
    const out = x.start(req.actor, 'proj.work_packages', req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  });
  r.post('/work-packages', idempotent, (req, res) => { const b = parseWpCreate(req.body); ok(res, k.create(req.actor, b.projectId, b), 201); });
  r.get('/work-packages/:id', (req, res) => ok(res, k.get(req.actor, pid(req))));
  r.patch('/work-packages/:id', idempotent, (req, res) => ok(res, k.update(req.actor, pid(req), parseWpUpdate(req.body))));
  r.delete('/work-packages/:id', (req, res) => ok(res, k.remove(req.actor, pid(req))));
  return r;
}

/** Part 10.04: BOQ versions, lines, mapping, norms, import, changes after the freeze and the reports. */
export function boqRoutes(bq, { exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id); const v = bq.versions; const send = (res, out) => { if (out.kind === 'html') return res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(out.body); res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store' }); return res.send(out.buffer); };
  r.get('/boq-projects', (req, res) => ok(res, bq.projectsList(req.actor)));
  r.get('/versions', (req, res) => res.json(v.list(req.actor, req.query)));
  r.get('/versions/export', (req, res) => {
    const x = exportsOf(); if (!x) throw new Error('The list export service is not running');
    const out = x.start(req.actor, 'proj.boq_versions', req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  });
  r.get('/versions/compare', (req, res) => { const q = parseCompare(req.query); ok(res, bq.reports.compare(req.actor, q.a, q.b)); });
  r.post('/versions/import/rows', idempotent, (req, res) => ok(res, bq.importer.stage(req.actor, parseBoqStage(req.body)), 201));
  r.post('/versions/import', idempotent, (req, res) => { const out = bq.importer.run(req.actor, parseBoqImport(req.body)); ok(res, out, out.committed ? 201 : 200); });
  r.post('/versions/revised', idempotentRequired, (req, res) => ok(res, v.createRevised(req.actor, parseRevised(req.body)), 201));
  r.post('/versions', idempotentRequired, (req, res) => ok(res, v.create(req.actor, parseVersionCreate(req.body)), 201));
  r.get('/versions/:id', (req, res) => ok(res, v.get(req.actor, pid(req))));
  r.patch('/versions/:id', idempotent, (req, res) => ok(res, v.update(req.actor, pid(req), parseVersionUpdate(req.body))));
  r.delete('/versions/:id', (req, res) => ok(res, v.remove(req.actor, pid(req))));
  r.post('/versions/:id/submit', idempotentRequired, (req, res) => ok(res, v.submit(req.actor, pid(req)), 202));
  r.post('/versions/:id/withdraw', idempotent, (req, res) => ok(res, v.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/versions/:id/cancel', idempotent, (req, res) => ok(res, v.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/versions/:id/amend', idempotentRequired, (req, res) => ok(res, bq.changes.amend(req.actor, pid(req), parseBoqAmend(req.body)), 202));
  r.get('/versions/:id/history', (req, res) => ok(res, v.history(req.actor, pid(req))));
  r.get('/versions/:id/print', (req, res) => send(res, bq.document(req.actor, pid(req), 'html')));
  r.get('/versions/:id/document', (req, res) => send(res, bq.document(req.actor, pid(req), parsePackFormat(req.query).format)));
  r.get('/versions/:id/lines', (req, res) => ok(res, bq.lines.list(req.actor, pid(req), parseUnmapped(req.query).unmapped ? { unmappedOnly: true } : {})));
  r.post('/versions/:id/lines', idempotent, (req, res) => ok(res, bq.lines.create(req.actor, pid(req), parseLineCreate(req.body)), 201));
  r.get('/versions/:id/abstract', (req, res) => ok(res, bq.reports.abstract(req.actor, pid(req))));
  r.get('/versions/:id/unmapped', (req, res) => ok(res, bq.reports.unmapped(req.actor, pid(req))));
  r.post('/versions/:id/mapping/bulk', idempotent, (req, res) => ok(res, bq.mapping.bulk(req.actor, pid(req), parseBulkMap(req.body))));
  r.patch('/boq-lines/:id', idempotent, (req, res) => ok(res, bq.lines.update(req.actor, pid(req), parseLineUpdate(req.body))));
  r.delete('/boq-lines/:id', (req, res) => ok(res, bq.lines.remove(req.actor, pid(req))));
  r.get('/boq-lines/:id/mapping', (req, res) => ok(res, bq.mapping.get(req.actor, pid(req))));
  r.put('/boq-lines/:id/mapping', idempotent, (req, res) => ok(res, bq.mapping.set(req.actor, pid(req), parseSplits(req.body))));
  r.get('/boq-lines/:id/norms', (req, res) => ok(res, bq.norms.get(req.actor, pid(req))));
  r.put('/boq-lines/:id/norms', idempotent, (req, res) => ok(res, bq.norms.set(req.actor, pid(req), parseNorms(req.body))));
  r.post('/boq-lines/:id/norms/from-analysis', idempotent, (req, res) => ok(res, bq.norms.fromAnalysis(req.actor, pid(req))));
  r.get('/boq-changes', (req, res) => ok(res, bq.changes.list(req.actor, parseVersionQuery(req.query).versionId)));
  r.get('/boq-changes/:id', (req, res) => ok(res, bq.changes.get(req.actor, pid(req))));
  r.post('/boq-changes/:id/withdraw', idempotent, (req, res) => ok(res, bq.changes.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/boq-changes/:id/cancel', idempotent, (req, res) => ok(res, bq.changes.cancel(req.actor, pid(req), parseReason(req.body))));
  return r;
}
