import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { AttachmentPanel } from '../../platform/object/panels.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { bill, fmtDate, qs } from './api.js';
import { DocBar, ErrorLine, Status, big, useRecord, useRunner } from './BillParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';

// Deviation statements and the register of extra and substituted items (part 22.02).
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }); const money = (v) => (v == null ? '—' : `₹ ${new Intl.NumberFormat('en-IN').format(v)}`); const n = (v) => (v == null ? '—' : nf.format(v));
const day = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const CLIENT_TONE = { NOT_SENT: 'DRAFT', SENT: 'IN_REVIEW', ACCEPTED: 'APPROVED', REJECTED: 'REJECTED' }; const DEC_TONE = { PENDING: 'IN_REVIEW', APPROVED: 'APPROVED', REJECTED: 'REJECTED', WITHDRAWN: 'CANCELLED' };
const pctText = (v) => `${v > 0 ? '+' : ''}${v}%`;

function StatementForm({ projectId: initial }) {
  const t = useT('bill'); const { error, run, busy } = useRunner(); const o = useQuery({ queryKey: ['bill', 'ds-options'], queryFn: () => bill.get('/deviation-statements/options'), retry: false });
  const [v, setV] = useState({ projectId: initial ?? '', period: day().slice(0, 7), notes: '' }); const [sel, setSel] = useState({});
  const cand = useQuery({ queryKey: ['bill', 'ds-candidates', v.projectId], queryFn: () => bill.get(`/deviation-statements/candidates${qs({ projectId: v.projectId })}`), enabled: Boolean(v.projectId), retry: false });
  if (o.error?.status === 403) return <NoPermission what={t('ds.title')} permission="bill.deviation_statement.create" />; if (o.isPending) return <Skeleton label={t('ds.title')} rows={4} />; const fe = error?.fields ?? {};
  const chosen = (cand.data?.rows ?? []).filter((r) => sel[r.boqLineId]?.on); const items = chosen.map((r) => ({ boqLineId: r.boqLineId, reason: sel[r.boqLineId].reason ?? '' }));
  return (
    <div className="mdm-panel" data-testid="bill-ds-form"><ErrorLine error={error} id="bill-error" />
      <div className="form-grid"><Field label={t('project')} name="projectId" error={fe.projectId}><select value={v.projectId} onChange={(e) => { setV({ ...v, projectId: e.target.value }); setSel({}); }} style={big} data-testid="bill-ds-project"><option value="">—</option>{o.data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('ds.period')} name="period" error={fe.period}><input type="month" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })} style={big} data-testid="bill-ds-period" /></Field>
        <Field label={t('ds.notes')} name="notes" error={fe.notes}><input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} style={big} maxLength={2000} data-testid="bill-ds-notes" /></Field></div>
      <h2>{t('ds.candidates')}</h2><p className="muted">{t('ds.candidatesNote', { pct: cand.data?.thresholdPct ?? o.data.thresholdPct })}</p>
      {!v.projectId ? <p className="muted">{t('rc.pick')}</p> : cand.isPending ? <Skeleton label={t('ds.candidates')} rows={2} /> : cand.data.rows.length === 0 ? <div className="empty-state"><h2>{t('ds.noCandidatesTitle')}</h2><p>{t('ds.noCandidatesBody')}</p><Link to="/bill/qty-recon">{t('rc.title')}</Link></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="bill-ds-candidates"><thead><tr><th /><th>{t('rc.item')}</th><th className="num">{t('rc.contract')}</th><th className="num">{t('rc.projected')}</th><th className="num">{t('rc.dev')}</th><th>{t('ds.reason')}</th></tr></thead>
          <tbody>{cand.data.rows.map((r) => <tr key={r.boqLineId} data-testid="bill-ds-candidate" data-code={r.code}><td><input type="checkbox" aria-label={r.code} checked={Boolean(sel[r.boqLineId]?.on)} onChange={(e) => setSel({ ...sel, [r.boqLineId]: { ...sel[r.boqLineId], on: e.target.checked } })} data-testid="bill-ds-pick" /></td><td>{r.code} {r.description}{r.inStatement ? ` (${t('ds.inStatement')})` : ''}</td><td className="num">{n(r.contract)} {r.uom}</td><td className="num">{n(r.projected)}</td><td className="num">{pctText(r.deviationPct)}</td>
            <td><input value={sel[r.boqLineId]?.reason ?? ''} onChange={(e) => setSel({ ...sel, [r.boqLineId]: { ...sel[r.boqLineId], reason: e.target.value } })} style={big} maxLength={500} aria-label={t('ds.reason')} data-testid="bill-ds-reason" /></td></tr>)}</tbody></table></div>)}
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.projectId || items.length === 0 || items.some((i) => i.reason.trim().length < 5)} data-testid="bill-ds-save" onClick={async () => { const r = await run(() => bill.post('/deviation-statements', { projectId: Number(v.projectId), period: v.period, notes: v.notes || null, items })); if (r) navigateTo(`/bill/deviations?id=${r.id}`); }}>{t('ds.save')}</button></div></div>
  );
}

function ClientPanel({ x, run, busy }) {
  const t = useT('bill'); const [s, setS] = useState({ sentOn: day(), clientRef: '' }); const [r, setR] = useState({ decision: 'ACCEPTED', respondedOn: day(), clientRef: '', outcome: 'VARIATION' });
  return (
    <div className="mdm-panel no-print" data-testid="bill-ds-client"><h2>{t('ds.client')}</h2>
      {x.can.send && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); run(() => bill.post(`/deviation-statements/${x.id}/send`, { sentOn: s.sentOn, clientRef: s.clientRef || null }), t('ds.sent')); }} data-testid="bill-ds-send-form"><Field label={t('ds.sentOn')} name="sentOn" error={null}><input type="date" value={s.sentOn} onChange={(e) => setS({ ...s, sentOn: e.target.value })} style={big} data-testid="bill-ds-sent-on" /></Field><Field label={t('ds.clientRef')} name="clientRef" error={null}><input value={s.clientRef} onChange={(e) => setS({ ...s, clientRef: e.target.value })} style={big} maxLength={120} data-testid="bill-ds-sent-ref" /></Field><div className="actions-row"><button className="btn btn-primary" style={big} disabled={busy} data-testid="bill-ds-send">{t('ds.send')}</button></div></form>}
      {x.can.respond && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); run(() => bill.post(`/deviation-statements/${x.id}/respond`, { decision: r.decision, respondedOn: r.respondedOn, clientRef: r.clientRef || null, ...(r.decision === 'ACCEPTED' ? { outcome: r.outcome } : {}) }), t('ds.responded')); }} data-testid="bill-ds-respond-form">
        <Field label={t('ds.decision')} name="decision" error={null}><select value={r.decision} onChange={(e) => setR({ ...r, decision: e.target.value })} style={big} data-testid="bill-ds-decision"><option value="ACCEPTED">{t('cs.ACCEPTED')}</option><option value="REJECTED">{t('cs.REJECTED')}</option></select></Field>
        {r.decision === 'ACCEPTED' && <Field label={t('ds.outcome')} name="outcome" error={null}><select value={r.outcome} onChange={(e) => setR({ ...r, outcome: e.target.value })} style={big} data-testid="bill-ds-outcome"><option value="VARIATION">{t('oc.VARIATION')}</option><option value="RATE_REVISION">{t('oc.RATE_REVISION')}</option></select></Field>}
        <Field label={t('ds.respondedOn')} name="respondedOn" error={null}><input type="date" value={r.respondedOn} onChange={(e) => setR({ ...r, respondedOn: e.target.value })} style={big} data-testid="bill-ds-responded-on" /></Field><Field label={t('ds.clientRef')} name="clientRef" error={null}><input value={r.clientRef} onChange={(e) => setR({ ...r, clientRef: e.target.value })} style={big} maxLength={120} /></Field>
        <div className="actions-row"><button className="btn btn-primary" style={big} disabled={busy} data-testid="bill-ds-respond">{t('ds.respond')}</button></div></form>}
      {!x.can.send && !x.can.respond && <p data-testid="bill-ds-client-state">{t(`cs.${x.clientState}`)}{x.sentOn ? ` · ${fmtDate(x.sentOn)}` : ''}{x.clientRef ? ` · ${x.clientRef}` : ''}{x.respondedOn ? ` · ${fmtDate(x.respondedOn)}` : ''}{x.outcome !== 'NONE' ? ` · ${t(`oc.${x.outcome}`)}` : ''}</p>}
      {x.crNo && <p data-testid="bill-ds-cr">{t('ds.raised', { cr: x.crNo })} <Link to={`/ctr/variations?id=${x.crId}`}>{x.crNo}</Link></p>}</div>
  );
}

function Statement({ id }) {
  const t = useT('bill'); const { q, guard } = useRecord('/deviation-statements', id, t('ds.title'), 'bill.deviation_statement.view'); const { error, run, busy, note } = useRunner(); const [reasons, setReasons] = useState({}); const [tab, setTab] = useState('items'); usePageTitle(t('ds.title'));
  if (guard) return guard; const x = q.data; const edited = Object.keys(reasons).length > 0;
  return (
    <div data-testid="bill-ds-object" data-status={x.status} data-client={x.clientState}><PageHeader id="ds-h" title={<>{x.dsNo} <Status x={x} /> <StatusBadge status={CLIENT_TONE[x.clientState]} label={t(`cs.${x.clientState}`)} /></>} meta={<><Link to="/bill/deviations">{t('ds.title')}</Link> · {x.docNo} · {x.project} · {t('ds.period')} {x.period} · {t('ds.allowed', { pct: x.thresholdPct })}</>} />
      <KpiRow><KpiTile label={t('ds.items')} value={x.itemCount} kind="count" valueTestid="bill-ds-count"><span>{t('ds.split', { over: x.overCount, under: x.underCount })}</span></KpiTile><KpiTile label={t('ds.effect')} value={money(x.netEffect)} amount={x.netEffect} kind="money" valueTestid="bill-ds-effect" /></KpiRow>
      <ErrorLine error={error} id="bill-error" />{note && <p className="mdm-banner" role="status" data-testid="bill-note">{note}</p>}
      <div className="actions-row no-print" role="tablist">{['items', 'client', 'documents'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)} data-testid={`bill-ds-tab-${k}`}>{t(`ds.tab.${k}`)}</button>)}</div>
      {tab === 'items' && <div className="table-scroll" data-testid="bill-ds-items"><table className="data-table"><thead><tr><th>{t('rc.item')}</th><th className="num">{t('rc.contract')}</th><th className="num">{t('rc.revised')}</th><th className="num">{t('rc.measured')}</th><th className="num">{t('rc.projected')}</th><th className="num">{t('rc.dev')}</th><th className="num">{t('ds.effect')}</th><th>{t('ds.reason')}</th></tr></thead>
        <tbody>{x.items.map((i) => <tr key={i.code} data-testid="bill-ds-item" data-direction={i.direction}><td><Link to={`/bill/qty-recon?projectId=${x.projectId}&code=${encodeURIComponent(i.code)}`}>{i.code}</Link> {i.description}</td><td className="num">{n(i.contract)} {i.uom}</td><td className="num">{n(i.revised)}</td><td className="num">{n(i.measured)}</td><td className="num">{n(i.projected)} ({t(`rc.src.${i.forecastSource}`)})</td><td className="num">{pctText(i.deviationPct)} {i.direction === 'OVER' ? '▲' : '▼'}</td><td className="num">{money(i.effect)}</td>
          <td>{x.can.edit ? <input value={reasons[i.boqLineId] ?? i.reason} onChange={(e) => setReasons({ ...reasons, [i.boqLineId]: e.target.value })} style={big} maxLength={500} aria-label={t('ds.reason')} data-testid="bill-ds-edit-reason" /> : i.reason}</td></tr>)}</tbody></table>
        {x.can.edit && <div className="actions-row no-print"><button type="button" className="btn" style={big} disabled={busy || !edited} onClick={async () => { if (await run(() => bill.patch(`/deviation-statements/${x.id}`, { items: x.items.map((i) => ({ boqLineId: i.boqLineId, reason: reasons[i.boqLineId] ?? i.reason })), rowVersion: x.version }), t('k.saved'))) setReasons({}); }} data-testid="bill-ds-update">{t('ds.updateReasons')}</button></div>}
        {x.extras.length > 0 && <p>{t('ds.extras')}: {x.extras.map((e) => <Link key={e.id} to={`/bill/deviations?extra=${e.id}`}>{e.docNo} </Link>)}</p>}</div>}
      {tab === 'client' && <ClientPanel x={x} run={run} busy={busy} />}
      {tab === 'documents' && <AttachmentPanel type="bill_deviation_statements" id={x.id} entity="bill_deviation_statements" canEdit={x.can.edit || x.can.send || x.can.respond} />}
      <DocBar kind="/deviation-statements" x={x} printName={`${x.dsNo.replaceAll('/', '-')}.pdf`} />
    </div>
  );
}

function ExtraForm() {
  const t = useT('bill'); const { error, run, busy } = useRunner(); const o = useQuery({ queryKey: ['bill', 'mb-options'], queryFn: () => bill.get('/mb-entries/options'), retry: false }); const [v, setV] = useState({ projectId: '', kind: 'EXTRA', description: '', uom: '', qty: '', rate: '0', substitutesBoqLineId: '', reason: '', instructionRef: '' });
  if (o.error?.status === 403) return <NoPermission what={t('xi.title')} permission="bill.extra_item.create" />; if (o.isPending) return <Skeleton label={t('xi.title')} rows={4} />; const fe = error?.fields ?? {}; const set = (k) => (e) => setV({ ...v, [k]: e.target.value }); const boq = o.data.items.filter((i) => String(i.projectId) === String(v.projectId));
  return (
    <form className="mdm-panel" data-testid="bill-xi-form" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => bill.post('/extra-items', { projectId: Number(v.projectId), kind: v.kind, description: v.description, uom: v.uom, qty: Number(v.qty), rate: Number(v.rate || 0), substitutesBoqLineId: v.kind === 'SUBSTITUTE' && v.substitutesBoqLineId ? Number(v.substitutesBoqLineId) : null, reason: v.reason, instructionRef: v.instructionRef || null })); if (r) navigateTo(`/bill/deviations?extra=${r.id}`); }}>
      <ErrorLine error={error} id="bill-error" /><div className="form-grid">
        <Field label={t('project')} name="projectId" error={fe.projectId}><select value={v.projectId} onChange={set('projectId')} style={big} data-testid="bill-xi-project"><option value="">—</option>{o.data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('xi.kind')} name="kind" error={fe.kind}><select value={v.kind} onChange={set('kind')} style={big} data-testid="bill-xi-kind">{['EXTRA', 'SUBSTITUTE'].map((k) => <option key={k} value={k}>{t(`xi.k.${k}`)}</option>)}</select></Field>
        {v.kind === 'SUBSTITUTE' && <Field label={t('xi.substitutes')} name="substitutesBoqLineId" error={fe.substitutesBoqLineId}><select value={v.substitutesBoqLineId} onChange={set('substitutesBoqLineId')} style={big} data-testid="bill-xi-substitutes"><option value="">—</option>{boq.map((i) => <option key={i.id} value={i.id}>{i.code} {i.description}</option>)}</select></Field>}
        <Field label={t('rc.description')} name="description" error={fe.description}><input value={v.description} onChange={set('description')} style={big} maxLength={500} data-testid="bill-xi-description" /></Field>
        <Field label={t('rc.unit')} name="uom" error={fe.uom}><input value={v.uom} onChange={set('uom')} style={big} maxLength={20} data-testid="bill-xi-uom" /></Field>
        <Field label={t('xi.qty')} name="qty" error={fe.qty}><input type="number" min="0" step="any" value={v.qty} onChange={set('qty')} style={big} data-testid="bill-xi-qty" /></Field>
        <Field label={t('xi.rate')} name="rate" error={fe.rate}><input type="number" min="0" step="any" value={v.rate} onChange={set('rate')} style={big} data-testid="bill-xi-rate" /></Field>
        <Field label={t('xi.instruction')} name="instructionRef" error={fe.instructionRef}><input value={v.instructionRef} onChange={set('instructionRef')} style={big} maxLength={120} data-testid="bill-xi-instruction" /></Field>
        <Field label={t('ds.reason')} name="reason" error={fe.reason}><input value={v.reason} onChange={set('reason')} style={big} maxLength={1000} data-testid="bill-xi-reason" /></Field></div>
      <div className="actions-row"><button className="btn btn-primary" style={big} disabled={busy || !v.projectId || !v.description || !v.uom || !v.qty || v.reason.trim().length < 5} data-testid="bill-xi-save">{t('xi.save')}</button></div></form>
  );
}

function Extra({ id }) {
  const t = useT('bill'); const { q, guard } = useRecord('/extra-items', id, t('xi.title'), 'bill.extra_item.view'); const { error, run, busy, note } = useRunner(); const [d, setD] = useState({ decision: 'APPROVED', decidedOn: day(), decisionRef: '', note: '' }); usePageTitle(t('xi.title'));
  if (guard) return guard; const x = q.data; const row = (k, val) => <tr><th scope="row">{t(k)}</th><td>{val}</td></tr>;
  return (
    <div data-testid="bill-xi-object" data-state={x.state}><PageHeader id="xi-h" title={<>{x.docNo} <StatusBadge status={DEC_TONE[x.state]} label={t(`xi.s.${x.state}`)} /></>} meta={<><Link to="/bill/deviations?tab=extras">{t('xi.title')}</Link> · {x.project} · {t(`xi.k.${x.kind}`)}</>} />
      <ErrorLine error={error} id="bill-error" />{note && <p className="mdm-banner" role="status" data-testid="bill-note">{note}</p>}
      <div className="table-scroll"><table className="data-table"><tbody>{row('rc.description', x.description)}{x.substitutes && row('xi.substitutes', x.substitutes)}{row('xi.qty', `${n(x.qty)} ${x.uom}`)}{row('xi.rate', money(x.rate))}{row('xi.value', money(x.value))}{row('ds.reason', x.reason)}{x.instructionRef && row('xi.instruction', x.instructionRef)}{x.decidedBy && row('xi.decided', `${x.decidedBy} · ${fmtDate(x.decidedOn)}${x.decisionRef ? ` · ${x.decisionRef}` : ''}`)}{x.crNo && row('xi.cr', <Link to={`/ctr/variations?id=${x.crId}`}>{x.crNo}</Link>)}</tbody></table></div>
      {x.can.decide && <form className="mdm-panel no-print form-grid" data-testid="bill-xi-decide-form" onSubmit={(e) => { e.preventDefault(); run(() => bill.post(`/extra-items/${x.id}/decide`, { decision: d.decision, decidedOn: d.decidedOn, decisionRef: d.decisionRef || null, note: d.note || null }), t('xi.decidedDone')); }}>
        <Field label={t('ds.decision')} name="decision" error={null}><select value={d.decision} onChange={(e) => setD({ ...d, decision: e.target.value })} style={big} data-testid="bill-xi-decision"><option value="APPROVED">{t('xi.s.APPROVED')}</option><option value="REJECTED">{t('xi.s.REJECTED')}</option></select></Field>
        <Field label={t('ds.respondedOn')} name="decidedOn" error={null}><input type="date" value={d.decidedOn} onChange={(e) => setD({ ...d, decidedOn: e.target.value })} style={big} /></Field><Field label={t('ds.clientRef')} name="decisionRef" error={null}><input value={d.decisionRef} onChange={(e) => setD({ ...d, decisionRef: e.target.value })} style={big} maxLength={120} data-testid="bill-xi-ref" /></Field>
        <div className="actions-row"><button className="btn btn-primary" style={big} disabled={busy} data-testid="bill-xi-decide">{t('xi.decide')}</button></div></form>}
      <div className="actions-row no-print">{x.can.withdraw && <button type="button" className="btn" disabled={busy} onClick={() => { const r = globalThis.prompt(t('why')); if (r) run(() => bill.post(`/extra-items/${x.id}/withdraw`, { reason: r }), t('withdrawn')); }} data-testid="bill-xi-withdraw">{t('withdraw')}</button>}</div>
      <AttachmentPanel type="bill_extra_items" id={x.id} entity="bill_extra_items" canEdit={x.can.edit} />
    </div>
  );
}

export function DeviationsPage() {
  const t = useT('bill'); usePageTitle(t('ds.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const xid = Number(sp.get('extra')) || null; const session = useSession(); const tab = sp.get('tab') === 'extras' ? 'extras' : 'statements';
  if (id) return <section aria-labelledby="ds-h"><Statement id={id} /></section>;
  if (xid) return <section aria-labelledby="xi-h"><Extra id={xid} /></section>;
  if (sp.get('new')) return <section aria-labelledby="dsn-h"><PageHeader id="dsn-h" title={t('ds.new')} meta={<Link to="/bill/deviations">{t('ds.title')}</Link>} /><StatementForm projectId={sp.get('projectId')} /></section>;
  if (sp.get('xnew')) return <section aria-labelledby="xin-h"><PageHeader id="xin-h" title={t('xi.new')} meta={<Link to="/bill/deviations?tab=extras">{t('xi.title')}</Link>} /><ExtraForm /></section>;
  return (
    <section aria-labelledby="dss-h" data-testid="bill-deviations"><PageHeader id="dss-h" title={t('ds.title')} subtitle={t('ds.intro')} />
      <div className="actions-row no-print"><div role="tablist" style={{ display: 'contents' }}>{[['statements', 'ds.tab.statements', '/bill/deviations'], ['extras', 'xi.title', '/bill/deviations?tab=extras']].map(([k, label, to]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => navigateTo(to)} data-testid={`bill-tab-${k}`}>{t(label)}</button>)}</div>
        {tab === 'statements' ? <Link to="/bill/deviations?new=1" data-testid="bill-ds-new">{t('ds.new')}</Link> : <Link to="/bill/deviations?xnew=1" data-testid="bill-xi-new">{t('xi.new')}</Link>} · <Link to="/bill/qty-recon">{t('rc.title')}</Link></div>
      {tab === 'statements'
        ? <ListReport listCode="bill.deviation_statements" endpoint="/bill/deviation-statements" title={t('ds.title')} session={session.data} rowHref={(r) => `/bill/deviations?id=${r.id}`} onOpen={(r) => navigateTo(`/bill/deviations?id=${r.id}`)} cardFields={['dsNo', 'project', 'period', 'items', 'client', 'status']} statusKey="status" empty={{ title: t('ds.emptyTitle'), text: t('ds.emptyBody') }} />
        : <ListReport listCode="bill.extra_items" endpoint="/bill/extra-items" title={t('xi.title')} session={session.data} rowHref={(r) => `/bill/deviations?extra=${r.id}`} onOpen={(r) => navigateTo(`/bill/deviations?extra=${r.id}`)} cardFields={['docNo', 'kind', 'description', 'qty', 'state']} statusKey="state" empty={{ title: t('xi.emptyTitle'), text: t('xi.emptyBody') }} />}
    </section>
  );
}
