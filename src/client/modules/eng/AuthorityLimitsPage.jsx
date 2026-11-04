import { useMemo, useState } from 'react';
import { ConfirmDialog } from '../../platform/feedback/Dialogs.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useUnsavedGuard } from '../../platform/forms/guard.js';
import { formatINR } from '../../platform/format.js';
import { useLimitHistory, useLimits, useProposeLimits } from '../../platform/workflow/api.js';
import { Field, Link, can, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Authority Limits (part 04.02, section 7.3): what each role may finally approve, by document type, in rupees. A change is asked for as a set, takes effect from a date
// and only after its approval chain (the system administrator, the chief financial officer, and the director when a limit passes ₹1 Cr) has approved it.
const toText = (v) => (v == null ? '' : String(v));

export default function AuthorityLimitsPage({ session }) {
  usePageTitle('Authority Limits');
  const grid = useLimits();
  const history = useLimitHistory({ limit: 20 });
  const propose = useProposeLimits();
  const [edits, setEdits] = useState({}); // "ROLE|DOC" -> text ('' = no limit)
  const [filter, setFilter] = useState('');
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [add, setAdd] = useState({ role: '', docType: '' });
  useUnsavedGuard(Object.keys(edits).length > 0);
  const canManage = can(session, 'eng.matrix.manage');
  const data = grid.data;
  const cells = useMemo(() => new Map((data?.cells ?? []).map((c) => [`${c.role}|${c.docType}`, c])), [data]);
  if (grid.error?.status === 403) return <NoPermission what="the authority limits" permission="eng.matrix.view" />;
  const roles = data ? [...new Set([...data.roles, ...Object.keys(edits).map((k) => k.split('|')[0])])].sort() : [];
  const docTypes = data ? data.docTypes.filter((d) => !filter || d.toLowerCase().includes(filter.toLowerCase())) : [];
  const changes = Object.entries(edits).map(([k, v]) => { const [role, docType] = k.split('|'); return { role, docType, maxAmount: v.trim() === '' ? null : v.trim() }; });
  const submit = async () => {
    const out = await propose.mutateAsync({ changes, effectiveFrom: when, reason });
    setEdits({});
    setConfirm(false);
    navigateTo(`/workflow/instance?id=${out.instance.id}`, { force: true });
  };
  const bad = changes.filter((c) => c.maxAmount !== null && !/^\d{1,13}(\.\d{1,2})?$/.test(c.maxAmount));
  return (
    <section aria-labelledby="al-title" data-testid="authority-limits">
      <h1 id="al-title">Authority Limits</h1>
      <p className="muted">The most a role may finally approve for each kind of document. When the last step of a chain belongs to a role whose limit is below the amount, the step passes to the next level above that has the authority. An empty box means no limit.</p>
      {grid.isPending && <Skeleton label="Loading the limits" rows={5} />}
      {grid.isError && grid.error?.status !== 403 && <ErrorState title="The limits could not be loaded" error={grid.error} onRetry={() => grid.refetch()} />}
      {data && (
        <>
          <form className="srch-form" role="search" aria-label="Filter the grid" onSubmit={(e) => e.preventDefault()}>
            <label className="field"><span>Document type</span><input type="search" value={filter} placeholder="PO, PAY..." onChange={(e) => setFilter(e.target.value)} /></label>
          </form>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Limits by role and document type">
            <table className="grid">
              <thead><tr><th scope="col">Role</th>{docTypes.map((d) => <th scope="col" key={d} className="num">{d}</th>)}</tr></thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role}>
                    <th scope="row">{role}</th>
                    {docTypes.map((d) => {
                      const key = `${role}|${d}`;
                      const c = cells.get(key);
                      const edited = key in edits;
                      if (!c && !edited) return <td key={d} className="num muted" aria-label={`${role} has no limit set for ${d}`}>-</td>;
                      return (
                        <td key={d} className="num" data-testid={`al-${role}-${d}`}>
                          {canManage ? (
                            <input aria-label={`Limit of ${role} for ${d} in rupees`} inputMode="decimal" size={9} value={edited ? edits[key] : toText(c?.current)} placeholder="no limit" onChange={(e) => setEdits({ ...edits, [key]: e.target.value })} />
                          ) : <span>{c?.current == null ? 'No limit' : formatINR(c.current)}</span>}
                          {c?.pending && <><br /><span className="small muted">asked: {c.pending.maxAmount == null ? 'no limit' : formatINR(c.pending.maxAmount)} from {c.pending.effectiveFrom}</span></>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canManage && (
            <>
              <h2>Give a role a limit it does not have yet</h2>
              <form className="wf-inline" aria-label="Add a limit" onSubmit={(e) => { e.preventDefault(); if (add.role && add.docType) { setEdits({ ...edits, [`${add.role}|${add.docType}`]: '' }); setAdd({ role: '', docType: '' }); } }}>
                <label className="field"><span>Role</span><select value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}><option value="">Choose</option>{data.allRoles.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
                <label className="field"><span>Document type</span><select value={add.docType} onChange={(e) => setAdd({ ...add, docType: e.target.value })}><option value="">Choose</option>{data.docTypes.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
                <button type="submit" className="btn" disabled={!add.role || !add.docType}>Add to the grid</button>
              </form>
              <h2>Ask for the changes</h2>
              <p className="muted small">{changes.length === 0 ? 'Change a box above to ask for a new limit.' : `${changes.length} change(s) to ask for.`}</p>
              <div className="form-grid">
                <Field label="Takes effect from" name="effectiveFrom" error={error}><input type="date" value={when} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setWhen(e.target.value)} /></Field>
                <Field label="Reason" name="reason" error={error}><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
              </div>
              {error && <p role="alert" className="error">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}{Object.entries(error.fields ?? {}).map(([k, v]) => <span key={k} className="small"> {k}: {v}</span>)}</p>}
              {bad.length > 0 && <p role="alert" className="error">Write limits as rupees, such as 2500000 or 2500000.50.</p>}
              <div className="actions">
                <button type="button" className="btn btn-primary" disabled={changes.length === 0 || bad.length > 0 || reason.trim().length < 5} onClick={() => { setError(null); setConfirm(true); }}>Ask for approval</button>
                <button type="button" className="btn" disabled={changes.length === 0} onClick={() => setEdits({})}>Discard the changes</button>
              </div>
            </>
          )}
          <h2>Recent changes</h2>
          {history.data && history.data.length > 0 ? (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Recent limit changes">
              <table className="grid"><thead><tr><th>Role</th><th>Document type</th><th className="num">Limit</th><th>Status</th><th>From</th><th>Asked by</th></tr></thead>
                <tbody>{history.data.map((h) => <tr key={h.id}><th scope="row" data-label="Role">{h.role}</th><td data-label="Document type">{h.docType}</td><td className="num" data-label="Limit">{h.maxAmount == null ? 'No limit' : formatINR(h.maxAmount)}</td><td data-label="Status">{h.status.toLowerCase()}</td><td data-label="From">{h.effectiveFrom}</td><td data-label="Asked by">{h.createdBy}</td></tr>)}</tbody></table>
            </div>
          ) : <p className="muted">No limit has been changed yet.</p>}
          <p className="muted small"><Link to="/admin/approval-matrix">Approval Matrix</Link> · <Link to="/admin/approval-simulator">Approval Simulator</Link></p>
        </>
      )}
      <ConfirmDialog open={confirm} title="Ask for these limits?" text={`${changes.length} change(s) go to the approval chain together and take effect from ${when} if approved.`} confirmLabel="Ask for approval" onConfirm={() => submit().catch((e) => { setConfirm(false); setError(errorInfo(e)); })} onCancel={() => setConfirm(false)} />
    </section>
  );
}
