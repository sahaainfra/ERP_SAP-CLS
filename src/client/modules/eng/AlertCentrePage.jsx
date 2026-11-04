import { useState } from 'react';
import Icon from '../../platform/design/Icon.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { alertsUrl, authHeaders, useAlertAct, useAlertBulk, useAlertSummary, useAlerts } from '../../platform/alerts/api.js';
import { Field, Link, Tile, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { ALERT_STATUS, SEVERITY } from './alerts-common.js';

// Alert Centre (part 04.09, section 7.3): the alerts that concern you, and the alerts of the projects you manage, with the most serious and the oldest first. An alert is acknowledged ("I have seen it")
// and then resolved with a note saying what was done; several can be acknowledged together. A rule that raises the same alert again within its window does not make a second one.
const EMPTY = { status: 'open', severity: '', rule: '', q: '' };
const PAGE = 25;

export default function AlertCentrePage() {
  usePageTitle('Alert Centre');
  const [view, setView] = useState('mine');
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState([]);
  const [resolving, setResolving] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const sum = useAlertSummary();
  const list = useAlerts({ view, ...filters, limit: PAGE, offset: (page - 1) * PAGE });
  const act = useAlertAct();
  const bulk = useAlertBulk();
  const download = async (format) => {
    const res = await fetch(alertsUrl(format, { view, status: filters.status }), { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { setNotice('The export could not be prepared.'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `alerts.${format}` }).click();
    URL.revokeObjectURL(url);
  };
  if (list.error?.status === 403 && view === 'project') { setView('mine'); }
  if (list.error?.status === 403 && view !== 'project') return <NoPermission what="these alerts" permission="alr.alert.view" />;
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE)) : 1;
  const set = (p) => { setFilters((f) => ({ ...f, ...p })); setPage(1); setPicked([]); };
  const run = (id, action, text) => { setError(null); act.mutate({ id, action, note: text }, { onSuccess: () => { setNotice(action === 'ack' ? 'Acknowledged.' : 'Resolved.'); setResolving(null); setNote(''); setPicked((p) => p.filter((x) => x !== id)); }, onError: (e) => setError(errorInfo(e)) }); };
  const doBulk = () => { setError(null); bulk.mutate({ ids: picked, action: 'ack' }, { onSuccess: (r) => { setNotice(`${r.done.length} acknowledged${r.failed.length ? `, ${r.failed.length} could not be (${r.failed[0].message})` : ''}.`); setPicked([]); }, onError: (e) => setError(errorInfo(e)) }); };
  const s = sum.data;
  const rows = d?.rows ?? [];
  const actable = rows.filter((a) => a.canAct && a.status === 'OPEN');
  return (
    <section aria-labelledby="ac-title" data-testid="alert-centre">
      <h1 id="ac-title">Alert Centre</h1>
      <p className="muted">What needs your attention: expiries, overdue items, thresholds and anything else the rules watch. Acknowledge what you have seen; resolve it when it is dealt with.</p>
      {notice && <p role="status" className="notice" data-testid="ac-notice">{notice}</p>}
      {error?.form && <p role="alert" className="error" data-testid="ac-error">{error.form}</p>}
      {s && <div className="tiles" data-testid="alert-tiles">
        <Tile label="Open for me" value={s.mine} status={s.mine ? 'warning' : 'success'} testId="tile-mine" />
        <Tile label="Critical for me" value={s.mineCritical} status={s.mineCritical ? 'danger' : 'success'} testId="tile-critical" />
        <Tile label="Not yet seen" value={s.mineNew} testId="tile-new" />
      </div>}
      <div className="srch-tools">
        <div role="tablist" aria-label="Whose alerts">
          <button type="button" role="tab" aria-selected={view === 'mine'} className={`btn${view === 'mine' ? ' btn-primary' : ''}`} onClick={() => { setView('mine'); setPage(1); setPicked([]); }}>My alerts</button>
          {s?.canViewProject && <button type="button" role="tab" aria-selected={view === 'project'} className={`btn${view === 'project' ? ' btn-primary' : ''}`} onClick={() => { setView('project'); setPage(1); setPicked([]); }}>Project alerts</button>}
        </div>
        <button type="button" className="btn" onClick={() => download('xlsx')}><Icon name="erp.action.export" size={16} /> Export XLSX</button>
        <button type="button" className="btn" onClick={() => download('csv')}>Export CSV</button>
        <button type="button" className="btn" onClick={() => download('pdf')}>Export PDF</button>
      </div>
      <form className="srch-form" role="search" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any</option><option value="open">Not resolved</option>{Object.entries(ALERT_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Severity</span><select value={filters.severity} onChange={(e) => set({ severity: e.target.value })}><option value="">Any</option>{Object.entries(SEVERITY).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Rule</span><input value={filters.rule} onChange={(e) => set({ rule: e.target.value.trim() })} placeholder="task.overdue" /></label>
        <label className="field"><span>Words</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
        {JSON.stringify(filters) !== JSON.stringify(EMPTY) && <button type="button" className="btn" onClick={() => set(EMPTY)}>Clear filters</button>}
      </form>
      {picked.length > 0 && <div className="srch-tools" role="group" aria-label="For the chosen alerts"><span>{picked.length} chosen</span><button type="button" className="btn" disabled={bulk.isPending} onClick={doBulk}>Acknowledge them</button><button type="button" className="btn" onClick={() => setPicked([])}>Clear the choice</button></div>}
      {resolving && (
        <form className="card wf-inline" aria-label="Resolve the alert" onSubmit={(e) => { e.preventDefault(); run(resolving, 'resolve', note); }}>
          <Field label="What was done about it?" name="resolution" error={error}><input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></Field>
          <button type="submit" className="btn btn-primary" disabled={act.isPending || note.trim().length < 3}>Resolve</button><button type="button" className="btn" onClick={() => setResolving(null)}>Cancel</button>
        </form>)}
      {list.isPending && <Skeleton label="Loading the alerts" rows={4} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The alerts could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {d && (rows.length === 0 ? <EmptyState title="No alert here" message="Nothing needs your attention with these filters. Rules raise alerts as they find something." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Alerts">
          <table className="grid">
            <thead><tr><th><span className="sr-only">Choose</span></th><th>Severity</th><th>Alert</th><th>Record</th><th>Since</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((a) => (
              <tr key={a.id} data-testid={`alert-${a.id}`}>
                <td data-label="Choose">{a.canAct && a.status === 'OPEN' && <input type="checkbox" aria-label={`Choose alert ${a.id}`} checked={picked.includes(a.id)} onChange={() => setPicked(picked.includes(a.id) ? picked.filter((x) => x !== a.id) : [...picked, a.id])} />}</td>
                <td data-label="Severity"><StatusBadge status={SEVERITY[a.severity][0]} label={SEVERITY[a.severity][1]} /></td>
                <th scope="row" data-label="Alert">{a.message}<br /><span className="muted small">{a.ruleCode}{a.occurrences > 1 ? `, raised ${a.occurrences} times` : ''}{a.escalatedAt ? ', escalated' : ''}</span>{a.resolution && <><br /><span className="small">Resolved: {a.resolution}</span></>}</th>
                <td data-label="Record">{a.route ? <Link to={a.route}>{a.label ?? 'Open'}</Link> : a.label}</td>
                <td data-label="Since">{formatDateTime(a.firstSeenAt)}</td>
                <td data-label="Status"><StatusBadge status={ALERT_STATUS[a.status][0]} label={ALERT_STATUS[a.status][1]} />{a.acknowledgedBy && a.status !== 'OPEN' ? <><br /><span className="muted small">{a.acknowledgedBy}</span></> : null}</td>
                <td data-label="Actions">{a.canAct && a.status === 'OPEN' && <button type="button" className="btn btn-small" disabled={act.isPending} onClick={() => run(a.id, 'ack')} aria-label={`Acknowledge alert ${a.id}`}>Acknowledge</button>}
                  {a.canAct && a.status !== 'RESOLVED' && <button type="button" className="btn btn-small" onClick={() => { setResolving(a.id); setNote(''); }} aria-label={`Resolve alert ${a.id}`}>Resolve</button>}</td>
              </tr>))}</tbody>
          </table>
        </div>))}
      {actable.length > 1 && picked.length === 0 && <p className="muted small">Choose several alerts to acknowledge them together.</p>}
      <div className="pager"><span>{d?.total ?? 0} alert(s), page {page} of {pages}</span>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
    </section>
  );
}
