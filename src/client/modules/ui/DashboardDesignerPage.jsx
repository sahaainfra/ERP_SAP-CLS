import { useEffect, useMemo, useState } from 'react';
import { DashboardGrid, FilterBar } from '../../platform/dashboard/Dashboard.jsx';
import { useDashboardList, useDecideDashboardChange, useProposeRoleDefault, useRoleDefaults, useRoleHistory } from '../../platform/dashboard/api.js';
import { addWidget, fit, sameLayout } from '../../platform/dashboard/layout.js';
import { datePresets } from '../../platform/list/state.js';
import { todayIst } from '../../platform/forms/dates.js';
import { useContextOptions } from '../../platform/shell/api.js';
import { Banner } from '../../platform/feedback/Feedback.jsx';
import { formatDateTime } from '../../platform/format.js';
import { QueryState, errorInfo, navigateTo } from '../core/pages/ui.jsx';
import { NoPermission } from '../../platform/feedback/states.jsx';

// The Dashboard Designer (part 03.07, FR-03, AC-02/05; a Config page): an administrator arranges the default dashboard of a role. A change is a
// request that another administrator approves (maker-checker); once approved, everyone of that role who has no layout of their own sees it.

const validLayout = (v) => Array.isArray(v) && v.every((i) => i && typeof i.id === 'string' && typeof i.widget === 'string' && Number.isFinite(i.w) && Number.isFinite(i.h));

function Pending({ pending, me, code }) {
  const decide = useDecideDashboardChange(code);
  const [comment, setComment] = useState({});
  const [error, setError] = useState('');
  if (pending.length === 0) return <p className="muted" data-testid="dd-no-pending">No changes are waiting for approval.</p>;
  const act = async (p, action) => {
    setError('');
    try { await decide.mutateAsync({ id: p.id, action, comment: comment[p.id] || (action === 'approve' ? 'Approved' : '') }); } catch (err) { const i = errorInfo(err); setError(`${i.form}${i.correlationId ? ` (Correlation ID ${i.correlationId})` : ''}`); }
  };
  return (
    <>
      {error && <p className="ff-error" role="alert">{error}</p>}
      <ul className="dd-pending">
        {pending.map((p) => (
          <li key={p.id} data-testid="dd-pending-item">
            <strong>{p.remove ? 'Remove' : 'Set'} the default of {p.role}</strong>{!p.remove && `, ${p.widgets} widget${p.widgets === 1 ? '' : 's'}`}
            <span className="muted small"> raised by {p.requestedBy} on {formatDateTime(p.requestedAt)}. Reason: {p.reason}</span>
            {p.requestedBy === me
              ? <span className="muted small"> You raised it, so another administrator must decide.</span>
              : (
                <span className="dd-decide">
                  <input aria-label={`Comment on request ${p.id}`} placeholder="Comment (needed to reject)" value={comment[p.id] ?? ''} onChange={(e) => setComment({ ...comment, [p.id]: e.target.value })} />
                  <button type="button" className="btn btn-small btn-primary" disabled={decide.isPending} onClick={() => act(p, 'approve')}>Approve</button>
                  <button type="button" className="btn btn-small btn-danger" disabled={decide.isPending || !(comment[p.id] ?? '').trim()} onClick={() => act(p, 'reject')}>Reject</button>
                </span>
              )}
          </li>
        ))}
      </ul>
    </>
  );
}

function History({ code, role }) {
  const h = useRoleHistory(code, role);
  if (h.isPending) return <p className="muted">Loading history...</p>;
  if (!h.data?.length) return <p className="muted">No changes recorded for this role yet.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Reason</th></tr></thead>
        <tbody>{h.data.map((a) => <tr key={a.id}><td>{formatDateTime(a.at)}</td><td>{a.actor}</td><td>{a.action}{a.newValues?.widgets ? `: ${a.newValues.widgets.length} widgets` : ''}</td><td>{a.reason ?? ''}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export default function DashboardDesignerPage({ session }) {
  useEffect(() => { document.title = 'Dashboard Designer - Administration - ERP'; }, []);
  const list = useDashboardList();
  const [code, setCode] = useState('my-work');
  const [role, setRole] = useState('');
  const [draft, setDraft] = useState(null);
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState(null);
  const [filters, setFilters] = useState({ projectId: null, siteId: null, preset: 'this-fy' });
  const ctx = useContextOptions(true);
  const presets = useMemo(() => datePresets(todayIst()), []);
  const designer = useRoleDefaults(code);
  const propose = useProposeRoleDefault(code);
  const current = designer.data?.roles.find((r) => r.role === role) ?? null;
  const pendingForRole = designer.data?.pending.some((p) => p.role === role);

  useEffect(() => { setDraft(null); setMessage(null); }, [code, role]);
  useEffect(() => { if (!role && designer.data?.roleCodes.length) setRole(designer.data.roleCodes[0].code); }, [designer.data, role]);

  // 166.1 F-03: a person without the right is told so before any of the designer is drawn (the server refuses the data as well)
  if (!session?.permissions?.includes('ui.dashboard.manage')) return <NoPermission what="the Dashboard Designer" permission="ui.dashboard.manage" />;
  const gate = [list, designer].find((q) => q.isPending || q.isError);
  if (gate) return <section aria-labelledby="page-title"><h1 id="page-title">Dashboard Designer</h1><QueryState query={gate} what="the dashboard designer" permission="ui.dashboard.manage" /></section>;

  const base = current?.layout ?? designer.data.system.layout;
  const layout = draft ?? base;
  const dirty = draft !== null && (!current || !sameLayout(draft, current.layout) || (name && name !== current.name));
  const incomplete = layout.some((i) => i.widget === 'notice.text' && !i.params?.text?.trim());
  const submit = async (remove) => {
    setMessage(null);
    try {
      const r = await propose.mutateAsync({ role, ...(remove ? { remove: true } : { layout: layout.map(fit), ...(name ? { name } : {}), filters: {} }), reason });
      setMessage({ tone: 'success', text: `Request ${r.id} is waiting for another administrator to approve.` });
      setDraft(null);
      setReason('');
    } catch (err) {
      const i = errorInfo(err);
      setMessage({ tone: 'error', text: `${i.form}${Object.values(i.fields).length ? ` ${Object.entries(i.fields).map(([f, m]) => `${f}: ${m}`).join('; ')}` : ''}${i.correlationId ? ` (Correlation ID ${i.correlationId})` : ''}` });
    }
  };
  const exportLayout = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ dashboard: code, role, layout: layout.map(fit) }, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: `dashboard-${code}-${role}.json` }).click();
    URL.revokeObjectURL(url);
  };
  const importLayout = async (file) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!validLayout(parsed.layout)) throw new Error('shape');
      setDraft(parsed.layout.map(fit));
      setMessage({ tone: 'info', text: `Layout of ${parsed.layout.length} places loaded from the file. Check it, then ask for the change.` });
    } catch { setMessage({ tone: 'error', text: 'That file is not a dashboard layout exported from this designer.' }); }
  };

  return (
    <section aria-labelledby="page-title" className="dash dd" data-testid="designer">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Dashboard Designer</nav>
      <div className="page-head"><h1 id="page-title">Dashboard Designer</h1></div>
      <p className="muted">Set the dashboard that people of a role see until they arrange one of their own. A change is a request: another administrator approves it, and it is recorded with your reason.</p>
      {message && <Banner tone={message.tone === 'error' ? 'error' : message.tone === 'info' ? 'info' : 'success'} testId="dd-message" onClose={() => setMessage(null)}>{message.text}</Banner>}
      <div className="dd-pick">
        <label>Dashboard
          <select value={code} onChange={(e) => setCode(e.target.value)} data-testid="dd-dashboard">
            {list.data.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
          </select>
        </label>
        <label>Role
          <select value={role} onChange={(e) => setRole(e.target.value)} data-testid="dd-role">
            {designer.data.roleCodes.map((r) => <option key={r.code} value={r.code}>{r.code} {r.name}</option>)}
          </select>
        </label>
        <p className="muted small" data-testid="dd-state">
          {current ? `${role} has its own default, version ${current.version}, last changed by ${current.updatedBy ?? 'the system'}.` : `${role} has no default of its own, so its people see the standard layout.`}
          {pendingForRole ? ' A change is already waiting for approval.' : ''}
        </p>
      </div>

      <h2>Layout</h2>
      <div className="dd-tools">
        <label className="dash-add">Add a widget
          <select value="" onChange={(e) => { const w = designer.data.catalogue.find((c) => c.code === e.target.value); if (w) setDraft(addWidget(layout, w, w.paramsKey === 'notice.text' ? { text: '' } : w.paramsKey === 'requests.top' ? { limit: 5 } : {})); }} data-testid="dd-add">
            <option value="">Choose...</option>
            {designer.data.catalogue.map((w) => <option key={w.code} value={w.code}>{w.title}</option>)}
          </select>
        </label>
        <button type="button" className="btn" onClick={exportLayout}>Export layout</button>
        <label className="btn dd-import">Import layout<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => { if (e.target.files[0]) importLayout(e.target.files[0]); e.target.value = ''; }} /></label>
        {draft !== null && <button type="button" className="btn" onClick={() => setDraft(null)}>Discard changes</button>}
      </div>
      <FilterBar filters={filters} onChange={setFilters} options={ctx.data} presets={presets} />
      <p className="muted small">The preview shows your own data. Drag a widget by its title or use its buttons to arrange it.</p>
      <DashboardGrid layout={layout} catalogue={designer.data.catalogue} filters={filters} presets={presets} edit onChange={setDraft} onDrill={(to) => navigateTo(to)} />

      <form className="dd-request" onSubmit={(e) => { e.preventDefault(); submit(false); }} aria-label="Request a change">
        <h2>Ask for the change</h2>
        <label>Name shown to the role (optional)<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={current?.name ?? designer.data.name} /></label>
        <label>Reason
          <textarea value={reason} rows={2} maxLength={500} onChange={(e) => setReason(e.target.value)} required data-testid="dd-reason" aria-describedby="dd-reason-hint" />
          <span id="dd-reason-hint" className="muted small">At least 5 characters. It is kept with the approval.</span>
        </label>
        <div className="dd-buttons">
          <button type="submit" className="btn btn-primary" disabled={!dirty || incomplete || reason.trim().length < 5 || propose.isPending || pendingForRole} data-testid="dd-submit">Request this default for {role}</button>
          {current && <button type="button" className="btn btn-danger" disabled={reason.trim().length < 5 || propose.isPending || pendingForRole} onClick={() => submit(true)}>Request removal of the default</button>}
        </div>
        {incomplete && <p className="field-error">A notice needs its text.</p>}
      </form>

      <h2>Waiting for approval</h2>
      <Pending pending={designer.data.pending} me={session?.user} code={code} />
      <h2>History of {role}</h2>
      <History code={code} role={role} />
    </section>
  );
}
