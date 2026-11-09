import { Router } from 'express';
import {
  parseCalibrate, parseCompute, parseCycle, parseCycleQuery, parseDispute, parseDisputeQuery, parseFeedback, parseFeedbackQuery, parseGoalCreate, parseGoalUpdate, parseId, parseKpi, parseLaunch, parseManager, parseManual, parseProgress, parseReason, parseResolve, parseSelf, parseSubmit,
} from './perf-validators.js';

/** Part 07.11: performance management: reviews, KPIs, goals, feedback. Rights, the reporting line and the masks are checked in the service. */
export function perfRoutes({ perf, exportsOf }, { idempotent, idempotentRequired }) {
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
  const v = perf.reviews;
  r.get('/reviews', (req, res) => res.json(v.list(req.actor, req.query)));
  r.get('/reviews/export', exportOf('hr.reviews'));
  r.post('/reviews/launch', idempotentRequired, (req, res) => ok(res, v.launch(req.actor, parseLaunch(req.body)), 201));
  r.get('/reviews/:id', (req, res) => ok(res, v.get(req.actor, parseId(req.params.id))));
  r.delete('/reviews/:id', (req, res) => ok(res, v.remove(req.actor, parseId(req.params.id))));
  r.post('/reviews/:id/self', idempotent, (req, res) => ok(res, v.self(req.actor, parseId(req.params.id), parseSelf(req.body))));
  r.post('/reviews/:id/manager', idempotent, (req, res) => ok(res, v.manager(req.actor, parseId(req.params.id), parseManager(req.body))));
  r.post('/reviews/:id/calibrate', idempotent, (req, res) => ok(res, v.calibrate(req.actor, parseId(req.params.id), parseCalibrate(req.body))));
  r.post('/reviews/:id/send-back', idempotent, (req, res) => ok(res, v.sendBack(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/reviews/:id/submit', idempotentRequired, (req, res) => ok(res, v.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/reviews/:id/withdraw', idempotent, (req, res) => ok(res, v.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/reviews/:id/cancel', idempotent, (req, res) => ok(res, v.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.get('/reviews/:id/history', (req, res) => ok(res, v.history(req.actor, parseId(req.params.id))));
  r.get('/reviews/:id/print', (req, res) => html(res, v.print(req.actor, parseId(req.params.id))));
  r.post('/reviews/:id/letter', idempotentRequired, async (req, res) => ok(res, await v.letter(req.actor, parseId(req.params.id)), 201));
  r.get('/reviews/:id/letter', async (req, res, next) => { try { pipe(res, await v.letterContent(req.actor, parseId(req.params.id), { download: req.query.download !== '0' }), next); } catch (e) { next(e); } });
  r.get('/performance/my', (req, res) => ok(res, perf.my.get(req.actor, parseCycleQuery(req.query))));
  r.get('/performance/team', (req, res) => ok(res, perf.team.get(req.actor, parseCycleQuery(req.query))));
  r.get('/performance/team/:id', (req, res) => ok(res, perf.team.member(req.actor, parseId(req.params.id), parseCycleQuery(req.query))));
  r.post('/performance/compute', idempotent, (req, res) => ok(res, perf.compute.run(req.actor, parseCompute(req.body))));
  r.post('/performance/manual-value', idempotentRequired, (req, res) => ok(res, perf.compute.manual(req.actor, parseManual(req.body)), 201));
  r.get('/performance/values/:id', (req, res) => ok(res, perf.evidence(req.actor, parseId(req.params.id))));
  r.post('/performance/values/:id/dispute', idempotentRequired, (req, res) => ok(res, perf.disputes.raise(req.actor, parseId(req.params.id), parseDispute(req.body)), 201));
  r.get('/performance/disputes', (req, res) => ok(res, perf.disputes.list(req.actor, parseDisputeQuery(req.query))));
  r.post('/performance/disputes/:id/resolve', idempotentRequired, (req, res) => ok(res, perf.disputes.resolve(req.actor, parseId(req.params.id), parseResolve(req.body))));
  r.get('/performance/metrics', (req, res) => ok(res, perf.config.metrics(req.actor)));
  r.get('/performance/kpis', (req, res) => ok(res, perf.config.kpis.list(req.actor)));
  r.put('/performance/kpis', idempotent, (req, res) => ok(res, perf.config.kpis.save(req.actor, parseKpi(req.body))));
  r.post('/performance/kpis/:id/activate', idempotentRequired, (req, res) => ok(res, perf.config.kpis.activate(req.actor, parseId(req.params.id))));
  r.post('/performance/kpis/:id/retire', idempotentRequired, (req, res) => ok(res, perf.config.kpis.retire(req.actor, parseId(req.params.id))));
  r.get('/performance/kpis/:id/history', (req, res) => ok(res, perf.config.kpis.history(req.actor, parseId(req.params.id))));
  r.get('/performance/cycles', (req, res) => ok(res, perf.config.cycles.list(req.actor)));
  r.put('/performance/cycles', idempotent, (req, res) => ok(res, perf.config.cycles.save(req.actor, parseCycle(req.body))));
  r.post('/performance/cycles/:id/open', idempotentRequired, (req, res) => ok(res, perf.config.cycles.open(req.actor, parseId(req.params.id))));
  r.post('/performance/cycles/:id/close', idempotentRequired, (req, res) => ok(res, perf.config.cycles.close(req.actor, parseId(req.params.id))));
  const g = perf.goals;
  r.get('/performance/goals', (req, res) => ok(res, g.list(req.actor, parseCycleQuery(req.query))));
  r.post('/performance/goals', idempotentRequired, (req, res) => ok(res, g.create(req.actor, parseGoalCreate(req.body)), 201));
  r.patch('/performance/goals/:id', idempotent, (req, res) => ok(res, g.update(req.actor, parseId(req.params.id), parseGoalUpdate(req.body))));
  r.delete('/performance/goals/:id', (req, res) => ok(res, g.remove(req.actor, parseId(req.params.id))));
  r.post('/performance/goals/:id/propose', idempotentRequired, (req, res) => ok(res, g.propose(req.actor, parseId(req.params.id))));
  r.post('/performance/goals/:id/agree', idempotentRequired, (req, res) => ok(res, g.agree(req.actor, parseId(req.params.id))));
  r.post('/performance/goals/:id/return', idempotentRequired, (req, res) => ok(res, g.giveBack(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/performance/goals/:id/progress', idempotent, (req, res) => ok(res, g.progress(req.actor, parseId(req.params.id), parseProgress(req.body))));
  r.get('/performance/feedback', (req, res) => ok(res, perf.feedback.list(req.actor, parseFeedbackQuery(req.query))));
  r.post('/performance/feedback', idempotentRequired, (req, res) => ok(res, perf.feedback.give(req.actor, parseFeedback(req.body)), 201));
  return r;
}
