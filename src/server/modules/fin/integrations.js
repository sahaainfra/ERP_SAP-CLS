import { authzOf } from '../../platform/authz/index.js';
import { eventTypes } from '../../platform/events/index.js';
import { lookupRegistry } from '../../platform/lookups/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';
import { CONTROL_KINDS, DIMENSION_LABELS, FIN_DOC, finOf } from './service.js';

// The finance masters (part 06.05) for the rest of the ERP: the approval of a change (FIN_MASTER_CHANGE: the accounts manager checks what the project controls manager proposes, then the CFO approves),
// what the approver sees, the object page of an account (search, audit), the form lookups (accounts, accounts open to manual postings, cost codes) and the events consumers listen to.
/** @type {any} */
const schema = { type: 'object', properties: {}, required: [] };
for (const [type, description] of [
  ['fin.master.change_requested', 'A new or changed account group, account, cost head, cost code or item category mapping was proposed and sent for approval: data { entity, action }.'],
  ['fin.account.changed', 'An account was added, changed, blocked, unblocked or deleted (approved): data { code, action, count }. The posting engine and the ledgers drop their cached copy.'],
  ['fin.cost_code.changed', 'A cost head or cost code was added or changed (approved): data { code, kind }.'],
  ['fin.category_mapping.changed', 'The accounts and cost code of item categories changed from a date (approved): data { categories, effectiveFrom }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'fin', description });

const step = (code, name, role, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const ref = (db, companyId, id) => db.prepare('SELECT * FROM fin_master_changes WHERE id = ? AND company_id = ?').get(Number(id), companyId);
const label = { GROUP: 'Account group', ACCOUNT: 'Account', COST_HEAD: 'Cost head', COST_CODE: 'Cost code', MAPPING: 'Item category mapping' };
const what = (c) => { const ch = JSON.parse(c.change_json || '{}'); if (c.entity === 'MAPPING') return `${(ch.rows ?? []).length} categories from ${ch.effectiveFrom}`; if (ch.rows) return `${ch.rows.length} imported accounts`; return `${ch.code ?? ''} ${ch.name ?? ''}`.trim(); };
workflowTypes.register({
  docType: FIN_DOC, label: 'Chart of accounts or cost code change', processOwner: 'CFO', route: (id) => `/finance/chart-of-accounts?change=${id}`,
  describe(db, companyId, id) { const c = ref(db, companyId, id); return c ? { ref: `FMC-${c.id}`, title: `${{ CREATE: 'New', UPDATE: 'Change', BLOCK: 'Block', UNBLOCK: 'Unblock' }[c.action]} ${label[c.entity].toLowerCase()}: ${what(c)}`, originator: c.requested_by } : null; },
  summarise(db, _actor, id) {
    const c = db.prepare('SELECT * FROM fin_master_changes WHERE id = ?').get(Number(id)); if (!c) return null;
    const ch = JSON.parse(c.change_json || '{}'); const before = JSON.parse(c.before_json || '{}');
    const fields = [{ label: 'What', value: `${label[c.entity]}: ${what(c)}` }, { label: 'Action', value: c.action }, { label: 'Proposed by', value: `${c.requested_by} (${c.maker_role})` }, { label: 'Reason', value: c.reason }];
    if (c.entity === 'ACCOUNT' && !ch.rows) {
      for (const [k, l] of [['type', 'Type'], ['normalBalance', 'Normal balance'], ['controlKind', 'Control account'], ['manualPosting', 'Manual posting']]) if (ch[k] !== undefined && (c.action === 'CREATE' || JSON.stringify(ch[k]) !== JSON.stringify(before[k]))) fields.push({ label: l, value: k === 'controlKind' ? (ch[k] ? CONTROL_KINDS[ch[k]] : 'no') : String(ch[k]) });
      if (ch.dimensions && JSON.stringify(ch.dimensions) !== JSON.stringify(before.dimensions ?? null)) fields.push({ label: 'Dimension rules', value: Object.entries(ch.dimensions).map(([d, r]) => `${DIMENSION_LABELS[d]} ${r.toLowerCase().replace('_', ' ')}`).join(', ') || 'none' });
    }
    return { fields };
  },
  defaultDefinition: { name: 'Finance master change: accounts manager (for a cost controls proposal), then CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('ACCMGR', 'Accounts manager (checks a cost head or cost code proposed by project controls)', 'ACCMGR', { field: 'makerRole', op: 'eq', value: 'PCMGR' }), step('CFO', 'Chief financial officer', 'CFO')] },
  hooks: {
    onApproved: (db, { instance, actor }) => finOf(db)?.decisions.change(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => finOf(db)?.decisions.change(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => finOf(db)?.decisions.change(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => finOf(db)?.decisions.change(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(FIN_DOC, ({ db, instance }) => {
  const c = db.prepare('SELECT * FROM fin_master_changes WHERE id = ?').get(Number(instance.docId));
  if (!c) return { sections: [] };
  const ch = JSON.parse(c.change_json || '{}');
  const items = [];
  if (c.entity === 'ACCOUNT' && !ch.rows) {
    const same = ch.name ? db.prepare('SELECT code FROM fin_accounts WHERE company_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL AND id != ?').all(c.company_id, ch.name, c.entity_id ?? 0) : [];
    items.push({ label: 'Accounts with the same name', value: same.map((x) => x.code).join(', ') || 'None', format: 'text', tone: same.length ? 'warn' : undefined });
    items.push({ label: 'Control account', value: ch.controlKind ? `${CONTROL_KINDS[ch.controlKind]}${ch.manualPosting ? ' — manual postings ALLOWED' : ' (posting engine only)'}` : 'No', format: 'text', tone: ch.controlKind && ch.manualPosting ? 'warn' : undefined });
  }
  if (c.entity === 'MAPPING') items.push({ label: 'Categories', value: (ch.rows ?? []).length, format: 'text' }, { label: 'From', value: ch.effectiveFrom, format: 'text' });
  if (ch.rows && c.entity === 'ACCOUNT') items.push({ label: 'Accounts in the import', value: ch.rows.length, format: 'text' }, { label: 'Control accounts in it', value: ch.rows.filter((r) => r.controlKind).length, format: 'text' });
  items.push({ label: 'Proposed by', value: `${c.requested_by} (${c.maker_role})`, format: 'text' });
  return { sections: [{ code: 'fin-master', title: 'Before approving', kind: 'metrics', items }] };
});
objectTypes.register({
  type: 'fin_account', label: 'Account', permission: 'fin.coa.view', route: (id) => `/finance/accounts/account?id=${id}`,
  access(db, actor, id) { if (!authzOf(db).check(actor, 'fin.coa.view').allowed) return null; const r = db.prepare('SELECT company_id, account_status FROM fin_accounts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); return r ? { companyId: r.company_id, projectId: null, siteId: null, status: r.account_status } : null; },
  auditEntities: (id) => [{ entity: 'fin_accounts', id }],
  summary(db, actor, id) { const r = db.prepare('SELECT code, name, account_status FROM fin_accounts WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); return r ? { label: `${r.code} ${r.name}`, status: r.account_status } : null; },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'fin.coa.view').allowed) return []; return db.prepare('SELECT id FROM fin_accounts WHERE company_id = ? AND deleted_at IS NULL AND (code LIKE ? OR name LIKE ?) ORDER BY code LIMIT ?').all(actor.companyId, `${q}%`, `%${q}%`, limit); },
});
for (const [name, lbl, where] of [['accounts', 'Accounts', "a.account_status = 'ACTIVE'"], ['manual-accounts', 'Accounts open to manual journals', "a.account_status = 'ACTIVE' AND a.manual_posting_allowed = 1"]]) {
  lookupRegistry.register({
    module: 'fin', name, label: lbl, permission: 'fin.coa.view', columns: [{ key: 'type', label: 'Type' }],
    search(db, actor, q) {
      const s = finOf(db); if (!s) return { rows: [], total: 0 };
      s.ensureSetup(actor.companyId);
      const args = [actor.companyId]; let w = `a.company_id = ? AND a.deleted_at IS NULL AND ${where}`;
      if (q.text) { w += ' AND (a.code LIKE ? OR a.name LIKE ?)'; args.push(`${q.text}%`, `%${q.text}%`); }
      if (q.ids) w += ` AND a.id IN (${q.ids.map(() => '?').join(',')})`;
      const total = db.prepare(`SELECT COUNT(*) AS n FROM fin_accounts a WHERE ${w}`).get(...args, ...(q.ids ?? [])).n;
      const rows = db.prepare(`SELECT a.id, a.code, a.name, a.account_type FROM fin_accounts a WHERE ${w} ORDER BY a.code LIMIT ? OFFSET ?`).all(...args, ...(q.ids ?? []), q.ids ? 200 : q.limit, q.ids ? 0 : q.offset);
      return { rows: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, extra: { type: r.account_type } })), total };
    },
  });
}
lookupRegistry.register({
  module: 'fin', name: 'cost-codes', label: 'Cost codes', permission: 'fin.coa.view', columns: [{ key: 'head', label: 'Cost head' }],
  search(db, actor, q) {
    const s = finOf(db); if (!s) return { rows: [], total: 0 };
    s.ensureSetup(actor.companyId);
    const args = [actor.companyId]; let w = "c.company_id = ? AND c.deleted_at IS NULL AND c.code_status = 'ACTIVE'";
    if (q.text) { w += ' AND (c.code LIKE ? OR c.name LIKE ?)'; args.push(`${q.text}%`, `%${q.text}%`); }
    if (q.ids) w += ` AND c.id IN (${q.ids.map(() => '?').join(',')})`;
    const total = db.prepare(`SELECT COUNT(*) AS n FROM fin_cost_codes c WHERE ${w}`).get(...args, ...(q.ids ?? [])).n;
    const rows = db.prepare(`SELECT c.id, c.code, c.name, h.code || ' ' || h.name AS head FROM fin_cost_codes c JOIN fin_cost_heads h ON h.id = c.cost_head_id WHERE ${w} ORDER BY c.code LIMIT ? OFFSET ?`).all(...args, ...(q.ids ?? []), q.ids ? 200 : q.limit, q.ids ? 0 : q.offset);
    return { rows: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, extra: { head: r.head } })), total };
  },
});
