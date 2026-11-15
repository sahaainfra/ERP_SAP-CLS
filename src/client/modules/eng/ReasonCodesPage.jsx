import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useReasonCodes, useSaveReason } from '../../platform/protocol/api.js';
import { Field, Link, can, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Reason Codes (part 04.04, section 7.5): the one list of reasons the ERP offers when someone cancels, rejects, returns, reverses, deviates or overrides. A company adds its
// own, and may switch a shared one off for itself; the dialogs of every module read this list.
export const ACTIONS = { cancel: 'Cancel', reject: 'Reject', return: 'Return for correction', reverse: 'Reverse', deviate: 'Deviate', override: 'Override a control' };

function Form({ initial, onDone, onCancel }) {
  const save = useSaveReason();
  const [error, setError] = useState(null);
  const submit = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    save.mutate({ actionType: String(f.get('actionType')), code: String(f.get('code')).trim().toUpperCase(), label: String(f.get('label')), requiresEvidence: f.get('evidence') === 'on', needsText: f.get('text') === 'on', active: f.get('active') === 'on', sortOrder: Number(f.get('sort')), ...(initial?.scope === 'company' ? { version: initial.version } : {}) },
      { onSuccess: (r) => onDone(r), onError: (er) => setError(errorInfo(er)) });
  };
  return (
    <form className="form-grid card" onSubmit={submit} aria-label={initial ? `Change ${initial.code}` : 'New reason code'}>
      <h2>{initial ? `Change ${initial.code}` : 'New reason code'}</h2>
      <Field label="For the action" name="actionType" error={error}><select name="actionType" defaultValue={initial?.actionType ?? 'cancel'} disabled={Boolean(initial)}>{Object.entries(ACTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      {initial && <input type="hidden" name="actionType" value={initial.actionType} />}
      <Field label="Code" name="code" error={error} hint="Capital letters, digits and underscores"><input name="code" required pattern="[A-Za-z][A-Za-z0-9_]{1,39}" defaultValue={initial?.code ?? ''} readOnly={Boolean(initial)} /></Field>
      <Field label="What the person reads" name="label" error={error}><input name="label" required minLength={3} maxLength={120} defaultValue={initial?.label ?? ''} /></Field>
      <Field label="Order" name="sort" error={error}><input name="sort" type="number" min="1" max="999" defaultValue={initial?.sortOrder ?? 100} /></Field>
      <label className="check"><input type="checkbox" name="evidence" defaultChecked={initial?.requiresEvidence} /> Evidence must be attached</label>
      <label className="check"><input type="checkbox" name="text" defaultChecked={initial?.needsText} /> The person must explain in words</label>
      <label className="check"><input type="checkbox" name="active" defaultChecked={initial ? initial.active : true} /> Offered in the dialogs</label>
      {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={save.isPending}>Save</button><button type="button" className="btn" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export default function ReasonCodesPage({ session }) {
  usePageTitle('Reason Codes');
  const [action, setAction] = useState('');
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const list = useReasonCodes(true);
  const manage = can(session, 'eng.pcs.manage');
  if (list.error?.status === 403) return <NoPermission what="the reason codes" permission="eng.pcs.manage" />;
  const rows = (list.data ?? []).filter((r) => !action || r.actionType === action);
  return (
    <section aria-labelledby="rc-title" data-testid="reason-codes">
      <PageHeader id="rc-title" title={"Reason Codes"} subtitle={"The reasons offered when someone cancels, rejects, returns, reverses, deviates or overrides. Shared reasons are the same for every company; a company adds its own or switches a shared one off for itself."} />
      {notice && <p role="status" className="notice" data-testid="rc-notice">{notice}</p>}
      <div className="srch-tools">{manage && !editing && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>New reason code</button>}<Link to="/admin/controls">Control Points</Link></div>
      {editing && <Form initial={editing.code ? editing : null} onCancel={() => setEditing(null)} onDone={(r) => { setEditing(null); setNotice(`${r.code} saved.`); }} />}
      <form className="srch-form" role="search" aria-label="Filter the reason codes" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Action</span><select value={action} onChange={(e) => setAction(e.target.value)}><option value="">All actions</option>{Object.entries(ACTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </form>
      {list.isPending && <Skeleton label="Loading the reason codes" rows={4} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The reason codes could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {list.data && (rows.length === 0 ? <EmptyState title="No reason code" message="Add one for this action." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Reason codes">
          <table className="grid">
            <thead><tr><th>Action</th><th>Code</th><th>Reason</th><th>Needs evidence</th><th>Needs words</th><th>Source</th><th>Offered</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={`${r.actionType}-${r.code}`} data-testid={`rc-row-${r.actionType}-${r.code}`}>
                <td data-label="Action">{ACTIONS[r.actionType]}</td><th scope="row" data-label="Code"><code>{r.code}</code></th><td data-label="Reason">{r.label}</td>
                <td data-label="Needs evidence">{r.requiresEvidence ? 'Yes' : 'No'}</td><td data-label="Needs words">{r.needsText ? 'Yes' : 'No'}</td><td data-label="Source">{r.scope === 'system' ? 'Shared' : 'This company'}</td>
                <td data-label="Offered"><StatusBadge status={r.active ? 'approved' : 'cancelled'} label={r.active ? 'Yes' : 'Switched off'} /></td>
                <td data-label="Actions">{manage && <button type="button" className="btn btn-small" onClick={() => setEditing(r)}>Change<span className="sr-only"> {r.code}</span></button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
