import { Router } from 'express';
import { toCsv } from '../../platform/export/index.js';
import { parseBankConfirm, parseBankRequest, parseBankVerify, parseBlacklist, parseDocumentAdd, parseGstinAdd, parseGstinVerify, parsePartnerCheck, parsePartnerCreate, parsePartnerDetails, parsePartnerStatus, parsePartnerSubmit, parsePartnerUpdate, parseQueue, parseSelectable, parseTdsSet } from './validators.js';
import { parseAmend, parseAnalysisCreate, parseAnalysisList, parseAnalysisStart, parseAnalysisSubmit, parseAnalysisUpdate, parseBookCreate, parseBookQuery, parseCompare, parseEdition, parseImpact, parseRateCreate, parseRateList, parseRateLookup, parseRateUpdate, parseReason, parseSorItems, parseSorSearch } from './validators.js';
import { parseAlternate, parseCategory, parseItemCheck, parseItemConvert, parseItemCreate, parseItemList, parseItemMark, parseItemResources, parseItemResubmit, parseItemSearch, parseItemStatus, parseItemUoms, parseItemUpdate, parseItemVersion, parseLegacyMap, parseMakeAdd, parseMakeDecide } from './validators.js';
import { parseEmployeePay, parseStatutoryCalendar, parseStatutoryLookup, parseWagesQuery, parseCommonCreate, parseCommonList, parseCommonRetire, parseCommonUpdate, parseConvert, parseFxQuery, parseGstQuery, parseListCode, parseListSave, parseListValues, parseMaster, parseTdsQuery } from './validators.js';
import { parseAsOf, parseCancel, parseCheck, parseConfig, parseCreate, parseDismiss, parseDuplicateList, parseId, parseLookup, parseMerge, parseQuality, parseRecordList, parseRequestList, parseResubmit, parseScan, parseStatus, parseType, parseUpdate } from './validators.js';

/** Part 06.01: the master data governance API. Every route needs a signed-in person; the rights (view, edit, sensitive, steward of a master, configure) are checked in the service. */
export function mdmRoutes({ service }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/dashboard', (req, res) => ok(res, service.dashboard(req.actor)));
  r.get('/masters', (req, res) => ok(res, service.records.types(req.actor)));
  r.get('/masters/:type/records', (req, res) => ok(res, service.records.list(req.actor, parseType(req.params.type), parseRecordList(req.query))));
  r.get('/masters/:type/records/export', (req, res) => {
    const rows = service.records.list(req.actor, parseType(req.params.type), { ...parseRecordList(req.query), limit: 50_000, offset: 0 }).rows;
    const keys = [...new Set(rows.flatMap((x) => Object.keys(x.data)))];
    const columns = [['code', 'Code'], ['name', 'Name'], ['status', 'Status'], ['dqScore', 'Quality score'], ['effectiveFrom', 'Version from'], ...keys.map((k) => [k, k])].map(([key, label]) => ({ key, label }));
    res.status(200).set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="master-records.csv"' }).send(toCsv({ columns, rows: rows.map((x) => ({ code: x.code, name: x.name, status: x.status, dqScore: x.dqScore, effectiveFrom: x.effectiveFrom, ...x.data })), footer: null }));
  });
  r.get('/masters/:type/lookup', (req, res) => ok(res, service.records.lookup(req.actor, parseType(req.params.type), parseLookup(req.query).q)));
  r.post('/masters/:type/check', (req, res) => ok(res, service.records.check(req.actor, parseType(req.params.type), parseCheck(req.body))));
  r.post('/masters/:type/records', idempotentRequired, (req, res) => ok(res, service.records.create(req.actor, parseType(req.params.type), parseCreate(req.body)), 202));
  r.get('/masters/:type/records/:id', (req, res) => ok(res, service.records.get(req.actor, parseType(req.params.type), parseId(req.params.id), parseAsOf(req.query))));
  r.put('/masters/:type/records/:id', idempotent, (req, res) => { const out = service.records.update(req.actor, parseType(req.params.type), parseId(req.params.id), parseUpdate(req.body)); ok(res, out, out.applied ? 200 : 202); });
  r.post('/masters/:type/records/:id/status', idempotentRequired, (req, res) => ok(res, service.records.setStatus(req.actor, parseType(req.params.type), parseId(req.params.id), parseStatus(req.body)), 202));
  r.get('/masters/:type/records/:id/resolve', (req, res) => ok(res, service.records.resolve(req.actor, parseType(req.params.type), parseId(req.params.id))));
  r.get('/masters/:type/records/:id/references', (req, res) => ok(res, service.records.references(req.actor, parseType(req.params.type), parseId(req.params.id))));
  r.post('/masters/:type/records/:id/review', idempotent, (req, res) => ok(res, service.quality.review(req.actor, parseType(req.params.type), parseId(req.params.id))));
  r.get('/change-requests', (req, res) => ok(res, service.requests.list(req.actor, parseRequestList(req.query))));
  r.get('/change-requests/:id', (req, res) => ok(res, service.requests.get(req.actor, parseId(req.params.id))));
  r.post('/change-requests/:id/cancel', idempotent, (req, res) => ok(res, service.requests.cancel(req.actor, parseId(req.params.id), parseCancel(req.body))));
  r.post('/change-requests/:id/resubmit', idempotent, (req, res) => ok(res, service.requests.resubmit(req.actor, parseId(req.params.id), parseResubmit(req.body))));
  r.get('/duplicates', (req, res) => ok(res, service.duplicates.list(req.actor, parseDuplicateList(req.query))));
  r.post('/duplicates/scan', idempotent, (req, res) => ok(res, service.duplicates.scanNow(req.actor, parseScan(req.body).type)));
  r.post('/duplicates/:id/dismiss', idempotent, (req, res) => ok(res, service.duplicates.dismiss(req.actor, parseId(req.params.id), parseDismiss(req.body))));
  r.post('/merge', idempotentRequired, (req, res) => ok(res, service.duplicates.requestMerge(req.actor, parseMerge(req.body)), 202));
  r.get('/quality', (req, res) => ok(res, service.quality.summary(req.actor, parseQuality(req.query))));
  r.get('/config', (req, res) => ok(res, service.config.get(req.actor)));
  r.get('/config/export', (req, res) => res.status(200).set({ 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="master-data-rules.json"' }).send(JSON.stringify(service.config.export(req.actor), null, 2)));
  r.post('/config', idempotentRequired, (req, res) => ok(res, service.config.propose(req.actor, parseConfig(req.body)), 202));
  return r;
}

/** Part 06.02: the common masters. Reading needs mdm.record.view; changing needs the steward permission of the master (checked in the service); a statutory change returns 202 with its change request. */
export function commonRoutes({ common, statutory }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  if (statutory) { // part 166.8 (ff.mdm.p16608, checked by the service)
    r.get('/statutory/lookup', (req, res) => ok(res, statutory.lookup(req.actor, parseStatutoryLookup(req.query))));
    r.get('/statutory/calendar', (req, res) => ok(res, statutory.calendar(req.actor, parseStatutoryCalendar(req.query))));
    r.get('/statutory/migration-report', (req, res) => ok(res, statutory.migrationReport(req.actor)));
    r.get('/statutory/employees/:id/wages', (req, res) => ok(res, statutory.wages(req.actor, parseId(req.params.id), parseWagesQuery(req.query).month)));
    r.put('/statutory/employees/:id/pay', idempotentRequired, (req, res) => ok(res, statutory.setPay(req.actor, parseId(req.params.id), parseEmployeePay(req.body))));
  }
  r.get('/common', (req, res) => ok(res, common.catalogue(req.actor)));
  r.get('/tax/gst', (req, res) => ok(res, common.tax.gst(req.actor, parseGstQuery(req.query))));
  r.get('/tax/tds', (req, res) => ok(res, common.tax.tds(req.actor, parseTdsQuery(req.query))));
  r.get('/exchange-rate', (req, res) => ok(res, common.tax.exchange(req.actor, parseFxQuery(req.query))));
  r.get('/uoms/convert', (req, res) => ok(res, common.tax.convert(req.actor, parseConvert(req.query))));
  r.get('/lookup-lists', (req, res) => ok(res, common.lookups.lists(req.actor)));
  r.get('/lookup-lists/:list', (req, res) => { const q = parseListValues(req.query); ok(res, common.lookups.values(req.actor, parseListCode(req.params.list), { all: q.all === 'true', lang: q.lang ?? null })); });
  r.put('/lookup-lists/:list', idempotent, (req, res) => ok(res, common.lookups.save(req.actor, parseListCode(req.params.list), parseListSave(req.body))));
  r.get('/common/:master', (req, res) => ok(res, common.list(req.actor, parseMaster(req.params.master), parseCommonList(req.query))));
  r.post('/common/:master', idempotentRequired, (req, res) => { const out = common.create(req.actor, parseMaster(req.params.master), parseCommonCreate(req.body)); ok(res, out, out.applied ? 201 : 202); });
  r.get('/common/:master/:id', (req, res) => ok(res, common.get(req.actor, parseMaster(req.params.master), parseId(req.params.id))));
  r.put('/common/:master/:id', idempotent, (req, res) => { const out = common.update(req.actor, parseMaster(req.params.master), parseId(req.params.id), parseCommonUpdate(req.body)); ok(res, out, out.applied ? 200 : 202); });
  r.post('/common/:master/:id/retire', idempotent, (req, res) => ok(res, common.retire(req.actor, parseMaster(req.params.master), parseId(req.params.id), parseCommonRetire(req.body))));
  return r;
}

/** Part 06.03: the item master. Reading needs mdm.record.view (everyone, through the selector); a request for a new item too; changes need the steward of the item's category (checked in the service). */
export function itemRoutes({ items: s, exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  // the Item Master register (List Report): its own query and its export through the List Report's export service (direct file or a background job)
  r.get('/items/register', (req, res) => res.json(s.register.list(req.actor, req.query)));
  r.get('/items/register/export', (req, res) => {
    const svc = exportsOf();
    if (!svc) throw new Error('The list export service is not running');
    const out = svc.start(req.actor, 'mdm.items', req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  });
  r.get('/item-categories', (req, res) => ok(res, s.categories.tree(req.actor)));
  r.post('/item-categories', idempotent, (req, res) => ok(res, s.categories.save(req.actor, null, parseCategory(req.body)), 201));
  r.put('/item-categories/:id', idempotent, (req, res) => ok(res, s.categories.save(req.actor, parseId(req.params.id), parseCategory(req.body))));
  r.get('/item-categories/:id/history', (req, res) => ok(res, s.categories.history(req.actor, parseId(req.params.id))));
  r.get('/items', (req, res) => ok(res, s.items.list(req.actor, parseItemList(req.query))));
  r.get('/items/search', (req, res) => ok(res, s.items.search(req.actor, parseItemSearch(req.query))));
  r.post('/items/check', (req, res) => ok(res, s.items.check(req.actor, parseItemCheck(req.body))));
  r.get('/items/migration', (req, res) => ok(res, s.migration.candidates(req.actor)));
  r.post('/items/migration/map', idempotent, (req, res) => ok(res, s.migration.map(req.actor, parseLegacyMap(req.body)), 201));
  r.post('/items', idempotentRequired, (req, res) => ok(res, s.items.create(req.actor, parseItemCreate(req.body)), 202));
  r.get('/items/:id', (req, res) => ok(res, s.items.get(req.actor, parseId(req.params.id))));
  r.put('/items/:id', idempotent, (req, res) => ok(res, s.items.update(req.actor, parseId(req.params.id), parseItemUpdate(req.body))));
  r.post('/items/:id/resubmit', idempotent, (req, res) => ok(res, s.items.resubmit(req.actor, parseId(req.params.id), parseItemResubmit(req.body))));
  r.post('/items/:id/versions', idempotentRequired, (req, res) => ok(res, s.items.newVersion(req.actor, parseId(req.params.id), parseItemVersion(req.body)), 202));
  r.post('/items/:id/status', idempotent, (req, res) => ok(res, s.items.setStatus(req.actor, parseId(req.params.id), parseItemStatus(req.body))));
  r.get('/items/:id/where-used', (req, res) => ok(res, s.items.whereUsed(req.actor, parseId(req.params.id))));
  r.post('/items/:id/mark', (req, res) => ok(res, s.items.mark(req.actor, parseId(req.params.id), parseItemMark(req.body))));
  r.put('/items/:id/uoms', idempotent, (req, res) => ok(res, s.uoms.save(req.actor, parseId(req.params.id), parseItemUoms(req.body))));
  r.get('/items/:id/convert', (req, res) => ok(res, s.uoms.convert(req.actor, parseId(req.params.id), parseItemConvert(req.query))));
  r.put('/items/:id/resources', idempotent, (req, res) => ok(res, s.resources.save(req.actor, parseId(req.params.id), parseItemResources(req.body))));
  r.post('/items/:id/makes', idempotent, (req, res) => ok(res, s.makes.add(req.actor, parseId(req.params.id), parseMakeAdd(req.body)), 201));
  r.post('/items/:id/makes/:makeId', idempotent, (req, res) => ok(res, s.makes.decide(req.actor, parseId(req.params.id), parseId(req.params.makeId), parseMakeDecide(req.body))));
  r.post('/items/:id/alternates', idempotent, (req, res) => ok(res, s.makes.alternate(req.actor, parseId(req.params.id), parseAlternate(req.body))));
  return r;
}

/** Part 06.04: the business partner master. Rights (steward of the partner's roles, verification, bank view and requests, blacklist requests, holds) are checked in the service. */
export function partnerRoutes({ partners: s, exportsOf }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/partners/register', (req, res) => res.json(s.register.list(req.actor, req.query)));
  r.get('/partners/register/export', (req, res) => {
    const svc = exportsOf();
    if (!svc) throw new Error('The list export service is not running');
    const out = svc.start(req.actor, 'mdm.partners', req.query);
    if (out.kind === 'job') return res.status(202).json({ data: out });
    res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'x-export-rows': String(out.rows), 'cache-control': 'no-store' });
    return res.send(out.buffer);
  });
  r.get('/partners/queue', (req, res) => ok(res, s.queue(req.actor, parseQueue(req.query))));
  r.post('/partners/check', (req, res) => ok(res, s.registration.check(req.actor, parsePartnerCheck(req.body))));
  r.post('/partners', idempotentRequired, (req, res) => ok(res, s.registration.create(req.actor, parsePartnerCreate(req.body)), 201));
  r.get('/partners/:id', (req, res) => ok(res, s.get(req.actor, parseId(req.params.id))));
  r.put('/partners/:id', idempotent, (req, res) => ok(res, s.registration.update(req.actor, parseId(req.params.id), parsePartnerUpdate(req.body))));
  r.post('/partners/:id/submit', idempotentRequired, (req, res) => ok(res, s.registration.submit(req.actor, parseId(req.params.id), parsePartnerSubmit(req.body)), 202));
  r.put('/partners/:id/details', idempotent, (req, res) => ok(res, s.details.update(req.actor, parseId(req.params.id), parsePartnerDetails(req.body))));
  r.get('/partners/:id/summary', (req, res) => ok(res, s.summary(req.actor, parseId(req.params.id))));
  r.get('/partners/:id/selectable', (req, res) => ok(res, s.selectable(req.actor, parseId(req.params.id), parseSelectable(req.query))));
  r.get('/partners/:id/payment-status', (req, res) => ok(res, s.banks.payment(req.actor, parseId(req.params.id))));
  r.post('/partners/:id/gstins', idempotent, (req, res) => ok(res, s.details.addGstin(req.actor, parseId(req.params.id), parseGstinAdd(req.body)), 201));
  r.post('/partners/:id/gstins/verify', idempotent, (req, res) => ok(res, s.details.verifyGstin(req.actor, parseId(req.params.id), parseGstinVerify(req.body))));
  r.post('/partners/:id/documents', idempotent, (req, res) => ok(res, s.details.addDocument(req.actor, parseId(req.params.id), parseDocumentAdd(req.body)), 201));
  r.post('/partners/:id/documents/:docId/verify', idempotent, (req, res) => ok(res, s.details.verifyDocument(req.actor, parseId(req.params.id), parseId(req.params.docId))));
  r.put('/partners/:id/tds', idempotent, (req, res) => ok(res, s.details.setTds(req.actor, parseId(req.params.id), parseTdsSet(req.body))));
  r.post('/partners/:id/banks', idempotentRequired, async (req, res) => ok(res, await s.banks.request(req.actor, parseId(req.params.id), parseBankRequest(req.body)), 202));
  r.post('/partners/:id/banks/:bankId/confirm', idempotentRequired, (req, res) => ok(res, s.banks.confirm(req.actor, parseId(req.params.id), parseId(req.params.bankId), parseBankConfirm(req.body)), 202));
  r.post('/partners/:id/banks/:bankId/verify', idempotent, (req, res) => ok(res, s.banks.verify(req.actor, parseId(req.params.id), parseId(req.params.bankId), parseBankVerify(req.body))));
  r.get('/partners/:id/banks/:bankId/reveal', (req, res) => ok(res, s.banks.reveal(req.actor, parseId(req.params.id), parseId(req.params.bankId))));
  r.post('/partners/:id/status', idempotent, (req, res) => ok(res, s.status.set(req.actor, parseId(req.params.id), parsePartnerStatus(req.body))));
  r.post('/partners/:id/blacklist', idempotentRequired, (req, res) => ok(res, s.status.request(req.actor, parseId(req.params.id), parseBlacklist(req.body)), 202));
  return r;
}

/** Part 06.06: the rate analysis engine and the schedule of rates library. Rights (view, create, edit, submit, amend, print, export; keep the library) are checked in the service. */
export function rateRoutes({ rates: s }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/resource-rates', (req, res) => ok(res, s.library.list(req.actor, parseRateList(req.query))));
  r.get('/resource-rates/lookup', (req, res) => { const q = parseRateLookup(req.query); ok(res, s.library.lookup(req.actor, q.itemId, { region: q.region ?? null, projectId: q.projectId ?? null, date: q.date })); });
  r.post('/resource-rates', idempotent, (req, res) => ok(res, s.library.create(req.actor, parseRateCreate(req.body)), 201));
  r.put('/resource-rates/:id', idempotent, (req, res) => ok(res, s.library.update(req.actor, parseId(req.params.id), parseRateUpdate(req.body))));
  r.post('/resource-rates/:id/retire', idempotent, (req, res) => ok(res, s.library.retire(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.get('/sor-books', (req, res) => ok(res, s.sor.books(req.actor)));
  r.post('/sor-books', idempotent, (req, res) => ok(res, s.sor.createBook(req.actor, parseBookCreate(req.body)), 201));
  r.get('/sor-books/:id', (req, res) => ok(res, s.sor.book(req.actor, parseId(req.params.id), parseBookQuery(req.query))));
  r.put('/sor-books/:id/items', idempotent, (req, res) => ok(res, s.sor.putItems(req.actor, parseId(req.params.id), parseSorItems(req.body))));
  r.post('/sor-books/:id/activate', idempotent, (req, res) => ok(res, s.sor.activate(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/sor-books/:id/editions', idempotent, (req, res) => ok(res, s.sor.newEdition(req.actor, parseId(req.params.id), parseEdition(req.body)), 201));
  r.get('/sor-items', (req, res) => ok(res, s.sor.search(req.actor, parseSorSearch(req.query))));
  r.get('/analyses', (req, res) => ok(res, s.analyses.list(req.actor, parseAnalysisList(req.query))));
  r.get('/analyses/export', (req, res) => {
    const rows = s.analyses.exportRows(req.actor, parseAnalysisList(req.query));
    const columns = [['ref', 'Analysis'], ['title', 'Title'], ['workItem', 'Work item'], ['scope', 'Scope'], ['project', 'Project'], ['region', 'Region'], ['basis', 'Per'], ['directCost', 'Direct cost'], ['unitRate', 'Unit rate'], ['unitRateGross', 'Unit rate with GST'], ['status', 'Status'], ['from', 'From'], ['to', 'To']].map(([key, label]) => ({ key, label }));
    res.status(200).set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="rate-analyses.csv"', 'cache-control': 'no-store' }).send(toCsv({ columns, rows, footer: null }));
  });
  r.get('/analyses/impact', (req, res) => ok(res, s.analyses.impact(req.actor, parseImpact(req.query))));
  r.post('/analyses/start', (req, res) => ok(res, s.analyses.start(req.actor, parseAnalysisStart(req.body))));
  r.post('/analyses', idempotentRequired, (req, res) => ok(res, s.analyses.create(req.actor, parseAnalysisCreate(req.body)), 201));
  r.get('/analyses/:id', (req, res) => ok(res, s.analyses.get(req.actor, parseId(req.params.id))));
  r.put('/analyses/:id', idempotent, (req, res) => ok(res, s.analyses.update(req.actor, parseId(req.params.id), parseAnalysisUpdate(req.body))));
  r.delete('/analyses/:id', (req, res) => ok(res, s.analyses.remove(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/analyses/:id/recalculate', idempotent, (req, res) => ok(res, s.analyses.recalculate(req.actor, parseId(req.params.id))));
  r.post('/analyses/:id/submit', idempotentRequired, (req, res) => ok(res, s.analyses.submit(req.actor, parseId(req.params.id), parseAnalysisSubmit(req.body)), 202));
  r.post('/analyses/:id/withdraw', idempotent, (req, res) => ok(res, s.analyses.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/analyses/:id/cancel', idempotent, (req, res) => ok(res, s.analyses.cancel(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/analyses/:id/amend', idempotentRequired, (req, res) => ok(res, s.analyses.amend(req.actor, parseId(req.params.id), parseAmend(req.body)), 201));
  r.get('/analyses/:id/compare', (req, res) => ok(res, s.analyses.compare(req.actor, parseId(req.params.id), parseCompare(req.query).with)));
  r.get('/analyses/:id/history', (req, res) => ok(res, s.analyses.history(req.actor, parseId(req.params.id))));
  r.get('/analyses/:id/print', (req, res) => res.status(200).set({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).send(s.analyses.print(req.actor, parseId(req.params.id))));
  return r;
}
