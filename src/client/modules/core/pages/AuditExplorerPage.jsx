import { Fragment, useState } from 'react';
import { formatDateTime, toCsv } from '../../../platform/format.js';
import { Changes } from '../../../platform/audit/RecordHistory.jsx';
import { useAuditEntities, useAuditSegments, useAuditTrail, useAuditVerification, useVerifyAudit } from '../api/audit.js';
import { Pager, QueryState, can, downloadCsv, errorInfo, usePageTitle } from './ui.jsx';

/** The audit trail: every change anyone made, who, when, from where, with the field changes; and whether the chain is intact. */
export default function AuditExplorerPage({ session }) {
  usePageTitle('Audit Explorer');
  const initial = new URLSearchParams(window.location.search);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState({ entity: initial.get('entity') ?? '', entityId: initial.get('id') ?? '', user: '', action: '' });
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState('');
  const list = useAuditTrail({ page, pageSize: 25, q, from, to, filters });
  const entities = useAuditEntities();
  const chain = useAuditVerification();
  const segments = useAuditSegments();
  const verify = useVerifyAudit();
  const rows = list.data?.data ?? [];
  const set = (name, value) => { setFilters((f) => ({ ...f, [name]: value })); setPage(1); };
  const v = chain.data;
  const timeline = filters.entity && filters.entityId;

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Audit</nav>
      <div className="page-head"><h1 id="page-title">Audit Explorer</h1></div>
      <p className="muted">Every change to a record is kept here and cannot be edited or deleted. Each entry is chained to the one before it, so a change made behind the application's back is found by the nightly check.</p>
      <p role="status" className="notice" data-testid="audit-notice">{notice}</p>
      <div className="tiles" data-testid="chain-status">
        <div className={`tile ${v?.healthy === false ? 'tile-bad' : v?.healthy ? 'tile-ok' : ''}`}>
          <span>Audit chain</span>
          <strong>{v?.healthy === false ? 'Broken' : v?.healthy ? 'Intact' : v ? 'Not checked yet' : '...'}</strong>
          <span className="muted small">{v ? `${v.entries} entries${v.last ? `, checked ${formatDateTime(v.last.finishedAt)}` : ''}` : ''}</span>
          {v?.last && !v.last.ok && <span className="field-error" role="alert">{v.last.problem}</span>}
        </div>
        <div className="tile"><span>Sealed months</span><strong>{segments.data?.segments.length ?? 0}</strong><span className="muted small">Kept for {segments.data?.retentionMonths ?? 84} months</span></div>
        {can(session, 'core.audit.verify') && <button type="button" className="btn btn-primary" disabled={verify.isPending} onClick={async () => { setNotice(''); try { const r = await verify.mutateAsync(); setNotice(r.ok ? `The chain is intact: ${r.checked} entries checked.` : `The chain is BROKEN at entry ${r.brokenSeq}: ${r.problem}`); } catch (err) { setNotice(errorInfo(err).form); } }}>{verify.isPending ? 'Checking...' : 'Verify now'}</button>}
      </div>
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search the audit trail</span><input type="search" placeholder="Search person, record, action or reason" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field field-inline"><span className="sr-only">Kind of record</span>
          <select aria-label="Kind of record" value={filters.entity} onChange={(e) => set('entity', e.target.value)}><option value="">Record: any</option>{(entities.data ?? []).map((e) => <option key={e.entity} value={e.entity}>{e.entity} ({e.entries})</option>)}</select>
        </label>
        <label className="field field-inline"><span className="sr-only">Record number</span><input aria-label="Record number" placeholder="Record number" value={filters.entityId} onChange={(e) => set('entityId', e.target.value)} /></label>
        <label className="field field-inline"><span className="sr-only">Person</span><input aria-label="Person" placeholder="Person" value={filters.user} onChange={(e) => set('user', e.target.value)} /></label>
        <label className="field field-inline"><span className="sr-only">Action</span><input aria-label="Action" placeholder="Action, e.g. submit" value={filters.action} onChange={(e) => set('action', e.target.value)} /></label>
        <label className="field field-inline"><span>From</span><input type="date" aria-label="From date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
        <label className="field field-inline"><span>To</span><input type="date" aria-label="To date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
        <button type="button" className="btn" disabled={rows.length === 0} onClick={() => downloadCsv('audit-trail.csv', toCsv(['Seq', 'When', 'Person', 'Record kind', 'Record', 'Action', 'Reason', 'Changes', 'Address', 'Correlation ID'], rows.map((e) => [e.seq, e.at, e.actor, e.entity, e.entityId, e.action, e.reason ?? '', JSON.stringify(e.changes), e.ip ?? '', e.correlationId ?? ''])))}>Export CSV</button>
      </div>
      {timeline && <p className="muted">Timeline of {filters.entity} {filters.entityId}, newest first. <button type="button" className="btn btn-small" onClick={() => setFilters((f) => ({ ...f, entity: '', entityId: '' }))}>Show everything</button></p>}
      <QueryState query={list} what="the audit trail" permission="core.audit.view" />
      {list.data && rows.length === 0 && <div className="state"><h2>No entries</h2><p>Nothing matches those filters.</p></div>}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Audit trail</caption>
              <thead><tr><th>When</th><th>Person</th><th>Record</th><th>Action</th><th>Changes</th><th><span className="sr-only">Details</span></th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <Fragment key={e.id}>
                    <tr data-testid={`audit-${e.id}`}>
                      <td data-label="When">{formatDateTime(e.at)}</td>
                      <td data-label="Person">{e.actor}</td>
                      <td data-label="Record"><button type="button" className="btn btn-link" aria-label={`Show the timeline of ${e.entity} ${e.entityId}`} onClick={() => { setFilters((f) => ({ ...f, entity: e.entity, entityId: e.entityId })); setPage(1); }}>{e.entity} {e.entityId}</button></td>
                      <td data-label="Action">{e.action}</td>
                      <td data-label="Changes"><Changes changes={e.changes} /></td>
                      <td data-label="Details"><button type="button" className="btn btn-small" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'Details'}</button></td>
                    </tr>
                    {open === e.id && (
                      <tr><td colSpan={6} data-label="Details">
                        <dl className="kv" data-testid={`audit-detail-${e.id}`}>
                          <dt>Entry</dt><dd>#{e.seq}</dd>
                          {e.reason && <><dt>Reason</dt><dd>{e.reason}</dd></>}
                          <dt>From</dt><dd>{e.ip ?? 'not recorded'}{e.device ? `, ${e.device}` : ''}</dd>
                          <dt>Correlation ID</dt><dd><code>{e.correlationId ?? 'none'}</code></dd>
                          <dt>Hash</dt><dd><code>{e.hash}</code></dd>
                          <dt>After the entry</dt><dd><code>{e.prevHash}</code></dd>
                        </dl>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun="entries" />
        </>
      )}
    </section>
  );
}
