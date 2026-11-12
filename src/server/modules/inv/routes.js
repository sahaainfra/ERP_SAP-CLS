import { Router } from 'express';
import { forbidden, notFound } from '../../platform/http/errors.js';
import { parseAdjCreate, parseAdjUpdate, parseBin, parseBinUpdate, parseCardQ, parseDashQ, parseMmdQ, parseMmdDrillQ, parseMmdFunnelQ, parseMmdStageQ, parseMmdExportQ, parseMmdStoresQ, parseId, parseInspection, parseItemsQ, parseMovement, parseOpening, parseReason, parseResQ, parseReservation, parseStoreChange, parseStoreCreate, parseStoreUpdate, parseTransfer, parseValuationQ, parseApptCreate, parseGateCheck, parseGateQ, parseInwardCreate, parseInwardImport, parseInwardUpdate, parsePassCreate, parsePassImport, parsePassUpdate, parsePhoto, parsePoQ, parseReturn, parseUnload, parseVendorQ, parseVerify, parseWeigh, parseGrnAmend, parseGrnCert, parseGrnCreate, parseGrnImport, parseGrnPhoto, parseGrnUpdate, parseInspect, parsePrefillQ, parseRtvCreate, parseRtvImport, parseRtvUpdate, parseAck, parseCertify, parseDrillQ, parseFreeIssueQ, parseIssueCreate, parseIssueImport, parseIssuePrefillQ, parseIssueUpdate, parseReconcile, parseReturnCreate, parseReturnImport, parseReturnUpdate, parseTargetQ, parseDispatch, parseReceive, parseResolve, parseTransferCreate, parseTransferImport, parseTransferPhoto, parseTransferPrefillQ, parseTransferUpdate, parseTransitQ, parseCountCreate, parseCountImport, parseCountUpdate, parseCounts, parseDisposalCreate, parseDisposalUpdate, parseExpiryQ, parseReasons, parseScrapEntry, parseScrapImport, parseVarianceQ, parseReorderChange, parseReorderChangeUpdate, parseReorderRecalc, parseReorderImport, parseReorderParamsQ, parseSuggestionConvert, parseAgeingQ, parseLabelTargetsQ, parseLabelPrint, parseScanQ, parseRtaMovement, parseRtaMovementUpdate, parseRtaImport, parseRtaAsset, parseRtaAssetUpdate, parseRtaHireQ, parseRtaBill, parseRtaRecQ, parseRtaRecUpdate, parseRtaHoldingQ, parseAssetCreate, parseAssetUpdate, parseAssetImport, parseAstHandover, parseAssetAck, parseAstAssetReturn, parseAstInspect, parseAstCalibrate, parseAstRepairOut, parseAstRepairIn, parseAstDispose, parseAstLossCreate, parseAstLossUpdate, parseAstStatementQ, parseAstCalDueQ, parseMrcGenerate, parseMrcLines, parseMrcStatusQ, parseMrcTrendQ, parseMrcImport, parseMrcContribution, parseMrcMaterial, parseMrcMaterialUpdate } from './validators.js';

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

/** /api/v1/inv physical verification, count variance, scrap and expiry (part 16.06). Behind its own flag, ff.inv.p1606. */
export function countRoutes(svc, { idempotent, idempotentRequired, flags }) {
  const r = Router(); const { plans, entries, disposals, expiry } = svc.count; const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  r.use(['/count-plans', '/count-variance', '/scrap-entries', '/scrap-disposals', '/expiry'], (req, _res, next) => (flags.isOn(req.actor, 'ff.inv.p1606') ? next() : next(notFound('Physical verification and scrap are not enabled for your company yet (feature flag ff.inv.p1606 is OFF).'))));
  r.get('/count-plans/due', (req, res) => ok(res, plans.due(req.actor)));
  r.get('/count-plans/queue', (req, res) => ok(res, plans.queue(req.actor)));
  r.get('/count-plans', (req, res) => res.json(plans.list(req.actor, req.query)));
  r.post('/count-plans', idempotentRequired, (req, res) => ok(res, plans.create(req.actor, parseCountCreate(req.body)), 201));
  r.post('/count-plans/import', idempotentRequired, (req, res) => { const b = parseCountImport(req.body); ok(res, plans.importRows(req.actor, b), 201); });
  r.get('/count-plans/:id', (req, res) => ok(res, plans.get(req.actor, pid(req))));
  r.patch('/count-plans/:id', idempotent, (req, res) => ok(res, plans.update(req.actor, pid(req), parseCountUpdate(req.body))));
  r.delete('/count-plans/:id', (req, res) => ok(res, plans.remove(req.actor, pid(req))));
  r.post('/count-plans/:id/submit', idempotentRequired, (req, res) => ok(res, plans.submit(req.actor, pid(req)), 202));
  r.post('/count-plans/:id/withdraw', idempotent, (req, res) => ok(res, plans.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/count-plans/:id/cancel', idempotent, (req, res) => ok(res, plans.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/count-plans/:id/amend', idempotent, (req, res) => ok(res, plans.amend(req.actor, pid(req))));
  r.post('/count-plans/:id/start', idempotentRequired, (req, res) => ok(res, plans.start(req.actor, pid(req))));
  r.get('/count-plans/:id/sheet', (req, res) => ok(res, plans.sheet(req.actor, pid(req))));
  r.post('/count-plans/:id/counts', idempotentRequired, (req, res) => { const b = parseCounts(req.body); ok(res, plans.record(req.actor, pid(req), { lines: b.lines, recount: Boolean(b.recount) })); });
  r.post('/count-plans/:id/close', idempotentRequired, (req, res) => ok(res, plans.close(req.actor, pid(req))));
  r.post('/count-plans/:id/review', idempotent, (req, res) => ok(res, plans.review(req.actor, pid(req), parseReasons(req.body))));
  r.post('/count-plans/:id/adjustment', idempotentRequired, (req, res) => ok(res, plans.adjust(req.actor, pid(req)), 201));
  r.get('/count-plans/:id/history', (req, res) => ok(res, plans.history(req.actor, pid(req))));
  r.get('/count-plans/:id/print', (req, res) => file(res, plans.print(req.actor, pid(req))));
  r.get('/count-variance', (req, res) => ok(res, plans.variance(req.actor, parseVarianceQ(req.query))));
  r.get('/scrap-entries', (req, res) => res.json(entries.list(req.actor, req.query)));
  r.post('/scrap-entries', idempotentRequired, (req, res) => ok(res, entries.create(req.actor, parseScrapEntry(req.body)), 201));
  r.get('/scrap-entries/:id', (req, res) => ok(res, entries.get(req.actor, pid(req))));
  r.post('/scrap-entries/:id/cancel', idempotent, (req, res) => ok(res, entries.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/scrap-disposals', (req, res) => res.json(disposals.list(req.actor, req.query)));
  r.post('/scrap-disposals', idempotentRequired, (req, res) => ok(res, disposals.create(req.actor, parseDisposalCreate(req.body)), 201));
  r.post('/scrap-disposals/import', idempotentRequired, (req, res) => ok(res, disposals.importRows(req.actor, parseScrapImport(req.body)), 201));
  r.get('/scrap-disposals/:id', (req, res) => ok(res, disposals.get(req.actor, pid(req))));
  r.patch('/scrap-disposals/:id', idempotent, (req, res) => ok(res, disposals.update(req.actor, pid(req), parseDisposalUpdate(req.body))));
  r.delete('/scrap-disposals/:id', (req, res) => ok(res, disposals.remove(req.actor, pid(req))));
  r.post('/scrap-disposals/:id/submit', idempotentRequired, (req, res) => ok(res, disposals.submit(req.actor, pid(req)), 202));
  r.post('/scrap-disposals/:id/withdraw', idempotent, (req, res) => ok(res, disposals.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/scrap-disposals/:id/cancel', idempotent, (req, res) => ok(res, disposals.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/scrap-disposals/:id/amend', idempotent, (req, res) => ok(res, disposals.amend(req.actor, pid(req))));
  r.get('/scrap-disposals/:id/history', (req, res) => ok(res, disposals.history(req.actor, pid(req))));
  r.get('/scrap-disposals/:id/print', (req, res) => file(res, disposals.print(req.actor, pid(req))));
  r.get('/expiry', (req, res) => ok(res, expiry.report(req.actor, parseExpiryQ(req.query))));
  return r;
}

/** /api/v1/inv reorder control, stock ageing, redeployment, labels and scanning (part 16.07). Behind its own flag, ff.inv.p1607. */
export function reorderRoutes(svc, { idempotent, idempotentRequired, flags }) {
  const r = Router(); const { params, changes, suggestions, ageing, labels } = svc.reorder; const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  r.use(['/reorder-params', '/reorder-changes', '/reorder-suggestions', '/ageing', '/redeployment', '/labels', '/scan'], (req, _res, next) => (flags.isOn(req.actor, 'ff.inv.p1607') ? next() : next(notFound('Reorder control, ageing and labels are not enabled for your company yet.'))));
  r.get('/reorder-params/options', (req, res) => ok(res, params.options(req.actor)));
  r.get('/reorder-params', (req, res) => ok(res, params.list(req.actor, parseReorderParamsQ(req.query))));
  r.get('/reorder-changes', (req, res) => res.json(changes.list(req.actor, req.query)));
  r.post('/reorder-changes', idempotentRequired, (req, res) => ok(res, changes.create(req.actor, parseReorderChange(req.body)), 201));
  r.post('/reorder-changes/import', idempotentRequired, (req, res) => ok(res, changes.importRows(req.actor, parseReorderImport(req.body)), 201));
  r.post('/reorder-changes/recalc', idempotentRequired, (req, res) => ok(res, changes.recalc(req.actor, parseReorderRecalc(req.body)), 201));
  r.get('/reorder-changes/:id', (req, res) => ok(res, changes.get(req.actor, pid(req))));
  r.patch('/reorder-changes/:id', idempotent, (req, res) => ok(res, changes.update(req.actor, pid(req), parseReorderChangeUpdate(req.body))));
  r.post('/reorder-changes/:id/submit', idempotentRequired, (req, res) => ok(res, changes.submit(req.actor, pid(req)), 202));
  r.post('/reorder-changes/:id/withdraw', idempotent, (req, res) => ok(res, changes.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/reorder-changes/:id/cancel', idempotent, (req, res) => ok(res, changes.cancel(req.actor, pid(req), parseReason(req.body))));
  r.get('/reorder-changes/:id/history', (req, res) => ok(res, changes.history(req.actor, pid(req))));
  r.get('/reorder-suggestions/summary', (req, res) => ok(res, suggestions.summary(req.actor)));
  r.get('/reorder-suggestions', (req, res) => res.json(suggestions.list(req.actor, req.query)));
  r.post('/reorder-suggestions/run', idempotentRequired, (req, res) => { if (!svc.base.may(req.actor, 'inv.reorder.suggest')) throw forbidden('You may not run the reorder check (permission inv.reorder.suggest).'); ok(res, suggestions.run(req.actor)); });
  r.post('/reorder-suggestions/convert', idempotentRequired, (req, res) => ok(res, suggestions.convert(req.actor, parseSuggestionConvert(req.body)), 201));
  r.get('/reorder-suggestions/:id', (req, res) => ok(res, suggestions.get(req.actor, pid(req))));
  r.post('/reorder-suggestions/:id/dismiss', idempotent, (req, res) => ok(res, suggestions.dismiss(req.actor, pid(req), parseReason(req.body))));
  r.get('/ageing', (req, res) => ok(res, ageing.report(req.actor, parseAgeingQ(req.query))));
  r.get('/redeployment', (req, res) => ok(res, ageing.redeploy(req.actor)));
  r.get('/labels/targets', (req, res) => ok(res, labels.targets(req.actor, parseLabelTargetsQ(req.query))));
  r.get('/labels/log', (req, res) => ok(res, labels.log(req.actor)));
  r.post('/labels', idempotentRequired, (req, res) => ok(res, labels.print(req.actor, parseLabelPrint(req.body)), 201));
  r.get('/scan', (req, res) => ok(res, labels.resolve(req.actor, parseScanQ(req.query).code)));
  return r;
}

/** /api/v1/inv/rta returnable site assets: catalogue, movements, hire charges, recoveries, dashboard (part 16.08). Behind its own flag, ff.inv.p1608. The movements live under /rta because /inv/movements is the stock movement of 16.01. */
export function rtaRoutes(svc, { idempotent, idempotentRequired, flags }) {
  const r = Router(); const { catalogue, movements, hire, recoveries, dashboard } = svc.rta; const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  r.use('/rta', (req, _res, next) => (flags.isOn(req.actor, 'ff.inv.p1608') ? next() : next(notFound('Returnable site assets are not enabled for your company yet.'))));
  r.get('/rta/dashboard', (req, res) => ok(res, dashboard.summary(req.actor)));
  r.get('/rta/reconciliation', (req, res) => ok(res, dashboard.reconcile(req.actor)));
  r.get('/rta/options', (req, res) => ok(res, movements.options(req.actor)));
  r.get('/rta/holdings', (req, res) => ok(res, movements.holdings(req.actor, parseRtaHoldingQ(req.query))));
  r.get('/rta/catalogue/candidates', (req, res) => ok(res, catalogue.candidates(req.actor)));
  r.get('/rta/catalogue', (req, res) => ok(res, catalogue.list(req.actor)));
  r.post('/rta/catalogue', idempotentRequired, (req, res) => ok(res, catalogue.create(req.actor, parseRtaAsset(req.body)), 201));
  r.patch('/rta/catalogue/:id', idempotent, (req, res) => ok(res, catalogue.update(req.actor, pid(req), parseRtaAssetUpdate(req.body))));
  r.get('/rta/movements', (req, res) => res.json(movements.list(req.actor, req.query)));
  r.post('/rta/movements', idempotentRequired, (req, res) => ok(res, movements.create(req.actor, parseRtaMovement(req.body)), 201));
  r.post('/rta/movements/import', idempotentRequired, (req, res) => ok(res, movements.importRows(req.actor, parseRtaImport(req.body)), 201));
  r.get('/rta/movements/:id', (req, res) => ok(res, movements.get(req.actor, pid(req))));
  r.patch('/rta/movements/:id', idempotent, (req, res) => ok(res, movements.update(req.actor, pid(req), parseRtaMovementUpdate(req.body))));
  r.delete('/rta/movements/:id', (req, res) => ok(res, movements.remove(req.actor, pid(req))));
  r.post('/rta/movements/:id/submit', idempotentRequired, (req, res) => ok(res, movements.submit(req.actor, pid(req)), 202));
  r.post('/rta/movements/:id/withdraw', idempotent, (req, res) => ok(res, movements.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/rta/movements/:id/cancel', idempotent, (req, res) => ok(res, movements.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/rta/movements/:id/amend', idempotent, (req, res) => ok(res, movements.amend(req.actor, pid(req)), 201));
  r.get('/rta/movements/:id/history', (req, res) => ok(res, movements.history(req.actor, pid(req))));
  r.get('/rta/movements/:id/print', (req, res) => file(res, movements.print(req.actor, pid(req))));
  r.get('/rta/hire', (req, res) => ok(res, hire.list(req.actor, parseRtaHireQ(req.query))));
  r.post('/rta/hire/:id/bill', idempotent, (req, res) => ok(res, hire.verifyBill(req.actor, pid(req), parseRtaBill(req.body))));
  r.get('/rta/recoveries', (req, res) => ok(res, recoveries.list(req.actor, parseRtaRecQ(req.query))));
  r.get('/rta/recoveries/:id', (req, res) => ok(res, recoveries.get(req.actor, pid(req))));
  r.patch('/rta/recoveries/:id', idempotent, (req, res) => ok(res, recoveries.update(req.actor, pid(req), parseRtaRecUpdate(req.body))));
  r.post('/rta/recoveries/:id/submit', idempotentRequired, (req, res) => ok(res, recoveries.submit(req.actor, pid(req)), 202));
  r.post('/rta/recoveries/:id/withdraw', idempotent, (req, res) => ok(res, recoveries.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/rta/recoveries/:id/cancel', idempotent, (req, res) => ok(res, recoveries.cancel(req.actor, pid(req), parseReason(req.body))));
  return r;
}

/** /api/v1/inv small assets, loss reports, custody statement and calibration due (part 16.09). Behind its own flag, ff.inv.p1609. */
export function assetRoutes(svc, { idempotent, idempotentRequired, flags }) {
  const r = Router(); const { assets, custody, losses, disposal, report } = svc.asset; const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  r.use(['/small-assets', '/loss-reports', '/custody-statement', '/calibration-due'], (req, _res, next) => (flags.isOn(req.actor, 'ff.inv.p1609') ? next() : next(notFound('Tool and small-asset custody is not enabled for your company yet.'))));
  r.get('/small-assets/options', (req, res) => ok(res, assets.options(req.actor)));
  r.get('/small-assets/mine', (req, res) => ok(res, custody.mine(req.actor)));
  r.get('/small-assets', (req, res) => res.json(assets.list(req.actor, req.query)));
  r.post('/small-assets', idempotentRequired, (req, res) => ok(res, assets.create(req.actor, parseAssetCreate(req.body)), 201));
  r.post('/small-assets/import', idempotentRequired, (req, res) => ok(res, assets.importRows(req.actor, parseAssetImport(req.body)), 201));
  r.get('/small-assets/:id', (req, res) => ok(res, assets.get(req.actor, pid(req))));
  r.patch('/small-assets/:id', idempotent, (req, res) => ok(res, assets.update(req.actor, pid(req), parseAssetUpdate(req.body))));
  r.delete('/small-assets/:id', (req, res) => ok(res, assets.remove(req.actor, pid(req))));
  r.post('/small-assets/:id/submit', idempotentRequired, (req, res) => ok(res, assets.submit(req.actor, pid(req)), 202));
  r.post('/small-assets/:id/withdraw', idempotent, (req, res) => ok(res, assets.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/small-assets/:id/cancel', idempotent, (req, res) => ok(res, assets.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/small-assets/:id/amend', idempotent, (req, res) => ok(res, assets.amend(req.actor, pid(req), parseReason(req.body))));
  r.get('/small-assets/:id/history', (req, res) => ok(res, assets.history(req.actor, pid(req))));
  r.get('/small-assets/:id/print', (req, res) => file(res, assets.print(req.actor, pid(req))));
  r.get('/small-assets/:id/tag', (req, res) => ok(res, assets.tag(req.actor, pid(req))));
  r.post('/small-assets/:id/issue', idempotentRequired, (req, res) => ok(res, custody.issue(req.actor, pid(req), parseAstHandover(req.body)), 201));
  r.post('/small-assets/:id/transfer', idempotentRequired, (req, res) => ok(res, custody.transfer(req.actor, pid(req), parseAstHandover(req.body)), 201));
  r.post('/small-assets/:id/cancel-handover', idempotent, (req, res) => ok(res, custody.cancelIssue(req.actor, pid(req), parseReason(req.body))));
  r.post('/small-assets/:id/acknowledge', idempotentRequired, (req, res) => ok(res, custody.acknowledge(req.actor, pid(req), parseAssetAck(req.body))));
  r.post('/small-assets/:id/return', idempotentRequired, (req, res) => ok(res, custody.return(req.actor, pid(req), parseAstAssetReturn(req.body))));
  r.post('/small-assets/:id/inspect', idempotent, (req, res) => ok(res, custody.inspect(req.actor, pid(req), parseAstInspect(req.body))));
  r.post('/small-assets/:id/calibrate', idempotent, (req, res) => ok(res, custody.calibrate(req.actor, pid(req), parseAstCalibrate(req.body))));
  r.post('/small-assets/:id/repair-out', idempotent, (req, res) => ok(res, custody.repairOut(req.actor, pid(req), parseAstRepairOut(req.body))));
  r.post('/small-assets/:id/repair-in', idempotent, (req, res) => ok(res, custody.repairIn(req.actor, pid(req), parseAstRepairIn(req.body))));
  r.post('/small-assets/:id/dispose', idempotentRequired, (req, res) => ok(res, disposal.request(req.actor, pid(req), parseAstDispose(req.body)), 202));
  r.get('/loss-reports', (req, res) => res.json(losses.list(req.actor, req.query)));
  r.post('/loss-reports', idempotentRequired, (req, res) => ok(res, losses.create(req.actor, parseAstLossCreate(req.body)), 201));
  r.get('/loss-reports/:id', (req, res) => ok(res, losses.get(req.actor, pid(req))));
  r.patch('/loss-reports/:id', idempotent, (req, res) => ok(res, losses.update(req.actor, pid(req), parseAstLossUpdate(req.body))));
  r.delete('/loss-reports/:id', (req, res) => ok(res, losses.remove(req.actor, pid(req))));
  r.post('/loss-reports/:id/submit', idempotentRequired, (req, res) => ok(res, losses.submit(req.actor, pid(req)), 202));
  r.post('/loss-reports/:id/withdraw', idempotent, (req, res) => ok(res, losses.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/loss-reports/:id/cancel', idempotent, (req, res) => ok(res, losses.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/loss-reports/:id/amend', idempotent, (req, res) => ok(res, losses.amend(req.actor, pid(req)), 201));
  r.get('/loss-reports/:id/history', (req, res) => ok(res, losses.history(req.actor, pid(req))));
  r.get('/loss-reports/:id/print', (req, res) => file(res, losses.print(req.actor, pid(req))));
  r.get('/custody-statement/print', (req, res) => file(res, report.printStatement(req.actor, parseAstStatementQ(req.query).employeeId)));
  r.get('/custody-statement', (req, res) => ok(res, report.statement(req.actor, parseAstStatementQ(req.query).employeeId)));
  r.get('/calibration-due', (req, res) => ok(res, report.calibrationDue(req.actor, parseAstCalDueQ(req.query))));
  return r;
}

/** /api/v1/inv monthly material reconciliation: key materials, status, reconciliations, trend (part 16.10). Behind its own flag, ff.inv.p1610. */
export function mrcRoutes(svc, { idempotent, idempotentRequired, flags }) {
  const r = Router(); const { keyMaterials, recons } = svc.mrc; const ok = (res, data, status = 200) => res.status(status).json({ data }); const pid = (req) => parseId(req.params.id);
  const file = (res, out) => res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer);
  r.use(['/reconciliations', '/reconciliation-materials'], (req, _res, next) => (flags.isOn(req.actor, 'ff.inv.p1610') ? next() : next(notFound('Monthly material reconciliation is not enabled for your company yet.'))));
  r.get('/reconciliation-materials/candidates', (req, res) => ok(res, keyMaterials.candidates(req.actor)));
  r.get('/reconciliation-materials', (req, res) => ok(res, keyMaterials.list(req.actor)));
  r.post('/reconciliation-materials', idempotentRequired, (req, res) => ok(res, keyMaterials.add(req.actor, parseMrcMaterial(req.body)), 201));
  r.patch('/reconciliation-materials/:id', idempotent, (req, res) => ok(res, keyMaterials.update(req.actor, pid(req), parseMrcMaterialUpdate(req.body))));
  r.delete('/reconciliation-materials/:id', (req, res) => ok(res, keyMaterials.remove(req.actor, pid(req))));
  r.get('/reconciliations/status', (req, res) => ok(res, recons.status(req.actor, parseMrcStatusQ(req.query).period)));
  r.get('/reconciliations/trend', (req, res) => ok(res, recons.trend(req.actor, parseMrcTrendQ(req.query))));
  r.get('/reconciliations/lines/:id/drilldown', (req, res) => ok(res, recons.drilldown(req.actor, pid(req))));
  r.get('/reconciliations', (req, res) => res.json(recons.list(req.actor, req.query)));
  r.post('/reconciliations', idempotentRequired, (req, res) => ok(res, recons.generate(req.actor, parseMrcGenerate(req.body)), 201));
  r.post('/reconciliations/import', idempotentRequired, (req, res) => ok(res, recons.importRows(req.actor, parseMrcImport(req.body))));
  r.get('/reconciliations/:id', (req, res) => ok(res, recons.get(req.actor, pid(req))));
  r.patch('/reconciliations/:id', idempotent, (req, res) => ok(res, recons.updateLines(req.actor, pid(req), parseMrcLines(req.body))));
  r.delete('/reconciliations/:id', (req, res) => ok(res, recons.remove(req.actor, pid(req))));
  r.post('/reconciliations/:id/recompute', idempotentRequired, (req, res) => ok(res, recons.recompute(req.actor, pid(req))));
  r.post('/reconciliations/:id/submit', idempotentRequired, (req, res) => ok(res, recons.submit(req.actor, pid(req)), 202));
  r.post('/reconciliations/:id/withdraw', idempotent, (req, res) => ok(res, recons.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/reconciliations/:id/cancel', idempotent, (req, res) => ok(res, recons.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/reconciliations/:id/amend', idempotent, (req, res) => ok(res, recons.amend(req.actor, pid(req), parseReason(req.body)), 201));
  r.post('/reconciliations/:id/contributions', idempotent, (req, res) => ok(res, recons.contribute(req.actor, pid(req), parseMrcContribution(req.body)), 201));
  r.get('/reconciliations/:id/history', (req, res) => ok(res, recons.history(req.actor, pid(req))));
  r.get('/reconciliations/:id/print', (req, res) => file(res, recons.print(req.actor, pid(req))));
  return r;
}

/** /api/v1/inv/materials materials management dashboard, drill-down, lifecycle funnel and exports (part 16.11). Behind its own flag, ff.inv.p1611. */
export function mmdRoutes(svc, { flags }) {
  const r = Router(); const m = svc.mmd; const ok = (res, data) => res.status(200).json({ data });
  r.use('/materials', (req, _res, next) => (flags.isOn(req.actor, 'ff.inv.p1611') ? next() : next(notFound('The materials dashboard is not enabled for your company yet.'))));
  r.get('/materials/dashboard', (req, res) => ok(res, m.dashboard(req.actor, parseMmdQ(req.query))));
  r.get('/materials/drill', (req, res) => ok(res, m.drill(req.actor, parseMmdDrillQ(req.query))));
  r.get('/materials/funnel', (req, res) => ok(res, m.funnel(req.actor, parseMmdFunnelQ(req.query))));
  r.get('/materials/funnel/records', (req, res) => ok(res, m.stageRecords(req.actor, parseMmdStageQ(req.query))));
  r.get('/materials/export', (req, res) => { const out = m.exportCsv(req.actor, parseMmdExportQ(req.query)); res.status(200).set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).send(out.buffer); });
  r.get('/materials/projects', (req, res) => ok(res, m.projects(req.actor)));
  r.get('/materials/stores', (req, res) => ok(res, m.stores(req.actor, parseMmdStoresQ(req.query).projectId)));
  r.get('/materials/categories', (req, res) => ok(res, m.categories(req.actor)));
  return r;
}
