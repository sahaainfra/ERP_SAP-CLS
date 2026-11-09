import { Router } from 'express';
import { parseAvailability, parseCheck, parseConfigImport, parseConfigPropose, parseIngestActual, parseIngestCommitment, parseLedger, parseLedgerDocs } from './validators.js';
import { parseChangeCreate, parseChangeImport, parseChangePreview, parseChangeUpdate, parseCompare } from './validators.js';
import { parseAmend, parseBudgetCreate, parseBudgetUpdate, parseGenerate, parseId, parseImport, parseLineCreate, parseLineUpdate, parseOptReason, parsePhasingGenerate, parsePhasingSet, parseProject, parseReason, parseView } from './validators.js';

/** Part 12.01: the project budget: generation from the baseline pack and the BOQ norms, lines and adjustments, views, phasing, margin, versions and approval. Rights and scope are checked in the service. */
export function budRoutes(svc, { exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const pid = (req) => parseId(req.params.id);
  const lid = (req) => parseId(req.params.lineId);
  const html = (res, body) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(body);
  const b = svc.budgets;
  r.get('/project-options', (req, res) => ok(res, b.options(req.actor)));
  r.get('/structure-options', (req, res) => ok(res, b.structure(req.actor, parseProject(req.query).projectId)));
  r.get('/generate/preview', (req, res) => ok(res, b.preview(req.actor, { projectId: parseProject(req.query).projectId })));
  r.post('/generate/preview', (req, res) => ok(res, b.preview(req.actor, parseGenerate(req.body))));
  r.post('/generate', idempotentRequired, (req, res) => ok(res, b.generate(req.actor, parseGenerate(req.body)), 201));
  r.get('/budgets', (req, res) => res.json(b.list(req.actor, req.query)));
  r.get('/budgets/export', (req, res) => {
    const x = exportsOf(); if (!x) throw new Error('The list export service is not running');
    const out = x.start(req.actor, 'bud.budgets', req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  });
  r.post('/budgets', idempotentRequired, (req, res) => ok(res, b.create(req.actor, parseBudgetCreate(req.body)), 201));
  r.get('/budgets/:id', (req, res) => ok(res, b.get(req.actor, pid(req))));
  r.patch('/budgets/:id', idempotent, (req, res) => ok(res, b.update(req.actor, pid(req), parseBudgetUpdate(req.body))));
  r.delete('/budgets/:id', (req, res) => ok(res, b.remove(req.actor, pid(req))));
  r.post('/budgets/:id/submit', idempotentRequired, (req, res) => ok(res, b.submit(req.actor, pid(req)), 202));
  r.post('/budgets/:id/withdraw', idempotent, (req, res) => ok(res, b.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/budgets/:id/cancel', idempotent, (req, res) => ok(res, b.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/budgets/:id/amend', idempotentRequired, (req, res) => ok(res, b.amend(req.actor, pid(req), parseAmend(req.body)), 201));
  r.get('/budgets/:id/history', (req, res) => ok(res, b.history(req.actor, pid(req))));
  r.get('/budgets/:id/print', (req, res) => html(res, b.print(req.actor, pid(req))));
  r.get('/budgets/:id/views', (req, res) => ok(res, b.views(req.actor, pid(req), parseView(req.query))));
  r.get('/budgets/:id/margin', (req, res) => ok(res, b.margin(req.actor, pid(req))));
  r.get('/budgets/:id/lines', (req, res) => ok(res, b.lines.list(req.actor, pid(req), req.query)));
  r.post('/budgets/:id/lines', idempotentRequired, (req, res) => ok(res, b.lines.create(req.actor, pid(req), parseLineCreate(req.body)), 201));
  r.post('/budgets/:id/import', idempotentRequired, (req, res) => ok(res, b.lines.import(req.actor, pid(req), parseImport(req.body)), 201));
  r.get('/budgets/:id/phasing', (req, res) => ok(res, b.phasing.get(req.actor, pid(req))));
  r.post('/budgets/:id/phasing/generate', idempotent, (req, res) => ok(res, b.phasing.generate(req.actor, pid(req), parsePhasingGenerate(req.body))));
  r.patch('/lines/:lineId', idempotent, (req, res) => ok(res, b.lines.update(req.actor, lid(req), parseLineUpdate(req.body))));
  r.delete('/lines/:lineId', (req, res) => ok(res, b.lines.remove(req.actor, lid(req), parseOptReason(req.query))));
  r.get('/lines/:lineId/phasing', (req, res) => ok(res, b.phasing.lineGet(req.actor, lid(req))));
  r.put('/lines/:lineId/phasing', idempotent, (req, res) => ok(res, b.phasing.lineSet(req.actor, lid(req), parsePhasingSet(req.body))));
  // ---- part 12.02: budget changes and the comparison of versions ----
  const c = svc.changes;
  if (c) {
    const exportOf = (code) => (req, res) => {
      const x = exportsOf(); if (!x) throw new Error('The list export service is not running');
      const out = x.start(req.actor, code, req.query);
      if (out.kind === 'job') return res.status(202).json({ data: out });
      res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
      return res.send(out.buffer);
    };
    r.get('/change-options', (req, res) => ok(res, c.options(req.actor, parseProject(req.query).projectId)));
    r.get('/changes', (req, res) => res.json(c.list(req.actor, req.query)));
    r.get('/changes/export', exportOf('bud.changes'));
    r.post('/changes/import', idempotentRequired, (req, res) => ok(res, c.import(req.actor, parseChangeImport(req.body)), 201));
    r.post('/changes/preview', (req, res) => ok(res, c.preview(req.actor, parseChangePreview(req.body))));
    r.post('/changes', idempotentRequired, (req, res) => ok(res, c.create(req.actor, parseChangeCreate(req.body)), 201));
    r.get('/changes/:id', (req, res) => ok(res, c.get(req.actor, pid(req))));
    r.patch('/changes/:id', idempotent, (req, res) => ok(res, c.update(req.actor, pid(req), parseChangeUpdate(req.body))));
    r.delete('/changes/:id', (req, res) => ok(res, c.remove(req.actor, pid(req))));
    r.post('/changes/:id/submit', idempotentRequired, (req, res) => ok(res, c.submit(req.actor, pid(req)), 202));
    r.post('/changes/:id/withdraw', idempotent, (req, res) => ok(res, c.withdraw(req.actor, pid(req), parseReason(req.body))));
    r.post('/changes/:id/cancel', idempotent, (req, res) => ok(res, c.cancel(req.actor, pid(req), parseReason(req.body))));
    r.post('/changes/:id/amend', idempotentRequired, (req, res) => ok(res, c.amend(req.actor, pid(req), parseAmend(req.body)), 201));
    r.get('/changes/:id/history', (req, res) => ok(res, c.history(req.actor, pid(req))));
    r.get('/changes/:id/print', (req, res) => html(res, c.print(req.actor, pid(req))));
    r.get('/compare', (req, res) => ok(res, c.compare(req.actor, parseCompare(req.query))));
    r.get('/compare/export', (req, res) => { const out = c.compareCsv(req.actor, parseCompare(req.query)); res.status(200).set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.name}"`, 'cache-control': 'no-store' }).send(out.body); });
  }
  // ---- part 12.03: the budget check, the commitment ledger and the settings ----
  const l = svc.ledger;
  if (l) {
    const csv = (res, out) => res.status(200).set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${out.name}"`, 'cache-control': 'no-store' }).send(out.body);
    r.post('/check', (req, res) => ok(res, l.check(req.actor, parseCheck(req.body))));
    r.get('/availability', (req, res) => ok(res, l.availability(req.actor, parseAvailability(req.query))));
    r.get('/ledger', (req, res) => ok(res, l.report(req.actor, parseLedger(req.query))));
    r.get('/ledger/documents', (req, res) => ok(res, l.documents(req.actor, parseLedgerDocs(req.query))));
    r.get('/ledger/export', (req, res) => csv(res, l.reportCsv(req.actor, parseLedger(req.query))));
    r.get('/commitments/:id/log', (req, res) => ok(res, l.commitments.ledgerLog(req.actor, pid(req))));
    r.post('/ingest/commitment', idempotentRequired, (req, res) => ok(res, l.ingestCommitment(req.actor, parseIngestCommitment(req.body)), 201));
    r.post('/ingest/actual', idempotentRequired, (req, res) => ok(res, l.ingestActual(req.actor, parseIngestActual(req.body)), 201));
    r.get('/check-config', (req, res) => ok(res, l.config.list(req.actor)));
    r.get('/check-config/export', (req, res) => csv(res, l.config.csv(req.actor)));
    r.post('/check-config/import', idempotentRequired, (req, res) => ok(res, l.config.import(req.actor, parseConfigImport(req.body)), 201));
    r.post('/check-config', idempotentRequired, (req, res) => ok(res, l.config.propose(req.actor, parseConfigPropose(req.body)), 201));
    r.post('/check-config/:id/cancel', idempotent, (req, res) => ok(res, l.config.cancel(req.actor, pid(req), parseReason(req.body))));
    r.get('/check-config/:id/history', (req, res) => ok(res, l.config.history(req.actor, pid(req))));
  }
  return r;
}
