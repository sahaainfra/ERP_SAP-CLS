import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { AttachmentPanel } from '../../platform/object/panels.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { bill, qs } from './api.js';
import { DocBar, ErrorLine, Status, big, useRecord, useRunner } from './BillParts.jsx';

// CVR Workbench (part 22.09): the monthly cost-value reconciliation of a project. The lines come from the owners; the claims, accruals and provisions are assessed here and each needs a note.
const mf = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); const money = (v) => (v == null ? '—' : `₹ ${mf.format(v)}`); const pctf = (v) => (v == null ? '—' : `${v} %`);
const thisMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);

function Lines({ lines, side }) {
  const t = useT('bill');
  return (
    <div className="table-scroll"><table className="data-table" data-testid={`bill-cvr-${side}`}><thead><tr><th>{t(`cvr.${side}`)}</th><th className="num">{t('cb.amount')}</th><th>{t('cvr.source')}</th></tr></thead>
      <tbody>{lines.map((l) => (
        <tr key={l.key} data-line={l.key}><td>{t(`cvr.l.${side}.${l.key}`)}{l.items?.length > 0 && <ul>{l.items.map((x, i) => <li key={i} className="muted">{x.claimNo ? `${x.claimNo} ${x.probabilityPct}% of ${money(x.claimed)}` : x.label}{x.note ? ` — ${x.note}` : ''}</li>)}</ul>}</td><td className="num" data-testid={`bill-cvr-${side}-${l.key}`}>{money(l.amount)}</td><td>{l.drill ? <Link to={l.drill}>{t('cvr.open')}</Link> : <span className="muted">{t('cvr.typed')}</span>}</td></tr>))}</tbody></table></div>
  );
}
function Totals({ x }) {
  const t = useT('bill');
  return (
    <div className="form-grid" data-testid="bill-cvr-totals">
      {[['value', money(x.value)], ['cost', money(x.cost)], ['margin', money(x.margin)], ['marginPct', pctf(x.marginPct)], ['budget', pctf(x.budgetMarginPct)], ['prev', pctf(x.prevMarginPct)], ['forecast', pctf(x.forecastMarginPct)]].map(([k, v]) => <div className="mdm-panel" key={k} data-testid={`bill-cvr-t-${k}`}><div className="muted">{t(`cvr.t.${k}`)}</div><strong style={{ fontSize: '1.3rem' }}>{v}</strong></div>)}
      {x.changePct != null && <div className="mdm-panel" data-testid="bill-cvr-change"><div className="muted">{t('cvr.t.change')}</div><strong>{x.changePct > 0 ? '▲' : x.changePct < 0 ? '▼' : '='} {Math.abs(x.changePct)} {t('cvr.points')}</strong></div>}
    </div>
  );
}

function Workbench() {
  const t = useT('bill'); const { error, run, busy } = useRunner(); const o = useQuery({ queryKey: ['bill', 'cvr-options'], queryFn: () => bill.get('/reports/options'), retry: false });
  const [v, setV] = useState({ projectId: '', period: thisMonth(), commentaryQs: '', probs: {}, accruals: [], valueProvisions: [], costProvisions: [] });
  const assessments = { claims: Object.entries(v.probs).filter(([, p]) => Number(p.pct) > 0).map(([claimId, p]) => ({ claimId: Number(claimId), probabilityPct: Number(p.pct), note: p.note || null })), accruals: v.accruals.filter((x) => Number(x.amount) > 0).map((x) => ({ label: x.label || '—', amount: Number(x.amount), note: x.note || null })), valueProvisions: v.valueProvisions.filter((x) => Number(x.amount) > 0).map((x) => ({ label: x.label || '—', amount: Number(x.amount), note: x.note || null })), costProvisions: v.costProvisions.filter((x) => Number(x.amount) > 0).map((x) => ({ kind: x.kind, amount: Number(x.amount), note: x.note || null })) };
  const body = v.projectId ? { projectId: Number(v.projectId), period: v.period, assessments } : null;
  const pv = useQuery({ queryKey: ['bill', 'cvr-preview', JSON.stringify(body)], queryFn: () => bill.post('/reports/preview', body), enabled: Boolean(body), retry: false, placeholderData: (p) => p });
  if (o.error?.status === 403) return <NoPermission what={t('cvr.new')} permission="bill.report.create" />; if (o.isPending) return <Skeleton label={t('cvr.new')} rows={4} />; if (o.isError) return <ErrorState error={o.error} onRetry={o.refetch} />;
  const d = o.data; const fe = error?.fields ?? {}; const set = (k) => (e) => setV({ ...v, [k]: e.target.value }); const upd = (key, i, k) => (e) => setV({ ...v, [key]: v[key].map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) }); const add = (key, row) => setV({ ...v, [key]: [...v[key], row] }); const del = (key, i) => setV({ ...v, [key]: v[key].filter((_, j) => j !== i) });
  const Rows = ({ k, kind }) => v[k].map((x, i) => (
    <div className="form-grid" key={i} data-testid={`bill-cvr-${k}-row`}>
      {kind === 'cost' ? <select value={x.kind} onChange={upd(k, i, 'kind')} style={big} aria-label={t('cvr.kind')}>{d.provisionKinds.map((p) => <option key={p.id} value={p.id}>{t(`cvr.pk.${p.id}`)}</option>)}</select> : <input value={x.label} onChange={upd(k, i, 'label')} style={big} placeholder={t('cvr.label')} aria-label={t('cvr.label')} />}
      <input type="number" min="0" step="any" value={x.amount} onChange={upd(k, i, 'amount')} style={big} placeholder={t('cb.amount')} aria-label={t('cb.amount')} data-testid={`bill-cvr-${k}-amount`} /><input value={x.note} onChange={upd(k, i, 'note')} style={big} placeholder={t('cvr.note')} aria-label={t('cvr.note')} data-testid={`bill-cvr-${k}-note`} /><button type="button" className="btn" onClick={() => del(k, i)}>{t('cvr.remove')}</button></div>));
  return (
    <form className="mdm-panel" data-testid="bill-cvr-form" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => bill.post('/reports', { projectId: Number(v.projectId), siteId: null, period: v.period, commentaryQs: v.commentaryQs || null, assessments })); if (r) navigateTo(`/bill/cvr?id=${r.id}`); }}>
      <ErrorLine error={error} id="bill-error" />
      <div className="form-grid"><Field label={t('project')} name="projectId" error={fe.projectId}><select value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value, probs: {} })} style={big} data-testid="bill-cvr-project"><option value="">—</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('cvr.month')} name="period" error={fe.period}><input type="month" value={v.period} onChange={set('period')} style={big} data-testid="bill-cvr-period" /></Field></div>
      {!body ? <p className="muted">{t('cvr.pick')}</p> : pv.isError ? <p className="field-error" role="alert" data-testid="bill-cvr-preview-error">{pv.error?.message}</p> : pv.isPending ? <Skeleton label={t('cvr.title')} rows={4} /> : (<div data-testid="bill-cvr-preview" data-margin={pv.data.margin}>
        <Totals x={pv.data} /><h2>{t('cvr.value')}</h2><Lines lines={pv.data.valueLines} side="value" /><h2>{t('cvr.cost')}</h2><Lines lines={pv.data.costLines} side="cost" />
        <h2>{t('cvr.claimsHead')}</h2>{pv.data.claimsOpen.length === 0 ? <p className="muted">{t('cvr.noClaims')}</p> : pv.data.claimsOpen.map((c) => (
          <div className="form-grid" key={c.claimId} data-testid="bill-cvr-claim"><div>{c.claimNo} {c.title}<div className="muted">{money(c.claimed)}</div></div>
            <input type="number" min="0" max="100" step="any" value={v.probs[c.claimId]?.pct ?? ''} onChange={(e) => setV({ ...v, probs: { ...v.probs, [c.claimId]: { ...v.probs[c.claimId], pct: e.target.value } } })} style={big} placeholder={t('cvr.prob')} aria-label={t('cvr.prob')} data-testid="bill-cvr-prob" />
            <input value={v.probs[c.claimId]?.note ?? ''} onChange={(e) => setV({ ...v, probs: { ...v.probs, [c.claimId]: { ...v.probs[c.claimId], note: e.target.value } } })} style={big} placeholder={t('cvr.note')} aria-label={t('cvr.note')} data-testid="bill-cvr-prob-note" /></div>))}
      </div>)}
      <h2>{t('cvr.accruals')}</h2><Rows k="accruals" /><button type="button" className="btn" onClick={() => add('accruals', { label: '', amount: '', note: '' })} data-testid="bill-cvr-add-accrual">{t('cvr.add')}</button>
      <h2>{t('cvr.valueProv')}</h2><Rows k="valueProvisions" /><button type="button" className="btn" onClick={() => add('valueProvisions', { label: '', amount: '', note: '' })} data-testid="bill-cvr-add-vprov">{t('cvr.add')}</button>
      <h2>{t('cvr.costProv')}</h2><Rows k="costProvisions" kind="cost" /><button type="button" className="btn" onClick={() => add('costProvisions', { kind: 'RECTIFICATION', amount: '', note: '' })} data-testid="bill-cvr-add-cprov">{t('cvr.add')}</button>
      <Field label={t('cvr.commentaryQs')} name="commentaryQs" error={fe.commentaryQs}><textarea value={v.commentaryQs} onChange={set('commentaryQs')} rows={3} style={big} maxLength={2000} data-testid="bill-cvr-commentary" /></Field>
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy || !body || pv.isError} data-testid="bill-cvr-save">{t('cb.saveDraft')}</button></div></form>
  );
}

function Report({ id }) {
  const t = useT('bill'); const { q, guard } = useRecord('/reports', id, t('cvr.one'), 'bill.report.view'); const { error, run } = useRunner(); const [note, setNote] = useState(''); const [tab, setTab] = useState('buildup'); usePageTitle(t('cvr.one'));
  if (guard) return guard; const x = q.data;
  return (
    <div data-testid="bill-cvr-object" data-status={x.status}><h1 id="cvr-h">{x.docNo} <Status x={x} /> {x.locked && <StatusBadge status="APPROVED" label={t('cvr.locked')} />}</h1>
      <p><Link to="/bill/cvr">{t('cvr.title')}</Link> · {x.project} · {x.period} · {t('cvr.asOf', { date: x.asOf })}</p>
      <Totals x={x} />
      <div className="actions-row no-print" role="tablist">{['buildup', 'commentary', 'documents'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)} data-testid={`bill-cvr-tab-${k}`}>{t(`cvr.tab.${k}`)}</button>)}</div>
      {tab === 'buildup' && <><h2>{t('cvr.value')}</h2><Lines lines={x.valueLines} side="value" /><h2>{t('cvr.cost')}</h2><Lines lines={x.costLines} side="cost" /></>}
      {tab === 'commentary' && <div data-testid="bill-cvr-comments"><h2>{t('cvr.commentaryQs')}</h2><p>{x.commentaryQs ?? '—'}</p><h2>{t('cvr.commentaryPm')}</h2><p data-testid="bill-cvr-pm-comment">{x.commentaryPm ?? '—'}</p>
        {x.can.comment && <form onSubmit={async (e) => { e.preventDefault(); const r = await run(() => bill.post(`/reports/${x.id}/comment`, { commentary: note })); if (r) { setNote(''); q.refetch(); } }}><ErrorLine error={error} id="bill-error" /><Field label={t('cvr.commentaryPm')} name="commentary" error={error?.fields?.commentary}><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={big} maxLength={2000} data-testid="bill-cvr-pm-input" /></Field><button type="submit" className="btn" data-testid="bill-cvr-pm-save">{t('cvr.addComment')}</button></form>}</div>}
      {tab === 'documents' && <AttachmentPanel type="bill_cvr_reports" id={x.id} entity="bill_cvr_reports" canEdit={x.can.edit} />}
      <DocBar kind="/reports" x={x} printName={`${x.docNo.replaceAll('/', '-')}.pdf`} />
    </div>
  );
}
export default function CvrPage() {
  const t = useT('bill'); usePageTitle(t('cvr.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="cvr-h"><Report id={id} /></section>;
  if (sp.get('new')) return <section aria-labelledby="cvrn-h"><h1 id="cvrn-h">{t('cvr.new')}</h1><p><Link to="/bill/cvr">{t('cvr.title')}</Link></p><Workbench /></section>;
  return (
    <section aria-labelledby="cvrs-h" data-testid="bill-cvr"><h1 id="cvrs-h">{t('cvr.title')}</h1><p className="muted">{t('cvr.intro')}</p>
      <div className="actions-row no-print"><Link to="/bill/cvr?new=1" data-testid="bill-cvr-new">{t('cvr.new')}</Link> · <Link to="/bill/control-tower">{t('ct.title')}</Link> · <Link to="/bill/qs-dashboard">{t('qd.title')}</Link></div>
      <ListReport listCode="bill.cvr" endpoint="/bill/reports" title={t('cvr.title')} session={session.data} rowHref={(r) => `/bill/cvr?id=${r.id}`} onOpen={(r) => navigateTo(`/bill/cvr?id=${r.id}`)} cardFields={['docNo', 'project', 'period', 'value', 'margin', 'status']} statusKey="status" empty={{ title: t('cvr.emptyTitle'), text: t('cvr.emptyBody') }} />
    </section>
  );
}

const FLAG_TONE = { LOSS: 'REJECTED', MARGIN_FALLING: 'RETURNED', NO_CVR: 'RETURNED', HIGH_RISK: 'RETURNED' };
export function ControlTowerPage() {
  const t = useT('bill'); usePageTitle(t('ct.title')); const sp = useSearch(); const [projectId, setProjectId] = useState(sp.get('projectId') ?? '');
  const o = useQuery({ queryKey: ['bill', 'tower-options'], queryFn: () => bill.get('/control-tower/options'), retry: false });
  const q = useQuery({ queryKey: ['bill', 'tower', projectId], queryFn: () => bill.get(`/control-tower${qs({ projectId })}`), retry: false, placeholderData: (p) => p });
  if (q.error?.status === 403) return <NoPermission what={t('ct.title')} permission="bill.control_tower.view" />; if (q.isPending) return <Skeleton label={t('ct.title')} rows={6} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const T = d.totals;
  return (
    <section aria-labelledby="ct-h" data-testid="bill-tower"><h1 id="ct-h">{t('ct.title')}</h1><p className="muted">{t('ct.intro', { date: d.asOf })}</p>
      <div className="mdm-panel no-print"><div className="form-grid"><Field label={t('project')} name="projectId" error={null}><select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={big} data-testid="bill-ct-project"><option value="">{t('qd.portfolio')}</option>{(o.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field></div>
        <div className="actions-row"><button type="button" className="btn" onClick={() => bill.exportFile(`/control-tower/export${qs({ projectId })}`, 'control-tower.csv')} data-testid="bill-ct-export">{t('rc.export')}</button> · <Link to="/bill/cvr">{t('cvr.title')}</Link> · <Link to="/bill/qs-dashboard">{t('qd.title')}</Link></div></div>
      {d.empty ? <div className="empty-state"><h2>{t('ct.emptyTitle')}</h2><p>{t('ct.emptyBody')}</p></div> : (<>
        <div className="form-grid" data-testid="bill-ct-tiles">{[['contracts', T.contracts], ['value', money(T.value)], ['billed', money(T.billed)], ['collected', money(T.collected)], ['outstanding', money(T.outstanding)], ['margin', T.marginMasked ? t('qd.masked') : money(T.margin)], ['variations', money(T.variations)], ['claims', money(T.claims)], ['guarantees', money(T.guaranteeAmount)], ['retention', money(T.retentionHeld)]].map(([k, v]) => <div className="mdm-panel" key={k} data-testid={`bill-ct-t-${k}`}><div className="muted">{t(`ct.t.${k}`)}</div><strong style={{ fontSize: '1.3rem' }}>{v}</strong></div>)}</div>
        <h2>{t('dash.exceptions')}</h2>{d.exceptions.length === 0 ? <p className="muted">{t('ct.noExceptions')}</p> : <ul data-testid="bill-ct-exceptions">{d.exceptions.map((e) => <li key={e.key} data-key={e.key}><StatusBadge status={FLAG_TONE[e.key]} label={t(`ct.f.${e.key}`)} /> {e.count}: {e.contracts.map((c) => c.contractNo).join(', ')}</li>)}</ul>}
        <div className="table-scroll"><table className="data-table" data-testid="bill-ct-table"><thead><tr><th>{t('rt.contract')}</th><th>{t('project')}</th><th className="num">{t('ct.t.value')}</th><th className="num">{t('ct.t.billed')}</th><th className="num">{t('ct.t.collected')}</th><th className="num">{t('ct.t.margin')}</th><th className="num">{t('ct.t.variations')}</th><th className="num">{t('ct.t.claims')}</th><th className="num">{t('ct.t.guarantees')}</th><th className="num">{t('ct.t.retention')}</th><th className="num">{t('ct.risks')}</th><th>{t('ct.flags')}</th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.contractId} data-testid="bill-ct-row" data-flags={r.flags.join(',')}><td><button type="button" className="btn" onClick={() => navigateTo(r.link)}>{r.contractNo}</button></td><td>{r.project}</td><td className="num">{money(r.value)}</td><td className="num">{money(r.billed)}{r.billedPct != null ? ` (${r.billedPct}%)` : ''}</td><td className="num">{money(r.collected)}</td>
              <td className="num" data-testid="bill-ct-margin">{r.marginMasked ? t('qd.masked') : r.cvr ? <Link to={`/bill/cvr?id=${r.cvr.id}`}>{money(r.margin)} ({pctf(r.marginPct)})</Link> : '—'}</td><td className="num">{r.variations.count} · {money(r.variations.value)}</td><td className="num">{r.claims.count} · {money(r.claims.value)}</td><td className="num">{r.securities.guarantees} · {money(r.securities.guaranteeAmount)}</td><td className="num">{money(r.securities.retentionHeld)}</td><td className="num">{r.risks.open} ({r.risks.high})</td>
              <td>{r.flags.map((f) => <StatusBadge key={f} status={FLAG_TONE[f]} label={t(`ct.f.${f}`)} />)}</td></tr>))}</tbody></table></div></>)}
    </section>
  );
}
