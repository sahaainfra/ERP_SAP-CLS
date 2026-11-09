import { Router } from 'express';
import {
  parseActivityCreate, parseActivityList, parseActivityUpdate, parseAmend, parseBoqLinks, parseBulk, parseCalendarCreate, parseCalendarDays, parseCalendarUpdate, parseDepCreate, parseGenerate, parseId, parseImport,
  parseProgress, parseProjectQ, parseReason, parseScheduleCreate, parseScheduleUpdate, parseTemplateCreate,
} from './validators.js';

/** /api/v1/plan: the schedule core (part 13.01). Rights and scope are checked in the service. */
export function planRoutes(svc, { exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router(); const p = svc.plan;
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const csv = (res, out) => res.status(200).set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.name}"`, 'cache-control': 'no-store' }).send(out.body);
  r.get('/projects', (req, res) => ok(res, p.schedules.projects(req.actor)));
  r.get('/options', (req, res) => ok(res, p.schedules.options(req.actor, parseId(req.query.projectId))));
  r.get('/current', (req, res) => ok(res, p.schedules.current(req.actor, parseId(req.query.projectId), { working: req.query.working === 'true' })));
  // calendars
  r.get('/calendars', (req, res) => ok(res, p.calendars.list(req.actor, parseProjectQ(req.query))));
  r.post('/calendars', idempotentRequired, (req, res) => ok(res, p.calendars.create(req.actor, parseCalendarCreate(req.body)), 201));
  r.get('/calendars/:id', (req, res) => ok(res, p.calendars.get(req.actor, pid(req))));
  r.patch('/calendars/:id', idempotent, (req, res) => ok(res, p.calendars.update(req.actor, pid(req), parseCalendarUpdate(req.body))));
  r.post('/calendars/:id/activate', idempotentRequired, (req, res) => ok(res, p.calendars.activate(req.actor, pid(req))));
  r.post('/calendars/:id/cancel', idempotent, (req, res) => ok(res, p.calendars.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/calendars/:id/days', (req, res) => ok(res, p.calendars.days(req.actor, pid(req), parseCalendarDays(req.query))));
  r.get('/calendars/:id/history', (req, res) => ok(res, p.calendars.history(req.actor, pid(req))));
  // templates
  r.get('/templates', (req, res) => ok(res, p.templates.list(req.actor)));
  r.post('/templates', idempotentRequired, (req, res) => ok(res, p.templates.create(req.actor, parseTemplateCreate(req.body)), 201));
  r.post('/templates/:id/activate', idempotentRequired, (req, res) => ok(res, p.templates.activate(req.actor, pid(req))));
  r.post('/templates/:id/cancel', idempotent, (req, res) => ok(res, p.templates.cancel(req.actor, pid(req), parseReason(req.body))));
  // schedules
  r.get('/schedules', (req, res) => res.json(p.schedules.list(req.actor, req.query)));
  r.get('/schedules/export', (req, res) => {
    const x = exportsOf(); if (!x) throw new Error('The list export service is not running');
    const out = x.start(req.actor, 'plan.schedules', req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  });
  r.post('/schedules', idempotentRequired, (req, res) => ok(res, p.schedules.create(req.actor, parseScheduleCreate(req.body)), 201));
  r.get('/schedules/:id', (req, res) => ok(res, p.schedules.get(req.actor, pid(req))));
  r.patch('/schedules/:id', idempotent, (req, res) => ok(res, p.schedules.update(req.actor, pid(req), parseScheduleUpdate(req.body))));
  r.delete('/schedules/:id', (req, res) => ok(res, p.schedules.remove(req.actor, pid(req))));
  r.post('/schedules/:id/submit', idempotentRequired, (req, res) => ok(res, p.schedules.submit(req.actor, pid(req)), 202));
  r.post('/schedules/:id/withdraw', idempotent, (req, res) => ok(res, p.schedules.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/schedules/:id/cancel', idempotent, (req, res) => ok(res, p.schedules.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/schedules/:id/amend', idempotentRequired, (req, res) => ok(res, p.schedules.amend(req.actor, pid(req), parseAmend(req.body)), 201));
  r.get('/schedules/:id/history', (req, res) => ok(res, p.schedules.history(req.actor, pid(req))));
  r.get('/schedules/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(p.schedules.print(req.actor, pid(req))));
  r.post('/schedules/:id/import', idempotentRequired, (req, res) => ok(res, p.schedules.import(req.actor, pid(req), parseImport(req.body)), 201));
  r.post('/schedules/:id/calculate', idempotent, (req, res) => ok(res, p.schedules.calculate(req.actor, pid(req))));
  r.post('/schedules/:id/update-progress', idempotentRequired, (req, res) => ok(res, p.schedules.progress(req.actor, pid(req), parseProgress(req.body))));
  r.get('/schedules/:id/critical', (req, res) => ok(res, p.critical(req.actor, pid(req), { near: Math.max(0, Math.min(100, Number(req.query.near ?? 5) || 0)) })));
  r.get('/schedules/:id/critical/export', (req, res) => csv(res, p.criticalCsv(req.actor, pid(req))));
  r.post('/schedules/:id/generate/preview', (req, res) => ok(res, p.generate.preview(req.actor, pid(req), parseGenerate(req.body))));
  r.post('/schedules/:id/generate', idempotentRequired, (req, res) => ok(res, p.generate.run(req.actor, pid(req), parseGenerate(req.body)), 201));
  // activities and links
  r.get('/schedules/:id/activities', (req, res) => ok(res, p.activities.list(req.actor, pid(req), parseActivityList(req.query))));
  r.post('/schedules/:id/activities', idempotentRequired, (req, res) => ok(res, p.activities.create(req.actor, pid(req), parseActivityCreate(req.body)), 201));
  r.patch('/schedules/:id/activities', idempotent, (req, res) => ok(res, p.activities.bulk(req.actor, pid(req), parseBulk(req.body))));
  r.post('/schedules/:id/dependencies', idempotentRequired, (req, res) => ok(res, p.links.create(req.actor, pid(req), parseDepCreate(req.body)), 201));
  r.get('/activities/:id', (req, res) => ok(res, p.activities.get(req.actor, pid(req))));
  r.patch('/activities/:id', idempotent, (req, res) => ok(res, p.activities.update(req.actor, pid(req), parseActivityUpdate(req.body))));
  r.delete('/activities/:id', (req, res) => ok(res, p.activities.remove(req.actor, pid(req))));
  r.put('/activities/:id/boq', idempotent, (req, res) => ok(res, p.activities.setBoq(req.actor, pid(req), parseBoqLinks(req.body))));
  r.delete('/dependencies/:id', (req, res) => ok(res, p.links.remove(req.actor, pid(req))));
  return r;
}
