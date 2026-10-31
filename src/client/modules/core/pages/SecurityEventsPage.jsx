import { useState } from 'react';
import { formatDateTime, toCsv } from '../../../platform/format.js';
import { useSecurityEvents } from '../api/audit.js';
import { Pager, QueryState, downloadCsv, usePageTitle } from './ui.jsx';

const SEVERITY = { CRITICAL: ['chip-bad', 'Critical'], HIGH: ['chip-fail', 'High'], WARNING: ['chip-not_applicable', 'Warning'], INFO: ['chip-never', 'Info'] };
const detailText = (d) => Object.entries(d ?? {}).filter(([k]) => !['event', 'entity', 'entityId'].includes(k)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');

/** Sign-in failures, permission changes, elevations, refused requests, sensitive exports and anything that touched the audit trail. */
export default function SecurityEventsPage() {
  usePageTitle('Security Events');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState({ severity: '', type: '', user: '' });
  const list = useSecurityEvents({ page, pageSize: 25, q, from, to, filters });
  const rows = list.data?.data ?? [];
  const s = list.data?.summary;
  const set = (name, value) => { setFilters((f) => ({ ...f, [name]: value })); setPage(1); };
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Security events</nav>
      <div className="page-head"><h1 id="page-title">Security Events</h1></div>
      <p className="muted">What happened that matters to security. Entries cannot be edited or deleted. A critical entry means the audit trail itself was tampered with, or a token was reused: look at it now.</p>
      {s && (
        <div className="tiles" data-testid="security-summary" role="status">
          <div className={`tile ${s.critical ? 'tile-bad' : 'tile-ok'}`}><span>Critical, last 24 hours</span><strong>{s.critical}</strong></div>
          <div className={`tile ${s.high ? 'tile-bad' : ''}`}><span>High</span><strong>{s.high}</strong></div>
          <div className="tile"><span>Warnings</span><strong>{s.warning}</strong></div>
          <div className="tile"><span>All events</span><strong>{s.last24h}</strong></div>
        </div>
      )}
      {s?.critical > 0 && <p className="field-error" role="alert">There {s.critical === 1 ? 'is 1 critical event' : `are ${s.critical} critical events`} in the last 24 hours.</p>}
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search events</span><input type="search" placeholder="Search person, type or address" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field field-inline"><span className="sr-only">Severity</span>
          <select aria-label="Severity" value={filters.severity} onChange={(e) => set('severity', e.target.value)}><option value="">Severity: any</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="WARNING">Warning</option><option value="INFO">Info</option></select>
        </label>
        <label className="field field-inline"><span className="sr-only">Type</span>
          <select aria-label="Type" value={filters.type} onChange={(e) => set('type', e.target.value)}><option value="">Type: any</option>{(list.data?.types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </label>
        <label className="field field-inline"><span className="sr-only">Person</span><input aria-label="Person" placeholder="Person" value={filters.user} onChange={(e) => set('user', e.target.value)} /></label>
        <label className="field field-inline"><span>From</span><input type="date" aria-label="From date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
        <label className="field field-inline"><span>To</span><input type="date" aria-label="To date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
        <button type="button" className="btn" disabled={rows.length === 0} onClick={() => downloadCsv('security-events.csv', toCsv(['When', 'Severity', 'Type', 'Person', 'Address', 'Details', 'Correlation ID'], rows.map((e) => [e.at, e.severity, e.type, e.username ?? '', e.ip ?? '', detailText(e.details), e.correlationId ?? ''])))}>Export CSV</button>
      </div>
      <QueryState query={list} what="the security events" permission="core.security.view" />
      {list.data && rows.length === 0 && <div className="state"><h2>No events</h2><p>Nothing matches those filters.</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Security events</caption>
              <thead><tr><th>When</th><th>Severity</th><th>Type</th><th>Person</th><th>Address</th><th>Details</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} data-testid={`security-${e.id}`}>
                    <td data-label="When">{formatDateTime(e.at)}</td>
                    <td data-label="Severity"><span className={`chip ${SEVERITY[e.severity][0]}`}>{SEVERITY[e.severity][1]}</span></td>
                    <td data-label="Type"><code>{e.type}</code></td>
                    <td data-label="Person">{e.username ?? ''}</td>
                    <td data-label="Address">{e.ip ?? ''}</td>
                    <td data-label="Details">{detailText(e.details)}{e.correlationId ? <> <span className="muted small">({e.correlationId.slice(0, 8)})</span></> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="events" />
        </>
      )}
    </section>
  );
}
