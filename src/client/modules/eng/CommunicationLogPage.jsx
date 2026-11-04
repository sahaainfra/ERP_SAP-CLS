import { useMemo, useState } from 'react';
import Chart from '../../platform/charts/Chart.jsx';
import Icon from '../../platform/design/Icon.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { authHeaders, messagesUrl, useMessage, useMessages, useMessageSummary, useRetryMessage } from '../../platform/comm/api.js';
import { can, errorInfo, usePageTitle } from '../core/pages/ui.jsx';

// Communication Log (part 04.07, section 7.1): every message the gateway sent, received or refused, with its channel, status, route (which connector was tried) and the reason it did not leave.
// Numbers and addresses are partly hidden; a one-time code never appears. A conversation shows what was sent and what came back for one record.
export const STATUS = { QUEUED: ['submitted', 'Queued'], SENDING: ['submitted', 'Sending'], SENT: ['approved', 'Sent'], DELIVERED: ['approved', 'Delivered'], READ: ['approved', 'Read'], FAILED: ['rejected', 'Failed'], BLOCKED: ['returned', 'Blocked'], RECEIVED: ['approved', 'Received'], CANCELLED: ['cancelled', 'Cancelled'] };
export const CHANNEL = { EMAIL: 'E-mail', SMS: 'Text message', WHATSAPP: 'WhatsApp', PUSH: 'Push' };
const EMPTY = { channel: '', status: '', direction: '', from: '', to: '', q: '' };
const PAGE = 25;

function Detail({ id, onClose, session }) {
  const q = useMessage(id);
  const retry = useRetryMessage();
  const [error, setError] = useState(null);
  if (q.isPending) return <Skeleton label="Loading the message" rows={3} />;
  if (q.isError) return <ErrorState title="The message could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data;
  return (
    <section className="card" aria-label={`Message ${m.id}`} data-testid="cl-detail">
      <div className="wf-inline"><h2>Message {m.id}</h2><button type="button" className="btn btn-small" onClick={onClose}>Close</button></div>
      <p><StatusBadge status={STATUS[m.status][0]} label={STATUS[m.status][1]} /> {CHANNEL[m.channel]} {m.direction === 'IN' ? 'received from' : 'to'} {m.to}</p>
      {m.blockReason && <p role="status" className="notice" data-testid="cl-block">Refused: {m.error ?? m.blockReason}</p>}
      {m.error && !m.blockReason && <p className="error small">{m.error}</p>}
      {m.subject && <p><strong>{m.subject}</strong></p>}
      <p className="muted">{m.body}</p>
      {m.route.length > 0 && <>
        <h3>Route</h3>
        <ol aria-label="Connectors tried" data-testid="cl-route">{m.route.map((r, i) => <li key={i}><code>{r.connector}</code>: {r.ok ? 'delivered' : `failed${r.error ? `: ${r.error}` : ''}`}</li>)}</ol>
      </>}
      {m.thread?.length > 1 && <>
        <h3>Conversation</h3>
        <ul aria-label="Conversation" data-testid="cl-thread">{m.thread.map((t) => <li key={t.id}><span className="muted small">{formatDateTime(t.at)}</span> {t.direction === 'IN' ? 'They wrote' : 'We sent'}: {t.body}</li>)}</ul>
      </>}
      {error && <p role="alert" className="error">{error.form}</p>}
      {m.status === 'FAILED' && can(session, 'comm.channel.edit') && <button type="button" className="btn" disabled={retry.isPending} onClick={() => { setError(null); retry.mutate(m.id, { onError: (er) => setError(errorInfo(er)) }); }}>Send again</button>}
    </section>
  );
}

export default function CommunicationLogPage({ session }) {
  usePageTitle('Communication Log');
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState('');
  const list = useMessages({ ...filters, limit: PAGE, offset: (page - 1) * PAGE });
  const sum = useMessageSummary({ from: filters.from, to: filters.to });
  const chart = useMemo(() => sum.data && ({ categories: Object.keys(sum.data.grid).filter((c) => sum.data.grid[c].total).map((c) => CHANNEL[c]), series: ['SENT', 'DELIVERED', 'READ', 'QUEUED', 'BLOCKED', 'FAILED'].map((s) => ({ name: STATUS[s][1], values: Object.keys(sum.data.grid).filter((c) => sum.data.grid[c].total).map((c) => sum.data.grid[c][s]) })) }), [sum.data]);
  const download = async (format) => {
    const res = await fetch(messagesUrl(format, { channel: filters.channel, status: filters.status, from: filters.from, to: filters.to }), { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { setNotice('The export could not be prepared.'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `communication-log.${format}` }).click();
    URL.revokeObjectURL(url);
    setNotice('');
  };
  if (list.error?.status === 403) return <NoPermission what="the communication log" permission="comm.log.view" />;
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE)) : 1;
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const t = sum.data?.totals;
  return (
    <section aria-labelledby="cl-title" data-testid="comm-log">
      <h1 id="cl-title">Communication Log</h1>
      <p className="muted">Every e-mail, text message, WhatsApp message and push the system sent, received or refused, and why. Numbers are partly hidden and codes are never shown.</p>
      {notice && <p role="status" className="notice">{notice}</p>}
      <form className="srch-form" role="search" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Channel</span><select value={filters.channel} onChange={(e) => set({ channel: e.target.value })}><option value="">All channels</option>{Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Direction</span><select value={filters.direction} onChange={(e) => set({ direction: e.target.value })}><option value="">Both</option><option value="OUT">Sent</option><option value="IN">Received</option></select></label>
        <label className="field"><span>From</span><input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="field"><span>To</span><input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></label>
        <label className="field"><span>Words</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
        {JSON.stringify(filters) !== JSON.stringify(EMPTY) && <button type="button" className="btn" onClick={() => set(EMPTY)}>Clear filters</button>}
      </form>
      {t && <ul className="srch-meta" aria-label="Totals" data-testid="cl-totals"><li><strong>{t.total}</strong> message(s)</li><li><strong data-testid="cl-failed">{t.failed}</strong> failed</li><li><strong data-testid="cl-blocked">{t.blocked}</strong> blocked</li><li><strong>{t.waiting}</strong> waiting</li></ul>}
      {chart && chart.categories.length > 0 && <Chart type="stacked" data={chart} title="Messages by channel and status" exportName="communication-by-channel" />}
      <div className="srch-tools">
        <button type="button" className="btn" onClick={() => download('xlsx')}><Icon name="erp.action.export" size={16} /> Export XLSX</button>
        <button type="button" className="btn" onClick={() => download('csv')}>Export CSV</button>
        <button type="button" className="btn" onClick={() => download('pdf')}>Export PDF</button>
      </div>
      {open && <Detail id={open} session={session} onClose={() => setOpen(null)} />}
      {list.isPending && <Skeleton label="Loading the log" rows={4} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The log could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {d && (d.rows.length === 0 ? <EmptyState title="No message matches" message="Messages appear here as the system sends them. Change the filters, or send a sample from Channel Settings." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Messages">
          <table className="grid">
            <thead><tr><th>When</th><th>Channel</th><th>Address</th><th>Message</th><th>Status</th><th>Connector</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} data-testid={`cl-row-${r.id}`}>
                <td data-label="When">{formatDateTime(r.at)}</td><td data-label="Channel">{CHANNEL[r.channel]}<br /><span className="muted small">{r.direction === 'IN' ? 'received' : r.purpose.toLowerCase()}</span></td>
                <td data-label="Address">{r.to}</td>
                <th scope="row" data-label="Message">{r.subject ?? r.template ?? '(text)'}<br /><span className="muted small">{r.relatedEntity ? `${r.relatedEntity} ${r.relatedId}` : ''}</span></th>
                <td data-label="Status"><StatusBadge status={STATUS[r.status][0]} label={STATUS[r.status][1]} />{r.error ? <><br /><span className="muted small">{r.error}</span></> : null}</td>
                <td data-label="Connector">{r.connector ?? ''}{r.route.length > 1 ? <><br /><span className="muted small">after {r.route.length - 1} failed</span></> : null}</td>
                <td data-label="Actions"><button type="button" className="btn btn-small" onClick={() => setOpen(r.id)} aria-label={`Open message ${r.id}`}>Open</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
      <div className="pager"><span>{d?.total ?? 0} message(s), page {page} of {pages}</span>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
    </section>
  );
}
