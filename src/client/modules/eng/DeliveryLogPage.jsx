import { useMemo, useState } from 'react';
import Chart from '../../platform/charts/Chart.jsx';
import Icon from '../../platform/design/Icon.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { authHeaders, deliveriesUrl, useDeliveries, useDeliverySummary, useRetryDelivery } from '../../platform/notifications/api.js';
import { can, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Delivery Log (part 04.06, section 7.4): what each channel did with each notification: sent, held for a digest, waiting to be tried again, failed or skipped, and why. A failed or
// skipped message can be sent again. Addresses are partly hidden; the text of a message is not shown here.
const STATUS = { PENDING: ['submitted', 'Waiting to be sent'], DEFERRED: ['returned', 'Held for a digest'], SENT: ['approved', 'Sent'], DELIVERED: ['approved', 'Delivered'], FAILED: ['rejected', 'Failed'], SKIPPED: ['cancelled', 'Skipped'] };
const CHANNEL = { IN_APP: 'In the centre', EMAIL: 'E-mail', SMS: 'Text message', WHATSAPP: 'WhatsApp', PUSH: 'Push' };
const EMPTY = { channel: '', status: '', user: '', from: '', to: '', q: '' };
const PAGE = 25;

export default function DeliveryLogPage({ session }) {
  usePageTitle('Delivery Log');
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const list = useDeliveries({ ...filters, limit: PAGE, offset: (page - 1) * PAGE });
  const sum = useDeliverySummary({ from: filters.from, to: filters.to });
  const retry = useRetryDelivery();
  const chart = useMemo(() => sum.data && ({ categories: Object.keys(sum.data.grid).filter((c) => sum.data.grid[c].total).map((c) => CHANNEL[c]), series: ['SENT', 'DELIVERED', 'DEFERRED', 'PENDING', 'SKIPPED', 'FAILED'].map((s) => ({ name: STATUS[s][1], values: Object.keys(sum.data.grid).filter((c) => sum.data.grid[c].total).map((c) => sum.data.grid[c][s]) })), unit: 'messages' }), [sum.data]);
  const download = async (format) => {
    const res = await fetch(deliveriesUrl(format, { channel: filters.channel, status: filters.status, from: filters.from, to: filters.to }), { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { setNotice('The export could not be prepared.'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `deliveries.${format}` }).click();
    URL.revokeObjectURL(url);
    setNotice('');
  };
  if (list.error?.status === 403) return <NoPermission what="the delivery log" permission="ntf.delivery.view" />;
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE)) : 1;
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const t = sum.data?.totals;
  return (
    <section aria-labelledby="dl-title" data-testid="delivery-log">
      <PageHeader id="dl-title" title={"Delivery Log"} subtitle={"What each channel did with each notification, and why a message did not leave. Failed and skipped messages can be sent again."} />
      {notice && <p role="status" className="notice" data-testid="dl-notice">{notice}</p>}
      {error && <p role="alert" className="error">{error.form}</p>}
      <form className="srch-form" role="search" aria-label="Report parameters" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Channel</span><select value={filters.channel} onChange={(e) => set({ channel: e.target.value })}><option value="">All channels</option>{Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any status</option>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>From</span><input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
        <label className="field"><span>To</span><input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></label>
        <label className="field"><span>Person</span><input value={filters.user} onChange={(e) => set({ user: e.target.value })} /></label>
        <label className="field"><span>Words</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
        {JSON.stringify(filters) !== JSON.stringify(EMPTY) && <button type="button" className="btn" onClick={() => set(EMPTY)}>Clear filters</button>}
      </form>
      {t && <ul className="srch-meta" aria-label="Totals" data-testid="dl-totals"><li><strong>{t.total}</strong> message(s)</li><li><strong data-testid="dl-failed">{t.failed}</strong> failed</li><li><strong>{t.pending}</strong> waiting or held</li></ul>}
      {chart && chart.categories.length > 0 && <Chart type="stacked" data={chart} title="Messages by channel and status" exportName="deliveries-by-channel" />}
      <div className="srch-tools">
        <button type="button" className="btn" onClick={() => download('xlsx')}><Icon name="erp.action.export" size={16} /> Export XLSX</button>
        <button type="button" className="btn" onClick={() => download('csv')}>Export CSV</button>
        <button type="button" className="btn" onClick={() => download('pdf')}>Export PDF</button>
      </div>
      {list.isPending && <Skeleton label="Loading the log" rows={4} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The log could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {d && (d.rows.length === 0 ? <EmptyState title="No delivery matches" message="Notifications reach this log as they are sent. Change the filters, or send yourself a test from your preferences." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Deliveries">
          <table className="grid">
            <thead><tr><th>When</th><th>Person</th><th>Channel</th><th>Notification</th><th>Status</th><th className="num">Attempts</th><th>Reason</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} data-testid={`dl-row-${r.id}`}>
                <td data-label="When">{formatDateTime(r.at)}</td><td data-label="Person">{r.user}<br /><span className="muted small">{r.address ?? ''}</span></td><td data-label="Channel">{CHANNEL[r.channel]}</td>
                <th scope="row" data-label="Notification">{r.title}<br /><span className="muted small">{r.template}</span></th>
                <td data-label="Status"><StatusBadge status={STATUS[r.status][0]} label={STATUS[r.status][1]} />{r.deliverAfter && r.status === 'DEFERRED' ? <><br /><span className="muted small">until {formatDateTime(r.deliverAfter)}</span></> : null}</td>
                <td className="num" data-label="Attempts">{r.attempts}</td><td data-label="Reason" className="small">{r.lastError ?? ''}</td>
                <td data-label="Actions">{['FAILED', 'SKIPPED'].includes(r.status) && can(session, 'ntf.delivery.retry') && <button type="button" className="btn btn-small" disabled={retry.isPending} onClick={() => { setError(null); retry.mutate(r.id, { onSuccess: () => setNotice('The message will be sent again.'), onError: (e) => setError(errorInfo(e)) }); }}>Send again<span className="sr-only"> {r.title}</span></button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
      <div className="pager"><span>{d?.total ?? 0} delivery(ies), page {page} of {pages}</span>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
    </section>
  );
}
