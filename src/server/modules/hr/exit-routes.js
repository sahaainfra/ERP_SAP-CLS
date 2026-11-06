import { Router } from 'express';
import {
  parseAnalytics, parseAssign, parseCaseCreate, parseCaseRespond, parseCaseStep, parseClearance, parseGrvCreate, parseGrvUpdate, parseId, parseInterview, parseLetter, parseLetterKind, parseNote, parseReason, parseResolve, parseRespond, parseSepCreate, parseSepPreview, parseSepUpdate, parseSubmit, parseTrack, parseTrackRespond,
} from './exit-validators.js';

/** Part 07.13: separations, clearances, exit interviews, full-and-final inputs, letters, grievances and disciplinary cases. Rights and scope are checked in the service. */
export function exitRoutes({ ex, exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const html = (res, body) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(body);
  const pipe = (res, out, next) => { res.status(200).set(out.headers); out.stream.on('error', next).pipe(res); };
  const exportOf = (code) => (req, res) => {
    const svc = exportsOf();
    if (!svc) throw new Error('The list export service is not running');
    const out = svc.start(req.actor, code, req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  };
  const s = ex.separations;
  r.get('/separations', (req, res) => res.json(s.list(req.actor, req.query)));
  r.get('/separations/export', exportOf('hr.separations'));
  r.get('/separations/mine', (req, res) => ok(res, s.mine(req.actor)));
  r.get('/separations/analytics', (req, res) => ok(res, ex.interviews.analytics(req.actor, parseAnalytics(req.query))));
  r.post('/separations/preview', (req, res) => ok(res, s.preview(req.actor, parseSepPreview(req.body))));
  r.post('/separations', idempotentRequired, (req, res) => ok(res, s.create(req.actor, parseSepCreate(req.body)), 201));
  r.get('/separations/:id', (req, res) => ok(res, s.get(req.actor, parseId(req.params.id))));
  r.patch('/separations/:id', idempotent, (req, res) => ok(res, s.update(req.actor, parseId(req.params.id), parseSepUpdate(req.body))));
  r.delete('/separations/:id', (req, res) => ok(res, s.remove(req.actor, parseId(req.params.id))));
  r.post('/separations/:id/submit', idempotentRequired, (req, res) => ok(res, s.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/separations/:id/withdraw', idempotent, (req, res) => ok(res, s.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/separations/:id/cancel', idempotent, (req, res) => ok(res, s.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.get('/separations/:id/history', (req, res) => ok(res, s.history(req.actor, parseId(req.params.id))));
  r.get('/separations/:id/print', (req, res) => html(res, s.print(req.actor, parseId(req.params.id))));
  r.post('/separations/:id/interview', idempotent, (req, res) => ok(res, ex.interviews.record(req.actor, parseId(req.params.id), parseInterview(req.body))));
  r.get('/separations/:id/fnf', (req, res) => ok(res, ex.fnf.inputs(req.actor, parseId(req.params.id))));
  r.post('/separations/:id/fnf/release', idempotentRequired, (req, res) => ok(res, ex.fnf.release(req.actor, parseId(req.params.id))));
  r.post('/separations/:id/letters', idempotentRequired, async (req, res) => ok(res, await ex.letters.issue(req.actor, parseId(req.params.id), parseLetter(req.body)), 201));
  r.get('/separations/:id/letters/:kind', async (req, res, next) => { try { pipe(res, await ex.letters.content(req.actor, parseId(req.params.id), parseLetterKind(req.params.kind), { download: req.query.download !== '0' }), next); } catch (e) { next(e); } });
  r.get('/clearances', (req, res) => ok(res, ex.clearances.worklist(req.actor)));
  r.put('/clearances/:id', idempotent, (req, res) => ok(res, ex.clearances.update(req.actor, parseId(req.params.id), parseClearance(req.body))));
  r.post('/clearances/:id/waive', idempotentRequired, (req, res) => ok(res, ex.clearances.waive(req.actor, parseId(req.params.id), parseReason(req.body))));
  const g = ex.grievances;
  r.get('/grievances', (req, res) => res.json(g.list(req.actor, req.query)));
  r.get('/grievances/export', exportOf('hr.grievances'));
  r.get('/grievances/track', (req, res) => ok(res, g.track(req.actor, parseTrack(req.query))));
  r.post('/grievances/track/respond', idempotentRequired, (req, res) => ok(res, g.trackRespond(req.actor, parseTrackRespond(req.body))));
  r.post('/grievances', idempotentRequired, (req, res) => ok(res, g.create(req.actor, parseGrvCreate(req.body)), 201));
  r.get('/grievances/:id', (req, res) => ok(res, g.get(req.actor, parseId(req.params.id))));
  r.patch('/grievances/:id', idempotent, (req, res) => ok(res, g.update(req.actor, parseId(req.params.id), parseGrvUpdate(req.body))));
  r.delete('/grievances/:id', (req, res) => ok(res, g.remove(req.actor, parseId(req.params.id))));
  r.post('/grievances/:id/submit', idempotentRequired, (req, res) => ok(res, g.submit(req.actor, parseId(req.params.id)), 202));
  r.post('/grievances/:id/withdraw', idempotent, (req, res) => ok(res, g.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/grievances/:id/cancel', idempotent, (req, res) => ok(res, g.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/grievances/:id/assign', idempotentRequired, (req, res) => ok(res, g.assign(req.actor, parseId(req.params.id), parseAssign(req.body))));
  r.post('/grievances/:id/note', idempotentRequired, (req, res) => ok(res, g.note(req.actor, parseId(req.params.id), parseNote(req.body))));
  r.post('/grievances/:id/resolve', idempotentRequired, (req, res) => ok(res, g.resolve(req.actor, parseId(req.params.id), parseResolve(req.body))));
  r.post('/grievances/:id/reject', idempotentRequired, (req, res) => ok(res, g.reject(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/grievances/:id/respond', idempotentRequired, (req, res) => ok(res, g.respond(req.actor, parseId(req.params.id), parseRespond(req.body))));
  r.get('/grievances/:id/history', (req, res) => ok(res, g.history(req.actor, parseId(req.params.id))));
  r.get('/grievances/:id/print', (req, res) => html(res, g.print(req.actor, parseId(req.params.id))));
  r.get('/disciplinary', (req, res) => ok(res, ex.cases.list(req.actor)));
  r.post('/disciplinary', idempotentRequired, (req, res) => ok(res, ex.cases.create(req.actor, parseCaseCreate(req.body)), 201));
  r.get('/disciplinary/:id', (req, res) => ok(res, ex.cases.get(req.actor, parseId(req.params.id))));
  r.post('/disciplinary/:id/step', idempotentRequired, (req, res) => ok(res, ex.cases.step(req.actor, parseId(req.params.id), parseCaseStep(req.body))));
  r.post('/disciplinary/:id/respond', idempotentRequired, (req, res) => ok(res, ex.cases.respond(req.actor, parseId(req.params.id), parseCaseRespond(req.body))));
  return r;
}
