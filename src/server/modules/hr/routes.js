import { Router } from 'express';
import {
  parseAmend, parseBankVerify, parseChangeList, parseCreateUser, parseDelete, parseDetails, parseDocumentAdd, parseEmployeeCheck, parseEmployeeCreate, parseEmployeeUpdate, parseId, parseLinkUser, parseOverview, parseQueue, parseReason, parseSubmit,
} from './validators.js';

/** Part 07.01: the employee master. Rights (create, edit, submit, amend, separate, verify bank, see statutory data, link users) and the scope of what a person sees are checked in the service. */
export function employeeRoutes({ employees: s, exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/employees', (req, res) => res.json(s.register.list(req.actor, req.query)));
  r.get('/employees/export', (req, res) => {
    const svc = exportsOf();
    if (!svc) throw new Error('The list export service is not running');
    const out = svc.start(req.actor, 'hr.employees', req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  });
  r.get('/employees/overview', (req, res) => ok(res, s.overview(req.actor, parseOverview(req.query))));
  r.get('/employees/queue', (req, res) => ok(res, s.queue(req.actor, parseQueue(req.query))));
  r.get('/employees/changes', (req, res) => ok(res, s.amendments.list(req.actor, parseChangeList(req.query))));
  r.get('/employees/me', (req, res) => ok(res, s.me(req.actor)));
  r.post('/employees/me/changes', idempotentRequired, (req, res) => { const me = s.me(req.actor); ok(res, s.amendments.request(req.actor, me.id, parseAmend(req.body)), 202); });
  r.post('/employees/check', (req, res) => ok(res, s.registration.check(req.actor, parseEmployeeCheck(req.body))));
  r.post('/employees', idempotentRequired, (req, res) => ok(res, s.registration.create(req.actor, parseEmployeeCreate(req.body)), 201));
  r.post('/employees/changes/:changeId/cancel', idempotent, (req, res) => ok(res, s.amendments.cancel(req.actor, parseId(req.params.changeId), parseReason(req.body))));
  r.get('/employees/:id', (req, res) => ok(res, s.get(req.actor, parseId(req.params.id))));
  r.patch('/employees/:id', idempotent, (req, res) => ok(res, s.registration.update(req.actor, parseId(req.params.id), parseEmployeeUpdate(req.body))));
  r.delete('/employees/:id', (req, res) => ok(res, s.registration.remove(req.actor, parseId(req.params.id), parseDelete(req.body))));
  r.post('/employees/:id/submit', idempotentRequired, (req, res) => ok(res, s.registration.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/employees/:id/withdraw', idempotent, (req, res) => ok(res, s.registration.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/employees/:id/cancel', idempotent, (req, res) => ok(res, s.registration.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/employees/:id/amend', idempotentRequired, (req, res) => ok(res, s.amendments.request(req.actor, parseId(req.params.id), parseAmend(req.body)), 202));
  r.put('/employees/:id/details', idempotent, (req, res) => ok(res, s.details.update(req.actor, parseId(req.params.id), parseDetails(req.body))));
  r.get('/employees/:id/history', (req, res) => ok(res, s.history(req.actor, parseId(req.params.id))));
  r.get('/employees/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(s.print(req.actor, parseId(req.params.id))));
  r.post('/employees/:id/documents', idempotent, (req, res) => ok(res, s.details.addDocument(req.actor, parseId(req.params.id), parseDocumentAdd(req.body)), 201));
  r.post('/employees/:id/documents/:docId/verify', idempotent, (req, res) => ok(res, s.details.verifyDocument(req.actor, parseId(req.params.id), parseId(req.params.docId))));
  r.post('/employees/:id/banks/:bankId/verify', idempotent, (req, res) => ok(res, s.banks.verify(req.actor, parseId(req.params.id), parseId(req.params.bankId), parseBankVerify(req.body))));
  r.get('/employees/:id/banks/:bankId/reveal', (req, res) => ok(res, s.banks.reveal(req.actor, parseId(req.params.id), parseId(req.params.bankId))));
  r.post('/employees/:id/user', idempotentRequired, async (req, res) => ok(res, await s.userLink.createUser(req.actor, parseId(req.params.id), parseCreateUser(req.body)), 201));
  r.post('/employees/:id/link-user', idempotent, (req, res) => ok(res, s.userLink.link(req.actor, parseId(req.params.id), parseLinkUser(req.body))));
  return r;
}
