import { Router } from 'express';
import {
  parseAssess, parseCalendar, parseCertCreate, parseCertType, parseCertUpdate, parseCheck, parseCompliance, parseCosts, parseCourse, parseFeedback, parseId, parseMark, parseMatrix, parseNominate, parseReason, parseReschedule, parseSessionCreate, parseSessionUpdate,
  parseSignIn, parseSkillDef, parseSkillHistory, parseSubmit, parseVerify,
} from './trn-validators.js';

/** Part 07.10: training sessions, nominations, QR attendance, certifications and licences, the skill matrix, compliance and cost. Rights and scope are checked in the service. */
export function trainingRoutes({ trn, exportsOf }, { idempotent, idempotentRequired }) {
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
  const origin = (req) => `${req.protocol}://${req.get('host')}`;
  const s = trn.sessions;
  r.get('/sessions', (req, res) => res.json(s.list(req.actor, req.query)));
  r.get('/sessions/export', exportOf('hr.training_sessions'));
  r.get('/sessions/calendar', (req, res) => ok(res, s.calendar(req.actor, parseCalendar(req.query))));
  r.post('/sessions', idempotentRequired, (req, res) => ok(res, s.create(req.actor, parseSessionCreate(req.body)), 201));
  r.get('/sessions/:id', (req, res) => ok(res, s.get(req.actor, parseId(req.params.id))));
  r.patch('/sessions/:id', idempotent, (req, res) => ok(res, s.update(req.actor, parseId(req.params.id), parseSessionUpdate(req.body))));
  r.delete('/sessions/:id', (req, res) => ok(res, s.remove(req.actor, parseId(req.params.id))));
  r.post('/sessions/:id/submit', idempotentRequired, (req, res) => ok(res, s.submit(req.actor, parseId(req.params.id), parseSubmit(req.body)), 202));
  r.post('/sessions/:id/withdraw', idempotent, (req, res) => ok(res, s.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/sessions/:id/cancel', idempotent, (req, res) => ok(res, s.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/sessions/:id/reschedule', idempotent, (req, res) => ok(res, s.reschedule(req.actor, parseId(req.params.id), parseReschedule(req.body))));
  r.post('/sessions/:id/complete', idempotentRequired, (req, res) => ok(res, trn.attendance.complete(req.actor, parseId(req.params.id))));
  r.get('/sessions/:id/history', (req, res) => ok(res, s.history(req.actor, parseId(req.params.id))));
  r.get('/sessions/:id/print', (req, res) => html(res, s.print(req.actor, parseId(req.params.id))));
  r.get('/sessions/:id/qr', async (req, res) => ok(res, await s.qr(req.actor, parseId(req.params.id), origin(req))));
  r.post('/sessions/:id/nominations', idempotentRequired, (req, res) => ok(res, trn.attendance.nominate(req.actor, parseId(req.params.id), parseNominate(req.body).people), 201));
  r.delete('/sessions/:id/nominations/:attendanceId', (req, res) => ok(res, trn.attendance.unnominate(req.actor, parseId(req.params.id), parseId(req.params.attendanceId))));
  r.post('/sessions/:id/attendance', idempotent, (req, res) => ok(res, trn.attendance.mark(req.actor, parseId(req.params.id), parseMark(req.body).rows)));
  r.post('/sessions/:id/feedback', idempotent, (req, res) => ok(res, trn.attendance.feedback(req.actor, parseId(req.params.id), parseFeedback(req.body))));
  r.post('/training/sign-in', idempotent, (req, res) => ok(res, trn.attendance.signIn(req.actor, parseSignIn(req.body))));
  r.get('/training/mine', (req, res) => ok(res, trn.mine.get(req.actor)));
  r.get('/training/courses', (req, res) => ok(res, trn.setup.courses.list(req.actor)));
  r.put('/training/courses', idempotent, (req, res) => ok(res, trn.setup.courses.save(req.actor, parseCourse(req.body))));
  r.get('/training/cert-types', (req, res) => ok(res, trn.setup.certTypes.list(req.actor)));
  r.put('/training/cert-types', idempotent, (req, res) => ok(res, trn.setup.certTypes.save(req.actor, parseCertType(req.body))));
  r.get('/training/skill-defs', (req, res) => ok(res, trn.setup.skills.list(req.actor)));
  r.put('/training/skill-defs', idempotent, (req, res) => ok(res, trn.setup.skills.save(req.actor, parseSkillDef(req.body))));
  const c = trn.certs;
  r.get('/training/certs', (req, res) => res.json(c.list(req.actor, req.query)));
  r.get('/training/certs/export', exportOf('hr.certifications'));
  r.post('/training/certs', idempotentRequired, (req, res) => ok(res, c.create(req.actor, parseCertCreate(req.body)), 201));
  r.post('/training/certs/check', (req, res) => {
    const b = parseCheck(req.body);
    if (!trn.canSee(req.actor, b.personType, b.personId) && !trn.certs.mayCheck(req.actor)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You may not check the certificates of that person (permission hr.cert.check).' } });
    return ok(res, c.check(req.actor.companyId, b));
  });
  r.get('/training/certs/:id', (req, res) => ok(res, c.get(req.actor, parseId(req.params.id))));
  r.patch('/training/certs/:id', idempotent, (req, res) => ok(res, c.update(req.actor, parseId(req.params.id), parseCertUpdate(req.body))));
  r.delete('/training/certs/:id', (req, res) => ok(res, c.remove(req.actor, parseId(req.params.id))));
  r.post('/training/certs/:id/verify', idempotentRequired, (req, res) => ok(res, c.verify(req.actor, parseId(req.params.id), parseVerify(req.body))));
  r.post('/training/certs/:id/revoke', idempotentRequired, (req, res) => ok(res, c.revoke(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/training/skills/assess', idempotentRequired, (req, res) => ok(res, trn.skills.assess(req.actor, parseAssess(req.body)), 201));
  r.get('/training/skills/matrix', (req, res) => ok(res, trn.skills.matrix(req.actor, parseMatrix(req.query))));
  r.get('/training/skills/history', (req, res) => ok(res, trn.skills.history(req.actor, parseSkillHistory(req.query))));
  r.get('/training/compliance', (req, res) => ok(res, trn.compliance.report(req.actor, parseCompliance(req.query))));
  r.get('/training/costs', (req, res) => ok(res, trn.compliance.costs(req.actor, parseCosts(req.query))));
  return r;
}
