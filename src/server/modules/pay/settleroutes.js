import { notFound } from '../../platform/http/errors.js';
import { parseFnfCreate, parseFnfImport, parseFnfUpdate, parseHoldAfterLock, parseId, parsePayslipEmail, parsePayslipGenerate, parsePayslipQuery, parsePostingQuery, parseReason, parseTransferConfirm, parseTransferCreate } from './validators.js';

/** Part 24.05: payroll posting, salary transfers, payslips and full-and-final under /api/v1/pay, behind ff.pay.p2405. Rights are checked in the services. */
export function settleRoutes(r, s, { idempotent, idempotentRequired, flags }) {
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  const off = () => notFound('Payroll posting and settlement are not enabled for your company yet (feature flag ff.pay.p2405 is OFF).');
  for (const p of ['/posting', '/transfers', '/payslips', '/fnf']) r.use(p, (req, _res, next) => (flags.isOn(req.actor, 'ff.pay.p2405') ? next() : next(off())));
  // FR-01 posting and the run's payment state
  r.get('/posting/runs', (req, res) => ok(res, s.posting.runs(req.actor, parsePostingQuery(req.query))));
  r.get('/posting/runs/:id', (req, res) => ok(res, s.posting.run(req.actor, pid(req))));
  r.post('/posting/runs/:id/post', idempotentRequired, (req, res) => ok(res, s.posting.post(req.actor, pid(req))));
  r.post('/posting/runs/:id/lines/:lineId/hold', idempotentRequired, (req, res) => ok(res, s.posting.hold(req.actor, pid(req), parseId(req.params.lineId), parseHoldAfterLock(req.body))));
  r.get('/posting/wage-runs', (req, res) => ok(res, s.posting.wageRuns(req.actor, parsePostingQuery(req.query))));
  r.post('/posting/wage-runs/:id/post', idempotentRequired, (req, res) => ok(res, s.posting.postWage(req.actor, pid(req))));
  // FR-02 salary transfers
  r.get('/transfers/banks', (req, res) => ok(res, s.transfers.banks(req.actor)));
  r.get('/transfers', (req, res) => ok(res, s.transfers.list(req.actor, { runId: req.query.runId ? parseId(req.query.runId) : undefined, fnfId: req.query.fnfId ? parseId(req.query.fnfId) : undefined })));
  r.post('/transfers', idempotentRequired, (req, res) => ok(res, s.transfers.create(req.actor, parseTransferCreate(req.body)), 201));
  r.get('/transfers/:id', (req, res) => ok(res, s.transfers.get(req.actor, pid(req))));
  r.post('/transfers/:id/release', idempotentRequired, (req, res) => ok(res, s.transfers.release(req.actor, pid(req))));
  r.post('/transfers/:id/cancel', idempotent, (req, res) => ok(res, s.transfers.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/transfers/:id/file', (req, res) => file(res, s.transfers.file(req.actor, pid(req))));
  r.post('/transfers/:id/confirm', idempotentRequired, (req, res) => ok(res, s.transfers.confirm(req.actor, pid(req), parseTransferConfirm(req.body))));
  // FR-03 payslips
  r.get('/payslips', (req, res) => ok(res, s.payslips.list(req.actor, parsePayslipQuery(req.query))));
  r.get('/payslips/mine', (req, res) => ok(res, s.payslips.mine(req.actor)));
  r.post('/payslips/generate', idempotentRequired, async (req, res) => ok(res, await s.payslips.generate(req.actor, parsePayslipGenerate(req.body)), 202));
  r.post('/payslips/email', idempotentRequired, (req, res) => ok(res, s.payslips.email(req.actor, parsePayslipEmail(req.body)), 202));
  r.get('/payslips/:id/download', async (req, res, next) => { const out = await s.payslips.download(req.actor, pid(req)); res.status(200).set(out.headers); out.stream.on('error', next).pipe(res); });
  // FR-04 full-and-final settlement
  r.get('/fnf', (req, res) => res.json(s.fnf.list(req.actor, req.query)));
  r.get('/fnf/candidates', (req, res) => ok(res, s.fnf.candidates(req.actor)));
  r.get('/fnf/export', (req, res) => file(res, s.fnf.exportCsv(req.actor, req.query)));
  r.post('/fnf', idempotentRequired, (req, res) => ok(res, s.fnf.create(req.actor, parseFnfCreate(req.body)), 201));
  r.get('/fnf/:id', (req, res) => ok(res, s.fnf.get(req.actor, pid(req))));
  r.patch('/fnf/:id', idempotent, (req, res) => ok(res, s.fnf.update(req.actor, pid(req), parseFnfUpdate(req.body))));
  r.delete('/fnf/:id', (req, res) => ok(res, s.fnf.remove(req.actor, pid(req))));
  r.post('/fnf/:id/compute', idempotent, (req, res) => ok(res, s.fnf.recompute(req.actor, pid(req))));
  r.post('/fnf/:id/submit', idempotentRequired, (req, res) => ok(res, s.fnf.submit(req.actor, pid(req)), 202));
  r.post('/fnf/:id/withdraw', idempotent, (req, res) => ok(res, s.fnf.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/fnf/:id/cancel', idempotent, (req, res) => ok(res, s.fnf.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/fnf/:id/amend', idempotentRequired, (req, res) => ok(res, s.fnf.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.get('/fnf/:id/history', (req, res) => ok(res, s.fnf.history(req.actor, pid(req))));
  r.get('/fnf/:id/compare', (req, res) => ok(res, s.fnf.compare(req.actor, pid(req))));
  r.get('/fnf/:id/print', (req, res) => file(res, s.fnf.print(req.actor, pid(req))));
  r.post('/fnf/:id/import', idempotentRequired, (req, res) => ok(res, s.fnf.import(req.actor, pid(req), parseFnfImport(req.body))));
  return r;
}
