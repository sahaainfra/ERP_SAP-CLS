import { Router } from 'express';
import { parseFromAward, parseMeeting, parseMeetingUpdate, parsePackAmend, parsePackCreate, parsePackFormat, parsePackUpdate, parseProjectQuery, parseAmend, parseId, parseMilestone, parseMilestoneUpdate, parsePrefill, parseReason, parseSubmit, parseTransition, parseUpdate, parseWizard } from './validators.js';

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
