import { Router } from 'express';
import {
  parseAddendum, parseCalendar, parseDecisionAmend, parseDecisionCreate, parseDecisionUpdate, parseDocument, parseEligibilityAdd, parseEligibilityUpdate, parseId, parseQueryAdd, parseQueryResponse, parseQueryUpdate, parseReason, parseSubmit, parseTeamTask, parseTenderAmend, parseTenderCreate, parseTenderTrack, parseTenderUpdate
} from './tender-validators.js';

/** Part 08.02: the tender register, eligibility, addenda, queries, team tasks, documents, the calendar, the dashboard and the bid or no-bid decisions. Rights and scope are checked in the service. */
export function tenderRoutes({ tdr, exportsOf }, { idempotent, idempotentRequired }) {
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
  const t = tdr.tenders; const pid = (req) => parseId(req.params.id);
  r.get('/tender-reports/dashboard', (req, res) => ok(res, tdr.dashboard(req.actor)));
  r.get('/tender-reports/calendar', (req, res) => ok(res, tdr.calendar(req.actor, parseCalendar(req.query))));
  r.get('/tenders', (req, res) => res.json(t.list(req.actor, req.query)));
  r.get('/tenders/export', exportOf('bd.tenders'));
  r.post('/tenders', idempotentRequired, (req, res) => ok(res, t.create(req.actor, parseTenderCreate(req.body)), 201));
  r.get('/tenders/:id', (req, res) => ok(res, t.get(req.actor, pid(req))));
  r.patch('/tenders/:id', idempotent, (req, res) => ok(res, t.update(req.actor, pid(req), parseTenderUpdate(req.body))));
  r.delete('/tenders/:id', (req, res) => ok(res, t.remove(req.actor, pid(req))));
  r.post('/tenders/:id/submit', idempotentRequired, (req, res) => ok(res, t.submit(req.actor, pid(req), parseSubmit(req.body)), 202));
  r.post('/tenders/:id/withdraw', idempotentRequired, (req, res) => ok(res, t.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/tenders/:id/cancel', idempotentRequired, (req, res) => ok(res, t.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/tenders/:id/amend', idempotentRequired, (req, res) => ok(res, t.amend(req.actor, pid(req), parseTenderAmend(req.body))));
  r.post('/tenders/:id/track', idempotent, (req, res) => ok(res, t.track(req.actor, pid(req), parseTenderTrack(req.body))));
  r.post('/tenders/:id/capacity', idempotent, (req, res) => ok(res, t.capacity(req.actor, pid(req))));
  r.post('/tenders/:id/ready', idempotentRequired, (req, res) => ok(res, t.markReady(req.actor, pid(req))));
  r.post('/tenders/:id/unready', idempotentRequired, (req, res) => ok(res, t.unready(req.actor, pid(req), parseReason(req.body))));
  r.get('/tenders/:id/history', (req, res) => ok(res, t.history(req.actor, pid(req))));
  r.get('/tenders/:id/print', (req, res) => html(res, t.print(req.actor, pid(req))));
  r.post('/tenders/:id/eligibility', idempotentRequired, (req, res) => ok(res, tdr.eligibility.add(req.actor, pid(req), parseEligibilityAdd(req.body)), 201));
  r.patch('/eligibility/:id', idempotent, (req, res) => ok(res, tdr.eligibility.update(req.actor, pid(req), parseEligibilityUpdate(req.body))));
  r.delete('/eligibility/:id', (req, res) => ok(res, tdr.eligibility.remove(req.actor, pid(req))));
  r.post('/tenders/:id/addenda', idempotentRequired, (req, res) => ok(res, tdr.addenda.add(req.actor, pid(req), parseAddendum(req.body)), 201));
  r.post('/addenda/:id/acknowledge', idempotent, (req, res) => ok(res, tdr.addenda.ack(req.actor, pid(req))));
  r.post('/tenders/:id/queries', idempotentRequired, (req, res) => ok(res, tdr.queries.add(req.actor, pid(req), parseQueryAdd(req.body)), 201));
  r.patch('/queries/:id', idempotent, (req, res) => ok(res, tdr.queries.update(req.actor, pid(req), parseQueryUpdate(req.body))));
  r.post('/queries/:id/send', idempotent, (req, res) => ok(res, tdr.queries.send(req.actor, pid(req))));
  r.post('/queries/:id/respond', idempotentRequired, (req, res) => ok(res, tdr.queries.respond(req.actor, pid(req), parseQueryResponse(req.body))));
  r.post('/queries/:id/no-response', idempotent, (req, res) => ok(res, tdr.queries.noResponse(req.actor, pid(req))));
  r.post('/tenders/:id/team-tasks', idempotentRequired, (req, res) => ok(res, tdr.teamTasks.add(req.actor, pid(req), parseTeamTask(req.body)), 201));
  r.post('/team-tasks/:id/done', idempotent, (req, res) => ok(res, tdr.teamTasks.done(req.actor, pid(req))));
  r.post('/team-tasks/:id/cancel', idempotent, (req, res) => ok(res, tdr.teamTasks.cancel(req.actor, pid(req))));
  r.get('/tenders/:id/documents', (req, res) => ok(res, tdr.documents.list(req.actor, pid(req))));
  r.post('/tenders/:id/documents', idempotentRequired, (req, res) => ok(res, tdr.documents.register(req.actor, pid(req), parseDocument(req.body)), 201));
  const d = tdr.decisions;
  r.get('/bid-decisions', (req, res) => res.json(d.list(req.actor, req.query)));
  r.get('/bid-decisions/export', exportOf('bd.bid_decisions'));
  r.post('/bid-decisions', idempotentRequired, (req, res) => ok(res, d.create(req.actor, parseDecisionCreate(req.body)), 201));
  r.get('/bid-decisions/:id', (req, res) => ok(res, d.get(req.actor, pid(req))));
  r.patch('/bid-decisions/:id', idempotent, (req, res) => ok(res, d.update(req.actor, pid(req), parseDecisionUpdate(req.body))));
  r.delete('/bid-decisions/:id', (req, res) => ok(res, d.remove(req.actor, pid(req))));
  r.post('/bid-decisions/:id/submit', idempotentRequired, (req, res) => ok(res, d.submit(req.actor, pid(req), parseSubmit(req.body)), 202));
  r.post('/bid-decisions/:id/withdraw', idempotentRequired, (req, res) => ok(res, d.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/bid-decisions/:id/cancel', idempotentRequired, (req, res) => ok(res, d.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/bid-decisions/:id/amend', idempotentRequired, (req, res) => ok(res, d.amend(req.actor, pid(req), parseDecisionAmend(req.body))));
  r.get('/bid-decisions/:id/history', (req, res) => ok(res, d.history(req.actor, pid(req))));
  r.get('/bid-decisions/:id/print', (req, res) => html(res, d.print(req.actor, pid(req))));
  return r;
}
