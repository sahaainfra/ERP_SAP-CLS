import { authzOf } from '../../platform/authz/index.js';
import { eventTypes } from '../../platform/events/index.js';
import { lookupRegistry } from '../../platform/lookups/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';
import { CONTROL_KINDS, DIMENSION_LABELS, FIN_DOC, finOf } from './service.js';
import { apOf, arOf, assetsOf, cashOf, glOf, gstOf, gstReconOf, paymentsOf, postingOf, projectAccountsOf, costForecastsOf, projectPlOf, cashForecastsOf, periodClosesOf } from './index.js';
import { registerProject360Widget } from '../proj/p360.js';
import { registerOfflineForm } from '../eng/offline.js';
import { fileEntities } from '../../platform/files/entities.js';
import { unprocessable } from '../../platform/http/errors.js';

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

// ---- part 23.01: the journal's approval, its events and its object page ----
for (const [type, description] of [
  ['fin.journal.posted', 'A journal was posted to the general ledger (part 23.01): data { journalId, voucherNo, voucherType, kind, date, periodId, total, sourceType, sourceId, reversalOf, lines[{ lineId, accountId, debit, credit, projectId, siteId, costCentreId, branchId }] }. Finance reports (23.x) and statements (23.14) read it.'],
  ['fin.gl.posted', 'The lines with a cost centre of a posted journal, for the department budgets (part 16.x, contract in bud/constants.js): data { sourceType, sourceId, docRef, date, lines[{ lineId, costCentreId, accountId, amount, narration }] }.'],
  ['fin.gl.reversed', 'A journal with lines on cost centres was reversed (part 23.01): data { sourceType, sourceId, docRef, date }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'fin', description });

const glStep = (code, name, role, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 24, requireAttachment: false, checklist: [], when, notify: [], action: null });
const jrow = (db, id) => db.prepare('SELECT * FROM fin_journals WHERE id = ?').get(Number(id));
const glDecide = (outcome) => (db, { instance, actor, comment }) => glOf(db)?.journals.decide(instance, actor, outcome, comment);
workflowTypes.register({
  docType: 'FIN_JOURNAL', label: 'Journal voucher', processOwner: 'CFO', route: (id) => `/finance/journals?id=${id}`,
  describe(db, companyId, id) { const r = jrow(db, id); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.doc_no} ₹${(r.total_paise / 100).toFixed(2)} ${r.narration}`.slice(0, 300), originator: r.requested_by } : null; },
  summarise(db, _actor, id) {
    const r = jrow(db, id); if (!r) return null;
    const lines = db.prepare('SELECT l.*, a.code, a.name FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.journal_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no').all(r.id);
    return { fields: [{ label: 'Voucher', value: `${r.voucher_type} ${r.doc_no} of ${r.voucher_date}` }, { label: 'Kind', value: r.kind }, { label: 'Amount', value: `₹${(r.total_paise / 100).toFixed(2)}` }, { label: 'Narration', value: r.narration }, ...lines.slice(0, 12).map((l) => ({ label: `${l.line_no}. ${l.code} ${l.name}`, value: l.debit_paise ? `Dr ₹${(l.debit_paise / 100).toFixed(2)}` : `Cr ₹${(l.credit_paise / 100).toFixed(2)}` }))] };
  },
  defaultDefinition: { name: 'Journal: the accounts manager; above the CFO limit (₹5 lakh), then the CFO (SoD-03: never the maker)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager', 'ACCMGR'), glStep('CFO', 'Chief financial officer (above the limit)', 'CFO', { field: 'overCfo', op: 'eq', value: 1 })] },
  hooks: { onApproved: glDecide('APPROVED'), onRejected: glDecide('REJECTED'), onReturned: glDecide('RETURNED'), onCancelled: glDecide('CANCELLED') },
});
evidenceProviders.register('FIN_JOURNAL', ({ db, instance }) => {
  const r = jrow(db, instance.docId); if (!r) return { sections: [] };
  const lines = db.prepare('SELECT l.*, a.code, a.name, a.is_control FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.journal_id = ? AND l.deleted_at IS NULL').all(r.id);
  const dr = lines.reduce((a, l) => a + l.debit_paise, 0); const cr = lines.reduce((a, l) => a + l.credit_paise, 0);
  const period = db.prepare('SELECT p.name, p.module_status_json FROM core_periods p WHERE p.company_id = ? AND ? BETWEEN p.start_date AND p.end_date').get(r.company_id, r.voucher_date);
  const fstatus = period ? (JSON.parse(period.module_status_json || '{}').finance ?? 'Open') : 'none';
  return { sections: [{ code: 'fin-journal', title: 'Before approving', kind: 'metrics', items: [
    { label: 'Debits = credits', value: dr === cr ? `Yes, ₹${(dr / 100).toFixed(2)}` : `No: ₹${(dr / 100).toFixed(2)} / ₹${(cr / 100).toFixed(2)}`, format: 'text', tone: dr === cr ? undefined : 'warn' },
    { label: 'Period', value: period ? `${period.name} (finance ${fstatus})` : 'No period covers the date', format: 'text', tone: fstatus === 'Open' ? undefined : 'warn' },
    { label: 'Lines', value: lines.length, format: 'text' },
    { label: 'Made by', value: r.requested_by, format: 'text' },
    ...(r.reversal_of_id ? [{ label: 'Reverses', value: jrow(db, r.reversal_of_id)?.voucher_no ?? '', format: 'text' }] : []),
  ] }] };
});
objectTypes.register({
  type: 'fin_journals', label: 'Journal', permission: 'fin.journal.view', route: (id) => `/finance/journals?id=${id}`, attachmentEntity: 'fin_journals', approvalTarget: 'fin_journals',
  access(db, actor, id) { if (!authzOf(db).check(actor, 'fin.journal.view').allowed) return null; const r = db.prepare('SELECT company_id FROM fin_journals WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); return r ? { companyId: r.company_id } : null; },
  auditEntities: (id) => [{ entity: 'fin_journals', id }],
  summary(db, actor, id) { const r = db.prepare('SELECT * FROM fin_journals WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); return r ? { label: `${r.voucher_no ?? r.doc_no} ${r.narration}`.slice(0, 200), status: r.status } : null; },
  related: () => [],
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'fin.journal.view').allowed) return []; return db.prepare('SELECT id FROM fin_journals WHERE company_id = ? AND deleted_at IS NULL AND (voucher_no LIKE ? OR doc_no LIKE ? OR narration LIKE ?) ORDER BY id DESC LIMIT ?').all(actor.companyId, `%${q}%`, `%${q}%`, `%${q}%`, limit).map((x) => x.id); },
});

// ---- part 23.02: the posting engine's approvals and its event ----
eventTypes.define({ type: 'fin.document.posted', version: 1, schema, owner: 'fin', description: 'The posting engine posted a document of another module (part 23.02): data { eventType, docType, docId, docRef, journalId, voucherNo, date, amount, rule }. The source module and its trace show the journal.' });
const peDecide = (outcome, kind) => (db, { instance, actor, comment }) => postingOf(db)?.[kind].decide(instance, actor, outcome, comment);
const peHooks = (kind) => ({ onApproved: peDecide('APPROVED', kind), onRejected: peDecide('REJECTED', kind), onReturned: peDecide('RETURNED', kind), onCancelled: peDecide('CANCELLED', kind) });
workflowTypes.register({
  docType: 'FIN_POSTING_RULE', label: 'Posting rule change', processOwner: 'CFO', route: (id) => `/finance/posting-rules?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM fin_posting_rules WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.rule_code} v${r.rule_version} ${r.name} from ${r.effective_from}`.slice(0, 300), originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM fin_posting_rules WHERE id = ?').get(Number(id)); if (!r) return null; const lines = JSON.parse(r.lines_json || '[]'); return { fields: [{ label: 'Rule', value: `${r.rule_code} version ${r.rule_version}` }, { label: 'Event', value: r.event_type }, { label: 'In force from', value: r.effective_from }, { label: 'Why', value: r.change_reason ?? '' }, ...lines.slice(0, 10).map((l, i) => ({ label: `${i + 1}. ${l.side} ${l.account}`, value: l.amount }))] }; },
  defaultDefinition: { name: 'Posting rule change: the accounts manager proposes, the CFO approves', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('CFO', 'Chief financial officer', 'CFO')] },
  hooks: peHooks('rules'),
});
workflowTypes.register({
  docType: 'FIN_REPLAY', label: 'Replay of historical events', processOwner: 'CFO', route: (id) => `/finance/posting-replay?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM fin_replay_runs WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `Replay ${r.from_date} to ${r.to_date}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM fin_replay_runs WHERE id = ?').get(Number(id)); if (!r) return null; const s = JSON.parse(r.dry_run_json || '{}'); return { fields: [{ label: 'Events', value: JSON.parse(r.event_types_json || '[]').join(', ') }, { label: 'Dates', value: `${r.from_date} to ${r.to_date}` }, { label: 'Dry run', value: `${s.events ?? 0} events, ${s.wouldPost ?? 0} would post ₹${s.total ?? 0}` }, { label: 'Would fail', value: Object.entries(s.failures ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none' }] }; },
  defaultDefinition: { name: 'Replay commit: the accounts manager, then the CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager', 'ACCMGR'), glStep('CFO', 'Chief financial officer', 'CFO')] },
  hooks: peHooks('replays'),
});

// ---- part 23.03: accounts payable ----
for (const [type, description] of [
  ['fin.ap_bill.created', 'An AP bill was made (part 23.03): from a matched vendor invoice, an approved subcontractor bill, a passed expense claim, or an approved direct expense bill: data { billId, docNo, source, partnerId, netPayable, dueDate, tds, tdsSection }. Payment proposals (23.04) read it.'],
  ['fin.ap_bill.hold_changed', 'An AP bill was held or released (part 23.03 FR-05): data { billId, docNo, hold, reason }. A held bill is not offered for payment.'],
  ['fin.advance.adjusted', 'An advance given was set against an AP bill (part 23.03 FR-04): data { advanceId, advanceNo, billId, billNo, partnerId, amount, on }. The advance ledger (22.07) reads it.'],
  ['fin.debit_note.approved', 'A debit note, or a credit note received from a vendor, was approved and posted (part 23.03 FR-03): data { noteId, docNo, kind, partnerId, reason, referenceType, referenceId, billId, amount, gst, total }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'fin', description });
const apDecide = (outcome, kind) => (db, { instance, actor, comment }) => apOf(db)?.[kind].decide(instance, actor, outcome, comment);
const apHooks = (kind) => ({ onApproved: apDecide('APPROVED', kind), onRejected: apDecide('REJECTED', kind), onReturned: apDecide('RETURNED', kind), onCancelled: apDecide('CANCELLED', kind) });
workflowTypes.register({
  docType: 'FIN_AP_DIRECT', label: 'Direct expense bill', processOwner: 'CFO', route: (id) => `/finance/ap-bills?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM ap_bills WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.payee_name} ₹${(r.total_paise / 100).toFixed(2)} ${r.description ?? ''}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM ap_bills WHERE id = ?').get(Number(id)); return r ? { fields: [{ label: 'Payee', value: r.payee_name }, { label: 'Their bill', value: `${r.bill_no ?? ''} of ${r.bill_date}` }, { label: 'For', value: r.description ?? '' }, { label: 'Amount and GST', value: `₹${(r.gross_paise / 100).toFixed(2)} + ₹${(r.gst_input_paise / 100).toFixed(2)}` }, { label: 'TDS', value: r.tds_paise ? `₹${(r.tds_paise / 100).toFixed(2)} under ${r.tds_section}` : 'none' }, { label: 'Net payable', value: `₹${(r.net_payable_paise / 100).toFixed(2)}` }] } : null; },
  defaultDefinition: { name: 'Direct expense bill: the head of the department, the accounts manager, then the CFO above ₹1 lakh', settings: { resubmit: 'first', distinctApprovers: true }, steps: [{ code: 'HEAD', name: 'Head of the department', type: 'approval', mode: 'single', approvers: [{ kind: 'manager' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null }, glStep('ACCMGR', 'Accounts manager', 'ACCMGR'), glStep('CFO', 'Chief financial officer (above the limit)', 'CFO', { field: 'overCfo', op: 'eq', value: 1 })] },
  hooks: apHooks('bills'),
});
workflowTypes.register({
  docType: 'FIN_DEBIT_NOTE', label: 'Debit note', processOwner: 'ACCMGR', route: (id) => `/finance/debit-notes?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM ap_debit_notes WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.reason} ₹${(r.total_paise / 100).toFixed(2)} ${r.description}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT n.*, p.legal_name FROM ap_debit_notes n JOIN mdm_partners p ON p.id = n.partner_id WHERE n.id = ?').get(Number(id)); return r ? { fields: [{ label: 'Vendor', value: r.legal_name }, { label: 'Reason', value: r.reason }, { label: 'For', value: r.description }, { label: 'Amount and GST', value: `₹${(r.amount_paise / 100).toFixed(2)} + ₹${(r.gst_paise / 100).toFixed(2)}` }] } : null; },
  defaultDefinition: { name: 'Debit note: the accounts manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager', 'ACCMGR')] },
  hooks: apHooks('notes'),
});
// ---- part 23.04: payments ----
for (const [type, description] of [
  ['fin.payment.released', 'A payment was released to the bank or as a cheque, and posted (part 23.04 FR-03): data { paymentId, docNo, proposalId, proposalNo, kind, billId, advanceId, partnerId, amount, mode, chequeNo, journalId, releasedOn }. Accounts payable settles the bill.'],
  ['fin.payment.confirmed', 'The bank confirmed a payment (UTR) or a cheque cleared (part 23.04 FR-03): data { paymentId, docNo, partnerId, amount, utr, chequeNo, paidOn, bankAccountId }. The advice is sent; bank reconciliation (23.06) reads it.'],
  ['fin.payment.failed', 'A payment was returned by the bank or a cheque cancelled, and reversed (part 23.04): data { paymentId, docNo, kind, billId, advanceId, partnerId, amount, reason, chequeNo }. Accounts payable opens the bill again.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'fin', description });
const pmDecide = (outcome) => (db, { instance, actor, comment }) => paymentsOf(db)?.proposals.decide(instance, actor, outcome, comment);
workflowTypes.register({
  docType: 'FIN_PAYMENT', label: 'Payment proposal', processOwner: 'CFO', route: (id) => `/finance/payment-proposals?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM pmt_proposals WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.lines_count} payment(s) ₹${(r.total_paise / 100).toFixed(2)} by ${r.pay_mode} on ${r.pay_date}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) {
    const r = db.prepare('SELECT p.*, b.name AS bank FROM pmt_proposals p JOIN fin_bank_accounts b ON b.id = p.bank_account_id WHERE p.id = ?').get(Number(id)); if (!r) return null;
    const lines = db.prepare("SELECT payee_name, line_kind, amount_paise, name_match FROM pmt_proposal_lines WHERE proposal_id = ? AND line_status = 'PROPOSED' AND deleted_at IS NULL ORDER BY line_no LIMIT 10").all(r.id);
    return { fields: [{ label: 'From', value: `${r.bank} by ${r.pay_mode} on ${r.pay_date}` }, { label: 'Total', value: `₹${(r.total_paise / 100).toFixed(2)} in ${r.lines_count} line(s)` }, ...lines.map((l, i) => ({ label: `Line ${i + 1}`, value: `${l.payee_name} · ${l.line_kind} · ₹${(l.amount_paise / 100).toFixed(2)}${l.name_match === 'OK' ? ' · bank name matches' : ''}` }))] };
  },
  defaultDefinition: { name: 'Payment release: the accounts manager; above ₹10 lakh the CFO; above ₹1 crore a director (never the preparer; released by a third person)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager', 'ACCMGR'), glStep('CFO', 'Chief financial officer (above ₹10 lakh)', 'CFO', { field: 'overAcc', op: 'eq', value: 1 }), glStep('DIR', 'Director (above ₹1 crore)', 'DIR', { field: 'overCfo', op: 'eq', value: 1 })] },
  hooks: { onApproved: pmDecide('APPROVED'), onRejected: pmDecide('REJECTED'), onReturned: pmDecide('RETURNED'), onCancelled: pmDecide('CANCELLED') },
});
// ---- part 23.05: receivables ----
for (const [type, description] of [
  ['fin.ar_invoice.created', 'A receivable was made (part 23.05 FR-01): from an issued tax invoice, or an approved other-income invoice: data { invoiceId, docNo, source, partnerId, projectId, amount, dueDate }.'],
  ['fin.receipt.posted', 'A receipt from a client was posted (part 23.05 FR-02): data { receiptId, docNo, partnerId, date, bankAccountId, reference, amount, tds, gstTds, retention, other, allocated, onAccount, journalId, invoices[] }. The cash forecast (23.13), bank reconciliation (23.06) and the client portal (25.04) read it.'],
  ['fin.receipt.allocated', 'A receipt on account was set against invoices (part 23.05): data { receiptId, docNo, partnerId, invoices[] }.'],
  ['fin.receipt.cancelled', 'A posted receipt was cancelled and reversed (part 23.05): data { receiptId, docNo, partnerId, amount, reason }.'],
  ['fin.ar_credit_note.approved', 'A credit note to a client was approved and posted (part 23.05 FR-04): data { noteId, docNo, invoiceId, invoiceNo, partnerId, reason, taxable, cgst, sgst, igst, total, irnRequired, irnDueDate }. E-invoicing (23.07) reads it.'],
  ['fin.ar.written_off', 'A receivable was written off (part 23.05): data { writeoffId, docNo, invoiceId, partnerId, amount, reason }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'fin', description });
const arDecide = (outcome, kind) => (db, { instance, actor, comment }) => arOf(db)?.[kind].decide(instance, actor, outcome, comment);
const arHooks = (kind) => ({ onApproved: arDecide('APPROVED', kind), onRejected: arDecide('REJECTED', kind), onReturned: arDecide('RETURNED', kind), onCancelled: arDecide('CANCELLED', kind) });
const arRow = (db, table, id) => db.prepare(`SELECT x.*, p.legal_name FROM ${table} x JOIN mdm_partners p ON p.id = x.partner_id WHERE x.id = ?`).get(Number(id));
workflowTypes.register({
  docType: 'FIN_AR_INVOICE', label: 'Other-income invoice', processOwner: 'ACCMGR', route: (id) => `/finance/receivables?id=${id}`,
  describe(db, companyId, id) { const r = arRow(db, 'ar_invoices', id); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.legal_name} ₹${(r.amount_paise / 100).toFixed(2)} ${r.description ?? ''}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = arRow(db, 'ar_invoices', id); return r ? { fields: [{ label: 'Party', value: r.legal_name }, { label: 'For', value: `${r.income_kind ?? ''} ${r.description ?? ''}` }, { label: 'Amount and GST', value: `₹${(r.taxable_paise / 100).toFixed(2)} + ₹${(r.gst_paise / 100).toFixed(2)}` }, { label: 'Due', value: r.due_date }] } : null; },
  defaultDefinition: { name: 'Other-income invoice: the accounts manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager', 'ACCMGR')] },
  hooks: arHooks('invoices'),
});
workflowTypes.register({
  docType: 'FIN_AR_CREDIT_NOTE', label: 'Credit note to a client', processOwner: 'ACCMGR', route: (id) => `/finance/receivables?cn=${id}`,
  describe(db, companyId, id) { const r = arRow(db, 'ar_credit_notes', id); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.legal_name} ₹${(r.total_paise / 100).toFixed(2)} ${r.reason}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = arRow(db, 'ar_credit_notes', id); return r ? { fields: [{ label: 'Client', value: r.legal_name }, { label: 'Reason', value: `${r.reason}: ${r.description}` }, { label: 'Taxable and GST', value: `₹${(r.taxable_paise / 100).toFixed(2)} + ₹${((r.cgst_paise + r.sgst_paise + r.igst_paise) / 100).toFixed(2)}` }, ...(r.irn_required ? [{ label: 'IRN due by', value: r.irn_due_date }] : [])] } : null; },
  defaultDefinition: { name: 'Credit note: the accounts manager; above ₹5 lakh the CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager', 'ACCMGR'), glStep('CFO', 'Chief financial officer (above ₹5 lakh)', 'CFO', { field: 'overCfo', op: 'eq', value: 1 })] },
  hooks: arHooks('notes'),
});
workflowTypes.register({
  docType: 'FIN_AR_WRITEOFF', label: 'Write-off of a receivable', processOwner: 'CFO', route: (id) => `/finance/receivables?wo=${id}`,
  describe(db, companyId, id) { const r = arRow(db, 'ar_writeoffs', id); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.legal_name} ₹${(r.amount_paise / 100).toFixed(2)}: ${r.reason}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = arRow(db, 'ar_writeoffs', id); return r ? { fields: [{ label: 'Client', value: r.legal_name }, { label: 'Amount', value: `₹${(r.amount_paise / 100).toFixed(2)}` }, { label: 'Why', value: r.reason }] } : null; },
  defaultDefinition: { name: 'Write-off: the accounts manager, the CFO, then a director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager', 'ACCMGR'), glStep('CFO', 'Chief financial officer', 'CFO'), glStep('DIR', 'Director', 'DIR')] },
  hooks: arHooks('writeoffs'),
});
// ---- part 23.06: cash and bank ----
for (const [type, description] of [
  ['fin.bank_line.matched', 'A bank statement line was matched to an entry of the books (part 23.06 FR-02): data { lineId, bankAccountId, date, debit, credit, entity, entityId, rule }. A payment matched by its UTR is confirmed in 23.04.'],
  ['fin.bank.reconciled', 'A bank reconciliation statement was signed off by the accounts manager (part 23.06): data { reconId, bankAccountId, asOf, book, statement }.'],
  ['fin.imprest_voucher.approved', 'An imprest voucher was approved and posted (part 23.06 FR-03): data { voucherId, docNo, imprestId, projectId, siteId, costCodeId, category, amount, gst, total }. Project costs read it.'],
  ['fin.imprest.replenished', 'An imprest was replenished from the bank (part 23.06 FR-03): data { replenishmentId, docNo, imprestId, bankAccountId, amount, journalId }.'],
  ['fin.contra.posted', 'A contra entry was posted (part 23.06 FR-04): data { contraId, docNo, kind, fromBankId, toBankId, fromImprestId, toImprestId, amount, date, journalId }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'fin', description });
const csDecide = (outcome, kind) => (db, { instance, actor, comment }) => cashOf(db)?.[kind].decide(instance, actor, outcome, comment);
const csHooks = (kind) => ({ onApproved: csDecide('APPROVED', kind), onRejected: csDecide('REJECTED', kind), onReturned: csDecide('RETURNED', kind), onCancelled: csDecide('CANCELLED', kind) });
const csRow = (db, table, id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id));
workflowTypes.register({
  docType: 'FIN_IMPREST_VOUCHER', label: 'Imprest voucher (above the custodian\'s band)', processOwner: 'ACCMGR', route: (id) => `/finance/imprest?voucher=${id}`,
  describe(db, companyId, id) { const r = csRow(db, 'fin_imprest_vouchers', id); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.payee} ₹${(r.total_paise / 100).toFixed(2)} ${r.description}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = csRow(db, 'fin_imprest_vouchers', id); if (!r) return null; const photos = db.prepare("SELECT COUNT(*) AS n FROM core_files WHERE linked_entity = 'fin_imprest_vouchers' AND linked_id = ? AND deleted_at IS NULL").get(r.id).n; return { fields: [{ label: 'Payee', value: r.payee }, { label: 'For', value: `${r.category}: ${r.description}` }, { label: 'Amount and GST', value: `₹${(r.amount_paise / 100).toFixed(2)} + ₹${(r.gst_paise / 100).toFixed(2)}` }, { label: 'Bill photos', value: String(photos) }] }; },
  defaultDefinition: { name: 'Imprest voucher above ₹10,000: the construction manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('CM', 'Construction manager', 'CM')] },
  hooks: csHooks('vouchers'),
});
workflowTypes.register({
  docType: 'FIN_IMPREST_REPL', label: 'Imprest replenishment', processOwner: 'ACCMGR', route: (id) => `/finance/imprest?replenishment=${id}`,
  describe(db, companyId, id) { const r = csRow(db, 'fin_imprest_replenishments', id); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.vouchers_count} voucher(s) ₹${(r.amount_paise / 100).toFixed(2)}`, originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = csRow(db, 'fin_imprest_replenishments', id); if (!r) return null; const i = csRow(db, 'fin_imprests', r.imprest_id); return { fields: [{ label: 'Imprest', value: `${i?.name ?? ''} (${i?.custodian ?? ''})` }, { label: 'Vouchers', value: String(r.vouchers_count) }, { label: 'Amount', value: `₹${(r.amount_paise / 100).toFixed(2)}` }, { label: 'Cash in hand now', value: `₹${((i?.balance_paise ?? 0) / 100).toFixed(2)} of ₹${((i?.limit_paise ?? 0) / 100).toFixed(2)}` }] }; },
  defaultDefinition: { name: 'Imprest replenishment: the project manager, then the accounts manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('PM', 'Project manager', 'PM'), glStep('ACCMGR', 'Accounts manager', 'ACCMGR')] },
  hooks: csHooks('replenishments'),
});
workflowTypes.register({
  docType: 'FIN_CONTRA', label: 'Contra entry', processOwner: 'ACCMGR', route: (id) => `/finance/cash-position?contra=${id}`,
  describe(db, companyId, id) { const r = csRow(db, 'fin_contras', id); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.contra_kind} ₹${(r.amount_paise / 100).toFixed(2)} ${r.purpose}`.slice(0, 300), originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = csRow(db, 'fin_contras', id); return r ? { fields: [{ label: 'Kind', value: r.contra_kind }, { label: 'Amount', value: `₹${(r.amount_paise / 100).toFixed(2)}` }, { label: 'Date', value: r.contra_date }, { label: 'Why', value: r.purpose }] } : null; },
  defaultDefinition: { name: 'Contra entry: the accounts manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager', 'ACCMGR')] },
  hooks: csHooks('contras'),
});
// the bill photo of an imprest voucher: seen by those who see the voucher, added by its custodian while it can be changed
fileEntities.register({
  entity: 'fin_imprest_vouchers', label: 'Imprest voucher (bill photo)',
  resolve(db, actor, id) { const v = db.prepare('SELECT v.company_id, v.org_project_id, v.org_site_id, v.status, i.custodian FROM fin_imprest_vouchers v JOIN fin_imprests i ON i.id = v.imprest_id WHERE v.id = ? AND v.company_id = ? AND v.deleted_at IS NULL').get(Number(id), actor.companyId); if (!v) return null; const a = authzOf(db); const own = v.custodian === actor.user; return { companyId: v.company_id, projectId: v.org_project_id, siteId: v.org_site_id, canView: own || a.check(actor, 'fin.imprest_voucher.view', { companyId: v.company_id, projectId: v.org_project_id ?? undefined }).allowed, canEdit: own && ['DRAFT', 'RETURNED'].includes(v.status), locked: !['DRAFT', 'RETURNED'].includes(v.status) }; },
});
// FR-03 on the phone: a voucher typed without a connection is queued and made when the phone is back online; its bill photo follows the command
registerOfflineForm({
  code: 'imprest_voucher', label: 'Imprest voucher', labelHi: 'इम्प्रेस्ट वाउचर', module: '23.06', permission: 'fin.imprest_voucher.create', attachmentEntity: 'fin_imprest_vouchers',
  fields: [{ key: 'imprestId', label: 'Imprest', type: 'number', required: true }, { key: 'date', label: 'Date', type: 'date', required: true }, { key: 'payee', label: 'Paid to', type: 'text', required: true }, { key: 'category', label: 'Category', type: 'text', required: true }, { key: 'description', label: 'For', type: 'text', required: true }, { key: 'amount', label: 'Amount', type: 'number', required: true }, { key: 'expenseAccountId', label: 'Expense head', type: 'number', required: true }],
  validate(v) { const e = []; if (!(Number(v.amount) > 0)) e.push({ field: 'amount', message: 'Amount: more than nothing.' }); if (!v.payee) e.push({ field: 'payee', message: 'Paid to: who was paid.' }); if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.date ?? ''))) e.push({ field: 'date', message: 'Date: the day of the bill.' }); return e; },
  create(db, actor, v, ctx) { const cs = cashOf(db); if (!cs) throw unprocessable('Cash and bank are not set up.'); const r = cs.vouchers.create(actor, { imprestId: Number(v.imprestId), date: v.date, payee: v.payee, category: v.category ?? 'SITE_EXPENSE', description: v.description, amount: String(v.amount), gst: v.gst != null ? String(v.gst) : undefined, expenseAccountId: Number(v.expenseAccountId), costCodeId: v.costCodeId ? Number(v.costCodeId) : null, clientRef: ctx?.clientRef ?? undefined, lat: ctx?.gps?.lat, lng: ctx?.gps?.lng }); return { entityId: r.id, version: r.version, projectId: r.projectId ?? null }; },
  load(db, actor, id) { const r = db.prepare('SELECT * FROM fin_imprest_vouchers WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); return r ? { version: r.version, values: { imprestId: r.imprest_id, date: r.voucher_date, payee: r.payee, category: r.category, description: r.description, amount: r.amount_paise / 100 }, projectId: r.org_project_id } : null; },
  update() { throw unprocessable('A voucher is changed on its page once it reached the server.'); },
});
for (const [type, label, perm, route] of [['ar_invoices', 'Receivable', 'fin.invoice.view', '/finance/receivables?id='], ['ar_receipts', 'Receipt', 'fin.receipt.view', '/finance/receivables?receipt=']]) objectTypes.register({
  type, label, permission: perm, route: (id) => `${route}${id}`, attachmentEntity: type, approvalTarget: type,
  access(db, actor, id) { const r = db.prepare(`SELECT company_id, org_project_id FROM ${type} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r || !authzOf(db).check(actor, perm, { companyId: r.company_id, projectId: r.org_project_id ?? undefined }).allowed) return null; return { companyId: r.company_id, projectId: r.org_project_id ?? undefined }; },
  auditEntities: (id) => [{ entity: type, id }],
  summary(db, actor, id) { const r = db.prepare(`SELECT doc_no, status FROM ${type} WHERE id = ? AND company_id = ?`).get(Number(id), actor.companyId); return r ? { label: r.doc_no, status: r.status } : null; },
  related: () => [],
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, perm).allowed) return []; return db.prepare(`SELECT id FROM ${type} WHERE company_id = ? AND deleted_at IS NULL AND (doc_no LIKE ?${type === 'ar_invoices' ? ' OR invoice_no LIKE ?' : ' OR reference LIKE ?'}) ORDER BY id DESC LIMIT ?`).all(actor.companyId, `%${q}%`, `%${q}%`, limit).map((x) => x.id); },
});
for (const [type, label, perm, route] of [['pmt_proposals', 'Payment proposal', 'fin.proposal.view', '/finance/payment-proposals?id='], ['pmt_payments', 'Payment', 'fin.payment.view', '/finance/payments?id=']]) objectTypes.register({
  type, label, permission: perm, route: (id) => `${route}${id}`, attachmentEntity: type, approvalTarget: type,
  access(db, actor, id) { if (!authzOf(db).check(actor, perm).allowed) return null; const r = db.prepare(`SELECT company_id FROM ${type} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); return r ? { companyId: r.company_id } : null; },
  auditEntities: (id) => [{ entity: type, id }],
  summary(db, actor, id) { const r = db.prepare(`SELECT doc_no, ${type === 'pmt_payments' ? 'pay_status' : 'status'} AS status FROM ${type} WHERE id = ? AND company_id = ?`).get(Number(id), actor.companyId); return r ? { label: r.doc_no, status: r.status } : null; },
  related: () => [],
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, perm).allowed) return []; return db.prepare(`SELECT id FROM ${type} WHERE company_id = ? AND deleted_at IS NULL AND (doc_no LIKE ?${type === 'pmt_payments' ? ' OR utr LIKE ? OR cheque_no LIKE ?' : ''}) ORDER BY id DESC LIMIT ?`).all(actor.companyId, `%${q}%`, ...(type === 'pmt_payments' ? [`%${q}%`, `%${q}%`] : []), limit).map((x) => x.id); },
});
for (const [type, label, perm, route] of [['ap_bills', 'AP bill', 'fin.bill.view', '/finance/ap-bills?id='], ['ap_debit_notes', 'Debit note', 'fin.debit_note.view', '/finance/debit-notes?id=']]) objectTypes.register({
  type, label, permission: perm, route: (id) => `${route}${id}`, attachmentEntity: type, approvalTarget: type,
  access(db, actor, id) { if (!authzOf(db).check(actor, perm).allowed) return null; const r = db.prepare(`SELECT company_id, org_project_id FROM ${type} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); return r ? { companyId: r.company_id, projectId: r.org_project_id ?? undefined } : null; },
  auditEntities: (id) => [{ entity: type, id }],
  summary(db, actor, id) { const r = db.prepare(`SELECT doc_no, status FROM ${type} WHERE id = ? AND company_id = ?`).get(Number(id), actor.companyId); return r ? { label: r.doc_no, status: r.status } : null; },
  related: () => [],
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, perm).allowed) return []; return db.prepare(`SELECT id FROM ${type} WHERE company_id = ? AND deleted_at IS NULL AND doc_no LIKE ? ORDER BY id DESC LIMIT ?`).all(actor.companyId, `%${q}%`, limit).map((x) => x.id); },
});

// ---- part 23.07: the GST compliance service ----
for (const [type, description] of [
  ['fin.gst_settings.approved', 'A version of the GST settings was approved by the CFO (part 23.07): data { settingsId, effectiveFrom, einvoiceEnabled, ewayEnabled, gspMode }.'],
  ['fin.einvoice.generated', 'The IRP returned the IRN of a document (part 23.07 FR-03): data { einvoiceId, documentType, documentId, documentNo, irn, ackNo, ackDate, mode }. The document (22.04, 23.05) carries the IRN and the QR.'],
  ['fin.einvoice.failed', 'An e-invoice was refused or not answered (part 23.07): data { einvoiceId, documentType, documentId, documentNo, code, retryable }.'],
  ['fin.einvoice.cancelled', 'An IRN was cancelled within its 24 hours (part 23.07): data { einvoiceId, documentType, documentId, documentNo, irn, reason }.'],
  ['fin.ewaybill.generated', 'An e-way bill was generated (part 23.07 FR-04): data { ewaybillId, ewbNo, documentType, documentId, documentNo, vehicleNo, validUntil, projectId }. The gate and the transfer read it.'],
  ['fin.ewaybill.vehicle_updated', 'The vehicle of an e-way bill changed (Part B): data { ewaybillId, ewbNo, vehicleNo, validUntil, documentType, documentId }.'],
  ['fin.ewaybill.extended', 'An e-way bill was extended: data { ewaybillId, ewbNo, validUntil }.'],
  ['fin.ewaybill.cancelled', 'An e-way bill was cancelled within its 24 hours: data { ewaybillId, ewbNo, documentType, documentId }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'fin', description });
const gsDecide = (outcome) => (db, { instance, actor, comment }) => gstOf(db)?.settings.flow.decide(instance, actor, outcome, comment);
workflowTypes.register({
  docType: 'FIN_GST_SETTINGS', label: 'GST settings (version)', processOwner: 'CFO', route: (id) => `/finance/gst-settings?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM gst_settings WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `GST settings from ${r.effective_from}: ${r.change_note ?? ''}`.slice(0, 300), originator: r.requested_by } : null; },
  summarise(db, _actor, id) {
    const r = db.prepare('SELECT * FROM gst_settings WHERE id = ?').get(Number(id)); if (!r) return null; const prev = db.prepare("SELECT * FROM gst_settings WHERE company_id = ? AND status = 'APPROVED' AND id <> ? ORDER BY effective_from DESC, id DESC LIMIT 1").get(r.company_id, r.id);
    const cr = (p) => `₹${(p / 1e7).toFixed(2)} crore`; /** @type {Array<[string, string, (v: any) => string]>} */ const rows = [['From', 'effective_from', (v) => v], ['Aggregate turnover', 'aato_paise', cr], ['e-Invoicing', 'einvoice_enabled', (v) => (v ? 'on' : 'off')], ['IRN reporting window', 'irn_window_days', (v) => `${v} days`], ['e-Way bills', 'eway_enabled', (v) => (v ? 'on' : 'off')], ['e-Way bill above', 'eway_threshold_paise', (v) => `₹${(v / 100).toLocaleString('en-IN')}`], ['GSP connector', 'gsp_connector_code', (v) => v ?? 'none'], ['Mode', 'gsp_mode', (v) => v], ['Why', 'change_note', (v) => v ?? '']];
    return { fields: rows.map((x) => { const l = String(x[0]); const k = String(x[1]); const f = /** @type {(v: any) => string} */ (x[2]); return { label: l, value: prev && prev[k] !== r[k] && k !== 'change_note' ? `${f(r[k])} (was ${f(prev[k])})` : f(r[k]) }; }) };
  },
  defaultDefinition: { name: 'GST settings: the CFO (made by the accounts manager)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('CFO', 'Chief financial officer', 'CFO')] },
  hooks: { onApproved: gsDecide('APPROVED'), onRejected: gsDecide('REJECTED'), onReturned: gsDecide('RETURNED'), onCancelled: gsDecide('CANCELLED') },
});

// ---- part 23.08: GST reconciliation, ITC review and TDS ----
for (const [type, description] of [
  ['fin.gst_2b.imported', 'A GSTR-2B statement was imported and matched (part 23.08 FR-01): data { importId, period, lines, MATCHED, MISMATCH_AMOUNT, MISMATCH_DATE, MISMATCH_NUMBER, MISSING_IN_BOOKS }.'],
  ['fin.gst_recon.followup', 'A vendor is asked about an invoice missing in GSTR-2B or that differs from it (part 23.08 FR-02): data { lineId, billId, partnerId, channel, invoiceNo, invoiceDate, issue, note, nextDate }. The vendor portal (25.02) shows it to the vendor.'],
  ['fin.itc_review.approved', 'The ITC of a month was approved by the CFO (part 23.08 FR-03): data { reviewId, docNo, period, eligible, override, reversed, claimable, blocked, journalId }. The reversal is posted.'],
  ['fin.gst_return.filed', 'GSTR-1 or GSTR-3B of a month was marked filed with its ARN: data { returnType, period, arn, filedOn }.'],
  ['fin.tds_return.filed', 'A quarterly TDS statement was marked filed with its token: data { quarter, form, tokenNo, filedOn }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'fin', description });
const itcDecide = (outcome) => (db, { instance, actor, comment }) => gstReconOf(db)?.reviews.flow.decide(instance, actor, outcome, comment);
workflowTypes.register({
  docType: 'FIN_ITC_REVIEW', label: 'Monthly ITC claim (review)', processOwner: 'CFO', route: (id) => `/finance/gst-reconciliation?tab=itc&review=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM gst_itc_reviews WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `ITC of ${r.period}: claim ₹${(r.claimable_paise / 100).toFixed(2)}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM gst_itc_reviews WHERE id = ?').get(Number(id)); if (!r) return null; const m = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`; const n = db.prepare("SELECT COUNT(*) AS n FROM gst_itc_review_lines WHERE review_id = ? AND decision = 'OVERRIDE_CLAIM' AND deleted_at IS NULL").get(r.id).n;
    return { fields: [{ label: 'Month', value: r.period }, { label: 'Eligible (matched in 2B)', value: m(r.eligible_paise) }, { label: 'Claimed by override', value: `${m(r.override_paise)} (${n} invoice(s), each with its reason)` }, { label: 'Reversed (unpaid beyond 180 days)', value: m(r.reversed_paise) }, { label: 'Blocked or not available', value: m(r.blocked_paise) }, { label: 'Held (not in 2B or mismatch)', value: m(r.held_paise) }, { label: 'ITC to claim', value: m(r.claimable_paise) }] }; },
  defaultDefinition: { name: 'Monthly ITC claim: the accounts manager, then the CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager (when someone else prepared it)', 'ACCMGR', { field: 'makerRole', op: 'ne', value: 'ACCMGR' }), glStep('CFO', 'Chief financial officer', 'CFO')] },
  hooks: { onApproved: itcDecide('APPROVED'), onRejected: itcDecide('REJECTED'), onReturned: itcDecide('RETURNED'), onCancelled: itcDecide('CANCELLED') },
});

// ---- part 23.09: fixed assets ----
for (const [type, description] of [
  ['fin.asset.capitalised', 'A fixed asset was capitalised (approved by the CFO; part 23.09 FR-02): data { assetId, docNo, classCode, cost, capDate, projectId, equipmentId, smallAssetId, source, journalId }.'],
  ['fin.depreciation.posted', 'The book depreciation of a month was posted (part 23.09 FR-03): data { runId, period, total, journalId, assets: [{ assetId, equipmentId, smallAssetId, projectId, siteId, classCode, amount }] }. Plant costs (17.07) and the batching plant (20.03) read the machines\' share.'],
  ['fin.asset.transferred', 'A fixed asset moved to another project, site or custodian (part 23.09 FR-04): data { assetId, transferId, fromProjectId, toProjectId, toCustodian, equipmentId, date }.'],
  ['fin.asset.disposed', 'A fixed asset was sold, scrapped or written off (part 23.09 FR-05): data { disposalId, docNo, assetId, assetNo, description, equipmentId, smallAssetId, projectId, method, date, buyerPartnerId, proceeds, gst, wdv, gainLoss, journalId, requestedBy, clearingAccountCode }. A sale becomes a receivable to invoice (23.05).'],
  ['fin.asset.verified', 'A physical verification of fixed assets was closed (part 23.09 FR-06): data { verificationId, projectId, expected, missing }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'fin', description });
const faDecide = (kind, outcome) => (db, { instance, actor, comment }) => assetsOf(db)?.[kind].flow.decide(instance, actor, outcome, comment);
const faHooks = (kind) => ({ onApproved: faDecide(kind, 'APPROVED'), onRejected: faDecide(kind, 'REJECTED'), onReturned: faDecide(kind, 'RETURNED'), onCancelled: faDecide(kind, 'CANCELLED') });
const inr = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
workflowTypes.register({
  docType: 'FIN_FA_ASSET', label: 'Capitalisation of a fixed asset', processOwner: 'CFO', route: (id) => `/finance/assets?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM fa_assets WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.description} ${inr(r.cost_paise)}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined, siteId: r.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM fa_assets WHERE id = ?').get(Number(id)); return r ? { fields: [{ label: 'Asset', value: r.description }, { label: 'Class', value: r.class_code }, { label: 'From', value: r.cap_source }, { label: 'Cost', value: inr(r.cost_paise) }, { label: 'Put to use', value: r.cap_date }, { label: 'Depreciation', value: `${r.book_method} over ${r.useful_life_months} months, residual ${inr(r.residual_paise)}` }, { label: 'Tax block', value: `${r.tax_block} at ${r.tax_rate_bp / 100}%` }] } : null; },
  defaultDefinition: { name: 'Capitalisation: the accounts manager, then the CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager (when someone else prepared it)', 'ACCMGR', { field: 'makerRole', op: 'ne', value: 'ACCMGR' }), glStep('CFO', 'Chief financial officer', 'CFO')] },
  hooks: faHooks('assets'),
});
workflowTypes.register({
  docType: 'FIN_FA_DISPOSAL', label: 'Disposal of a fixed asset', processOwner: 'CFO', route: (id) => `/finance/assets?disposal=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT d.*, a.doc_no AS asset_no, a.description, a.org_project_id FROM fa_disposals d JOIN fa_assets a ON a.id = d.asset_id WHERE d.id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `${r.method} of ${r.asset_no} ${r.description}: WDV ${inr(r.wdv_paise)}, proceeds ${inr(r.proceeds_paise)}`.slice(0, 300), originator: r.requested_by, projectId: r.org_project_id ?? undefined } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT d.*, a.doc_no AS asset_no, a.description, a.cost_paise, a.accumulated_dep_paise FROM fa_disposals d JOIN fa_assets a ON a.id = d.asset_id WHERE d.id = ?').get(Number(id)); return r ? { fields: [{ label: 'Asset', value: `${r.asset_no} ${r.description}` }, { label: 'How', value: r.method }, { label: 'Date', value: r.disposal_date }, { label: 'Cost', value: inr(r.cost_paise) }, { label: 'Depreciation to the day before', value: inr(r.accumulated_dep_paise + r.dep_to_date_paise) }, { label: 'Written-down value', value: inr(r.wdv_paise) }, { label: 'Proceeds (+ GST)', value: `${inr(r.proceeds_paise)} + ${inr(r.gst_paise)}` }, { label: r.gain_loss_paise >= 0 ? 'Gain' : 'Loss', value: inr(Math.abs(r.gain_loss_paise)) }, { label: 'Why', value: r.reason }] } : null; },
  defaultDefinition: { name: 'Disposal: the accounts manager, the CFO, and a director above ₹10 lakh', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager (when someone else proposed it)', 'ACCMGR', { field: 'makerRole', op: 'ne', value: 'ACCMGR' }), glStep('CFO', 'Chief financial officer', 'CFO'), glStep('DIR', 'Director (above ₹10 lakh)', 'DIR', { field: 'aboveDir', op: 'eq', value: 'yes' })] },
  hooks: faHooks('disposals'),
});

// ---- part 23.10: project accounting ----
for (const [type, description] of [
  ['fin.revenue.recognised', 'The revenue of a project for a month was recognised and posted (approved by the CFO; part 23.10 FR-02, FR-03): data { recognitionId, docNo, projectId, period, method, poc, contractRevenue, recognisedCum, recognisedPeriod, billed, unbilled, excess, lossProvision, eac, costToDate, journalId }. The project P&L (23.12) reads it.'],
  ['fin.overhead.posted', 'The overhead of a pool allocated in 12.04 was posted to the projects (part 23.10 FR-04): data { runId, docNo, period, total, journalId, allocations: [{ projectId, amount }] }.'],
]) eventTypes.define({ type, version: 1, schema, owner: 'fin', description });
const rrDecide = (outcome) => (db, { instance, actor, comment }) => projectAccountsOf(db)?.recognition.flow.decide(instance, actor, outcome, comment);
workflowTypes.register({
  docType: 'FIN_REVENUE_RECOGNITION', label: 'Revenue recognition of a project for a month', processOwner: 'CFO', route: (id) => `/finance/revenue-recognition?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT x.*, p.code FROM pa_revenue_recognition x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `Revenue of ${r.code} for ${r.period}: ${inr(r.recognised_period_paise)} this month`, originator: r.requested_by, projectId: r.org_project_id } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT x.*, p.code, p.name FROM pa_revenue_recognition x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(Number(id)); if (!r) return null;
    return { fields: [{ label: 'Project', value: `${r.code} ${r.name}` }, { label: 'Month', value: r.period }, { label: 'Method', value: r.method === 'OUTPUT' ? 'Output' : 'Cost to cost' }, { label: 'Cost to date / EAC', value: `${inr(r.cost_to_date_paise)} / ${inr(r.eac_paise)} (${r.eac_ref ?? r.eac_source})` }, { label: 'Percentage of completion', value: `${(r.poc_ppm / 10000).toFixed(2)} %` }, { label: 'Contract revenue', value: inr(r.contract_revenue_paise) }, { label: 'Recognised to date / this month', value: `${inr(r.recognised_cum_paise)} / ${inr(r.recognised_period_paise)}` }, { label: 'Billed to date', value: inr(r.billed_cum_paise) }, { label: 'Unbilled / billing in excess', value: `${inr(r.unbilled_paise)} / ${inr(r.excess_billing_paise)}` }, { label: 'Expected loss provided', value: inr(r.loss_provision_paise) }] }; },
  defaultDefinition: { name: 'Revenue recognition: the accounts manager (when someone else prepared it), then the CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager (when someone else prepared it)', 'ACCMGR', { field: 'makerRole', op: 'ne', value: 'ACCMGR' }), glStep('CFO', 'CFO', 'CFO')] },
  hooks: { onApproved: rrDecide('APPROVED'), onRejected: rrDecide('REJECTED'), onReturned: rrDecide('RETURNED'), onCancelled: rrDecide('CANCELLED') },
});
objectTypes.register({ type: 'pa_revenue_recognition', label: 'Revenue recognition', permission: 'fin.revenue_recognition.view', route: (id) => `/finance/revenue-recognition?id=${id}`,
  access(db, actor, id) { if (!authzOf(db).check(actor, 'fin.revenue_recognition.view').allowed) return null; const r = db.prepare('SELECT company_id, org_project_id, status FROM pa_revenue_recognition WHERE id = ? AND deleted_at IS NULL').get(Number(id)); return r && r.company_id === actor.companyId ? { companyId: r.company_id, projectId: r.org_project_id, status: r.status } : null; },
  auditEntities: (id) => [{ entity: 'pa_revenue_recognition', id }], summary(db, _actor, id) { const r = db.prepare('SELECT doc_no, period, status FROM pa_revenue_recognition WHERE id = ?').get(Number(id)); return r ? { label: `${r.doc_no} ${r.period}`, status: r.status } : null; },
  related() { return []; } });

// ---- part 23.11: cost forecast ----
eventTypes.define({ type: 'fin.eac_version.approved', version: 1, schema, owner: 'fin', description: 'A cost forecast of a project for a month was approved (part 23.11 FR-05): data { forecastId, docNo, projectId, period, version, budget, actual, etc, eac, vac, riskAllowance, lossMaking, confidence }. Revenue recognition (23.10) takes its EAC; the P&L (23.12) and the cash forecast (23.13) read it.' });
const fcDecide = (outcome) => (db, { instance, actor, comment }) => costForecastsOf(db)?.forecasts.flow.decide(instance, actor, outcome, comment);
workflowTypes.register({
  docType: 'FIN_COST_FORECAST', label: 'Monthly cost forecast of a project', processOwner: 'PD', route: (id) => `/finance/cost-forecasts?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT x.*, p.code FROM fc_forecasts x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `Cost forecast of ${r.code} for ${r.period} v${r.version_no}: EAC ${inr(r.eac_total_paise)}`, originator: r.requested_by, projectId: r.org_project_id } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT x.*, p.code, p.name FROM fc_forecasts x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(Number(id)); if (!r) return null;
    return { fields: [{ label: 'Project', value: `${r.code} ${r.name}` }, { label: 'Month / version', value: `${r.period} v${r.version_no}` }, { label: 'Budget', value: inr(r.budget_paise) }, { label: 'Actual + accrued', value: inr(r.actual_paise + r.accrued_paise) }, { label: 'ETC', value: inr(r.etc_paise) }, { label: 'Risk allowance / pending variations', value: `${inr(r.risk_allowance_paise)} / ${inr(r.pending_var_cost_paise)}` }, { label: 'EAC / VAC', value: `${inr(r.eac_total_paise)} / ${inr(r.vac_total_paise)}` }, { label: 'Contract revenue', value: `${inr(r.contract_revenue_paise)}${r.loss_making ? ' — loss-making' : ''}` }, { label: 'Confidence', value: r.confidence }] }; },
  defaultDefinition: { name: 'Cost forecast: the project controls manager, the PM, the project director, and the CFO for a loss-making project', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('PCMGR', 'Project controls manager (when someone else prepared it)', 'PCMGR', { field: 'makerRole', op: 'ne', value: 'PCMGR' }), glStep('PM', 'Project manager (when someone else prepared it)', 'PM', { field: 'makerRole', op: 'ne', value: 'PM' }), glStep('PD', 'Project director', 'PD'), glStep('CFO', 'CFO (loss-making project)', 'CFO', { field: 'loss', op: 'eq', value: 'yes' })] },
  hooks: { onApproved: fcDecide('APPROVED'), onRejected: fcDecide('REJECTED'), onReturned: fcDecide('RETURNED'), onCancelled: fcDecide('CANCELLED') },
});

// ---- part 23.12: project P&L ----
eventTypes.define({ type: 'fin.pl_snapshot.frozen', version: 1, schema, owner: 'fin', description: 'The P&L of a project for a month was frozen (approved by the CFO; equal to the ledger; part 23.12 FR-04): data { snapshotId, docNo, projectId, period, revenue, grossProfit, operatingProfit, revenueToDate, operatingProfitToDate }. MIS (27.07), the control tower (27.04) and the closeout (26.04) read it.' });
const plDecide = (outcome) => (db, { instance, actor, comment }) => projectPlOf(db)?.snapshots.flow.decide(instance, actor, outcome, comment);
workflowTypes.register({
  docType: 'FIN_PL_SNAPSHOT', label: 'Freeze of a project P&L for a month', processOwner: 'CFO', route: (id) => `/finance/project-pl?snapshot=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT x.*, p.code FROM pl_snapshots x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `P&L of ${r.code} for ${r.period}: revenue ${inr(r.revenue_paise)}`, originator: r.requested_by, projectId: r.org_project_id } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT x.*, p.code, p.name FROM pl_snapshots x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(Number(id)); if (!r) return null;
    return { fields: [{ label: 'Project', value: `${r.code} ${r.name}` }, { label: 'Month', value: r.period }, { label: 'Revenue', value: inr(r.revenue_paise) }, { label: 'Gross profit', value: inr(r.gross_profit_paise) }, { label: 'Operating profit', value: inr(r.operating_profit_paise) }, { label: 'Ledger / P&L', value: `${inr(r.gl_total_paise)} / ${inr(r.pl_total_paise)}${r.gl_total_paise === r.pl_total_paise ? ' (equal)' : ' (NOT equal)'}` }] }; },
  defaultDefinition: { name: 'P&L snapshot freeze: the accounts manager (when someone else made it), then the CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager (when someone else made it)', 'ACCMGR', { field: 'makerRole', op: 'ne', value: 'ACCMGR' }), glStep('CFO', 'CFO', 'CFO')] },
  hooks: { onApproved: plDecide('APPROVED'), onRejected: plDecide('REJECTED'), onReturned: plDecide('RETURNED'), onCancelled: plDecide('CANCELLED') },
});
// Project 360 (10.08): the P&L of the project this year
registerProject360Widget('fin-pl', (ctx) => projectPlOf(ctx.db)?.widget(ctx.actor, ctx.project.project_id) ?? { figures: [], rows: [], note: 'The project P&L (part 23.12) is not set up for this database.' });

// ---- part 23.13: cash forecast ----
eventTypes.define({ type: 'fin.cash_forecast.published', version: 1, schema, owner: 'fin', description: 'The weekly cash forecast was published (approved by the CFO; part 23.13): data { forecastId, docNo, weekStart, weeks, opening, inflow, outflow, closing, lowest, lowestWeek }. The control tower (27.04) reads it.' });
const cfDecide = (outcome) => (db, { instance, actor, comment }) => cashForecastsOf(db)?.forecasts.flow.decide(instance, actor, outcome, comment);
workflowTypes.register({
  docType: 'FIN_CASH_FORECAST', label: 'Weekly cash forecast publication', processOwner: 'CFO', route: (id) => `/finance/treasury?forecast=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM cf_forecasts WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `Cash forecast from ${r.week_start}: closing ${inr(r.closing_paise)}, lowest ${inr(r.lowest_paise)}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM cf_forecasts WHERE id = ?').get(Number(id)); if (!r) return null; const adj = db.prepare("SELECT COUNT(*) AS n FROM cf_lines WHERE forecast_id = ? AND source = 'MANUAL' AND deleted_at IS NULL").get(r.id).n;
    return { fields: [{ label: 'Weeks', value: `${r.weeks} from ${r.week_start}` }, { label: 'Opening cash', value: inr(r.opening_paise) }, { label: 'Inflow / outflow', value: `${inr(r.inflow_paise)} / ${inr(r.outflow_paise)}` }, { label: 'Closing', value: inr(r.closing_paise) }, { label: 'Lowest point', value: `${inr(r.lowest_paise)} (week of ${r.lowest_week})` }, { label: 'Manual adjustments', value: `${adj} (each with its reason)` }] }; },
  defaultDefinition: { name: 'Cash forecast: the accounts manager (when someone else prepared it), then the CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager (when someone else prepared it)', 'ACCMGR', { field: 'makerRole', op: 'ne', value: 'ACCMGR' }), glStep('CFO', 'CFO', 'CFO')] },
  hooks: { onApproved: cfDecide('APPROVED'), onRejected: cfDecide('REJECTED'), onReturned: cfDecide('RETURNED'), onCancelled: cfDecide('CANCELLED') },
});

// ---- part 23.14: period close ----
eventTypes.define({ type: 'fin.period.closed', version: 1, schema, owner: 'fin', description: 'A month was closed (approved by the CFO; every module hard-closed; part 23.14 FR-02): data { closeId, docNo, period, periodId, tbDebit, tbCredit, balanced, assets, equityLiabilities, revenue, pbt, pat, revenueYtd, patYtd, cash }. MIS (27.07) and consolidation (23.15) read it.' });
eventTypes.define({ type: 'fin.period.reopened', version: 1, schema, owner: 'fin', description: 'A closed month was reopened (approved ACCMGR → CFO → DIR; part 23.14 FR-02): data { closeId, reopenId, period, periodId, modules, to, reason }.' });
eventTypes.define({ type: 'fin.year.closed', version: 1, schema, owner: 'fin', description: 'A financial year was closed after every month and the closing entries (part 23.14 FR-04): data { fyId, code, pat, carryForwardJournalId }.' });
const clDecide = (outcome) => (db, { instance, actor, comment }) => periodClosesOf(db)?.closes.flow.decide(instance, actor, outcome, comment);
workflowTypes.register({
  docType: 'FIN_PERIOD_CLOSE', label: 'Period close', processOwner: 'CFO', route: (id) => `/finance/close?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM close_periods WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `Close of ${r.period}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM close_periods WHERE id = ?').get(Number(id)); if (!r) return null; const t = db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN task_status IN ('DONE', 'NOT_APPLICABLE') THEN 1 ELSE 0 END) AS d FROM close_tasks WHERE close_id = ? AND deleted_at IS NULL").get(r.id); let f = {}; try { f = JSON.parse(r.figures_json); } catch { /* none */ }
    return { fields: [{ label: 'Month', value: r.period }, { label: 'Checklist', value: `${t.d ?? 0} of ${t.n} tasks done` }, { label: 'Trial balance', value: `₹${f.tbDebit ?? '—'} / ₹${f.tbCredit ?? '—'}${f.balanced ? ' (balanced)' : ''}` }, { label: 'Revenue / profit after tax', value: `₹${f.revenue ?? '—'} / ₹${f.pat ?? '—'}` }, { label: 'Cash', value: `₹${f.cash ?? '—'}` }] }; },
  defaultDefinition: { name: 'Period close: the accounts manager (when someone else prepared it), then the CFO', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager (when someone else prepared it)', 'ACCMGR', { field: 'makerRole', op: 'ne', value: 'ACCMGR' }), glStep('CFO', 'CFO', 'CFO')] },
  hooks: { onApproved: clDecide('APPROVED'), onRejected: clDecide('REJECTED'), onReturned: clDecide('RETURNED'), onCancelled: clDecide('CANCELLED') },
});
const roDecide = (outcome) => (db, { instance, actor, comment }) => periodClosesOf(db)?.reopens.flow.decide(instance, actor, outcome, comment);
workflowTypes.register({
  docType: 'FIN_PERIOD_REOPEN', label: 'Reopen of a closed month', processOwner: 'CFO', route: (id) => `/finance/close?reopen=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT r.*, c.period FROM close_reopens r JOIN close_periods c ON c.id = r.close_id WHERE r.id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `Reopen ${r.period}: ${r.reason}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT r.*, c.period, c.doc_no AS close_no FROM close_reopens r JOIN close_periods c ON c.id = r.close_id WHERE r.id = ?').get(Number(id)); if (!r) return null;
    return { fields: [{ label: 'Month', value: `${r.period} (${r.close_no})` }, { label: 'Modules', value: JSON.parse(r.modules_json).join(', ') }, { label: 'Reopened as', value: r.target_status }, { label: 'Reason', value: r.reason }] }; },
  defaultDefinition: { name: 'Reopen of a closed month: the accounts manager (when someone else asked), the CFO, then the director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [glStep('ACCMGR', 'Accounts manager (when someone else asked)', 'ACCMGR', { field: 'makerRole', op: 'ne', value: 'ACCMGR' }), glStep('CFO', 'CFO', 'CFO'), glStep('DIR', 'Director', 'DIR')] },
  hooks: { onApproved: roDecide('APPROVED'), onRejected: roDecide('REJECTED'), onReturned: roDecide('RETURNED'), onCancelled: roDecide('CANCELLED') },
});
