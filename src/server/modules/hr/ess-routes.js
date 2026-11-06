import { Router } from 'express';
import { parseId, parseIssue, parseLetterCreate, parseLetterQuery, parseLetterUpdate, parseMonth, parseReason, parseSubmit, parseTeamQuery } from './ess-validators.js';

/** Part 07.09: employee and manager self-service. Rights, the reporting line and the masks are checked in the service. */
export function essRoutes({ ess }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pipe = (res, out, next) => { res.status(200).set(out.headers); out.stream.on('error', next).pipe(res); };
  r.get('/ess/home', (req, res) => ok(res, ess.my.home(req.actor)));
  r.get('/ess/attendance', (req, res) => ok(res, ess.my.attendance(req.actor, parseMonth(req.query))));
  r.get('/ess/profile-changes', (req, res) => ok(res, ess.my.profileChanges(req.actor)));
  r.get('/ess/team', (req, res) => ok(res, ess.team.overview(req.actor, parseTeamQuery(req.query))));
  r.get('/ess/team/members/:id', (req, res) => ok(res, ess.team.member(req.actor, parseId(req.params.id))));
  r.get('/ess/letters', (req, res) => ok(res, ess.letters.list(req.actor, parseLetterQuery(req.query))));
  r.post('/ess/letters', idempotentRequired, (req, res) => ok(res, ess.letters.create(req.actor, parseLetterCreate(req.body)), 201));
  r.get('/ess/letters/:id', (req, res) => ok(res, ess.letters.get(req.actor, parseId(req.params.id))));
  r.patch('/ess/letters/:id', idempotent, (req, res) => ok(res, ess.letters.update(req.actor, parseId(req.params.id), parseLetterUpdate(req.body))));
  r.delete('/ess/letters/:id', (req, res) => ok(res, ess.letters.remove(req.actor, parseId(req.params.id))));
  r.post('/ess/letters/:id/submit', idempotentRequired, (req, res) => ok(res, ess.letters.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/ess/letters/:id/withdraw', idempotent, (req, res) => ok(res, ess.letters.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/ess/letters/:id/cancel', idempotent, (req, res) => ok(res, ess.letters.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.get('/ess/letters/:id/history', (req, res) => ok(res, ess.letters.history(req.actor, parseId(req.params.id))));
  r.post('/ess/letters/:id/issue', idempotentRequired, async (req, res) => ok(res, await ess.letters.issue(req.actor, parseId(req.params.id), parseIssue(req.body)), 201));
  r.get('/ess/letters/:id/content', async (req, res, next) => { try { pipe(res, await ess.letters.content(req.actor, parseId(req.params.id), { download: req.query.download !== '0' }), next); } catch (e) { next(e); } });
  return r;
}
