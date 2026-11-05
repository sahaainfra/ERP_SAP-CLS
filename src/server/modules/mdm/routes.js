import { Router } from 'express';
import { toCsv } from '../../platform/export/index.js';
import { parseCommonCreate, parseCommonList, parseCommonRetire, parseCommonUpdate, parseConvert, parseFxQuery, parseGstQuery, parseListCode, parseListSave, parseListValues, parseMaster, parseTdsQuery } from './validators.js';
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
export function commonRoutes({ common }, { idempotent, idempotentRequired }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
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
