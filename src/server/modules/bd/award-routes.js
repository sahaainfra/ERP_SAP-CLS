import { Router } from 'express';
import {
  parseAnalysis, parseAwardCreate, parseAwardUpdate, parseCredentialCreate, parseCredentialLink, parseCredentialUpdate, parseEmdAmend, parseEmdCreate, parseEmdIssue, parseEmdRefund, parseEmdUpdate, parseId, parseNegotiation, parseReason, parseResults, parseSubmissionAmend, parseSubmissionCreate, parseSubmissionRecord, parseSubmissionUpdate
} from './award-validators.js';

/** Part 08.03: credentials, EMD and fees, the submission, the opening results, the competitors, negotiation and the award. Rights and scope are checked in the service. */
export function awardRoutes({ aw, exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const html = (res, body) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(body);
  const exportOf = (code) => (req, res) => {
    const svc = exportsOf();
    if (!svc) throw new Error('The list export service is not running');
    const out = svc.start(req.actor, code, req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  };
  const pid = (req) => parseId(req.params.id);
  const c = aw.credentials;
  r.get('/credentials', (req, res) => res.json(c.list(req.actor, req.query)));
  r.get('/credentials/export', exportOf('bd.credentials'));
  r.post('/credentials', idempotentRequired, (req, res) => ok(res, c.create(req.actor, parseCredentialCreate(req.body)), 201));
  r.get('/credentials/:id', (req, res) => ok(res, c.get(req.actor, pid(req))));
  r.patch('/credentials/:id', idempotent, (req, res) => ok(res, c.update(req.actor, pid(req), parseCredentialUpdate(req.body))));
  r.delete('/credentials/:id', (req, res) => ok(res, c.remove(req.actor, pid(req))));
  r.get('/tenders/:id/credentials', (req, res) => ok(res, c.forTender(req.actor, pid(req))));
  r.post('/tenders/:id/credentials', idempotent, (req, res) => ok(res, c.link(req.actor, pid(req), parseCredentialLink(req.body)), 201));
  r.delete('/tender-credentials/:id', (req, res) => ok(res, c.unlink(req.actor, pid(req))));
  const e = aw.emd;
  r.get('/emd', (req, res) => res.json(e.list(req.actor, req.query)));
  r.get('/emd/export', exportOf('bd.emd'));
  r.get('/emd/ageing', (req, res) => ok(res, aw.ageingReport(req.actor)));
  r.post('/emd', idempotentRequired, (req, res) => ok(res, e.create(req.actor, parseEmdCreate(req.body)), 201));
  r.get('/emd/:id', (req, res) => ok(res, e.get(req.actor, pid(req))));
  r.patch('/emd/:id', idempotent, (req, res) => ok(res, e.update(req.actor, pid(req), parseEmdUpdate(req.body))));
  r.delete('/emd/:id', (req, res) => ok(res, e.remove(req.actor, pid(req))));
  r.post('/emd/:id/submit', idempotentRequired, (req, res) => ok(res, e.submit(req.actor, pid(req)), 202));
  r.post('/emd/:id/withdraw', idempotentRequired, (req, res) => ok(res, e.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/emd/:id/cancel', idempotentRequired, (req, res) => ok(res, e.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/emd/:id/amend', idempotentRequired, (req, res) => ok(res, e.amend(req.actor, pid(req), parseEmdAmend(req.body))));
  r.post('/emd/:id/issue', idempotentRequired, (req, res) => ok(res, e.issue(req.actor, pid(req), parseEmdIssue(req.body))));
  r.post('/emd/:id/refund', idempotentRequired, (req, res) => ok(res, e.refund(req.actor, pid(req), parseEmdRefund(req.body))));
  r.get('/emd/:id/print', (req, res) => html(res, e.print(req.actor, pid(req))));
  r.get('/tenders/:id/emd', (req, res) => ok(res, e.forTender(req.actor, pid(req))));
  const s = aw.submissions;
  r.get('/tenders/:id/submission', (req, res) => ok(res, s.forTender(req.actor, pid(req))));
  r.post('/submissions', idempotentRequired, (req, res) => ok(res, s.create(req.actor, parseSubmissionCreate(req.body)), 201));
  r.get('/submissions/:id', (req, res) => ok(res, s.get(req.actor, pid(req))));
  r.patch('/submissions/:id', idempotent, (req, res) => ok(res, s.update(req.actor, pid(req), parseSubmissionUpdate(req.body))));
  r.post('/submissions/:id/submit', idempotentRequired, (req, res) => ok(res, s.submit(req.actor, pid(req)), 202));
  r.post('/submissions/:id/withdraw', idempotentRequired, (req, res) => ok(res, s.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/submissions/:id/amend', idempotentRequired, (req, res) => ok(res, s.amend(req.actor, pid(req), parseSubmissionAmend(req.body))));
  r.post('/submissions/:id/record', idempotentRequired, (req, res) => ok(res, s.record(req.actor, pid(req), parseSubmissionRecord(req.body))));
  r.get('/tenders/:id/results', (req, res) => ok(res, aw.results.get(req.actor, pid(req))));
  r.put('/tenders/:id/results', idempotentRequired, (req, res) => ok(res, aw.results.save(req.actor, pid(req), parseResults(req.body))));
  r.get('/competitor-reports', (req, res) => ok(res, aw.analysis(req.actor, parseAnalysis(req.query))));
  r.get('/competitors/:id', (req, res) => ok(res, aw.competitor(req.actor, pid(req))));
  r.get('/tenders/:id/negotiations', (req, res) => ok(res, aw.negotiations.list(req.actor, pid(req))));
  r.post('/tenders/:id/negotiations', idempotentRequired, (req, res) => ok(res, aw.negotiations.add(req.actor, pid(req), parseNegotiation(req.body)), 201));
  const a = aw.awards;
  r.get('/awards', (req, res) => res.json(a.list(req.actor, req.query)));
  r.get('/awards/export', exportOf('bd.awards'));
  r.post('/awards', idempotentRequired, (req, res) => ok(res, a.create(req.actor, parseAwardCreate(req.body)), 201));
  r.get('/awards/:id', (req, res) => ok(res, a.get(req.actor, pid(req))));
  r.patch('/awards/:id', idempotent, (req, res) => ok(res, a.update(req.actor, pid(req), parseAwardUpdate(req.body))));
  r.delete('/awards/:id', (req, res) => ok(res, a.remove(req.actor, pid(req))));
  r.post('/awards/:id/submit', idempotentRequired, (req, res) => ok(res, a.submit(req.actor, pid(req)), 202));
  r.post('/awards/:id/withdraw', idempotentRequired, (req, res) => ok(res, a.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/awards/:id/cancel', idempotentRequired, (req, res) => ok(res, a.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/awards/:id/print', (req, res) => html(res, a.print(req.actor, pid(req))));
  r.get('/tenders/:id/award', (req, res) => ok(res, a.forTender(req.actor, pid(req))));
  return r;
}
