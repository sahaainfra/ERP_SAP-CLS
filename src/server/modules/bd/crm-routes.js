import { Router } from 'express';
import {
  parseContactCreate, parseContactUpdate, parseDirectAward, parseId, parseInteraction, parseInteractionQuery, parseLeadAmend, parseLeadConvert, parseLeadCreate, parseLeadUpdate, parseLose, parseOppAmend, parseOppConvert, parseOppCreate, parseOppUpdate, parseReason, parseReport, parseSubmit, parseTrack
} from './crm-validators.js';

/** Part 08.01: leads, opportunities, interactions, contacts, clients and the pipeline reports. Rights and scope are checked in the service. */
export function crmRoutes({ crm, exportsOf }, { idempotent, idempotentRequired }) {
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
  const l = crm.leads;
  r.get('/leads', (req, res) => res.json(l.list(req.actor, req.query)));
  r.get('/leads/export', exportOf('bd.leads'));
  r.post('/leads', idempotentRequired, (req, res) => ok(res, l.create(req.actor, parseLeadCreate(req.body)), 201));
  r.get('/leads/:id', (req, res) => ok(res, l.get(req.actor, parseId(req.params.id))));
  r.patch('/leads/:id', idempotent, (req, res) => ok(res, l.update(req.actor, parseId(req.params.id), parseLeadUpdate(req.body))));
  r.delete('/leads/:id', (req, res) => ok(res, l.remove(req.actor, parseId(req.params.id))));
  r.post('/leads/:id/submit', idempotentRequired, (req, res) => ok(res, l.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/leads/:id/withdraw', idempotentRequired, (req, res) => ok(res, l.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/leads/:id/cancel', idempotentRequired, (req, res) => ok(res, l.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/leads/:id/amend', idempotentRequired, (req, res) => ok(res, l.amend(req.actor, parseId(req.params.id), parseLeadAmend(req.body))));
  r.post('/leads/:id/convert', idempotentRequired, (req, res) => ok(res, l.convert(req.actor, parseId(req.params.id), parseLeadConvert(req.body)), 201));
  r.get('/leads/:id/history', (req, res) => ok(res, l.history(req.actor, parseId(req.params.id))));
  r.get('/leads/:id/print', (req, res) => html(res, l.print(req.actor, parseId(req.params.id))));
  const o = crm.opportunities;
  r.get('/opportunities', (req, res) => res.json(o.list(req.actor, req.query)));
  r.get('/opportunities/export', exportOf('bd.opportunities'));
  r.post('/opportunities', idempotentRequired, (req, res) => ok(res, o.create(req.actor, parseOppCreate(req.body)), 201));
  r.get('/opportunities/:id', (req, res) => ok(res, o.get(req.actor, parseId(req.params.id))));
  r.patch('/opportunities/:id', idempotent, (req, res) => ok(res, o.update(req.actor, parseId(req.params.id), parseOppUpdate(req.body))));
  r.delete('/opportunities/:id', (req, res) => ok(res, o.remove(req.actor, parseId(req.params.id))));
  r.post('/opportunities/:id/submit', idempotentRequired, (req, res) => ok(res, o.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/opportunities/:id/withdraw', idempotentRequired, (req, res) => ok(res, o.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/opportunities/:id/cancel', idempotentRequired, (req, res) => ok(res, o.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/opportunities/:id/amend', idempotentRequired, (req, res) => ok(res, o.amend(req.actor, parseId(req.params.id), parseOppAmend(req.body))));
  r.post('/opportunities/:id/track', idempotent, (req, res) => ok(res, o.track(req.actor, parseId(req.params.id), parseTrack(req.body))));
  r.post('/opportunities/:id/lose', idempotentRequired, (req, res) => ok(res, o.lose(req.actor, parseId(req.params.id), parseLose(req.body))));
  r.post('/opportunities/:id/direct-award', idempotentRequired, (req, res) => ok(res, o.requestDirectAward(req.actor, parseId(req.params.id), parseDirectAward(req.body)), 202));
  r.post('/opportunities/:id/convert', idempotentRequired, (req, res) => ok(res, o.convert(req.actor, parseId(req.params.id), parseOppConvert(req.body))));
  r.get('/opportunities/:id/history', (req, res) => ok(res, o.history(req.actor, parseId(req.params.id))));
  r.get('/opportunities/:id/print', (req, res) => html(res, o.print(req.actor, parseId(req.params.id))));
  const i = crm.interactions;
  r.get('/interactions', (req, res) => ok(res, i.list(req.actor, parseInteractionQuery(req.query))));
  r.get('/interactions/mine', (req, res) => ok(res, i.mine(req.actor)));
  r.post('/interactions', idempotentRequired, (req, res) => ok(res, i.create(req.actor, parseInteraction(req.body)), 201));
  r.post('/interactions/:id/done', idempotent, (req, res) => ok(res, i.done(req.actor, parseId(req.params.id))));
  r.delete('/interactions/:id', (req, res) => ok(res, i.remove(req.actor, parseId(req.params.id))));
  const c = crm.contacts;
  r.get('/clients', (req, res) => res.json(crm.clients.list(req.actor, req.query)));
  r.get('/clients/:id', (req, res) => ok(res, crm.clients.get(req.actor, parseId(req.params.id))));
  r.get('/clients/:id/contacts', (req, res) => ok(res, c.list(req.actor, parseId(req.params.id))));
  r.post('/clients/:id/contacts', idempotentRequired, (req, res) => ok(res, c.create(req.actor, parseId(req.params.id), parseContactCreate(req.body)), 201));
  r.patch('/contacts/:id', idempotent, (req, res) => ok(res, c.update(req.actor, parseId(req.params.id), parseContactUpdate(req.body))));
  r.delete('/contacts/:id', (req, res) => ok(res, c.remove(req.actor, parseId(req.params.id))));
  r.get('/reports/dashboard', (req, res) => ok(res, crm.reports.dashboard(req.actor, parseReport(req.query))));
  r.get('/reports/forecast', (req, res) => ok(res, crm.reports.forecast(req.actor, parseReport(req.query))));
  r.get('/reports/win-loss', (req, res) => ok(res, crm.reports.winLoss(req.actor, parseReport(req.query))));
  r.get('/reports/board', (req, res) => ok(res, crm.reports.board(req.actor, parseReport(req.query))));
  return r;
}
