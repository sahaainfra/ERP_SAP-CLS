import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { fin } from './api.js';

// Cost Heads & Cost Codes (Finance, part 06.05, FR-03): the cost structure of the company (1 Material › 1.1 Cement, 2 Labour, 3 Plant and machinery, 4 Subcontract, 5 Site overheads, 6 Head office overheads ...),
// each top head posted to an account, and the cost codes under the heads (with a unit) that estimates, budgets, purchase orders, work orders and site costs are coded to. The project controls manager (or the
// accounts manager) proposes a new or changed head or code; the accounts manager checks a proposal of project controls and the CFO approves it.
export default function CostCodesPage() {
  usePageTitle('Cost Heads & Cost Codes');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fin', 'costs'], queryFn: fin.costs, retry: false });
  const accounts = useQuery({ queryKey: ['fin', 'chart', {}], queryFn: () => fin.chart({}), retry: false });
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  if (q.error?.status === 403) return <NoPermission what="the cost codes" permission="fin.coa.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the cost heads" rows={6} />;
  const { heads, codes, canEdit } = q.data;
  const head = heads.find((h) => h.id === sel) ?? null;
  const expense = (accounts.data?.accounts ?? []).filter((a) => !a.isControl && a.status === 'ACTIVE');
  const submit = async (e) => {
    e.preventDefault(); setError(null);
    try {
      let out;
      if (form.kind === 'head') out = form.id ? await fin.updateHead(form.id, { name: form.name, accountId: form.accountId ? Number(form.accountId) : null, status: form.status, reason: form.reason, version: form.rowVersion }) : await fin.createHead({ code: form.code, name: form.name, parentId: form.parentId ?? null, accountId: form.accountId ? Number(form.accountId) : null, reason: form.reason });
      else out = form.id ? await fin.updateCode(form.id, { name: form.name, uom: form.uom || null, status: form.status, reason: form.reason, version: form.rowVersion }) : await fin.createCode({ code: form.code, name: form.name, costHeadId: form.costHeadId, uom: form.uom || null, reason: form.reason });
      setNote(`${out.what} was sent for approval (change #${out.id}${out.makerRole === 'PCMGR' ? ': the accounts manager checks it, then the CFO' : ': the CFO approves it'}).`); setForm(null); qc.invalidateQueries({ queryKey: ['fin'] });
    } catch (err) { setError(errorInfo(err)); }
  };
  const nextCode = (parent) => { const kids = heads.filter((h) => h.parentId === (parent?.id ?? null)).map((h) => Number(h.code.split('.').at(-1))).filter(Number.isFinite); const n = (kids.length ? Math.max(...kids) : 0) + 1; return parent ? `${parent.code}.${n}` : String(n); };
  const tree = (parent, depth) => heads.filter((h) => h.parentId === parent).map((h) => (
    <li key={h.id}><button type="button" className={`btn btn-small item-tree-node${sel === h.id ? ' btn-primary' : ''}`} style={{ marginInlineStart: `${depth}rem` }} onClick={() => { setSel(h.id); setForm(null); }} data-testid="cc-head">{h.code} {h.name} <span className="muted small">{codes.filter((c) => c.costHeadId === h.id).length}</span>{h.status !== 'ACTIVE' ? ' (not in use)' : ''}</button>
      {heads.some((x) => x.parentId === h.id) && <ul className="item-tree">{tree(h.id, depth + 1)}</ul>}</li>));
  const headCodes = head ? codes.filter((c) => c.costHeadId === head.id) : [];
  return (
    <section aria-labelledby="cc-title" data-testid="cost-codes" className="fin-page">
      <h1 id="cc-title">Cost Heads &amp; Cost Codes</h1>
      {note && <p className="mdm-banner" role="status" data-testid="cc-note">{note}</p>}
      <div className="item-master">
        <nav aria-label="Cost heads" className="item-tree-pane"><ul className="item-tree">{tree(null, 0)}</ul>{canEdit && <button type="button" className="btn btn-small" onClick={() => { setError(null); setForm({ kind: 'head', code: nextCode(null), name: '', parentId: null, accountId: '', status: 'ACTIVE', reason: '' }); }} data-testid="cc-new-top">New top cost head</button>}</nav>
        <div className="item-list-pane">
          {form ? (
            <form onSubmit={submit} aria-label={form.kind === 'head' ? 'Cost head' : 'Cost code'} data-testid="cc-form">
              <h2>{form.id ? `Change ${form.code}` : form.kind === 'head' ? 'New cost head' : `New cost code under ${head?.code} ${head?.name}`}</h2>
              <div className="mdm-fields">
                <Field label="Code (required)" name="code" error={error}><input value={form.code} disabled={Boolean(form.id)} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} data-testid="cc-f-code" /></Field>
                <Field label="Name (required)" name="name" error={error}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="cc-f-name" /></Field>
                {form.kind === 'head' ? <Field label={form.parentId ? 'Account (the parent head\'s when empty)' : 'Account (required)'} name="accountId" error={error}><select value={form.accountId ?? ''} onChange={(e) => setForm({ ...form, accountId: e.target.value })} data-testid="cc-f-account"><option value="">—</option>{expense.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></Field>
                  : <Field label="Unit" name="uom" error={error}><input value={form.uom ?? ''} onChange={(e) => setForm({ ...form, uom: e.target.value.toUpperCase() })} data-testid="cc-f-uom" /></Field>}
                {form.id && <Field label="In use" name="status" error={error}><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="ACTIVE">Yes</option><option value="INACTIVE">No</option></select></Field>}
                <Field label="Reason (required)" name="reason" error={error}><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} data-testid="cc-f-reason" /></Field>
              </div>
              {error?.form && <p className="field-error" role="alert" data-testid="cc-error">{error.form}</p>}
              <div className="actions"><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="cc-f-save">Send for approval</button></div>
            </form>
          ) : !head ? <EmptyState title="Choose a cost head" message="Its account and its cost codes show here." /> : (
            <div data-testid="cc-detail">
              <h2>{head.code} {head.name}</h2>
              <p>Posted to: {head.account ? <strong>{head.account.code} {head.account.name}</strong> : <span className="muted">the account of its parent head</span>}{head.pendingChangeId && <span className="small"> · a change is waiting</span>}</p>
              {canEdit && <div className="actions-row"><button type="button" className="btn btn-small" onClick={() => { setError(null); setForm({ kind: 'head', id: head.id, code: head.code, name: head.name, accountId: head.accountId ?? '', status: head.status, rowVersion: head.rowVersion, parentId: head.parentId, reason: '' }); }} data-testid="cc-edit-head">Change the head</button>
                <button type="button" className="btn btn-small" onClick={() => { setError(null); setForm({ kind: 'head', code: nextCode(head), name: '', parentId: head.id, accountId: '', status: 'ACTIVE', reason: '' }); }} data-testid="cc-new-sub">Add a sub-head</button>
                <button type="button" className="btn btn-small btn-primary" onClick={() => { setError(null); setForm({ kind: 'code', code: '', name: '', costHeadId: head.id, uom: '', status: 'ACTIVE', reason: '' }); }} data-testid="cc-new-code">New cost code</button></div>}
              {headCodes.length === 0 ? <p className="muted">No cost code under this head.</p> : (
                <div className="table-wrap" tabIndex={0} role="region" aria-label="Cost codes"><table className="grid"><thead><tr><th>Code</th><th>Name</th><th>Unit</th><th>In use</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>{headCodes.map((c) => <tr key={c.id} data-testid="cc-code"><th scope="row" data-label="Code">{c.code}</th><td data-label="Name">{c.name}</td><td data-label="Unit">{c.uom ?? '—'}</td><td data-label="In use">{c.status === 'ACTIVE' ? 'Yes' : 'No'}{c.pendingChangeId ? ' · change waiting' : ''}</td><td>{canEdit && !c.pendingChangeId && <button type="button" className="btn btn-small" onClick={() => { setError(null); setForm({ kind: 'code', id: c.id, code: c.code, name: c.name, uom: c.uom ?? '', status: c.status, rowVersion: c.rowVersion, reason: '' }); }}>Change</button>}</td></tr>)}</tbody></table></div>)}
            </div>
          )}
          <p className="small"><Link to="/finance/chart-of-accounts?tab=changes">Changes waiting for approval</Link> · <Link to="/finance/category-mapping">Item category mapping</Link></p>
        </div>
      </div>
    </section>
  );
}
