import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import * as v from './validators.js';

/** /api/v1/ctr: client contracts, clauses, obligations, milestones and amendments (part 21.01), later the rest of the contracts module. Each part behind its own flag. */
export function ctrRoutes(svc, { idempotent, idempotentRequired, flags, parts = {} }) {
  const r = Router(); const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => v.parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  const { contracts, clauses, obligations, milestones, amendments } = svc; const q = (req) => req.query;
  r.use((req, _res, next) => (flags.isOn(req.actor, 'ff.ctr.p2101') ? next() : next(notFound('Contract management is not enabled for your company yet.'))));
  const doc = (path, s, parseCreate, parseUpdate) => {
    r.get(`${path}/options`, (req, res) => ok(res, s.options(req.actor)));
    r.get(`${path}/export`, (req, res) => file(res, s.exportCsv(req.actor)));
    r.post(`${path}/import`, idempotentRequired, (req, res) => ok(res, s.importRows(req.actor, { rows: Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 500) : [] }), 201));
    r.get(path, (req, res) => res.json(s.list(req.actor, q(req))));
    r.post(path, idempotentRequired, (req, res) => ok(res, s.create(req.actor, parseCreate(req.body)), 201));
    r.get(`${path}/:id`, (req, res) => ok(res, s.get(req.actor, pid(req))));
    r.patch(`${path}/:id`, idempotent, (req, res) => ok(res, s.update(req.actor, pid(req), parseUpdate(req.body))));
    r.delete(`${path}/:id`, (req, res) => ok(res, s.remove(req.actor, pid(req))));
    r.post(`${path}/:id/submit`, idempotentRequired, (req, res) => ok(res, s.submit(req.actor, pid(req)), 202));
    r.post(`${path}/:id/withdraw`, idempotent, (req, res) => ok(res, s.withdraw(req.actor, pid(req), v.parseReason(req.body))));
    r.post(`${path}/:id/cancel`, idempotent, (req, res) => ok(res, s.cancel(req.actor, pid(req), v.parseReason(req.body))));
    r.post(`${path}/:id/amend`, idempotent, (req, res) => ok(res, s.amend(req.actor, pid(req), v.parseReason(req.body))));
    r.get(`${path}/:id/history`, (req, res) => ok(res, s.history(req.actor, pid(req))));
    r.get(`${path}/:id/print`, (req, res) => file(res, s.print(req.actor, pid(req))));
  };
  r.get('/contracts/prefill', (req, res) => ok(res, contracts.prefill(req.actor, v.parsePrefillQ(q(req)).projectId)));
  doc('/contracts', contracts, v.parseContractCreate, v.parseContractUpdate);
  r.post('/contracts/:id/clauses', idempotentRequired, (req, res) => ok(res, clauses.add(req.actor, pid(req), v.parseClause(req.body)), 201));
  r.get('/clauses', (req, res) => ok(res, clauses.library(req.actor, { category: v.CATS.includes(q(req).category) ? q(req).category : null })));
  r.patch('/clauses/:id', idempotent, (req, res) => ok(res, clauses.update(req.actor, pid(req), v.parseClauseUpdate(req.body))));
  r.delete('/clauses/:id', (req, res) => ok(res, clauses.remove(req.actor, pid(req))));
  r.post('/contracts/:id/obligations', idempotentRequired, (req, res) => ok(res, obligations.add(req.actor, pid(req), v.parseObligation(req.body)), 201));
  r.get('/obligations', (req, res) => ok(res, obligations.calendar(req.actor, v.parseCalendarQ(q(req)))));
  r.get('/obligations/export', (req, res) => file(res, obligations.exportCsv(req.actor, v.parseCalendarQ(q(req)))));
  r.patch('/obligations/:id', idempotent, (req, res) => ok(res, obligations.update(req.actor, pid(req), v.parseObligationUpdate(req.body))));
  r.delete('/obligations/:id', (req, res) => ok(res, obligations.remove(req.actor, pid(req))));
  r.post('/obligations/:id/complete', idempotentRequired, (req, res) => ok(res, obligations.complete(req.actor, pid(req), v.parseDone(req.body))));
  r.post('/obligations/:id/waive', idempotent, (req, res) => ok(res, obligations.waive(req.actor, pid(req), v.parseReason(req.body))));
  r.post('/contracts/:id/milestones', idempotentRequired, (req, res) => ok(res, milestones.add(req.actor, pid(req), v.parseMilestone(req.body)), 201));
  r.patch('/milestones/:id', idempotent, (req, res) => ok(res, milestones.update(req.actor, pid(req), v.parseMilestoneUpdate(req.body))));
  r.delete('/milestones/:id', (req, res) => ok(res, milestones.remove(req.actor, pid(req))));
  r.post('/milestones/:id/achieve', idempotentRequired, (req, res) => ok(res, milestones.achieve(req.actor, pid(req), v.parseAchieve(req.body))));
  doc('/amendments', amendments, v.parseAmendCreate, v.parseAmendUpdate);
  for (const mount of Object.values(parts)) mount(r, { ok, pid, file, idempotent, idempotentRequired, flags });
  return r;
}
