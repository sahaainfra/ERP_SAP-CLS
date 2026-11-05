import { Router } from 'express';
import { toCsv } from '../../platform/export/index.js';
import { parseAccountCreate, parseAccountUpdate, parseBlock, parseChangeList, parseChart, parseCodeCreate, parseCodeUpdate, parseDimensionRules, parseGroupCreate, parseGroupUpdate, parseHeadCreate, parseHeadUpdate, parseId, parseImportPreview, parseImportSubmit, parseMapping, parsePosting, parseReason, parseRuleList } from './validators.js';

/** Part 06.05: the finance master API (chart of accounts, cost heads and cost codes, dimension rules, item category mapping). A new or changed record is a change sent for approval (202); the rights are checked in the service. */
export function finRoutes({ fin: s }, { idempotent }) {
  const r = Router();
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  r.get('/accounts', (req, res) => ok(res, s.chart(req.actor, parseChart(req.query))));
  r.get('/accounts/export', (req, res) => {
    const rows = s.exportRows(req.actor);
    const columns = [['code', 'Code'], ['name', 'Name'], ['group', 'Group'], ['nature', 'Nature'], ['schedule3', 'Schedule III line'], ['type', 'Type'], ['normalBalance', 'Normal balance'], ['currency', 'Currency'], ['control', 'Control account'], ['manualPosting', 'Manual posting'], ['status', 'Status'], ['dimensions', 'Dimension rules']].map(([key, label]) => ({ key, label }));
    res.status(200).set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="chart-of-accounts.csv"', 'cache-control': 'no-store' }).send(toCsv({ columns, rows, footer: null }));
  });
  r.post('/accounts', idempotent, (req, res) => ok(res, s.changes.account.create(req.actor, parseAccountCreate(req.body)), 202));
  r.get('/accounts/:id', (req, res) => ok(res, s.account(req.actor, parseId(req.params.id))));
  r.put('/accounts/:id', idempotent, (req, res) => ok(res, s.changes.account.update(req.actor, parseId(req.params.id), parseAccountUpdate(req.body)), 202));
  r.post('/accounts/:id/block', idempotent, (req, res) => ok(res, s.changes.account.block(req.actor, parseId(req.params.id), parseBlock(req.body)), 202));
  r.delete('/accounts/:id', (req, res) => ok(res, s.changes.account.remove(req.actor, parseId(req.params.id), parseReason(req.body ?? {}))));
  r.put('/accounts/:id/dimension-rules', idempotent, (req, res) => ok(res, s.changes.account.dimensions(req.actor, parseId(req.params.id), parseDimensionRules(req.body)), 202));
  r.post('/postings/check', (req, res) => ok(res, s.checkPosting(req.actor, parsePosting(req.body))));
  r.get('/account-groups', (req, res) => { const c = s.chart(req.actor, {}); ok(res, { rows: c.groups, schedule3: c.schedule3 }); });
  r.post('/account-groups', idempotent, (req, res) => ok(res, s.changes.group.create(req.actor, parseGroupCreate(req.body)), 202));
  r.put('/account-groups/:id', idempotent, (req, res) => ok(res, s.changes.group.update(req.actor, parseId(req.params.id), parseGroupUpdate(req.body)), 202));
  r.get('/schedule-iii', (req, res) => ok(res, s.schedule3(req.actor)));
  r.get('/cost-heads', (req, res) => ok(res, s.costTree(req.actor)));
  r.post('/cost-heads', idempotent, (req, res) => ok(res, s.changes.head.create(req.actor, parseHeadCreate(req.body)), 202));
  r.put('/cost-heads/:id', idempotent, (req, res) => ok(res, s.changes.head.update(req.actor, parseId(req.params.id), parseHeadUpdate(req.body)), 202));
  r.get('/cost-codes', (req, res) => ok(res, s.costTree(req.actor)));
  r.post('/cost-codes', idempotent, (req, res) => ok(res, s.changes.code.create(req.actor, parseCodeCreate(req.body)), 202));
  r.put('/cost-codes/:id', idempotent, (req, res) => ok(res, s.changes.code.update(req.actor, parseId(req.params.id), parseCodeUpdate(req.body)), 202));
  r.get('/dimension-rules', (req, res) => ok(res, s.dimensionRules(req.actor, parseRuleList(req.query))));
  r.get('/category-mappings', (req, res) => ok(res, s.categoryMap(req.actor)));
  r.post('/category-mappings', idempotent, (req, res) => ok(res, s.changes.mapping(req.actor, parseMapping(req.body)), 202));
  r.get('/changes', (req, res) => ok(res, s.changes.list(req.actor, parseChangeList(req.query))));
  r.get('/changes/:id', (req, res) => ok(res, s.changes.get(req.actor, parseId(req.params.id))));
  r.post('/changes/:id/resubmit', idempotent, (req, res) => ok(res, s.changes.resubmit(req.actor, parseId(req.params.id), parseReason(req.body)), 202));
  r.post('/changes/:id/withdraw', idempotent, (req, res) => ok(res, s.changes.withdraw(req.actor, parseId(req.params.id), parseReason(req.body))));
  r.post('/import/preview', (req, res) => ok(res, s.importPreview(req.actor, parseImportPreview(req.body))));
  r.post('/import', idempotent, (req, res) => ok(res, s.importSubmit(req.actor, parseImportSubmit(req.body)), 202));
  return r;
}
