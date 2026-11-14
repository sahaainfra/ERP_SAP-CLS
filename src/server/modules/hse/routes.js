import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/hse: plans, HIRA, JSA, inductions and toolbox talks (part 19.01), later permits, incidents, inspections, ESG, security, camp and the dashboard. Each part behind its own flag. */
export function hseRoutes(svc, { idempotent, idempotentRequired, flags, parts = {} }) {
  const r = Router(); const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => v.parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  const { plans, hira, jsa, content, inductions, medical, topics, talks } = svc;
  r.use((req, _res, next) => (flags.isOn(req.actor, 'ff.hse.p1901') ? next() : next(notFound('HSE is not enabled for your company yet.'))));
  const q = (req) => req.query;
  const doc = (path, s, parseCreate, parseUpdate) => {
    r.get(`${path}/options`, (req, res) => ok(res, s.options(req.actor, q(req).projectId ? { projectId: Number(q(req).projectId) } : {})));
    r.get(path, (req, res) => res.json(s.list(req.actor, q(req))));
    r.post(path, idempotentRequired, (req, res) => ok(res, s.create(req.actor, parseCreate(req.body)), 201));
    r.get(`${path}/:id`, (req, res) => ok(res, s.get(req.actor, pid(req))));
    r.patch(`${path}/:id`, idempotent, (req, res) => ok(res, s.update(req.actor, pid(req), parseUpdate(req.body))));
    r.delete(`${path}/:id`, (req, res) => ok(res, s.remove(req.actor, pid(req))));
    r.post(`${path}/:id/cancel`, idempotent, (req, res) => ok(res, s.cancel(req.actor, pid(req), v.parseReason(req.body))));
  };
  const approved = (path, s) => {
    r.post(`${path}/:id/submit`, idempotentRequired, (req, res) => ok(res, s.submit(req.actor, pid(req)), 202));
    r.post(`${path}/:id/withdraw`, idempotent, (req, res) => ok(res, s.withdraw(req.actor, pid(req), v.parseReason(req.body))));
    r.post(`${path}/:id/amend`, idempotent, (req, res) => ok(res, s.amend(req.actor, pid(req), v.parseReason(req.body))));
    r.get(`${path}/:id/history`, (req, res) => ok(res, s.history(req.actor, pid(req))));
    r.get(`${path}/:id/print`, (req, res) => file(res, s.print(req.actor, pid(req))));
  };
  r.get('/hira/summary', (req, res) => ok(res, hira.summary(req.actor, v.parseProjectQ(q(req)))));
  r.get('/hira/export', (req, res) => file(res, svc.exportHira(req.actor)));
  doc('/plans', plans, v.parsePlanCreate, v.parsePlanUpdate); approved('/plans', plans); r.post('/plans/:id/file', idempotent, (req, res) => ok(res, plans.attach(req.actor, pid(req), v.parseFileAttach(req.body))));
  doc('/hira', hira, v.parseHiraCreate, v.parseHiraUpdate); approved('/hira', hira);
  doc('/jsa', jsa, v.parseJsaCreate, v.parseJsaUpdate);
  r.post('/jsa/:id/release', idempotent, (req, res) => ok(res, jsa.release(req.actor, pid(req))));
  r.post('/jsa/:id/sign', idempotent, (req, res) => ok(res, jsa.sign(req.actor, pid(req), v.parseJsaSign(req.body))));
  r.post('/jsa/:id/complete', idempotent, (req, res) => ok(res, jsa.complete(req.actor, pid(req))));
  r.get('/jsa/:id/print', (req, res) => file(res, jsa.print(req.actor, pid(req))));
  // induction content, inductions and the medical status
  r.get('/induction-content/options', (req, res) => ok(res, content.options(req.actor)));
  r.get('/induction-content/for-site', (req, res) => ok(res, content.forSite(req.actor, v.parseSiteQ(q(req)).siteId)));
  r.get('/induction-content', (req, res) => res.json(content.list(req.actor, q(req))));
  r.post('/induction-content', idempotentRequired, (req, res) => ok(res, content.create(req.actor, v.parseContentCreate(req.body)), 201));
  r.get('/induction-content/:id', (req, res) => ok(res, content.get(req.actor, pid(req))));
  r.patch('/induction-content/:id', idempotent, (req, res) => ok(res, content.update(req.actor, pid(req), v.parseContentUpdate(req.body))));
  r.delete('/induction-content/:id', (req, res) => ok(res, content.remove(req.actor, pid(req))));
  r.get('/inductions/options', (req, res) => ok(res, inductions.options(req.actor, q(req).siteId ? { siteId: Number(q(req).siteId) } : {})));
  r.get('/inductions/people', (req, res) => ok(res, inductions.people(req.actor, v.parsePeopleQ(q(req)))));
  r.get('/inductions/check', (req, res) => ok(res, inductions.check(req.actor, v.parseBadgeQ(q(req)))));
  r.post('/inductions/scan', idempotentRequired, (req, res) => ok(res, inductions.scan(req.actor, v.parseInductionScan(req.body)), 201));
  r.get('/inductions', (req, res) => res.json(inductions.list(req.actor, q(req))));
  r.post('/inductions', idempotentRequired, (req, res) => ok(res, inductions.create(req.actor, v.parseInductionCreate(req.body)), 201));
  r.get('/inductions/:id', (req, res) => ok(res, inductions.get(req.actor, pid(req))));
  r.post('/inductions/:id/cancel', idempotent, (req, res) => ok(res, inductions.cancel(req.actor, pid(req), v.parseReason(req.body))));
  r.get('/medical', (req, res) => ok(res, medical.list(req.actor, q(req).workerId ? { workerId: Number(q(req).workerId) } : {})));
  r.post('/medical', idempotentRequired, (req, res) => ok(res, medical.record(req.actor, v.parseMedicalCreate(req.body)), 201));
  // toolbox topics and talks
  r.get('/toolbox-topics', (req, res) => res.json(topics.list(req.actor, q(req))));
  r.post('/toolbox-topics', idempotentRequired, (req, res) => ok(res, topics.create(req.actor, v.parseTopicCreate(req.body)), 201));
  r.get('/toolbox-topics/:id', (req, res) => ok(res, topics.get(req.actor, pid(req))));
  r.patch('/toolbox-topics/:id', idempotent, (req, res) => ok(res, topics.update(req.actor, pid(req), v.parseTopicUpdate(req.body))));
  r.delete('/toolbox-topics/:id', (req, res) => ok(res, topics.remove(req.actor, pid(req))));
  doc('/toolbox-talks', talks, v.parseTalkCreate, v.parseTalkUpdate);
  r.post('/toolbox-talks/:id/attend', idempotent, (req, res) => ok(res, talks.attend(req.actor, pid(req), v.parseAttend(req.body))));
  r.post('/toolbox-talks/:id/photos', idempotent, (req, res) => ok(res, talks.photo(req.actor, pid(req), v.parseFileAttach(req.body))));
  r.post('/toolbox-talks/:id/complete', idempotent, (req, res) => ok(res, talks.complete(req.actor, pid(req))));
  r.get('/compliance', (req, res) => ok(res, svc.compliance(req.actor, v.parseProjectQ(q(req)))));
  r.get('/compliance/export', (req, res) => file(res, svc.exportCompliance(req.actor, v.parseProjectQ(q(req)))));
  for (const mount of Object.values(parts)) mount(r, { ok, pid, file, idempotent, idempotentRequired, flags });
  return r;
}
