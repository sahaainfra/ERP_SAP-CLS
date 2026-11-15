import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { PHASE_TONE, REQ_TONE, fmtDate, pa, pl } from './api.js';
import { ExportButton, useRunner } from './PlantParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Equipment requisitions and the allocation desk (part 17.02, FR-01, FR-02): the list, the worklist of approved requisitions still to be met, and the requisition with the availability of the fleet for its period, the hire decision and the allocations made against it.
function Availability({ t, r }) {
  const q = useQuery({ queryKey: ['plant', 'avail', r.classItemId, r.fromDate, r.toDate], queryFn: () => pa.availability({ classItemId: r.classItemId, fromDate: r.fromDate, toDate: r.toDate }), retry: false });
  if (q.isPending) return <Skeleton label={t('a.availability')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; if (!d.rows.length) return <p className="muted" data-testid="rq-avail-empty">{t('a.noFleet')}</p>;
  return (
    <div className="table-scroll"><table className="data-table" data-testid="rq-avail"><caption>{t('a.availabilityFor', { n: d.usable, from: fmtDate(d.fromDate), to: fmtDate(d.toDate) })}</caption><thead><tr><th>{t('assetCode')}</th><th>{t('make')}</th><th>{t('where')}</th><th>{t('a.free')}</th><th>{t('a.ready')}</th><th /></tr></thead>
      <tbody>{d.rows.map((m) => <tr key={m.equipmentId} data-testid="rq-avail-row" data-usable={m.usable}><td><Link to={`/plant/equipment?id=${m.equipmentId}`}>{m.assetCode}</Link></td><td>{m.make} {m.model}{m.capacity ? ` · ${m.capacity}` : ''}</td><td>{m.stateLabel}{m.project ? ` · ${m.project}${m.site ? `/${m.site}` : ''}` : ''}</td>
        <td>{m.free ? t('a.yes') : t('a.busy', { d: m.conflict.docNo })}</td><td>{m.ready ? (m.lapsesDuring.length ? t('a.lapses') : t('a.yes')) : <span className="field-error">{m.problems.join('; ')}</span>}</td>
        <td>{m.usable && r.can.allocate && <span data-testid="rq-allocate"><Link to={`/plant/allocations/new?requisitionId=${r.id}&equipmentId=${m.equipmentId}`}>{t('a.allocate')}</Link></span>}</td></tr>)}</tbody></table></div>
  );
}
function Requisition({ id }) {
  const t = useT('plant'); const q = useQuery({ queryKey: ['plant', 'req', id], queryFn: () => pa.req(id), retry: false }); const hq = useQuery({ queryKey: ['plant', 'req-history', id, q.data?.status], queryFn: () => pa.reqHistory(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const sp0 = useSearch(); const [tab, setTab] = useState(sp0.get('tab') === 'desk' ? 'desk' : 'details'); const [comment, setComment] = useState(''); const [hire, setHire] = useState({ qty: '1', reason: '' }); usePageTitle(t('a.reqTitle'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('a.reqTitle')} permission="plant.requisition.view" />; if (q.isPending) return <Skeleton label={t('a.reqTitle')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const can = x.can; const why = (action, msg) => { const r = globalThis.prompt(t('why')); if (r) run(() => pa.reqAct(x.id, action, { reason: r }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => pl.decide(x.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div data-testid="rq-object" data-status={x.status} data-fulfilment={x.fulfilment ?? ''}>
      <PageHeader id="rq-h" title={<>{x.docNo} <StatusBadge status={REQ_TONE[x.status]} label={t(`rs.${x.status}`)} />{x.fulfilment && <> <StatusBadge status={x.fulfilment === 'FULFILLED' ? 'APPROVED' : 'IN_REVIEW'} label={t(`a.f.${x.fulfilment}`)} /></>}</>} meta={<><Link to="/plant/requisitions">{t('a.reqTitle')}</Link> · {x.qty} × {x.class} · {x.project}{x.site ? `/${x.site}` : ''}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="rq-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="rq-note">{note}</p>}
      <div className="actions-row no-print">{can.edit && <Link to={`/plant/requisitions/new?id=${x.id}`}>{t('edit')}</Link>}{can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pa.reqAct(x.id, 'submit'), t('submitted'))} data-testid="rq-submit">{t('sendForApproval')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}{can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))} data-testid="rq-cancel">{t('cancel')}</button>}{can.amend && <button type="button" className="btn" onClick={() => why('amend', t('amended'))}>{t('amend')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => pl.exportFile({}, `${x.docNo}.pdf`, `/requisitions/${x.id}/print`).catch(() => setError({ form: t('exportFailed') }))} data-testid="rq-print">{t('print')}</button>}</div>
      {x.approve && x.taskId && <div className="mdm-panel no-print" data-testid="rq-decide"><h2>{t('decision')}</h2><label>{t('comment')}<textarea value={comment} onChange={(ev) => setComment(ev.target.value)} rows={2} style={{ width: '100%' }} /></label><div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="rq-approve">{t('approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('reject')}</button></div></div>}
      <div role="tablist" className="tabs no-print">{['details', 'desk', 'approvals'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} style={{ minHeight: 44 }} onClick={() => setTab(k)} data-testid={`rq-tab-${k}`}>{t(`a.tab.${k}`)}</button>)}</div>
      {tab === 'details' && <dl className="kv" data-testid="rq-details"><div><dt>{t('class')}</dt><dd>{x.class}</dd></div><div><dt>{t('capacity')}</dt><dd>{x.capacity ?? '—'}</dd></div><div><dt>{t('a.qty')}</dt><dd>{x.qty}</dd></div><div><dt>{t('a.period')}</dt><dd>{fmtDate(x.fromDate)} – {fmtDate(x.toDate)}</dd></div><div><dt>{t('a.purpose')}</dt><dd>{x.purpose}</dd></div><div><dt>{t('a.activity')}</dt><dd>{x.activity ?? '—'}</dd></div><div><dt>{t('a.priority')}</dt><dd>{x.priorityLabel}</dd></div><div><dt>{t('a.met')}</dt><dd>{t('a.metHint', { a: x.allocated, h: x.hireQty, o: x.openQty })}</dd></div></dl>}
      {tab === 'desk' && <div data-testid="rq-desk">{x.status !== 'APPROVED' ? <p className="muted">{t('a.notApproved')}</p> : <>
        <Availability t={t} r={x} />
        {x.allocations.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="rq-allocations"><caption>{t('a.allocationsOf')}</caption><thead><tr><th>{t('a.allocation')}</th><th>{t('assetCode')}</th><th>{t('a.period')}</th><th>{t('a.where')}</th></tr></thead><tbody>{x.allocations.map((a) => <tr key={a.id}><td><Link to={`/plant/allocations?id=${a.id}`}>{a.docNo}</Link></td><td>{a.assetCode}</td><td>{fmtDate(a.fromDate)} – {fmtDate(a.toDate)}</td><td><StatusBadge status={a.status === 'APPROVED' ? PHASE_TONE[a.phase] : REQ_TONE[a.status]} label={a.status === 'APPROVED' ? t(`a.ph.${a.phase}`) : t(`rs.${a.status}`)} /></td></tr>)}</tbody></table></div>}
        {can.hire && <div className="mdm-panel no-print" data-testid="rq-hire"><h3>{t('a.hireTitle')}</h3><p className="muted">{t('a.hireHint')}</p><div className="form-grid"><Field label={t('a.qty')} name="qty" error={error}><input type="number" min="0" value={hire.qty} onChange={(ev) => setHire({ ...hire, qty: ev.target.value })} style={{ minHeight: 44 }} data-testid="rq-hire-qty" /></Field><Field label={t('a.hireReason')} name="reason" error={error}><input value={hire.reason} onChange={(ev) => setHire({ ...hire, reason: ev.target.value })} maxLength={500} style={{ minHeight: 44 }} data-testid="rq-hire-reason" /></Field></div>
          <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pa.reqAct(x.id, 'hire', { qty: Number(hire.qty), reason: hire.reason }), t('a.hireSent'))} data-testid="rq-hire-go">{t('a.hireGo')}</button></div></div>}</>}</div>}
      {tab === 'approvals' && hq.data && <div className="table-scroll" data-testid="rq-history"><table className="data-table"><caption>{t('approvals')}</caption><thead><tr><th>{t('when')}</th><th>{t('who')}</th><th>{t('event')}</th><th>{t('comment')}</th></tr></thead><tbody>{[...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, c: a.comment })), ...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, c: a.reason }))].sort((p, q2) => String(p.at).localeCompare(String(q2.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.c ?? ''}</td></tr>)}</tbody></table></div>}
    </div>
  );
}
function Desk({ t }) {
  const q = useQuery({ queryKey: ['plant', 'desk'], queryFn: () => pa.reqList({ 'filter[status]': 'APPROVED', pageSize: 100, sort: 'from' }), retry: false });
  if (q.isPending) return <Skeleton label={t('a.deskTitle')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const rows = (q.data.data ?? []).filter((r) => r.fulfilment !== 'FULFILLED');
  if (!rows.length) return <div className="mdm-panel" data-testid="rq-desk-empty"><h2>{t('a.deskEmptyTitle')}</h2><p className="muted">{t('a.deskEmptyBody')}</p></div>;
  return (
    <div className="table-scroll"><table className="data-table" data-testid="rq-desk-list"><caption>{t('a.deskTitle')}</caption><thead><tr><th>{t('a.requisition')}</th><th>{t('class')}</th><th>{t('project')}</th><th>{t('a.period')}</th><th>{t('a.priority')}</th><th className="num">{t('a.open')}</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} data-testid="rq-desk-row"><td><Link to={`/plant/requisitions?id=${r.id}&tab=desk`}>{r.docNo}</Link></td><td>{r.class}{r.capacity ? ` · ${r.capacity}` : ''}</td><td>{r.project}{r.site ? `/${r.site}` : ''}</td><td>{fmtDate(r.fromDate)} – {fmtDate(r.toDate)}</td><td>{r.priorityLabel}</td><td className="num">{r.openQty}</td></tr>)}</tbody></table></div>
  );
}
export default function RequisitionsPage() {
  const t = useT('plant'); usePageTitle(t('a.reqTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const [view, setView] = useState('list');
  if (id) return <section aria-labelledby="rq-h"><Requisition id={id} /></section>;
  return (
    <section aria-labelledby="rql-h" data-testid="plant-rq-list"><PageHeader id="rql-h" title={t('a.reqTitle')} subtitle={t('a.reqIntro')} />
      <div className="actions-row no-print"><Link to="/plant/requisitions/new">{t('a.reqNew')}</Link><Link to="/plant/gantt">{t('a.ganttTitle')}</Link><Link to="/plant/allocations">{t('a.allocTitle')}</Link><ExportButton query={{}} name="requisitions.csv" path="/requisitions/export" testId="rq-export" /></div>
      <div role="tablist" className="tabs no-print">{['list', 'desk'].map((k) => <button key={k} type="button" role="tab" aria-selected={view === k} className={`btn${view === k ? ' btn-primary' : ''}`} style={{ minHeight: 44 }} onClick={() => setView(k)} data-testid={`rq-view-${k}`}>{t(`a.view.${k}`)}</button>)}</div>
      {view === 'desk' ? <Desk t={t} /> : <ListReport listCode="plant.requisitions" endpoint="/plant/requisitions" title={t('a.reqTitle')} session={session.data} rowHref={(r) => `/plant/requisitions?id=${r.id}`} onOpen={(r) => navigateTo(`/plant/requisitions?id=${r.id}`)} cardFields={['docNo', 'class', 'project', 'status']} statusKey="status" dateKey="created" empty={{ title: t('a.reqEmptyTitle'), text: t('a.reqEmptyBody') }} />}
    </section>
  );
}
