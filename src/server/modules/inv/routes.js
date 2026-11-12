import { Router } from 'express';
import { notFound } from '../../platform/http/errors.js';
import { parseAdjCreate, parseAdjUpdate, parseBin, parseBinUpdate, parseCardQ, parseDashQ, parseId, parseInspection, parseItemsQ, parseMovement, parseOpening, parseReason, parseResQ, parseReservation, parseStoreChange, parseStoreCreate, parseStoreUpdate, parseTransfer, parseValuationQ, parseApptCreate, parseGateCheck, parseGateQ, parseInwardCreate, parseInwardImport, parseInwardUpdate, parsePassCreate, parsePassImport, parsePassUpdate, parsePhoto, parsePoQ, parseReturn, parseUnload, parseVendorQ, parseVerify, parseWeigh, parseGrnAmend, parseGrnCert, parseGrnCreate, parseGrnImport, parseGrnPhoto, parseGrnUpdate, parseInspect, parsePrefillQ, parseRtvCreate, parseRtvImport, parseRtvUpdate, parseAck, parseCertify, parseDrillQ, parseFreeIssueQ, parseIssueCreate, parseIssueImport, parseIssuePrefillQ, parseIssueUpdate, parseReconcile, parseReturnCreate, parseReturnImport, parseReturnUpdate, parseTargetQ, parseDispatch, parseReceive, parseResolve, parseTransferCreate, parseTransferImport, parseTransferPhoto, parseTransferPrefillQ, parseTransferUpdate, parseTransitQ } from './validators.js';

/** /api/v1/inv: stores, bins, the stock ledger, balances, valuation, reservations and adjustments (part 16.01). Rights and scope are checked in the services. */
export function invRoutes(svc, { idempotent, idempotentRequired }) {
  const r = Router(); const s = svc.invSvc; const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  r.get('/projects', (req, res) => ok(res, s.projects(req.actor)));
  r.get('/items', (req, res) => ok(res, s.items(req.actor, parseItemsQ(req.query).q ?? '')));
  r.get('/dashboard', (req, res) => ok(res, s.dashboard(req.actor, parseDashQ(req.query))));
  r.get('/integrity', (req, res) => ok(res, s.integrity(req.actor)));
  r.get('/stores/options', (req, res) => ok(res, s.stores.options(req.actor)));
  r.get('/stores', (req, res) => res.json(s.stores.list(req.actor, req.query)));
  r.post('/stores', idempotentRequired, (req, res) => ok(res, s.stores.create(req.actor, parseStoreCreate(req.body)), 201));
  r.get('/stores/:id', (req, res) => ok(res, s.stores.get(req.actor, pid(req))));
  r.patch('/stores/:id', idempotent, (req, res) => ok(res, s.stores.update(req.actor, pid(req), parseStoreUpdate(req.body))));
  r.post('/stores/:id/submit', idempotentRequired, (req, res) => ok(res, s.stores.submit(req.actor, pid(req)), 202));
  r.post('/stores/:id/withdraw', idempotent, (req, res) => ok(res, s.stores.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/stores/:id/cancel', idempotent, (req, res) => ok(res, s.stores.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/stores/:id/change', idempotentRequired, (req, res) => ok(res, s.stores.requestChange(req.actor, pid(req), parseStoreChange(req.body)), 202));
  r.post('/stores/:id/deactivate', idempotent, (req, res) => ok(res, s.stores.deactivate(req.actor, pid(req), parseReason(req.body))));
  r.post('/stores/:id/reactivate', idempotent, (req, res) => ok(res, s.stores.reactivate(req.actor, pid(req), parseReason(req.body))));
  r.get('/stores/:id/history', (req, res) => ok(res, s.stores.history(req.actor, pid(req))));
  r.post('/stores/:id/bins', idempotentRequired, (req, res) => ok(res, s.bins.add(req.actor, pid(req), parseBin(req.body)), 201));
  r.patch('/bins/:id', idempotent, (req, res) => ok(res, s.bins.update(req.actor, pid(req), parseBinUpdate(req.body))));
  r.delete('/bins/:id', (req, res) => ok(res, s.bins.remove(req.actor, pid(req))));
  r.get('/balances', (req, res) => res.json(s.balances.list(req.actor, req.query)));
  r.get('/ledger', (req, res) => ok(res, s.itemCard(req.actor, parseCardQ(req.query))));
  r.get('/valuation', (req, res) => ok(res, s.valuation(req.actor, parseValuationQ(req.query))));
  r.post('/movements', idempotentRequired, (req, res) => ok(res, s.movements.post(req.actor, parseMovement(req.body)), 201));
  r.post('/transfers', idempotentRequired, (req, res) => ok(res, s.movements.transfer(req.actor, parseTransfer(req.body)), 201));
  r.post('/inspection', idempotent, (req, res) => ok(res, s.movements.inspection(req.actor, parseInspection(req.body))));
  r.post('/ledger/:id/reverse', idempotentRequired, (req, res) => ok(res, s.movements.reverse(req.actor, pid(req), parseReason(req.body)), 201));
  r.post('/opening-stock', idempotentRequired, (req, res) => ok(res, s.movements.openingImport(req.actor, parseOpening(req.body)), 201));
  r.get('/reservations', (req, res) => ok(res, s.reservations.list(req.actor, parseResQ(req.query))));
  r.post('/reservations', idempotentRequired, (req, res) => ok(res, s.reservations.create(req.actor, parseReservation(req.body)), 201));
  r.post('/reservations/:id/release', idempotent, (req, res) => ok(res, s.reservations.release(req.actor, pid(req), parseReason(req.body))));
  r.get('/adjustments', (req, res) => res.json(s.adjustments.list(req.actor, req.query)));
  r.post('/adjustments', idempotentRequired, (req, res) => ok(res, s.adjustments.create(req.actor, parseAdjCreate(req.body)), 201));
  r.get('/adjustments/:id', (req, res) => ok(res, s.adjustments.get(req.actor, pid(req))));
  r.patch('/adjustments/:id', idempotent, (req, res) => ok(res, s.adjustments.update(req.actor, pid(req), parseAdjUpdate(req.body))));
  r.post('/adjustments/:id/submit', idempotentRequired, (req, res) => ok(res, s.adjustments.submit(req.actor, pid(req)), 202));
  r.post('/adjustments/:id/withdraw', idempotent, (req, res) => ok(res, s.adjustments.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/adjustments/:id/cancel', idempotent, (req, res) => ok(res, s.adjustments.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/adjustments/:id/history', (req, res) => ok(res, s.adjustments.history(req.actor, pid(req))));
  return r;
}

/** /api/v1/inv gate control (part 16.02): appointments, inbound gate entries and the weighbridge, outbound gate passes, the gate register. Behind its own flag, ff.inv.p1602. */
export function gateRoutes(svc, { idempotent, idempotentRequired, flags }) {
  const r = Router(); const g = svc.gate; const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  r.use(['/gate', '/inward', '/passes', '/appointments'], (req, _res, next) => (flags.isOn(req.actor, 'ff.inv.p1602') ? next() : next(notFound('Gate control is not enabled for your company yet (feature flag ff.inv.p1602 is OFF).'))));
  r.get('/gate/options', (req, res) => ok(res, g.options(req.actor)));
  r.get('/gate/dashboard', (req, res) => ok(res, g.dashboard(req.actor, parseGateQ(req.query))));
  r.get('/gate/vendors', (req, res) => ok(res, g.vendors(req.actor, parseVendorQ(req.query).q ?? '')));
  r.get('/gate/purchase-orders', (req, res) => ok(res, g.inward.lookupPo(req.actor, parsePoQ(req.query))));
  r.post('/gate/check', (req, res) => ok(res, g.inward.check(req.actor, parseGateCheck(req.body))));
  r.get('/appointments', (req, res) => res.json(g.appointments.list(req.actor, req.query)));
  r.post('/appointments', idempotentRequired, (req, res) => ok(res, g.appointments.create(req.actor, parseApptCreate(req.body)), 201));
  r.post('/appointments/:id/cancel', idempotent, (req, res) => ok(res, g.appointments.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/inward', (req, res) => res.json(g.inward.list(req.actor, req.query)));
  r.post('/inward', idempotentRequired, (req, res) => ok(res, g.inward.create(req.actor, parseInwardCreate(req.body)), 201));
  r.post('/inward/import', idempotentRequired, (req, res) => ok(res, g.inward.importRows(req.actor, parseInwardImport(req.body)), 201));
  r.get('/inward/:id', (req, res) => ok(res, g.inward.get(req.actor, pid(req))));
  r.patch('/inward/:id', idempotent, (req, res) => ok(res, g.inward.update(req.actor, pid(req), parseInwardUpdate(req.body))));
  r.delete('/inward/:id', (req, res) => ok(res, g.inward.remove(req.actor, pid(req))));
  r.post('/inward/:id/submit', idempotentRequired, (req, res) => ok(res, g.inward.submit(req.actor, pid(req)), 202));
  r.post('/inward/:id/withdraw', idempotent, (req, res) => ok(res, g.inward.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/inward/:id/cancel', idempotent, (req, res) => ok(res, g.inward.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/inward/:id/amend', idempotent, (req, res) => ok(res, g.inward.amend(req.actor, pid(req), parseReason(req.body))));
  r.post('/inward/:id/weighment', idempotentRequired, (req, res) => ok(res, g.inward.weigh(req.actor, pid(req), parseWeigh(req.body))));
  r.post('/inward/:id/unloading', idempotent, (req, res) => ok(res, g.inward.unload(req.actor, pid(req), parseUnload(req.body))));
  r.post('/inward/:id/handover', idempotentRequired, (req, res) => ok(res, g.inward.handover(req.actor, pid(req))));
  r.post('/inward/:id/exit', idempotentRequired, (req, res) => ok(res, g.inward.exit(req.actor, pid(req))));
  r.post('/inward/:id/photos', idempotent, (req, res) => ok(res, g.inward.photo(req.actor, pid(req), parsePhoto(req.body))));
  r.get('/inward/:id/history', (req, res) => ok(res, g.inward.history(req.actor, pid(req))));
  r.get('/inward/:id/print', (req, res) => file(res, g.inward.print(req.actor, pid(req))));
  r.get('/passes', (req, res) => res.json(g.passes.list(req.actor, req.query)));
  r.post('/passes', idempotentRequired, (req, res) => ok(res, g.passes.create(req.actor, parsePassCreate(req.body)), 201));
  r.post('/passes/import', idempotentRequired, (req, res) => ok(res, g.passes.importRows(req.actor, parsePassImport(req.body)), 201));
  r.post('/passes/verify', idempotentRequired, (req, res) => ok(res, g.passes.verify(req.actor, parseVerify(req.body))));
  r.get('/passes/:id', (req, res) => ok(res, g.passes.get(req.actor, pid(req))));
  r.patch('/passes/:id', idempotent, (req, res) => ok(res, g.passes.update(req.actor, pid(req), parsePassUpdate(req.body))));
  r.delete('/passes/:id', (req, res) => ok(res, g.passes.remove(req.actor, pid(req))));
  r.post('/passes/:id/submit', idempotentRequired, (req, res) => ok(res, g.passes.submit(req.actor, pid(req)), 202));
  r.post('/passes/:id/withdraw', idempotent, (req, res) => ok(res, g.passes.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/passes/:id/cancel', idempotent, (req, res) => ok(res, g.passes.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/passes/:id/amend', idempotent, (req, res) => ok(res, g.passes.amend(req.actor, pid(req), parseReason(req.body))));
  r.post('/passes/:id/return', idempotent, (req, res) => ok(res, g.passes.markReturned(req.actor, pid(req), parseReturn(req.body))));
  r.get('/passes/:id/history', (req, res) => ok(res, g.passes.history(req.actor, pid(req))));
  r.get('/passes/:id/print', (req, res) => file(res, g.passes.print(req.actor, pid(req))));
  return r;
}

/** /api/v1/inv goods receipts and returns to vendor (part 16.03). Behind its own flag, ff.inv.p1603. */
export function grnRoutes(svc, { idempotent, idempotentRequired, flags }) {
  const r = Router(); const { grns, rtvs } = svc.grn; const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  r.use(['/grns', '/rtvs'], (req, _res, next) => (flags.isOn(req.actor, 'ff.inv.p1603') ? next() : next(notFound('Goods receipts are not enabled for your company yet (feature flag ff.inv.p1603 is OFF).'))));
  r.get('/grns/summary', (req, res) => ok(res, grns.summary(req.actor)));
  r.get('/grns/ready', (req, res) => ok(res, grns.ready(req.actor)));
  r.get('/grns/prefill', (req, res) => ok(res, grns.prefill(req.actor, parsePrefillQ(req.query))));
  r.get('/grns', (req, res) => res.json(grns.list(req.actor, req.query)));
  r.post('/grns', idempotentRequired, (req, res) => ok(res, grns.create(req.actor, parseGrnCreate(req.body)), 201));
  r.post('/grns/import', idempotentRequired, (req, res) => ok(res, grns.importRows(req.actor, parseGrnImport(req.body)), 201));
  r.get('/grns/:id', (req, res) => ok(res, grns.get(req.actor, pid(req))));
  r.patch('/grns/:id', idempotent, (req, res) => ok(res, grns.update(req.actor, pid(req), parseGrnUpdate(req.body))));
  r.delete('/grns/:id', (req, res) => ok(res, grns.remove(req.actor, pid(req))));
  r.post('/grns/:id/submit', idempotentRequired, (req, res) => ok(res, grns.submit(req.actor, pid(req)), 202));
  r.post('/grns/:id/withdraw', idempotent, (req, res) => ok(res, grns.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/grns/:id/cancel', idempotent, (req, res) => ok(res, grns.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/grns/:id/amend', idempotent, (req, res) => ok(res, grns.amend(req.actor, pid(req), parseGrnAmend(req.body))));
  r.post('/grns/:id/inspection', idempotentRequired, (req, res) => ok(res, grns.inspect(req.actor, pid(req), parseInspect(req.body))));
  r.post('/grns/:id/photos', idempotent, (req, res) => ok(res, grns.photo(req.actor, pid(req), parseGrnPhoto(req.body))));
  r.post('/grns/:id/certificates', idempotent, (req, res) => ok(res, grns.certificate(req.actor, pid(req), parseGrnCert(req.body))));
  r.get('/grns/:id/history', (req, res) => ok(res, grns.history(req.actor, pid(req))));
  r.get('/grns/:id/print', (req, res) => file(res, grns.print(req.actor, pid(req))));
  r.get('/rtvs', (req, res) => res.json(rtvs.list(req.actor, req.query)));
  r.post('/rtvs', idempotentRequired, (req, res) => ok(res, rtvs.create(req.actor, parseRtvCreate(req.body)), 201));
  r.post('/rtvs/import', idempotentRequired, (req, res) => ok(res, rtvs.importRows(req.actor, parseRtvImport(req.body)), 201));
  r.get('/rtvs/:id', (req, res) => ok(res, rtvs.get(req.actor, pid(req))));
  r.patch('/rtvs/:id', idempotent, (req, res) => ok(res, rtvs.update(req.actor, pid(req), parseRtvUpdate(req.body))));
  r.delete('/rtvs/:id', (req, res) => ok(res, rtvs.remove(req.actor, pid(req))));
  r.post('/rtvs/:id/submit', idempotentRequired, (req, res) => ok(res, rtvs.submit(req.actor, pid(req)), 202));
  r.post('/rtvs/:id/withdraw', idempotent, (req, res) => ok(res, rtvs.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/rtvs/:id/cancel', idempotent, (req, res) => ok(res, rtvs.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/rtvs/:id/amend', idempotent, (req, res) => ok(res, rtvs.amend(req.actor, pid(req))));
  r.get('/rtvs/:id/history', (req, res) => ok(res, rtvs.history(req.actor, pid(req))));
  r.get('/rtvs/:id/print', (req, res) => file(res, rtvs.print(req.actor, pid(req))));
  return r;
}

/** /api/v1/inv material issue, site returns and the free-issue ledger (part 16.04). Behind its own flag, ff.inv.p1604. */
export function issueRoutes(svc, { idempotent, idempotentRequired, flags }) {
  const r = Router(); const { issues, siteReturns, freeIssue } = svc.issue; const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  r.use(['/issues', '/site-returns', '/free-issue'], (req, _res, next) => (flags.isOn(req.actor, 'ff.inv.p1604') ? next() : next(notFound('Material issue is not enabled for your company yet (feature flag ff.inv.p1604 is OFF).'))));
  r.get('/issues/summary', (req, res) => ok(res, issues.summary(req.actor)));
  r.get('/issues/work-authorisations', (req, res) => ok(res, issues.workAuths(req.actor)));
  r.get('/issues/targets', (req, res) => ok(res, issues.targets(req.actor, parseTargetQ(req.query).q ?? '')));
  r.get('/issues/prefill', (req, res) => ok(res, issues.prefill(req.actor, parseIssuePrefillQ(req.query))));
  r.get('/issues', (req, res) => res.json(issues.list(req.actor, req.query)));
  r.post('/issues', idempotentRequired, (req, res) => ok(res, issues.create(req.actor, parseIssueCreate(req.body)), 201));
  r.post('/issues/import', idempotentRequired, (req, res) => ok(res, issues.importRows(req.actor, parseIssueImport(req.body)), 201));
  r.get('/issues/:id', (req, res) => ok(res, issues.get(req.actor, pid(req))));
  r.patch('/issues/:id', idempotent, (req, res) => ok(res, issues.update(req.actor, pid(req), parseIssueUpdate(req.body))));
  r.delete('/issues/:id', (req, res) => ok(res, issues.remove(req.actor, pid(req))));
  r.post('/issues/:id/submit', idempotentRequired, (req, res) => ok(res, issues.submit(req.actor, pid(req)), 202));
  r.post('/issues/:id/withdraw', idempotent, (req, res) => ok(res, issues.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/issues/:id/cancel', idempotent, (req, res) => ok(res, issues.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/issues/:id/amend', idempotent, (req, res) => ok(res, issues.amend(req.actor, pid(req))));
  r.post('/issues/:id/ack-code', idempotent, (req, res) => ok(res, issues.ackCode(req.actor, pid(req))));
  r.post('/issues/:id/acknowledge', idempotentRequired, (req, res) => ok(res, issues.acknowledge(req.actor, pid(req), parseAck(req.body))));
  r.get('/issues/:id/history', (req, res) => ok(res, issues.history(req.actor, pid(req))));
  r.get('/issues/:id/print', (req, res) => file(res, issues.print(req.actor, pid(req))));
  r.get('/site-returns', (req, res) => res.json(siteReturns.list(req.actor, req.query)));
  r.post('/site-returns', idempotentRequired, (req, res) => ok(res, siteReturns.create(req.actor, parseReturnCreate(req.body)), 201));
  r.post('/site-returns/import', idempotentRequired, (req, res) => ok(res, siteReturns.importRows(req.actor, parseReturnImport(req.body)), 201));
  r.get('/site-returns/:id', (req, res) => ok(res, siteReturns.get(req.actor, pid(req))));
  r.patch('/site-returns/:id', idempotent, (req, res) => ok(res, siteReturns.update(req.actor, pid(req), parseReturnUpdate(req.body))));
  r.delete('/site-returns/:id', (req, res) => ok(res, siteReturns.remove(req.actor, pid(req))));
  r.post('/site-returns/:id/submit', idempotentRequired, (req, res) => ok(res, siteReturns.submit(req.actor, pid(req)), 202));
  r.post('/site-returns/:id/withdraw', idempotent, (req, res) => ok(res, siteReturns.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/site-returns/:id/cancel', idempotent, (req, res) => ok(res, siteReturns.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/site-returns/:id/amend', idempotent, (req, res) => ok(res, siteReturns.amend(req.actor, pid(req))));
  r.get('/site-returns/:id/history', (req, res) => ok(res, siteReturns.history(req.actor, pid(req))));
  r.get('/site-returns/:id/print', (req, res) => file(res, siteReturns.print(req.actor, pid(req))));
  r.get('/free-issue/projects', (req, res) => ok(res, freeIssue.projects(req.actor)));
  r.get('/free-issue', (req, res) => ok(res, freeIssue.report(req.actor, parseFreeIssueQ(req.query))));
  r.get('/free-issue/drill', (req, res) => ok(res, freeIssue.drill(req.actor, parseDrillQ(req.query))));
  r.post('/free-issue/reconcile', idempotentRequired, (req, res) => ok(res, freeIssue.reconcile(req.actor, parseReconcile(req.body))));
  r.post('/free-issue/certified', idempotentRequired, (req, res) => ok(res, freeIssue.certify(req.actor, parseCertify(req.body)), 201));
  return r;
}

/** /api/v1/inv stock transfers and in-transit stock (part 16.05). Behind its own flag, ff.inv.p1605. */
export function transferRoutes(svc, { idempotent, idempotentRequired, flags }) {
  const r = Router(); const { transfers, inTransit } = svc.transfer; const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  // the single-item movement of 16.01 (POST /transfers with an item in the body) stays where it was: it falls through to that router
  r.use(['/transfers', '/in-transit'], (req, _res, next) => (req.method === 'POST' && req.originalUrl.split('?')[0].replace(/\/$/, '').endsWith('/inv/transfers') && req.body?.itemId !== undefined ? next('router') : next()));
  r.use(['/transfers', '/in-transit'], (req, _res, next) => (flags.isOn(req.actor, 'ff.inv.p1605') ? next() : next(notFound('Stock transfers are not enabled for your company yet (feature flag ff.inv.p1605 is OFF).'))));
  r.get('/transfers/summary', (req, res) => ok(res, transfers.summary(req.actor)));
  r.get('/transfers/options', (req, res) => ok(res, transfers.options(req.actor)));
  r.get('/transfers/prefill', (req, res) => ok(res, transfers.prefill(req.actor, parseTransferPrefillQ(req.query))));
  r.get('/transfers', (req, res) => res.json(transfers.list(req.actor, req.query)));
  r.post('/transfers', idempotentRequired, (req, res) => ok(res, transfers.create(req.actor, parseTransferCreate(req.body)), 201));
  r.post('/transfers/import', idempotentRequired, (req, res) => ok(res, transfers.importRows(req.actor, parseTransferImport(req.body)), 201));
  r.get('/transfers/:id', (req, res) => ok(res, transfers.get(req.actor, pid(req))));
  r.patch('/transfers/:id', idempotent, (req, res) => ok(res, transfers.update(req.actor, pid(req), parseTransferUpdate(req.body))));
  r.delete('/transfers/:id', (req, res) => ok(res, transfers.remove(req.actor, pid(req))));
  r.post('/transfers/:id/submit', idempotentRequired, (req, res) => ok(res, transfers.submit(req.actor, pid(req)), 202));
  r.post('/transfers/:id/withdraw', idempotent, (req, res) => ok(res, transfers.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/transfers/:id/cancel', idempotent, (req, res) => ok(res, transfers.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/transfers/:id/amend', idempotent, (req, res) => ok(res, transfers.amend(req.actor, pid(req))));
  r.post('/transfers/:id/dispatch', idempotentRequired, (req, res) => ok(res, transfers.dispatch(req.actor, pid(req), parseDispatch(req.body))));
  r.post('/transfers/:id/receive', idempotentRequired, (req, res) => ok(res, transfers.receive(req.actor, pid(req), parseReceive(req.body))));
  r.post('/transfers/:id/photos', idempotent, (req, res) => ok(res, transfers.photo(req.actor, pid(req), parseTransferPhoto(req.body))));
  r.post('/transfers/:id/discrepancies/:did/resolve', idempotentRequired, (req, res) => ok(res, transfers.resolve(req.actor, pid(req), parseId(req.params.did), parseResolve(req.body))));
  r.get('/transfers/:id/history', (req, res) => ok(res, transfers.history(req.actor, pid(req))));
  r.get('/transfers/:id/print', (req, res) => file(res, transfers.print(req.actor, pid(req))));
  r.get('/in-transit', (req, res) => ok(res, inTransit.report(req.actor, parseTransitQ(req.query))));
  return r;
}
