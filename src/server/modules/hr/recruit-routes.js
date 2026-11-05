import { Router } from 'express';
import { HttpError } from '../../platform/http/errors.js';
import { createRateLimiter } from '../../platform/integrations/breaker.js';
import {
  parseBoard, parseCandCreate, parseCandList, parseCheckStatus, parseDocument, parseFeedback, parseId, parseInterviewCreate, parseJoin, parseOfferAccept, parseOfferCreate, parseOfferPreview, parseOfferUpdate, parsePlanSet, parsePrejoining, parseReason, parseReqAmend, parseReqCreate,
  parseReqList, parseReqPlanCheck, parseReqUpdate, parseRespond, parseStage, parseSubmit, parseTaskDone, parseTaskList, parseToken,
} from './recruit-validators.js';

/** Part 07.02: requisitions, the pipeline, interviews, offers and the joining checklist. Rights and scope are checked in the service. */
export function recruitRoutes({ recruit: s, exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const exportOf = (code) => (req, res) => {
    const svc = exportsOf();
    if (!svc) throw new Error('The list export service is not running');
    const out = svc.start(req.actor, code, req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  };
  r.get('/plans', (req, res) => ok(res, s.plans.list(req.actor)));
  r.put('/plans', idempotent, (req, res) => ok(res, s.plans.set(req.actor, parsePlanSet(req.body))));
  r.get('/requisitions', (req, res) => { parseReqList(req.query); res.json(s.reqRegister.list(req.actor, req.query)); });
  r.get('/requisitions/export', exportOf('hr.requisitions'));
  r.get('/requisitions/plan-check', (req, res) => ok(res, s.requisitions.planCheck(req.actor, parseReqPlanCheck(req.query))));
  r.post('/requisitions', idempotentRequired, (req, res) => ok(res, s.requisitions.create(req.actor, parseReqCreate(req.body)), 201));
  r.get('/requisitions/:id', (req, res) => ok(res, s.requisitions.get(req.actor, parseId(req.params.id))));
  r.patch('/requisitions/:id', idempotent, (req, res) => ok(res, s.requisitions.update(req.actor, parseId(req.params.id), parseReqUpdate(req.body))));
  r.delete('/requisitions/:id', (req, res) => ok(res, s.requisitions.remove(req.actor, parseId(req.params.id))));
  r.post('/requisitions/:id/submit', idempotentRequired, (req, res) => ok(res, s.requisitions.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/requisitions/:id/withdraw', idempotent, (req, res) => ok(res, s.requisitions.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/requisitions/:id/cancel', idempotent, (req, res) => ok(res, s.requisitions.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/requisitions/:id/amend', idempotentRequired, (req, res) => ok(res, s.requisitions.amend(req.actor, parseId(req.params.id), parseReqAmend(req.body)), 201));
  r.get('/requisitions/:id/compare', (req, res) => ok(res, s.requisitions.compare(req.actor, parseId(req.params.id))));
  r.get('/requisitions/:id/history', (req, res) => ok(res, s.requisitions.get(req.actor, parseId(req.params.id)).history));
  r.get('/requisitions/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(s.requisitions.print(req.actor, parseId(req.params.id))));

  r.get('/candidates', (req, res) => { const q = parseCandList(req.query); const out = s.candidates.list(req.actor, q); res.json({ data: out.rows, meta: { total: out.total, limit: q.limit, offset: q.offset } }); });
  r.get('/candidates/board', (req, res) => ok(res, s.candidates.board(req.actor, parseBoard(req.query))));
  r.post('/candidates', idempotentRequired, (req, res) => ok(res, s.candidates.create(req.actor, parseCandCreate(req.body)), 201));
  r.get('/candidates/:id', (req, res) => ok(res, s.candidates.get(req.actor, parseId(req.params.id))));
  r.post('/candidates/:id/stage', idempotent, (req, res) => ok(res, s.candidates.setStage(req.actor, parseId(req.params.id), parseStage(req.body))));
  r.put('/candidates/:id/checks', idempotent, (req, res) => ok(res, s.candidates.checks(req.actor, parseId(req.params.id), parseCheckStatus(req.body))));
  r.put('/candidates/:id/prejoining', idempotent, (req, res) => ok(res, s.candidates.savePrejoining(req.actor, parseId(req.params.id), parsePrejoining(req.body))));
  r.post('/candidates/:id/documents', idempotent, (req, res) => ok(res, s.candidates.addDocument(req.actor, parseId(req.params.id), parseDocument(req.body)), 201));
  r.post('/candidates/:id/join', idempotentRequired, (req, res) => ok(res, s.candidates.join(req.actor, parseId(req.params.id), parseJoin(req.body)), 201));
  r.post('/candidates/:id/interviews', idempotent, (req, res) => ok(res, s.interviews.schedule(req.actor, parseId(req.params.id), parseInterviewCreate(req.body)), 201));
  r.get('/interviews/mine', (req, res) => ok(res, s.interviews.mine(req.actor)));
  r.post('/interviews/:id/feedback', idempotent, (req, res) => ok(res, s.interviews.feedback(req.actor, parseId(req.params.id), parseFeedback(req.body))));
  r.post('/interviews/:id/cancel', idempotent, (req, res) => ok(res, s.interviews.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));

  r.get('/offers', (req, res) => { parseReqList(req.query); res.json(s.offerRegister.list(req.actor, req.query)); });
  r.get('/offers/export', exportOf('hr.offers'));
  r.post('/offers/preview', (req, res) => ok(res, s.offers.preview(req.actor, parseOfferPreview(req.body))));
  r.post('/offers', idempotentRequired, (req, res) => ok(res, s.offers.create(req.actor, parseOfferCreate(req.body)), 201));
  r.get('/offers/:id', (req, res) => ok(res, s.offers.get(req.actor, parseId(req.params.id))));
  r.patch('/offers/:id', idempotent, (req, res) => ok(res, s.offers.update(req.actor, parseId(req.params.id), parseOfferUpdate(req.body))));
  r.delete('/offers/:id', (req, res) => ok(res, s.offers.remove(req.actor, parseId(req.params.id))));
  r.post('/offers/:id/submit', idempotentRequired, (req, res) => ok(res, s.offers.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/offers/:id/withdraw', idempotent, (req, res) => ok(res, s.offers.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/offers/:id/cancel', idempotent, (req, res) => ok(res, s.offers.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/offers/:id/amend', idempotentRequired, (req, res) => ok(res, s.offers.amend(req.actor, parseId(req.params.id), parseReqAmend(req.body)), 201));
  r.get('/offers/:id/compare', (req, res) => ok(res, s.offers.compare(req.actor, parseId(req.params.id))));
  r.post('/offers/:id/send', idempotentRequired, (req, res) => ok(res, s.offers.send(req.actor, parseId(req.params.id))));
  r.post('/offers/:id/accept', idempotentRequired, (req, res) => ok(res, s.offers.recordAcceptance(req.actor, parseId(req.params.id), parseOfferAccept(req.body))));
  r.get('/offers/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(s.offers.print(req.actor, parseId(req.params.id))));

  r.get('/onboarding', (req, res) => { const q = parseTaskList(req.query); ok(res, s.onboarding.list(req.actor, { status: q.status, candidateId: q.candidateId })); });
  r.post('/onboarding/:id/complete', idempotent, (req, res) => ok(res, s.onboarding.complete(req.actor, parseId(req.params.id), parseTaskDone(req.body))));
  return r;
}

/** The candidate's side of an offer, with no sign-in: the link is the proof. Rate limited per address. */
export function offerLinkRoutes({ recruit: s }) {
  const r = Router();
  const limiter = createRateLimiter();
  const limit = (name, perMinute) => (req, _res, next) => (limiter.take(`${name}:${req.ip}`, perMinute).ok ? next() : next(new HttpError(429, 'RATE_LIMITED', 'Too many attempts from this address. Wait a minute and try again.')));
  r.get('/offer-link/:token', limit('offer-look', 30), (req, res) => res.json({ data: s.link.info(parseToken(req.params.token)) }));
  r.post('/offer-link/:token/respond', limit('offer-respond', 10), (req, res) => res.json({ data: s.link.respond(parseToken(req.params.token), parseRespond(req.body)) }));
  r.put('/offer-link/:token/prejoining', limit('offer-details', 10), (req, res) => res.json({ data: s.link.prejoining(parseToken(req.params.token), parsePrejoining(req.body)) }));
  return r;
}
