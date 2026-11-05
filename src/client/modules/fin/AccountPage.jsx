import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { CHANGE_STATUS, CONTROLS, NATURE, REQ, TYPES, TYPE_LABEL, fin } from './api.js';

// Account (Finance, part 06.05, FR-02, FR-04, BR-01, BR-02): one ledger with its properties (group and nature, type, normal side, currency, control account, manual posting, blocked), its dimension rules
// (which of project, site, WBS, cost centre ... a posting must carry, may carry or must not carry), what maps to it (cost heads, item categories) and its change history. A change is sent to the CFO; an account
// with postings keeps its nature and is blocked rather than deleted. "Check a posting" shows what the posting check (T-01) says for a line to this account.
const TABS = [['properties', 'Properties'], ['dimensions', 'Dimension rules'], ['mapping', 'Mapping'], ['history', 'Changes']];
export default function AccountPage() {
  const id = Number(new URLSearchParams(window.location.search).get('id'));
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fin', 'account', id], queryFn: () => fin.account(id), enabled: id > 0, retry: false });
  usePageTitle(q.data ? `${q.data.code} ${q.data.name}` : 'Account');
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') ?? 'properties');
  const [edit, setEdit] = useState(null);
  const [rules, setRules] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [probe, setProbe] = useState({ source: 'MANUAL', PROJECT: '', SITE: '', WBS: '', result: null });
  const groups = useGroups(Boolean(edit));
  if (!(id > 0)) return <EmptyState title="No account chosen" message="Open an account from the chart of accounts." />;
  if (q.error?.status === 403) return <NoPermission what="the chart of accounts" permission="fin.coa.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the account" rows={5} />;
  const a = q.data;
  const pending = Boolean(a.pendingChangeId);
  const sent = (out) => { setNote(`${out.what} was sent to the CFO for approval (change #${out.id}).`); setEdit(null); setRules(null); setReason(''); setError(null); qc.invalidateQueries({ queryKey: ['fin'] }); };
  const run = async (fn) => { setError(null); try { sent(await fn()); } catch (err) { setError(errorInfo(err)); } };
  const saveProps = (e) => { e.preventDefault(); run(() => fin.updateAccount(a.id, { name: edit.name, groupId: Number(edit.groupId), type: edit.type, normalBalance: edit.normalBalance, isControl: Boolean(edit.controlKind), controlKind: edit.controlKind || null, manualPosting: edit.manualPosting, ...(edit.contra ? { contraReason: reason } : {}), reason, version: a.rowVersion })); };
  const saveRules = (e) => { e.preventDefault(); run(() => fin.dimensions(a.id, { rules: Object.entries(rules).filter(([, r]) => r).map(([dimension, requirement]) => ({ dimension, requirement })), reason, version: a.rowVersion })); };
  const block = () => run(() => fin.block(a.id, { block: a.status !== 'BLOCKED', reason }));
  const remove = async () => { setError(null); try { await fin.remove(a.id, reason); qc.invalidateQueries({ queryKey: ['fin'] }); navigateTo('/finance/chart-of-accounts'); } catch (err) { setError(errorInfo(err)); } };
  const check = async () => { const dims = Object.fromEntries(['PROJECT', 'SITE', 'WBS'].filter((k) => probe[k]).map((k) => [k, k === 'WBS' ? probe[k] : Number(probe[k])])); try { setProbe({ ...probe, result: await fin.checkPosting({ accountId: a.id, source: probe.source, dimensions: dims }) }); } catch (err) { setError(errorInfo(err)); } };
  return (
    <section aria-labelledby="acc-title" data-testid="account-page" className="fin-page">
      <p className="small"><Link to="/finance/chart-of-accounts">Chart of accounts</Link> › {a.group.path.map((p) => p.name).join(' › ')}</p>
      <div className="page-head"><h1 id="acc-title">{a.code} {a.name}</h1><StatusBadge status={a.status === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED'} label={a.status === 'ACTIVE' ? 'Active' : 'Blocked'} />{a.isControl && <span className="chip">Control: {a.controlLabel}</span>}</div>
      {pending && <p className="mdm-banner" data-testid="acc-pending">A change of this account is waiting for approval (change #{a.pendingChangeId}).</p>}
      {a.status === 'BLOCKED' && <p className="mdm-banner is-warning">Blocked{a.blockReason ? `: ${a.blockReason}` : ''}. It takes no postings.</p>}
      {note && <p className="mdm-banner" role="status" data-testid="acc-note">{note}</p>}
      <div className="seg" role="tablist" aria-label="Sections">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn btn-small ${tab === k ? 'btn-primary' : ''}`} onClick={() => setTab(k)} data-testid={`acc-tab-${k}`}>{l}</button>)}</div>
      {tab === 'properties' && (!edit ? (
        <div data-testid="acc-props">
          <dl className="mdm-dl">
            <dt>Group</dt><dd>{a.group.code} {a.group.name} ({NATURE[a.nature]}){a.group.schedule3Label ? ` · Schedule III: ${a.group.schedule3Label}` : ''}</dd>
            <dt>Type</dt><dd>{TYPE_LABEL[a.type]}</dd><dt>Normal side</dt><dd>{a.normalBalance === 'DR' ? 'Debit' : 'Credit'}</dd><dt>Currency</dt><dd>{a.currency}</dd>
            <dt>Control account</dt><dd>{a.isControl ? `${a.controlLabel}: postings from the posting engine only${a.manualPosting ? ', manual journals allowed as an exception' : ''}` : 'No'}</dd>
            <dt>Manual journals</dt><dd data-testid="acc-manual">{a.manualPosting ? 'Allowed' : 'Not allowed'}</dd><dt>Postings</dt><dd data-testid="acc-postings">{a.postings}</dd>
          </dl>
          {a.canEdit && !pending && <div className="mdm-fields">
            <Field label="Reason (for block, unblock or delete)" name="reason" error={error}><input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="acc-reason" /></Field>
            <div className="actions-row"><button type="button" className="btn btn-primary btn-small" onClick={() => { setError(null); setEdit({ name: a.name, groupId: a.groupId, type: a.type, normalBalance: a.normalBalance, controlKind: a.controlKind ?? '', manualPosting: a.manualPosting, contra: false }); }} data-testid="acc-edit">Change</button>
              <button type="button" className="btn btn-small" onClick={block} data-testid="acc-block">{a.status === 'BLOCKED' ? 'Unblock' : 'Block'}</button>
              {a.canDelete ? <button type="button" className="btn btn-small" onClick={remove} data-testid="acc-delete">Delete</button> : <span className="muted small">{a.postings ? 'Has postings: it can be blocked, not deleted' : a.isControl ? 'A control account is blocked, not deleted' : 'Used by a cost head or a mapping'}</span>}</div></div>}
          {error?.form && <p className="field-error" role="alert" data-testid="acc-error">{error.form}</p>}
          <h2>Check a posting</h2>
          <div className="mdm-fields" data-testid="acc-probe">
            <Field label="Source" name="source"><select value={probe.source} onChange={(e) => setProbe({ ...probe, source: e.target.value, result: null })} data-testid="acc-probe-source"><option value="MANUAL">Manual journal</option><option value="ENGINE">Posting engine (a document)</option></select></Field>
            <Field label="Project id" name="PROJECT"><input inputMode="numeric" value={probe.PROJECT} onChange={(e) => setProbe({ ...probe, PROJECT: e.target.value, result: null })} data-testid="acc-probe-project" /></Field>
            <Field label="Site id" name="SITE"><input inputMode="numeric" value={probe.SITE} onChange={(e) => setProbe({ ...probe, SITE: e.target.value, result: null })} /></Field>
            <Field label="WBS" name="WBS"><input value={probe.WBS} onChange={(e) => setProbe({ ...probe, WBS: e.target.value, result: null })} /></Field>
            <div className="actions-row"><button type="button" className="btn btn-small" onClick={check} data-testid="acc-probe-check">Check</button></div>
          </div>
          {probe.result && <p className={`mdm-banner ${probe.result.ok ? '' : 'is-warning'}`} role="status" data-testid="acc-probe-result">{probe.result.ok ? 'This line would be accepted.' : `Rejected: ${probe.result.errors.map((x) => x.message).join(' ')}`}</p>}
        </div>
      ) : (
        <form onSubmit={saveProps} aria-label="Change the account" data-testid="acc-form">
          <div className="mdm-fields">
            <Field label="Name" name="name" error={error}><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="acc-f-name" /></Field>
            <Field label="Group" name="groupId" error={error}><select value={edit.groupId} onChange={(e) => setEdit({ ...edit, groupId: e.target.value })}>{(groups ?? [a.group]).filter((g) => g.parentId).map((g) => <option key={g.id} value={g.id}>{g.code} {g.name}</option>)}</select></Field>
            <Field label="Type" name="type" error={error}><select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Normal side" name="normalBalance" error={error}><select value={edit.normalBalance} onChange={(e) => setEdit({ ...edit, normalBalance: e.target.value, contra: e.target.value !== a.normalBalance })}><option value="DR">Debit</option><option value="CR">Credit</option></select></Field>
            <Field label="Control account" name="controlKind" error={error}><select value={edit.controlKind} onChange={(e) => setEdit({ ...edit, controlKind: e.target.value })}><option value="">No</option>{CONTROLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <label className="check"><input type="checkbox" checked={edit.manualPosting} onChange={(e) => setEdit({ ...edit, manualPosting: e.target.checked })} data-testid="acc-f-manual" /> Manual journals may post to it{edit.controlKind ? ' (an exception for a control account, BR-01)' : ''}</label>
            <Field label="Reason (required)" name="reason" error={error}><input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="acc-f-reason" /></Field>
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="acc-error">{error.form}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="acc-f-save">Send for approval</button></div>
        </form>
      ))}
      {tab === 'dimensions' && (
        <form onSubmit={saveRules} aria-label="Dimension rules" data-testid="acc-dims">
          <p className="small">Company is always set. A mandatory dimension must be on every posting line; a posting without it is rejected. A site belongs to its project.</p>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Rules"><table className="grid"><thead><tr><th>Dimension</th><th>Rule</th></tr></thead>
            <tbody>{a.dimensionsList.map((dm) => { const cur = (rules ?? a.dimensions)[dm.code] ?? ''; return <tr key={dm.code} data-testid="acc-dim"><th scope="row" data-label="Dimension">{dm.label}</th><td data-label="Rule">{a.canEdit && !pending ? <select aria-label={`${dm.label} rule`} value={cur} onChange={(e) => setRules({ ...(rules ?? a.dimensions), [dm.code]: e.target.value })} data-testid={`acc-dim-${dm.code}`}><option value="">Not used (optional)</option>{REQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> : (REQ.find(([k]) => k === cur)?.[1] ?? 'Not used')}</td></tr>; })}</tbody></table></div>
          {rules && <div className="mdm-fields"><Field label="Reason (required)" name="reason" error={error}><input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="acc-dims-reason" /></Field>
            {error?.form && <p className="field-error" role="alert">{error.form}</p>}
            <div className="actions"><button type="button" className="btn" onClick={() => setRules(null)}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="acc-dims-save">Send for approval</button></div></div>}
        </form>
      )}
      {tab === 'mapping' && (
        <div data-testid="acc-mapping">
          <h2>Cost heads posted here</h2>{a.costHeads.length ? <ul className="mdm-list">{a.costHeads.map((h) => <li key={h.id}><Link to="/finance/cost-codes">{h.code} {h.name}</Link></li>)}</ul> : <p className="muted">None</p>}
          <h2>Item categories</h2>{a.mappings.length ? <ul className="mdm-list">{a.mappings.map((m) => <li key={m.id}>{m.code} {m.name} <span className="muted small">({m.role === 'Inventory' ? 'stock' : 'consumption'})</span></li>)}</ul> : <p className="muted">None</p>}
          <p className="small"><Link to="/finance/category-mapping">Item category mapping</Link></p>
        </div>
      )}
      {tab === 'history' && (a.changes.length === 0 ? <EmptyState title="No change yet" message="Approved and waiting changes of this account show here." /> : (
        <ul className="mdm-list" data-testid="acc-history">{a.changes.map((c) => <li key={c.id}>#{c.id} {c.what} · {c.requestedBy} · {formatDateTime(c.createdAt)} · <StatusBadge status={CHANGE_STATUS[c.status][0]} label={CHANGE_STATUS[c.status][1]} />{c.reason ? ` · ${c.reason}` : ''}</li>)}</ul>))}
    </section>
  );
}
/** The groups for the "Group" choice, loaded only while the form is open. */
function useGroups(enabled) {
  const q = useQuery({ queryKey: ['fin', 'chart', 'groups'], queryFn: () => fin.chart({}), enabled, retry: false });
  return q.data?.groups ?? null;
}
