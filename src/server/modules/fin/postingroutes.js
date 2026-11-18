import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseId, parseJournalReason, parseRecon, parseReplayCreate, parseRepostAll, parseResolve, parseRulePropose, parseRuleTest, parseRuleUpdate, parseSamples } from './validators.js';

/** Part 23.02: the posting engine API under /api/v1/fin (rules, postings and the failed queue, replays, reconciliation), behind ff.fin.p2302. Rights are checked in the service. */
export function postingRoutes(pe, { idempotent, idempotentRequired, flags }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use(['/posting-rules', '/postings', '/replays', '/reconciliation'], (req, _res, next) => (flags.isOn(req.actor, 'ff.fin.p2302') ? next() : next(notFound('The posting engine is not enabled for your company yet (feature flag ff.fin.p2302 is OFF).'))));
  const { rules: ru, postings: po, replays: rp } = pe;
  r.get('/posting-rules/catalogue', (req, res) => ok(res, ru.catalogue(req.actor)));
  r.get('/posting-rules/samples', (req, res) => ok(res, ru.samples(req.actor, parseSamples(req.query).eventType)));
  r.post('/posting-rules/test', (req, res) => ok(res, ru.test(req.actor, parseRuleTest(req.body))));
  r.get('/posting-rules', (req, res) => res.json(ru.list(req.actor, req.query)));
  r.post('/posting-rules', idempotentRequired, (req, res) => ok(res, ru.propose(req.actor, parseRulePropose(req.body)), 201));
  r.get('/posting-rules/:id', (req, res) => ok(res, ru.get(req.actor, pid(req))));
  r.patch('/posting-rules/:id', idempotent, (req, res) => ok(res, ru.update(req.actor, pid(req), parseRuleUpdate(req.body))));
  r.post('/posting-rules/:id/submit', idempotentRequired, (req, res) => ok(res, ru.submit(req.actor, pid(req)), 202));
  r.post('/posting-rules/:id/withdraw', idempotent, (req, res) => ok(res, ru.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/posting-rules/:id/cancel', idempotent, (req, res) => ok(res, ru.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.get('/posting-rules/:id/history', (req, res) => ok(res, ru.history(req.actor, pid(req))));
  r.get('/postings/summary', (req, res) => ok(res, po.summary(req.actor)));
  r.get('/postings/export', (req, res) => file(res, po.exportCsv(req.actor, req.query)));
  r.post('/postings/repost-all', idempotentRequired, (req, res) => ok(res, po.repostAll(req.actor, parseRepostAll(req.body))));
  r.get('/postings', (req, res) => res.json(po.list(req.actor, req.query)));
  r.get('/postings/:id', (req, res) => ok(res, po.get(req.actor, pid(req))));
  r.post('/postings/:id/repost', idempotentRequired, (req, res) => ok(res, po.repost(req.actor, pid(req))));
  r.post('/postings/:id/resolve', idempotentRequired, (req, res) => ok(res, po.resolve(req.actor, pid(req), parseResolve(req.body))));
  r.get('/replays', (req, res) => ok(res, rp.list(req.actor)));
  r.post('/replays', idempotentRequired, (req, res) => ok(res, rp.create(req.actor, parseReplayCreate(req.body)), 201));
  r.get('/replays/:id', (req, res) => ok(res, rp.get(req.actor, pid(req))));
  r.post('/replays/:id/submit', idempotentRequired, (req, res) => ok(res, rp.submit(req.actor, pid(req)), 202));
  r.post('/replays/:id/withdraw', idempotent, (req, res) => ok(res, rp.withdraw(req.actor, pid(req), parseJournalReason(req.body))));
  r.post('/replays/:id/cancel', idempotent, (req, res) => ok(res, rp.cancel(req.actor, pid(req), parseJournalReason(req.body))));
  r.get('/replays/:id/history', (req, res) => ok(res, rp.history(req.actor, pid(req))));
  r.get('/reconciliation', (req, res) => ok(res, pe.reconcile(req.actor, parseRecon(req.query))));
  return r;
}
