import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ConfirmDialog } from '../../platform/feedback/Dialogs.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatINR } from '../../platform/format.js';
import { useCreateDelegation, useDelegations, useMatrixList, useRevokeDelegation } from '../../platform/workflow/api.js';
import { Field, Link, can, errorInfo, usePageTitle } from '../core/pages/ui.jsx';

// Delegations (part 04.02, section 7.5): My delegations, and for administrators everyone's. A person hands their approvals to another for a period, all kinds of
// document or selected ones, up to an amount no higher than their own authority. The delegate decides on their behalf and it shows on the record. A delegation of
// more than 15 days waits for the delegator's manager. Not to someone who raised a document waiting for the delegator, nor to someone with lower clearance.
const STATUS = { PENDING: ['submitted', 'Waiting for the manager'], ACTIVE: ['approved', 'In force'], REVOKED: ['cancelled', 'Ended'], REJECTED: ['rejected', 'Refused'] };
const PAGE = 25;

function NewForm({ types, onDone, onCancel }) {
  const create = useCreateDelegation();
  const [error, setError] = useState(null);
  const [chosen, setChosen] = useState([]);
  const today = new Date().toISOString().slice(0, 10);
  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { delegate: String(f.get('delegate')).trim(), docTypes: chosen, from: String(f.get('from')), to: String(f.get('to')), reason: String(f.get('reason')), ...(String(f.get('maxAmount')).trim() ? { maxAmount: String(f.get('maxAmount')).trim() } : {}) };
    create.mutate(body, { onSuccess: (r) => onDone(r), onError: (er) => setError(errorInfo(er)) });
  };
  return (
    <form className="form-grid" onSubmit={submit} aria-label="New delegation">
      <Field label="Delegate to (user name)" name="delegate" error={error}><input name="delegate" required minLength={2} maxLength={60} /></Field>
      <Field label="From" name="from" error={error}><input name="from" type="date" required min={today} defaultValue={today} /></Field>
      <Field label="To" name="to" error={error}><input name="to" type="date" required min={today} defaultValue={today} /></Field>
      <Field label="Most the delegate may approve (₹, optional)" name="maxAmount" error={error} hint="Never more than your own limit."><input name="maxAmount" inputMode="decimal" /></Field>
      <Field label="Reason" name="reason" error={error}><input name="reason" required minLength={5} maxLength={500} /></Field>
      <fieldset><legend>Which documents (none ticked means all)</legend>
        <div className="wf-inline">{types.map((t) => <label className="check" key={t.docType}><input type="checkbox" checked={chosen.includes(t.docType)} onChange={(e) => setChosen(e.target.checked ? [...chosen, t.docType] : chosen.filter((x) => x !== t.docType))} /> {t.label}</label>)}</div>
      </fieldset>
      {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={create.isPending}>Delegate</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export default function DelegationsPage({ session }) {
  usePageTitle('Delegations');
  const [scope, setScope] = useState('mine');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [revoking, setRevoking] = useState(null);
  const list = useDelegations({ scope, status, limit: PAGE, offset: (page - 1) * PAGE });
  const types = useMatrixList({ limit: 1 });
  const revoke = useRevokeDelegation();
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  if (list.error?.status === 403 && scope === 'mine') return <NoPermission what="delegations" permission="eng.delegation.use" />;
  return (
    <section aria-labelledby="dl-title" data-testid="delegations">
      <h1 id="dl-title">Delegations</h1>
      <p className="muted">Hand your approvals to someone else while you are away. They decide in your name, within your authority, for the dates you give, and it shows on every record.</p>
      {notice && <p role="status" className="notice" data-testid="dl-notice">{notice}</p>}
      <div className="srch-tools">
        <div role="tablist" aria-label="Whose delegations" className="wf-tabs">
          <button type="button" role="tab" aria-selected={scope === 'mine'} className={`btn${scope === 'mine' ? ' btn-primary' : ''}`} onClick={() => { setScope('mine'); setPage(1); }}>My delegations</button>
          {(data?.canSeeAll || can(session, 'eng.delegation.admin')) && <button type="button" role="tab" aria-selected={scope === 'all'} className={`btn${scope === 'all' ? ' btn-primary' : ''}`} onClick={() => { setScope('all'); setPage(1); }}>Everyone's delegations</button>}
        </div>
        {!creating && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>New delegation</button>}
      </div>
      {creating && <NewForm types={types.data?.docTypes ?? []} onCancel={() => setCreating(false)} onDone={(r) => { setCreating(false); setNotice(r.delegation.status === 'PENDING' ? `Delegation ${r.delegation.id} is longer than 15 days, so your manager must approve it before it starts.` : `Delegation ${r.delegation.id} is in force from ${r.delegation.from}.`); }} />}
      <form className="srch-form" role="search" aria-label="Filter the delegations" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Status</span><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Any status</option>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </form>
      {list.isPending && <Skeleton label="Loading the delegations" rows={3} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The delegations could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {data && (data.rows.length === 0 ? <EmptyState title="No delegation" message="When you are away, delegate your approvals so nothing waits for you." action={{ label: 'New delegation', onClick: () => setCreating(true) }} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Delegations">
          <table className="grid">
            <thead><tr><th>From</th><th>To</th><th>Dates</th><th>Documents</th><th className="num">Cap (₹)</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{data.rows.map((d) => (
              <tr key={d.id} data-testid={`dl-row-${d.id}`}>
                <th scope="row" data-label="From">{d.delegator}</th><td data-label="To">{d.delegate}</td><td data-label="Dates">{d.from} to {d.to} ({d.days} days)</td>
                <td data-label="Documents">{d.docTypes.length ? d.docTypes.join(', ') : 'All'}</td><td className="num" data-label="Cap (₹)">{d.maxAmount == null ? 'Your own limit' : formatINR(d.maxAmount)}</td>
                <td data-label="Status"><StatusBadge status={STATUS[d.status][0]} label={STATUS[d.status][1]} />{d.instanceId && d.status === 'PENDING' && <> <Link to={`/workflow/instance?id=${d.instanceId}`}>see the approval</Link></>}</td>
                <td>{['PENDING', 'ACTIVE'].includes(d.status) && (d.delegator === session?.user || scope === 'all') && <button type="button" className="btn btn-small" onClick={() => setRevoking(d)}>End<span className="sr-only"> delegation {d.id}</span></button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
      <div className="pager"><span>{data?.total ?? 0} delegation(s), page {page} of {pages}</span>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
      <ConfirmDialog open={Boolean(revoking)} title="End this delegation?" text={revoking ? `${revoking.delegate} will no longer decide in the name of ${revoking.delegator}. Tasks already decided stay as they are.` : ''} confirmLabel="End the delegation" danger commentOptional
        onConfirm={async ({ reason }) => { await revoke.mutateAsync({ id: revoking.id, reason: reason || 'Ended early' }); setRevoking(null); setNotice('The delegation was ended.'); }} onCancel={() => setRevoking(null)} />
    </section>
  );
}
