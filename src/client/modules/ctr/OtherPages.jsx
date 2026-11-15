import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { ctr, fmtDate, qs } from './api.js';
import { DocBar, ErrorLine, Status, big, useRecord, useRunner } from './CtrParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';

// The Obligations Calendar (part 21.01 FR-03) and Contract Amendments (FR-06).
const nf = new Intl.NumberFormat('en-IN'); const money = (n) => (n == null ? '—' : `₹ ${nf.format(n)}`); const OB_TONE = { OVERDUE: 'REJECTED', DUE_SOON: 'RETURNED', OPEN: 'IN_REVIEW', DONE: 'APPROVED', WAIVED: 'CANCELLED' };
export function ObligationsPage() {
  const t = useT('ctr'); usePageTitle(t('ob.title')); const sp = useSearch(); const session = useSession(); const { error, run, busy, note } = useRunner(); const [f, setF] = useState({ state: 'ALL', mine: false, projectId: sp.get('projectId') ?? '' });
  const query = qs({ state: f.state, projectId: f.projectId, owner: f.mine ? session.data?.user ?? '' : '' }); const q = useQuery({ queryKey: ['ctr', 'calendar', query], queryFn: () => ctr.get(`/obligations${query}`), retry: false, placeholderData: (p) => p });
  if (q.error?.status === 403) return <NoPermission what={t('ob.title')} permission="ctr.obligation.view" />; if (q.isPending) return <Skeleton label={t('ob.title')} rows={5} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />; const d = q.data; const perms = session.data?.permissions ?? []; const canDone = Array.isArray(perms) ? perms.includes('ctr.obligation.complete') : Boolean(perms['ctr.obligation.complete']);
  const max = Math.max(1, ...d.months.map((m) => m.open + m.overdue + m.done)); const w = 480; const h = 100; const bw = w / Math.max(1, d.months.length);
  return (
    <section aria-labelledby="ob-h" data-testid="ctr-obligations"><PageHeader id="ob-h" title={t('ob.title')} subtitle={t('ob.intro', { from: fmtDate(d.from), to: fmtDate(d.to) })} /><ErrorLine error={error} id="ctr-error" />{note && <p className="mdm-banner" role="status" data-testid="ctr-note">{note}</p>}
      <KpiRow data-testid="ctr-ob-counts">{[['overdue', 'REJECTED', 'error'], ['dueSoon', 'RETURNED', 'warning'], ['open', 'IN_REVIEW', 'info'], ['done', 'APPROVED', 'success']].map(([k, status, tone]) => { const state = { overdue: 'OVERDUE', dueSoon: 'DUE_SOON', open: 'OPEN', done: 'DONE' }[k]; return <KpiTile key={k} label={t(`ob.c.${k}`)} value={d.counts[k]} kind="time" tone={tone} onClick={() => setF({ ...f, state })} pressed={f.state === state} data-testid={`ctr-ob-count-${k}`}><StatusBadge status={status} label={t(`ob.c.${k}`)} size="sm" /></KpiTile>; })}</KpiRow>
      <div className="mdm-panel no-print"><div className="form-grid"><Field label={t('k.state')} name="state" error={null}><select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} style={big} data-testid="ctr-ob-state">{['ALL', 'OVERDUE', 'DUE_SOON', 'OPEN', 'DONE'].map((k) => <option key={k} value={k}>{t(`ob.s.${k}`)}</option>)}</select></Field>
        <label style={{ minHeight: 48 }}><input type="checkbox" checked={f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked })} data-testid="ctr-ob-mine" /> {t('ob.mine')}</label></div>
        <div className="actions-row"><button type="button" className="btn" onClick={() => ctr.exportFile(`/obligations/export${query}`, 'obligations.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="ctr-ob-export">{t('ob.export')}</button></div></div>
      {d.months.length > 0 && <figure data-testid="ctr-ob-chart"><figcaption>{t('ob.byMonth')}</figcaption><svg viewBox={`0 0 ${w} ${h + 18}`} role="img" aria-label={t('ob.byMonth')} style={{ width: '100%', maxWidth: 560, height: 'auto' }}>{d.months.map((m, i) => { const tot = m.open + m.overdue + m.done; const bh = Math.round((tot / max) * h); const oh = Math.round((m.overdue / max) * h); return <g key={m.month}><rect x={i * bw + 3} y={h - bh} width={bw - 6} height={bh} fill="currentColor" opacity="0.45"><title>{`${m.month}: ${tot}`}</title></rect><rect x={i * bw + 3} y={h - oh} width={bw - 6} height={oh} fill="currentColor" opacity="0.9"><title>{`${m.month}: ${m.overdue} ${t('ob.c.overdue')}`}</title></rect><text x={i * bw + bw / 2} y={h + 13} fontSize="9" textAnchor="middle" fill="currentColor">{m.month.slice(2)}</text></g>; })}</svg></figure>}
      {d.rows.length === 0 ? <div className="empty-state"><h2>{t('ob.emptyTitle')}</h2><p>{t('ob.emptyBody')}</p><Link to="/ctr/contracts">{t('k.register')}</Link></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="ctr-ob-table"><thead><tr><th>{t('k.due')}</th><th>{t('k.obligation')}</th><th>{t('ob.contract')}</th><th>{t('k.owner')}</th><th>{t('k.recurrence')}</th><th>{t('k.state')}</th><th /></tr></thead>
          <tbody>{d.rows.map((o) => <tr key={o.id} data-testid="ctr-ob-row" data-state={o.state}><td>{fmtDate(o.dueDate)}</td><td>{o.description}{o.clause ? ` (${t('k.clauseNo')} ${o.clause})` : ''}</td><td><Link to={`/ctr/contracts?id=${o.contractId}`}>{o.contractNo}</Link> · {o.project}</td><td>{o.owner}</td><td>{t(`k.r.${o.recurrence}`)}</td><td><StatusBadge status={OB_TONE[o.state]} label={t(`k.os.${o.state}`)} /></td>
            <td>{o.status === 'OPEN' && canDone && <button type="button" className="btn" disabled={busy} onClick={() => { const n = globalThis.prompt(t('k.doneWhat')); if (n) run(() => ctr.post(`/obligations/${o.id}/complete`, { note: n }), t('k.done')); }} data-testid="ctr-ob-done">{t('k.markDone')}</button>}</td></tr>)}</tbody></table></div>)}
    </section>
  );
}
function AmendForm({ onSave, busy, error, contractId }) {
  const t = useT('ctr'); const o = useQuery({ queryKey: ['ctr', 'amend-options'], queryFn: () => ctr.get('/amendments/options'), retry: false }); const [v, setV] = useState({ contractId: contractId ?? '', kind: 'AMENDMENT', description: '', referenceNo: '', signedDate: '', valueChange: '0', newCompletion: '', ldCapPct: '', dlpMonths: '' }); const fe = error?.fields ?? {};
  if (o.error?.status === 403) return <NoPermission what={t('am.title')} permission="ctr.amendment.create" />; if (o.isPending) return <Skeleton label={t('am.title')} rows={3} />;
  const terms = { ...(v.ldCapPct !== '' ? { ldCapPct: Number(v.ldCapPct) } : {}), ...(v.dlpMonths !== '' ? { dlpMonths: Number(v.dlpMonths) } : {}) };
  return (<div className="mdm-panel" data-testid="ctr-am-form"><div className="form-grid">
    <Field label={t('ob.contract')} name="contractId" error={fe.contractId}><select value={v.contractId} onChange={(e) => setV({ ...v, contractId: e.target.value })} style={big} data-testid="ctr-am-contract"><option value="">—</option>{o.data.contracts.map((k) => <option key={k.id} value={k.id}>{k.contractNo} {k.title}</option>)}</select></Field>
    <Field label={t('k.kind')} name="kind" error={null}><select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} style={big}>{['AMENDMENT', 'SUPPLEMENTARY'].map((k) => <option key={k} value={k}>{t(`am.k.${k}`)}</option>)}</select></Field>
    <Field label={t('am.valueChange')} name="valueChange" error={fe.valueChange}><input type="number" step="any" value={v.valueChange} onChange={(e) => setV({ ...v, valueChange: e.target.value })} style={big} data-testid="ctr-am-value" /></Field>
    <Field label={t('am.newCompletion')} name="newCompletion" error={fe.newCompletion}><input type="date" value={v.newCompletion} onChange={(e) => setV({ ...v, newCompletion: e.target.value })} style={big} data-testid="ctr-am-completion" /></Field>
    <Field label={t('k.ldCap')} name="ldCapPct" error={null}><input type="number" min="0" step="any" value={v.ldCapPct} onChange={(e) => setV({ ...v, ldCapPct: e.target.value })} style={big} /></Field><Field label={t('k.dlp')} name="dlpMonths" error={null}><input type="number" min="0" value={v.dlpMonths} onChange={(e) => setV({ ...v, dlpMonths: e.target.value })} style={big} /></Field>
    <Field label={t('am.reference')} name="referenceNo" error={null}><input value={v.referenceNo} onChange={(e) => setV({ ...v, referenceNo: e.target.value })} style={big} /></Field><Field label={t('am.signed')} name="signedDate" error={null}><input type="date" value={v.signedDate} onChange={(e) => setV({ ...v, signedDate: e.target.value })} style={big} /></Field></div>
    <Field label={t('am.description')} name="description" error={fe.description}><textarea rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} style={{ width: '100%' }} data-testid="ctr-am-desc" /></Field>
    <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.contractId || v.description.length < 5} onClick={() => onSave({ contractId: Number(v.contractId), kind: v.kind, description: v.description, referenceNo: v.referenceNo || null, signedDate: v.signedDate || null, valueChange: Number(v.valueChange || 0), newCompletion: v.newCompletion || null, terms })} data-testid="ctr-am-save">{t('save')}</button></div></div>);
}
function Amendment({ id }) {
  const t = useT('ctr'); const { q, guard } = useRecord('/amendments', id, t('am.title'), 'ctr.amendment.view'); const { error, run, busy, note } = useRunner(); usePageTitle(t('am.title')); if (guard) return guard; const x = q.data; const c = x.current ?? {};
  return (
    <div data-testid="ctr-am-object" data-status={x.status}><PageHeader id="am-h" title={<>{x.docNo} <Status x={x} /></>} meta={<><Link to="/ctr/amendments">{t('am.title')}</Link> · <Link to={`/ctr/contracts?id=${x.contractId}`}>{x.contractNo}</Link> · {t('k.amendNo', { n: x.no })} · {t(`am.k.${x.kind}`)}</>} /><ErrorLine error={error} id="ctr-error" />{note && <p className="mdm-banner" role="status">{note}</p>}
      <p>{x.description}</p>
      <div className="table-scroll"><table className="data-table" data-testid="ctr-am-compare"><caption>{t('am.compare')}</caption><thead><tr><th /><th>{t('am.now')}</th><th>{t('am.proposed')}</th></tr></thead><tbody>
        <tr><th scope="row">{t('k.v.revised')}</th><td>{money(c.revised)}</td><td data-testid="ctr-am-after">{c.revised == null || x.valueChange == null ? '—' : money(Math.round((c.revised + x.valueChange) * 100) / 100)}</td></tr>
        <tr><th scope="row">{t('k.completion')}</th><td>{c.completion ? fmtDate(c.completion) : '—'}</td><td>{x.newCompletion ? fmtDate(x.newCompletion) : '—'}</td></tr>
        {'ldCapPct' in x.terms && <tr><th scope="row">{t('k.ldCap')}</th><td>{c.ldCapPct}%</td><td>{x.terms.ldCapPct}%</td></tr>}{'dlpMonths' in x.terms && <tr><th scope="row">{t('k.dlp')}</th><td>{c.dlpMonths}</td><td>{x.terms.dlpMonths}</td></tr>}</tbody></table></div>
      {x.can.edit && <div className="actions-row no-print"><button type="button" className="btn" disabled={busy} onClick={() => { const val = globalThis.prompt(t('am.valueChange'), String(x.valueChange ?? 0)); if (val != null) run(() => ctr.edit('/amendments', x.id, { valueChange: Number(val), rowVersion: x.version }), t('k.saved')); }} data-testid="ctr-am-edit-value">{t('am.editValue')}</button></div>}
      <DocBar kind="/amendments" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
export function AmendmentsPage() {
  const t = useT('ctr'); usePageTitle(t('am.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const { error, run, busy } = useRunner();
  if (id) return <section aria-labelledby="am-h"><Amendment id={id} /></section>;
  if (sp.get('new')) return <section aria-labelledby="amn-h"><PageHeader id="amn-h" title={t('am.new')} meta={<Link to="/ctr/amendments">{t('am.title')}</Link>} /><ErrorLine error={error} id="ctr-error" /><AmendForm contractId={sp.get('contractId')} busy={busy} error={error} onSave={async (v) => { const r = await run(() => ctr.make('/amendments', v)); if (r) navigateTo(`/ctr/amendments?id=${r.id}`); }} /></section>;
  return (
    <section aria-labelledby="ams-h" data-testid="ctr-amendments"><PageHeader id="ams-h" title={t('am.title')} subtitle={t('am.intro')} />
      <div className="actions-row no-print"><Link to="/ctr/amendments?new=1" data-testid="ctr-am-new">{t('am.new')}</Link> · <Link to="/ctr/contracts">{t('k.register')}</Link></div>
      <ListReport listCode="ctr.amendments" endpoint="/ctr/amendments" title={t('am.title')} session={session.data} rowHref={(r) => `/ctr/amendments?id=${r.id}`} onOpen={(r) => navigateTo(`/ctr/amendments?id=${r.id}`)} cardFields={['docNo', 'contractNo', 'kind', 'status']} statusKey="status" empty={{ title: t('am.emptyTitle'), text: t('am.emptyBody') }} />
    </section>
  );
}
