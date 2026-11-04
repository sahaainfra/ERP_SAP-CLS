import { useMemo, useRef, useState } from 'react';
import Chart from '../../platform/charts/Chart.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { authHeaders } from '../../platform/api/index.js';
import { formatDateTime } from '../../platform/format.js';
import { exportUrl, useAddDefect, useDecideRoute, usePendingRoutes, useProposeRoute, useResolveDefect, useSignoff, useTracker, useTransition } from '../../platform/migration/api.js';
import { Field, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import Icon from '../../platform/design/Icon.jsx';

// Screen Migration Tracker (part 03.10, FR-06, FR-07, BR-02): a report of how far the pages of the application are onto the design system. A parameter
// panel (module, status, page type, words, open defects), the progress by module as a chart that drills into the table, the table with totals, the details
// of a page (defects, its old address, verification), the sign-off of a module by its owner, and the export. A page is Verified by its owner, never by the
// person who migrated it; the old address of a page is a redirect that another system administrator approves.

const STATUS = { NOT_STARTED: 'Not started', MIGRATED: 'Migrated', VERIFIED: 'Verified', SCHEDULED: 'Scheduled' };
const TONE = { NOT_STARTED: 'neutral', MIGRATED: 'info', VERIFIED: 'success', SCHEDULED: 'warning' };
const MODULE = { core: 'Core platform', iam: 'People and access', ui: 'Design system and shell' };
const TYPE = { DASHBOARD: 'Dashboard', LIST: 'List report', OBJECT: 'Object page', FORM: 'Form', WORKLIST: 'Worklist', REPORT: 'Report' };

function Details({ page, dialogRef, canSign, onDone }) {
  const addDefect = useAddDefect();
  const resolve = useResolveDefect();
  const transition = useTransition();
  const route = useProposeRoute();
  const [error, setError] = useState(null);
  const [scheduling, setScheduling] = useState(false);
  if (!page) return <dialog ref={dialogRef} className="dialog" aria-label="Page details" />;
  const fail = (e) => setError(errorInfo(e));
  const run = (mutation, body, message) => mutation.mutate({ code: page.code, version: page.version, ...body }, { onSuccess: (r) => { setError(null); onDone(message(r)); }, onError: fail });
  return (
    <dialog ref={dialogRef} className="dialog dialog-wide" aria-labelledby="mt-d-title">
      <h2 id="mt-d-title">{page.label}</h2>
      <p className="muted small"><code>{page.code}</code> · {MODULE[page.module]} · {TYPE[page.type]} · owner {page.ownerRole} · migrated in part {page.migratedInPart ?? 'n/a'}{page.migratedBy ? ` by ${page.migratedBy}` : ''}</p>
      <p><StatusBadge status={TONE[page.status] === 'success' ? 'approved' : page.status === 'SCHEDULED' ? 'returned' : page.status === 'MIGRATED' ? 'submitted' : 'draft'} label={STATUS[page.status]} />
        {page.verifiedBy && <> verified by {page.verifiedBy} on {formatDateTime(page.verifiedAt)}</>}{page.scheduledPart && <> to be rebuilt in part {page.scheduledPart}</>}</p>
      <p>Address <code>{page.newRoute}</code>{page.redirects && <>, reached from the old address <code>{page.oldRoute}</code></>}</p>
      {page.notes && <p className="muted small">{page.notes}</p>}
      {error && <div role="alert" className="state state-error"><p>{error.form}</p>{error.correlationId && <p className="muted small">Correlation ID: <code>{error.correlationId}</code></p>}</div>}
      <h3>Defects</h3>
      {page.defects.length === 0 ? <p className="muted">No defects were found on this page.</p> : (
        <ul className="lp-list">
          {page.defects.map((d) => (
            <li key={d.id}><strong>{d.id}</strong> <span className={d.status === 'OPEN' ? '' : 'muted'}>{d.severity}: {d.text}</span> <span className="muted small">({d.status === 'OPEN' ? `for ${d.ownerPart}` : `resolved: ${d.note}`})</span>
              {d.status === 'OPEN' && canSign && (
                <form className="srch-meta" onSubmit={(e) => { e.preventDefault(); const note = String(new FormData(e.currentTarget).get('note')); run(resolve, { defectId: d.id, note }, () => `Defect ${d.id} resolved.`); }}>
                  <input name="note" aria-label={`What was done about ${d.id}`} placeholder="What was done" required minLength={5} maxLength={300} /><button type="submit" className="btn btn-small" disabled={resolve.isPending}>Resolve {d.id}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canSign && (
        <>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run(addDefect, { text: String(f.get('text')), severity: String(f.get('severity')), ownerPart: String(f.get('ownerPart')) }, () => 'Defect added.'); e.currentTarget.reset(); }}>
            <Field label="A defect found on this page" name="text" error={error}><input name="text" required minLength={5} maxLength={300} /></Field>
            <Field label="Severity" name="severity" error={error}><select name="severity" defaultValue="Medium">{['Low', 'Medium', 'High', 'Critical'].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Part that owns the fix" name="ownerPart" error={error}><input name="ownerPart" required maxLength={60} defaultValue={page.migratedInPart ?? ''} /></Field>
            <div className="actions"><button type="submit" className="btn" disabled={addDefect.isPending}>Add defect</button></div>
          </form>
          <h3>Status</h3>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const to = String(f.get('to')); run(transition, { to, reason: String(f.get('reason')), ...(to === 'SCHEDULED' ? { scheduledPart: String(f.get('scheduledPart')) } : {}) }, (r) => `${page.label} is now ${STATUS[r.status].toLowerCase()}.`); }}>
            <Field label="Change to" name="to" error={error}>
              <select name="to" defaultValue={page.status === 'MIGRATED' ? 'VERIFIED' : 'MIGRATED'} onChange={(e) => setScheduling(e.target.value === 'SCHEDULED')}>
                <option value="VERIFIED">Verified (checked with the business user)</option><option value="MIGRATED">Migrated (reopen)</option><option value="SCHEDULED">Scheduled to another part</option>
              </select>
            </Field>
            {scheduling && <Field label="Part that will rebuild it" name="scheduledPart" error={error}><input name="scheduledPart" pattern="\d\d\.\d\d" placeholder="04.08" required /></Field>}
            <Field label="Reason or what was checked" name="reason" error={error}><input name="reason" required minLength={5} maxLength={500} /></Field>
            <div className="actions"><button type="submit" className="btn btn-primary" disabled={transition.isPending}>Change status</button></div>
          </form>
          <h3>Old address</h3>
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run(route, { oldRoute: String(f.get('oldRoute')), reason: String(f.get('reason')) }, (r) => `Request ${r.id} raised. Another system administrator must approve it before the old address redirects.`); }}>
            <Field label="Address that should lead here" name="oldRoute" error={error} hint={`Give ${page.newRoute} itself to take a redirect away.`}><input name="oldRoute" required defaultValue={page.oldRoute} maxLength={200} /></Field>
            <Field label="Reason" name="reason" error={error}><input name="reason" required minLength={5} maxLength={500} /></Field>
            <div className="actions"><button type="submit" className="btn" disabled={route.isPending}>Request this address</button></div>
          </form>
        </>
      )}
      <div className="actions"><button type="button" className="btn" onClick={() => dialogRef.current?.close()}>Close</button></div>
    </dialog>
  );
}

function PendingRoutes({ me }) {
  const pending = usePendingRoutes();
  const decide = useDecideRoute();
  const [comment, setComment] = useState({});
  if (!pending.data || pending.data.length === 0) return null;
  return (
    <section aria-labelledby="mt-pending"><h2 id="mt-pending">Old addresses waiting for approval</h2>
      <table className="grid" aria-label="Old addresses waiting for approval">
        <thead><tr><th>Page</th><th>Address</th><th>Requested by</th><th>Reason</th><th>Decision</th></tr></thead>
        <tbody>
          {pending.data.map((p) => (
            <tr key={p.id}>
              <td data-label="Page"><code>{p.code}</code></td><td data-label="Address"><code>{p.oldRoute}</code></td><td data-label="Requested by">{p.requestedBy}</td><td data-label="Reason">{p.reason}</td>
              <td data-label="Decision">
                {p.requestedBy === me ? <span className="muted">Waiting for another administrator</span> : (
                  <>
                    <input aria-label={`Comment for request ${p.id}`} placeholder="Comment (needed to reject)" value={comment[p.id] ?? ''} onChange={(e) => setComment({ ...comment, [p.id]: e.target.value })} />
                    <button type="button" className="btn btn-small btn-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, action: 'approve', comment: comment[p.id] || 'Approved' })}>Approve</button>
                    <button type="button" className="btn btn-small btn-danger" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, action: 'reject', comment: comment[p.id] ?? '' })}>Reject</button>
                    {decide.isError && decide.variables?.id === p.id && <span className="field-error" role="alert">{errorInfo(decide.error).form}</span>}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function MigrationTrackerPage({ session }) {
  usePageTitle('Screen Migration Tracker');
  const [filters, setFilters] = useState({ module: '', status: '', type: '', q: '', defects: '' });
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(null);
  const [signoff, setSignoff] = useState(null);
  const [signoffError, setSignoffError] = useState(null);
  const dialog = useRef(null);
  const signoffDialog = useRef(null);
  const tracker = useTracker(filters);
  const sign = useSignoff();
  const data = tracker.data;
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const current = open && data?.rows.find((r) => r.code === open);
  const chart = useMemo(() => data && ({
    categories: data.summary.byModule.map((m) => MODULE[m.module]),
    series: [['verified', 'Verified'], ['migrated', 'Migrated'], ['scheduled', 'Scheduled'], ['notStarted', 'Not started']].map(([k, name]) => ({ name, values: data.summary.byModule.map((m) => m[k]), drill: data.summary.byModule.map((m) => `#module=${m.module}&status=${({ verified: 'VERIFIED', migrated: 'MIGRATED', scheduled: 'SCHEDULED', notStarted: 'NOT_STARTED' })[k]}`) })),
    unit: 'pages',
  }), [data]);
  const drill = (to) => { const p = new URLSearchParams(String(to).replace(/^#/, '')); set({ module: p.get('module') ?? '', status: p.get('status') ?? '' }); };
  const download = async (format) => {
    const res = await fetch(exportUrl(format, { module: filters.module, status: filters.status, type: filters.type, q: filters.q, defects: filters.defects }), { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { setNotice('The export could not be prepared.'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `screen-migration.${format}` }).click();
    URL.revokeObjectURL(url);
  };
  const submitSignoff = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    sign.mutate({ module: signoff, comment: String(f.get('comment')) }, {
      onSuccess: (r) => { setNotice(`${MODULE[r.module]}: ${r.verified.length} page(s) verified${r.skipped.length ? `, ${r.skipped.length} left: ${r.skipped.map((s) => `${s.code} (${s.reason})`).join('; ')}` : ''}.`); signoffDialog.current?.close(); setSignoff(null); },
      onError: (err) => setSignoffError(errorInfo(err)),
    });
  };

  if (tracker.error?.status === 403) return <NoPermission what="the Screen Migration Tracker" permission="ui.migration.view" />;
  const t = data?.summary.totals;
  const pct = t && t.total ? Math.round(((t.migrated + t.verified + t.scheduled) / t.total) * 100) : 0;
  const rows = data?.rows ?? [];
  return (
    <section aria-labelledby="mt-title" data-testid="migration-tracker">
      <h1 id="mt-title">Screen Migration Tracker</h1>
      <p className="muted">How far each page of the application is on the design system. A page is Verified only after it passes the page checklist and its owner has checked it with a business user; the person who migrated a page cannot verify it.</p>
      {notice && <p role="status" className="notice" data-testid="mt-notice">{notice}</p>}
      {tracker.isPending && <Skeleton label="Loading the tracker" rows={5} />}
      {tracker.isError && tracker.error?.status !== 403 && <ErrorState title="The tracker could not be loaded" error={tracker.error} onRetry={() => tracker.refetch()} />}
      {data && (
        <>
          <ul className="srch-meta" aria-label="Progress" data-testid="mt-progress">
            <li><strong data-testid="mt-total">{t.total}</strong> pages</li><li><strong>{t.verified}</strong> verified</li><li><strong>{t.migrated}</strong> migrated</li><li><strong>{t.scheduled}</strong> scheduled</li><li><strong>{t.notStarted}</strong> not started</li>
            <li><strong>{pct}%</strong> migrated, verified or scheduled</li><li><strong data-testid="mt-defects">{t.openDefects}</strong> open defects</li><li><strong>{t.redirects}</strong> old addresses redirect</li>
          </ul>
          <div className="wd-body" style={{ maxWidth: '44rem' }}><Chart type="stacked" data={chart} title="Pages by module and status" onDrill={drill} exportName="migration-progress" /></div>
          <PendingRoutes me={session?.user} />
          <form className="srch-form" aria-label="Report parameters" role="search" onSubmit={(e) => e.preventDefault()}>
            <label className="field"><span>Module</span><select value={filters.module} onChange={(e) => set({ module: e.target.value })}><option value="">All modules</option>{data.modules.map((m) => <option key={m} value={m}>{MODULE[m]}</option>)}</select></label>
            <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option>{data.statuses.map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}</select></label>
            <label className="field"><span>Page type</span><select value={filters.type} onChange={(e) => set({ type: e.target.value })}><option value="">Any type</option>{data.types.map((x) => <option key={x} value={x}>{TYPE[x]}</option>)}</select></label>
            <label className="field"><span>Name or address</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
            <label className="check"><input type="checkbox" checked={filters.defects === 'open'} onChange={(e) => set({ defects: e.target.checked ? 'open' : '' })} /> Only pages with open defects</label>
          </form>
          <div className="srch-tools">
            <button type="button" className="btn" onClick={() => download('xlsx')}><Icon name="erp.action.export" size={16} /> Export XLSX</button>
            <button type="button" className="btn" onClick={() => download('csv')}><Icon name="erp.action.export" size={16} /> Export CSV</button>
            {data.canSignOff && data.modules.map((m) => <button key={m} type="button" className="btn" onClick={() => { setSignoff(m); setSignoffError(null); setTimeout(() => signoffDialog.current?.showModal(), 0); }}>Sign off {MODULE[m]}</button>)}
            {(filters.module || filters.status || filters.type || filters.q || filters.defects) && <button type="button" className="btn" onClick={() => setFilters({ module: '', status: '', type: '', q: '', defects: '' })}>Clear filters</button>}
          </div>
          {rows.length === 0 ? <EmptyState title="No page matches" message="Change the parameters above." action={{ label: 'Clear filters', onClick: () => setFilters({ module: '', status: '', type: '', q: '', defects: '' }) }} /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Pages">
              <table className="grid">
                <thead><tr><th>Page</th><th>Module</th><th>Type</th><th>Address</th><th>Status</th><th className="num">Open defects</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code} data-testid={`mt-row-${r.code}`}>
                      <th scope="row" data-label="Page">{r.label}<br /><code className="small">{r.code}</code></th>
                      <td data-label="Module">{MODULE[r.module]}</td><td data-label="Type">{TYPE[r.type]}</td>
                      <td data-label="Address"><code>{r.newRoute}</code>{r.redirects && <><br /><span className="muted small">from <code>{r.oldRoute}</code></span></>}</td>
                      <td data-label="Status"><StatusBadge status={r.status === 'VERIFIED' ? 'approved' : r.status === 'SCHEDULED' ? 'returned' : r.status === 'MIGRATED' ? 'submitted' : 'draft'} label={STATUS[r.status]} />{r.scheduledPart && <span className="muted small"> to {r.scheduledPart}</span>}</td>
                      <td className="num" data-label="Open defects">{r.openDefects}</td>
                      <td><button type="button" className="btn btn-small" aria-label={`Details of ${r.label}`} onClick={() => { setOpen(r.code); setTimeout(() => dialog.current?.showModal(), 0); }}>Details</button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><th scope="row" colSpan={5}>Total of the {rows.length} page(s) shown</th><td className="num" data-testid="mt-shown-defects">{rows.reduce((n, r) => n + r.openDefects, 0)}</td><td /></tr></tfoot>
              </table>
            </div>
          )}
          <p className="muted small">Scheduling this report by e-mail comes with the report service (part 04.x); until then it is exported from this page.</p>
        </>
      )}
      <Details key={current?.code ?? 'none'} page={current} dialogRef={dialog} canSign={data?.canSignOff} onDone={setNotice} />
      <dialog ref={signoffDialog} className="dialog" aria-labelledby="mt-so-title">
        <form onSubmit={submitSignoff} method="dialog">
          <h2 id="mt-so-title">Sign off {signoff ? MODULE[signoff] : ''}</h2>
          <p>Every migrated page of the module without a High or Critical defect becomes Verified, in your name. Pages you migrated yourself and pages with a blocking defect are left and listed. Only the owner of the module can do this.</p>
          <label className="field"><span>What was checked, and with whom</span><input name="comment" required minLength={5} maxLength={500} /></label>
          {signoffError && <p role="alert" className="error">{signoffError.form}{signoffError.correlationId && <> (<code>{signoffError.correlationId}</code>)</>}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => signoffDialog.current?.close()}>Cancel</button><button type="submit" className="btn btn-primary" disabled={sign.isPending}>Sign off</button></div>
        </form>
      </dialog>
    </section>
  );
}
