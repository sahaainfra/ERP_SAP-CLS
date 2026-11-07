import { Router } from 'express';
import { parseAssumptions, parseBoq, parseDiscount, parseId, parseReason, parseReview, parseSensitivity } from './review-validators.js';

/** Part 09.03: the review panel, the bid price summary, the assumptions register, the sensitivity, the unbalanced items and the priced BOQ of an estimate. Rights, scope and masking are checked in the service. */
export function reviewRoutes({ rv }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  r.get('/estimates/:id/review', (req, res) => ok(res, rv.panel(req.actor, pid(req))));
  r.get('/estimates/:id/reviews', (req, res) => ok(res, rv.reviews.list(req.actor, pid(req))));
  r.post('/estimates/:id/reviews', idempotentRequired, (req, res) => ok(res, rv.reviews.record(req.actor, pid(req), parseReview(req.body)), 201));
  r.get('/estimates/:id/bid-summary', (req, res) => ok(res, rv.summary.get(req.actor, pid(req))));
  r.put('/estimates/:id/bid-summary', idempotent, (req, res) => ok(res, rv.summary.update(req.actor, pid(req), parseDiscount(req.body))));
  r.post('/estimates/:id/bid-summary/submit', idempotentRequired, (req, res) => ok(res, rv.summary.submitDiscount(req.actor, pid(req)), 202));
  r.post('/estimates/:id/bid-summary/withdraw', idempotent, (req, res) => ok(res, rv.summary.withdrawDiscount(req.actor, pid(req), parseReason(req.body))));
  r.get('/estimates/:id/assumptions', (req, res) => ok(res, rv.assumptions.list(req.actor, pid(req))));
  r.put('/estimates/:id/assumptions', idempotent, (req, res) => ok(res, rv.assumptions.put(req.actor, pid(req), parseAssumptions(req.body))));
  r.get('/estimates/:id/sensitivity', (req, res) => ok(res, rv.sensitivity(req.actor, pid(req), { pct: String(parseSensitivity(req.query).pct) })));
  r.get('/estimates/:id/unbalanced', (req, res) => ok(res, rv.unbalanced(req.actor, pid(req))));
  r.get('/estimates/:id/priced-boq', (req, res) => {
    const out = rv.pricedBoq(req.actor, pid(req), parseBoq(req.query));
    if (out.kind === 'html') return res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(out.body);
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store' });
    return res.send(out.buffer);
  });
  return r;
}
