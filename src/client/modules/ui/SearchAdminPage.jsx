import { useEffect, useRef, useState } from 'react';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { useReindex, useSearchAnalytics, useSearchStatus } from '../../platform/search/api.js';
import { formatDateTime } from '../../platform/format.js';
import { ApiError } from '../../platform/api/index.js';
import { can } from '../core/pages/ui.jsx';

// Search Administration (part 03.08, BR-02, FR-06): how complete the search index is for each kind of record, the rebuild of one kind or all of them
// (a background job with progress, for the IT administrator), and the analytics of what people searched for, with the searches that found nothing.

const JOB_TONE = { QUEUED: 'info', RUNNING: 'info', SUCCEEDED: 'success', FAILED: 'error', CANCELLED: 'muted' };

export default function SearchAdminPage({ session }) {
  useEffect(() => { document.title = 'Search Administration - ERP'; }, []);
  const [days, setDays] = useState(30);
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef(null);
  const status = useSearchStatus();
  const analytics = useSearchAnalytics(days);
  const reindex = useReindex();
  const mayRebuild = can(session, 'ui.search.reindex');

  if (status.isError && status.error instanceof ApiError && status.error.status === 403) return <NoPermission what="Search Administration" permission="ui.search.analytics" />;
  const ask = (entity, label) => { setTarget({ entity, label }); setReason(''); reindex.reset(); dialog.current?.showModal(); };
  const submit = async (e) => {
    e.preventDefault();
    try {
      await reindex.mutateAsync({ entity: target.entity, reason: reason.trim() });
      setNotice(`Rebuild of ${target.label} queued. It runs in the background; the list below shows its progress.`);
      dialog.current?.close();
    } catch { /* shown in the dialog */ }
  };
  const a = analytics.data;
  return (
    <section aria-labelledby="sa-title" data-testid="search-admin">
      <h1 id="sa-title">Search Administration</h1>
      <p className="muted">The search index keeps the words of each record so people can find it fast. It follows changes by itself; rebuild a kind only after an import, a restore or when results look wrong. Every rebuild is recorded with its reason.</p>
      {notice && <p role="status" className="notice">{notice}</p>}

      <h2>Index</h2>
      {status.isPending && <Skeleton label="Loading the index status" rows={3} />}
      {status.isError && !(status.error instanceof ApiError && status.error.status === 403) && <ErrorState title="The index status could not be loaded" error={status.error} onRetry={() => status.refetch()} />}
      {status.data && (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Search index by kind of record">
          <table className="data">
            <thead><tr><th>Kind of record</th><th className="num">Records</th><th className="num">In the index</th><th className="num">Waiting to be indexed</th><th>Last indexed</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {status.data.types.map((t) => (
                <tr key={t.type}>
                  <th scope="row" data-label="Kind">{t.label}</th>
                  <td className="num" data-label="Records">{t.source}</td>
                  <td className="num" data-label="In the index">{t.indexed}</td>
                  <td className="num" data-label="Waiting">{t.behind > 0 ? <strong>{t.behind}</strong> : 0}</td>
                  <td data-label="Last indexed">{t.lastIndexedAt ? formatDateTime(t.lastIndexedAt) : 'Never'}</td>
                  <td>{mayRebuild && <button type="button" className="btn btn-small" onClick={() => ask(t.type, t.label)} aria-label={`Rebuild ${t.label}`}>Rebuild</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {mayRebuild && <p><button type="button" className="btn" onClick={() => ask('all', 'every kind of record')}>Rebuild all</button></p>}
          {!mayRebuild && <p className="muted small">Rebuilding is for the IT administrator (ui.search.reindex).</p>}
        </div>
      )}

      <h2>Rebuilds</h2>
      {status.data?.jobs.length === 0 && <EmptyState compact title="No rebuilds yet" message="A rebuild appears here with its progress and result." />}
      {status.data?.jobs.length > 0 && (
        <ul className="srch-list">
          {status.data.jobs.map((j) => (
            <li key={j.id} className="srch-row">
              <div className="srch-body"><strong>{j.type === 'ui.search_reindex' ? `Rebuild ${(j.params.types ?? []).join(', ')}` : 'Catch-up of changes'}</strong>
                <span className="muted small">{j.createdBy} · {formatDateTime(j.createdAt)}{j.message ? ` · ${j.message}` : ''}{j.error ? ` · ${j.error}` : ''}</span></div>
              {['QUEUED', 'RUNNING'].includes(j.status) && <progress max="100" value={j.progress ?? 0} aria-label="Progress" />}
              <StatusBadge status={j.status} tone={JOB_TONE[j.status]} />
            </li>
          ))}
        </ul>
      )}

      <h2>What people searched for</h2>
      <label className="field field-inline"><span>Period</span><select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select></label>
      {analytics.isPending && <Skeleton label="Loading the analytics" rows={3} />}
      {analytics.isError && <ErrorState title="The analytics could not be loaded" error={analytics.error} onRetry={() => analytics.refetch()} />}
      {a && a.searches === 0 && <EmptyState compact title="No searches in this period" message="Searches appear here after people use the palette or Advanced Search." />}
      {a && a.searches > 0 && (
        <>
          <ul className="srch-meta" aria-label="Summary">
            <li><strong data-testid="sa-searches">{a.searches}</strong> searches</li>
            <li><strong>{a.noResultRate}%</strong> found nothing ({a.noResult})</li>
            <li><strong>{a.withClick}</strong> opened a result</li>
            <li>median <strong>{a.p50Ms} ms</strong>, slowest 1 in 20 <strong>{a.p95Ms} ms</strong></li>
          </ul>
          <div className="srch-two">
            <div><h3>Searches that found nothing</h3>
              {a.noResultTop.length === 0 ? <p className="muted">Every search found something.</p> : (
                <table className="data"><thead><tr><th>Typed</th><th className="num">Times</th><th className="num">People</th></tr></thead>
                  <tbody>{a.noResultTop.map((r) => <tr key={r.q}><td data-label="Typed">{r.q}</td><td className="num" data-label="Times">{r.searches}</td><td className="num" data-label="People">{r.people}</td></tr>)}</tbody></table>
              )}
            </div>
            <div><h3>Most searched</h3>
              <table className="data"><thead><tr><th>Typed</th><th className="num">Times</th><th className="num">Avg results</th><th className="num">Opened</th></tr></thead>
                <tbody>{a.top.map((r) => <tr key={r.q}><td data-label="Typed">{r.q}</td><td className="num" data-label="Times">{r.searches}</td><td className="num" data-label="Avg results">{r.avgResults}</td><td className="num" data-label="Opened">{r.clicks}</td></tr>)}</tbody></table>
            </div>
          </div>
          <p className="muted small">What people type can include names. It is kept only for the retention period (parameter ui.search.retention_days) and shown here without who typed it.</p>
        </>
      )}

      <dialog ref={dialog} className="dialog" aria-labelledby="rb-title">
        <form onSubmit={submit} method="dialog">
          <h2 id="rb-title">Rebuild {target?.label}</h2>
          <p>The index of {target?.label} is read again from the records. Search keeps working meanwhile. Say why, so the record of the rebuild makes sense later.</p>
          <label className="field"><span>Reason</span><input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={300} required /></label>
          {reindex.isError && <p role="alert" className="error">{reindex.error.message}{reindex.error.correlationId && <> (Correlation ID: <code>{reindex.error.correlationId}</code>)</>}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => dialog.current?.close()}>Cancel</button><button type="submit" className="btn btn-primary" disabled={reason.trim().length < 5 || reindex.isPending}>Rebuild</button></div>
        </form>
      </dialog>
    </section>
  );
}
