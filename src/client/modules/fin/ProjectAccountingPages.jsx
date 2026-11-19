import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import Chart from '../../platform/charts/Chart.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { JN_TONE, gl, money, pa } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';

// Part 23.10: revenue recognition of a project for a month (choose, preview with the calculation and the journal, send for approval; the record with its
// approval, amendment and print) and the project accounts (project trial balance, WIP and unbilled revenue, the overhead allocated).
const big = { minHeight: 48, fontSize: '1rem' };
const can = (session, p) => Boolean(session?.permissions?.includes(p));
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const lastMonth = () => { const d = new Date(`${istToday().slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const fyStartOf = (t) => { const y = Number(t.slice(0, 4)); return `${Number(t.slice(5, 7)) >= 4 ? y : y - 1}-04-01`; };
const guardOf = (q, what, permission) => (q.error?.status === 403 || q.error?.status === 404 ? <NoPermission what={what} permission={permission} /> : q.isPending ? <Skeleton label={what} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : null);
const Pills = ({ tabs, tab, setTab, label, prefix }) => <div className="actions-row" role="tablist" aria-label={label}>{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} style={{ minHeight: 44 }} onClick={() => setTab(k)} data-testid={`${prefix}-${k}`}>{l}</button>)}</div>;
const Rows = ({ rows }) => <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(8rem, max-content) 1fr', gap: '4px 12px', margin: 0 }}>{rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt className="muted">{k}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{v}</dd></div>)}</dl>;
const pct = (v) => `${Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} %`;

function Decide({ x, run, busy, t }) {
  const [comment, setComment] = useState(''); const [err, setErr] = useState(null);
  if (!x?.can?.approve || !x.can.taskId) return null;
  const go = (a) => { if (a !== 'approve' && comment.trim().length < 5) { setErr(t('rr.sayWhy')); return; } run(() => gl.decide(x.can.taskId, a, comment.trim() || null), t(`rr.done.${a}`)); };
  return <div className="mdm-panel no-print" data-testid="rr-decide"><h2>{t('rr.decision')}</h2>{err && <p className="field-error" role="alert">{err}</p>}<label>{t('rr.comment')}<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></label>
    <div className="actions-row ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => go('approve')} data-testid="rr-approve">{t('rr.approve')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => go('return')}>{t('rr.return')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => go('reject')}>{t('rr.reject')}</button></div></div>;
}
/** The figures of a recognition (preview or record), the trace of each input and the journal. */
function Figures({ x, t }) {
  return (<>
    <KpiRow label={t('rr.figures')}><KpiTile label={t('rr.poc')} value={pct(x.pocPct)} valueTestid="rr-poc" /><KpiTile label={t('rr.thisMonth')} value={money(x.recognisedPeriod)} amount={x.recognisedPeriod} kind="money" valueTestid="rr-period" /><KpiTile label={x.unbilled ? t('rr.unbilled') : t('rr.excess')} value={money(x.unbilled || x.excess)} amount={x.unbilled || x.excess} kind="money" /><KpiTile label={t('rr.provision')} value={money(x.lossProvision)} amount={x.lossProvision} kind="money" /></KpiRow>
    <div className="mdm-panel"><Rows rows={[[t('rr.method'), x.methodLabel], [t('rr.costToDate'), money(x.costToDate)], [t('rr.eac'), x.eac ? `${money(x.eac)} (${x.eacRef ?? x.eacSource})` : null], [t('rr.output'), x.output ? money(x.output) : null], [t('rr.contractRevenue'), money(x.contractRevenue)], [t('rr.recognisedCum'), money(x.recognisedCum)], [t('rr.recognisedPrev'), money(x.recognisedPrev)], [t('rr.billed'), money(x.billed)], [t('rr.expectedLoss'), x.expectedLoss ? money(x.expectedLoss) : null]]} /></div>
    {x.trace && Object.keys(x.trace).length > 0 && <details className="mdm-panel"><summary style={{ minHeight: 44 }}>{t('rr.howWorked')}</summary><Rows rows={Object.entries(x.trace).map(([k, v]) => [t(`rr.tr.${k}`), v])} /></details>}
    {x.journal?.length > 0 && <div className="mdm-panel" data-testid="rr-journal"><h2>{x.journalId ? t('rr.journalPosted') : t('rr.journalProjected')}</h2><ul className="lp-list">{x.journal.map((l, i) => <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, minHeight: 44, alignItems: 'center', flexWrap: 'wrap' }}><span>{l.code} {l.name ?? ''}</span><span className="num">{l.debit ? `Dr ${money(l.debit)}` : `Cr ${money(l.credit)}`}</span></li>)}</ul></div>}
  </>);
}
function Record({ id }) {
  const t = useT('pa'); const q = useQuery({ queryKey: ['gl', 'rr', id], queryFn: () => pa.get(id), retry: false }); const { error, note, busy, run } = useGlRunner(); const [mode, setMode] = useState(null); const [reason, setReason] = useState(''); usePageTitle(t('rr.title'));
  const g = guardOf(q, t('rr.title'), 'fin.revenue_recognition.view'); if (g) return g; const x = q.data; const c = x.can;
  const act = (a, msg, body) => run(() => pa.act(x.id, a, body), t(msg)).then((r) => { if (r && a === 'amend') navigateTo(`/finance/revenue-recognition?id=${r.id}`); setMode(null); });
  return (
    <section aria-labelledby="rr-h" data-testid="rr-record">
      <PageHeader id="rr-h" title={`${x.docNo} · ${x.project}`} subtitle={`${t('rr.month')} ${x.period}`} meta={<StatusBadge status={JN_TONE[x.status] ?? 'CANCELLED'} label={t(`rr.st.${x.status}`)} />} />
      <p><Link to="/finance/revenue-recognition">{t('rr.back')}</Link></p>
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <Figures x={x} t={t} />
      <Decide x={x} run={run} busy={busy} t={t} />
      <div className="actions-row ff-actionbar">
        {c.recompute && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => pa.update(x.id, { version: x.version }), t('rr.recomputed'))}>{t('rr.recompute')}</button>}
        {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => pa.act(x.id, 'submit'), t('rr.sent'))} data-testid="rr-submit">{t('rr.submit')}</button>}
        {c.delete && <button type="button" className="btn" style={big} disabled={busy} onClick={() => globalThis.confirm?.(t('rr.confirmDelete')) && run(() => pa.remove(x.id), t('rr.deleted')).then((r) => r && navigateTo('/finance/revenue-recognition'))}>{t('rr.delete')}</button>}
        {(c.withdraw || c.cancel || c.amend) && <button type="button" className="btn" style={big} onClick={() => setMode(mode ? null : c.amend ? 'amend' : c.withdraw ? 'withdraw' : 'cancel')}>{c.amend ? t('rr.amend') : c.withdraw ? t('rr.withdraw') : t('rr.cancel')}</button>}
        <button type="button" className="btn" style={big} onClick={() => gl.file(`/revenue-recognition/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => globalThis.alert?.(t('rr.fileFailed')))}>{t('rr.print')}</button>
      </div>
      {mode && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); act(mode, `rr.${mode}Done`, { reason }); }}><Field label={t('rr.reason')} name="reason" error={error?.fields?.reason}><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></Field><div className="ff-actionbar"><button type="submit" className="btn btn-primary" style={big} disabled={busy || reason.trim().length < 5}>{t(`rr.${mode}`)}</button></div></form>}
      {x.history?.approvals?.length > 0 && <div className="mdm-panel"><h2>{t('rr.history')}</h2><ul className="lp-list">{x.history.approvals.map((h, i) => <li key={i} style={{ minHeight: 44 }}>{String(h.at).slice(0, 16).replace('T', ' ')} · {h.event}{h.step_code ? ` (${h.step_code})` : ''} · {h.actor}{h.comment ? ` · ${h.comment}` : ''}</li>)}</ul></div>}
    </section>
  );
}
/** The run of a month: 1 choose the project, 2 preview, 3 save and send. */
function Run() {
  const t = useT('pa'); const session = useSession(); const [period, setPeriod] = useState(lastMonth()); const [step, setStep] = useState('choose'); const [f, setF] = useState({ projectId: '', method: 'COST_TO_COST', surveyPct: '', surveyNote: '' }); const { error, note, busy, run } = useGlRunner();
  const cq = useQuery({ queryKey: ['gl', 'rr-cand', period], queryFn: () => pa.candidates({ period }), retry: false }); const [pv, setPv] = useState(null);
  const body = () => ({ projectId: Number(f.projectId), period, method: f.method, ...(f.method === 'OUTPUT' && f.surveyPct !== '' ? { surveyPct: Number(f.surveyPct), surveyNote: f.surveyNote || null } : {}) });
  const preview = async () => { const r = await run(() => pa.preview(body())); if (r) { setPv(r); setStep('preview'); } };
  const save = async (send) => { const r = await run(async () => { const x = await pa.create(body()); if (send) await pa.act(x.id, 'submit'); return x; }, send ? t('rr.sent') : t('rr.saved')); if (r) navigateTo(`/finance/revenue-recognition?id=${r.id}`); };
  const g = guardOf(cq, t('rr.title'), 'fin.revenue_recognition.view'); const rows = cq.data ?? []; const writer = can(session.data, 'fin.revenue_recognition.create');
  return (
    <div data-testid="rr-run">
      <Pills tabs={[['choose', `1 · ${t('rr.choose')}`], ['preview', `2 · ${t('rr.preview')}`]]} tab={step} setTab={(k) => (k === 'choose' || pv) && setStep(k)} label={t('rr.run')} prefix="rr-step" />
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      {step === 'choose' && <>
        <div className="form-grid"><Field label={t('rr.month')} name="period" error={error?.fields?.period}><input type="month" value={period} onChange={(e) => { setPeriod(e.target.value); setPv(null); }} style={big} data-testid="rr-period-input" /></Field>
          <Field label={t('rr.method')} name="method" error={null}><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} style={big}><option value="COST_TO_COST">{t('rr.m.COST_TO_COST')}</option><option value="OUTPUT">{t('rr.m.OUTPUT')}</option></select></Field>
          {f.method === 'OUTPUT' && <><Field label={t('rr.surveyPct')} name="surveyPct" error={error?.fields?.surveyPct}><input inputMode="decimal" value={f.surveyPct} onChange={(e) => setF({ ...f, surveyPct: e.target.value })} style={big} placeholder={t('rr.surveyHint')} /></Field><Field label={t('rr.surveyNote')} name="surveyNote" error={error?.fields?.surveyNote}><input value={f.surveyNote} onChange={(e) => setF({ ...f, surveyNote: e.target.value })} style={big} /></Field></>}</div>
        {g ?? (rows.length === 0 ? <EmptyState compact title={t('rr.noProjects')} message={t('rr.noProjectsBody')} /> : <ul className="lp-list" aria-label={t('rr.projects')}>{rows.map((p) => <li key={p.projectId} className="mdm-panel" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 12, margin: '6px 0' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}><input type="radio" name="rr-project" checked={String(f.projectId) === String(p.projectId)} onChange={() => setF({ ...f, projectId: p.projectId })} disabled={Boolean(p.recognitionId)} /> {p.project}</label>
          {p.recognitionId ? <Link to={`/finance/revenue-recognition?id=${p.recognitionId}`}>{p.docNo} · {t(`rr.st.${p.status}`)}</Link> : <span className="muted">{t('rr.notYet')}</span>}</li>)}</ul>)}
        <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy || !f.projectId} onClick={preview} data-testid="rr-preview">{t('rr.previewGo')}</button></div>
      </>}
      {step === 'preview' && pv && <>
        <h2>{pv.project} · {period}</h2><Figures x={pv} t={t} />
        {writer && <div className="ff-actionbar"><button type="button" className="btn" style={big} disabled={busy} onClick={() => save(false)}>{t('rr.saveDraft')}</button><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => save(true)} data-testid="rr-send">{t('rr.saveSend')}</button></div>}
      </>}
    </div>
  );
}
function List() {
  const t = useT('pa'); const [period, setPeriod] = useState(''); const q = useQuery({ queryKey: ['gl', 'rr-list', period], queryFn: () => pa.list({ pageSize: 50, ...(period ? { 'filter[period]': period } : {}) }), retry: false });
  const g = guardOf(q, t('rr.title'), 'fin.revenue_recognition.view'); const rows = q.data?.data ?? [];
  return (<div data-testid="rr-list"><div className="form-grid"><Field label={t('rr.month')} name="lperiod" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} /></Field></div>
    {g ?? (rows.length === 0 ? <EmptyState compact title={t('rr.none')} message={t('rr.noneBody')} /> : <ul className="lp-list">{rows.map((x) => <li key={x.id} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><Link to={`/finance/revenue-recognition?id=${x.id}`} style={{ display: 'grid', gap: 4, minHeight: 44 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{x.docNo} · {x.project}</strong><StatusBadge status={JN_TONE[x.status] ?? 'CANCELLED'} label={t(`rr.st.${x.status}`)} /></span>
      <span className="muted small">{x.period} · {x.methodLabel} · {t('rr.poc')} {pct(x.pocPct)} · {t('rr.thisMonth')} {money(x.recognisedPeriod)}{x.unbilled ? ` · ${t('rr.unbilled')} ${money(x.unbilled)}` : ''}{x.excess ? ` · ${t('rr.excess')} ${money(x.excess)}` : ''}</span></Link></li>)}</ul>)}
    <div className="actions-row"><button type="button" className="btn" style={big} onClick={() => gl.file('/revenue-recognition/export', 'revenue-recognition.csv').catch(() => globalThis.alert?.(t('rr.fileFailed')))}>{t('rr.export')}</button></div></div>);
}
export function RevenueRecognitionPage() {
  const t = useT('pa'); usePageTitle(t('rr.title')); const sp = useSearch(); const session = useSession(); const id = Number(sp.get('id')) || null; const [tab, setTab] = useState(can(session.data, 'fin.revenue_recognition.create') ? 'run' : 'list');
  if (id) return <Record id={id} />;
  return (<section aria-labelledby="rrp-h" data-testid="rr-page"><PageHeader id="rrp-h" title={t('rr.title')} subtitle={t('rr.intro')} meta={<Link to="/finance/project-accounts">{t('pa.title')}</Link>} />
    <Pills tabs={[...(can(session.data, 'fin.revenue_recognition.create') ? [['run', t('rr.run')]] : []), ['list', t('rr.records')]]} tab={tab} setTab={setTab} label={t('rr.title')} prefix="rr-tab" />
    {tab === 'run' ? <Run /> : <List />}</section>);
}

// ---- the project accounts ----
function TrialBalance() {
  const t = useT('pa'); const [f, setF] = useState({ projectId: '', from: fyStartOf(istToday()), to: istToday() }); const cq = useQuery({ queryKey: ['gl', 'pa-projects'], queryFn: () => pa.candidates({ period: istToday().slice(0, 7) }), retry: false });
  const q = useQuery({ queryKey: ['gl', 'pa-tb', f], queryFn: () => pa.tb(f), retry: false, enabled: Boolean(f.projectId) }); const x = q.data;
  return (<div data-testid="pa-tb"><div className="form-grid"><Field label={t('pa.project')} name="project" error={null}><select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })} style={big} data-testid="pa-tb-project"><option value="">{t('pa.chooseProject')}</option>{(cq.data ?? []).map((p) => <option key={p.projectId} value={p.projectId}>{p.project}</option>)}</select></Field>
    <Field label={t('pa.from')} name="from" error={null}><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={big} /></Field><Field label={t('pa.to')} name="to" error={null}><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={big} /></Field></div>
    {!f.projectId ? <EmptyState compact title={t('pa.chooseProject')} message={t('pa.chooseBody')} /> : guardOf(q, t('pa.tb'), 'fin.project_ledger.view') ?? <>
      <KpiRow label={t('pa.tb')}><KpiTile label={t('pa.revenue')} value={money(x.heads.revenue)} amount={x.heads.revenue} kind="money" valueTestid="pa-revenue" /><KpiTile label={t('pa.directCost')} value={money(x.heads.directCost)} amount={x.heads.directCost} kind="money" /><KpiTile label={t('pa.overhead')} value={money(x.heads.overhead)} amount={x.heads.overhead} kind="money" /><KpiTile label={t('pa.margin')} value={money(x.heads.margin)} amount={x.heads.margin} kind="money" /></KpiRow>
      <div className="mdm-panel"><Chart type="bar" data={{ categories: [t('pa.revenue'), t('pa.directCost'), t('pa.overhead'), t('pa.margin')], series: [{ name: t('pa.amount'), values: [x.heads.revenue, x.heads.directCost, x.heads.overhead, x.heads.margin].map((v) => Math.round(v)) }], unit: '₹' }} title={t('pa.heads')} exportName="project-heads" tableSwitch /></div>
      <ul className="lp-list" aria-label={t('pa.tb')}>{x.rows.map((r) => <li key={r.accountId} className="mdm-panel" style={{ display: 'grid', gap: 4, padding: 12, margin: '6px 0' }}><span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{r.code} {r.name}</strong><span className="num">{money(r.closing)}</span></span><span className="muted small">{t(`pa.h.${r.head}`)} · {t('pa.opening')} {money(r.opening)} · Dr {money(r.debit)} · Cr {money(r.credit)}</span></li>)}</ul>
      <div className="ff-actionbar"><span>Dr <strong>{money(x.totals.debit)}</strong></span><span>Cr <strong>{money(x.totals.credit)}</strong></span><button type="button" className="btn" style={big} onClick={() => gl.file(`/project-accounts/export?kind=tb&projectId=${f.projectId}&from=${f.from}&to=${f.to}`, 'project-trial-balance.csv').catch(() => globalThis.alert?.(t('rr.fileFailed')))}>{t('rr.export')}</button></div></>}
  </div>);
}
function Wip() {
  const t = useT('pa'); const [period, setPeriod] = useState(istToday().slice(0, 7)); const q = useQuery({ queryKey: ['gl', 'pa-wip', period], queryFn: () => pa.wip({ period }), retry: false }); const g = guardOf(q, t('pa.wip'), 'fin.project_ledger.view'); const x = q.data;
  return (<div data-testid="pa-wip"><div className="form-grid"><Field label={t('rr.month')} name="wperiod" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} /></Field></div>
    {g ?? (x.rows.length === 0 ? <EmptyState compact title={t('pa.noWip')} message={t('pa.noWipBody')} /> : <>
      <KpiRow label={t('pa.wip')}><KpiTile label={t('rr.unbilled')} value={money(x.totals.unbilled)} amount={x.totals.unbilled} kind="money" valueTestid="pa-unbilled" /><KpiTile label={t('rr.excess')} value={money(x.totals.excess)} amount={x.totals.excess} kind="money" /><KpiTile label={t('rr.recognisedCum')} value={money(x.totals.recognisedCum)} amount={x.totals.recognisedCum} kind="money" /><KpiTile label={t('rr.provision')} value={money(x.totals.lossProvision)} amount={x.totals.lossProvision} kind="money" /></KpiRow>
      <div className="mdm-panel"><Chart type="bar" data={{ categories: x.rows.map((r) => r.project.split(' ')[0]), series: [{ name: t('rr.recognisedCum'), values: x.rows.map((r) => Math.round(r.recognisedCum)) }, { name: t('rr.billed'), values: x.rows.map((r) => Math.round(r.billed)) }], unit: '₹' }} title={t('pa.wipChart')} exportName={`wip-${period}`} tableSwitch /></div>
      <ul className="lp-list">{x.rows.map((r) => <li key={r.id} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><Link to={`/finance/revenue-recognition?id=${r.id}`} style={{ display: 'grid', gap: 4, minHeight: 44 }}><strong>{r.project}</strong><span className="muted small">{r.period} · {t('rr.poc')} {pct(r.pocPct)} · {t('rr.recognisedCum')} {money(r.recognisedCum)} · {t('rr.billed')} {money(r.billed)} · {r.unbilled ? `${t('rr.unbilled')} ${money(r.unbilled)}` : `${t('rr.excess')} ${money(r.excess)}`}</span></Link></li>)}</ul>
      <div className="ff-actionbar"><button type="button" className="btn" style={big} onClick={() => gl.file(`/project-accounts/export?kind=wip&period=${period}`, `wip-${period}.csv`).catch(() => globalThis.alert?.(t('rr.fileFailed')))}>{t('rr.export')}</button></div></>)}
  </div>);
}
function Overheads() {
  const t = useT('pa'); const [f, setF] = useState({ from: fyStartOf(istToday()).slice(0, 7), to: istToday().slice(0, 7) }); const q = useQuery({ queryKey: ['gl', 'pa-oh', f], queryFn: () => pa.overheads(f), retry: false }); const { error, note, busy, run } = useGlRunner(); const g = guardOf(q, t('pa.overheads'), 'fin.project_ledger.view'); const x = q.data;
  return (<div data-testid="pa-oh"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}<div className="form-grid"><Field label={t('pa.fromMonth')} name="ofrom" error={null}><input type="month" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={big} /></Field><Field label={t('pa.toMonth')} name="oto" error={null}><input type="month" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={big} /></Field></div>
    {g ?? <>
      {x.unposted.length > 0 && <div className="mdm-banner" role="status">{t('pa.unposted', { n: x.unposted.length })}{x.canPost && <> <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => pa.catchUp(), t('pa.caughtUp')).then(() => q.refetch())} data-testid="pa-catchup">{t('pa.postNow')}</button></>}</div>}
      {x.rows.length === 0 ? <EmptyState compact title={t('pa.noOverheads')} message={t('pa.noOverheadsBody')} /> : <>
        <KpiRow label={t('pa.overheads')}><KpiTile label={t('pa.allocated')} value={money(x.total)} amount={x.total} kind="money" valueTestid="pa-oh-total" /><KpiTile label={t('pa.projectsN')} value={String(x.byProject.length)} /></KpiRow>
        <div className="mdm-panel"><Chart type="bar" data={{ categories: x.byProject.map((r) => r.project.split(' ')[0]), series: [{ name: t('pa.allocated'), values: x.byProject.map((r) => Math.round(r.amount)) }], unit: '₹' }} title={t('pa.ohChart')} exportName="overheads" tableSwitch /></div>
        <ul className="lp-list">{x.rows.map((r) => <li key={r.id} className="mdm-panel" style={{ display: 'grid', gap: 4, padding: 12, margin: '6px 0' }}><span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{r.pool} · {r.project}</strong><span className="num">{money(r.amount)}</span></span><span className="muted small">{r.period} · {t(`pa.oh.${r.status}`)}</span></li>)}</ul>
        <div className="ff-actionbar"><button type="button" className="btn" style={big} onClick={() => gl.file(`/project-accounts/export?kind=overheads&from=${f.from}&to=${f.to}`, 'overheads.csv').catch(() => globalThis.alert?.(t('rr.fileFailed')))}>{t('rr.export')}</button></div></>}</>}
  </div>);
}
export function ProjectAccountsPage() {
  const t = useT('pa'); usePageTitle(t('pa.title')); const sp = useSearch(); const [tab, setTab] = useState(sp.get('tab') ?? 'tb');
  return (<section aria-labelledby="pa-h" data-testid="pa-page"><PageHeader id="pa-h" title={t('pa.title')} subtitle={t('pa.intro')} meta={<Link to="/finance/revenue-recognition">{t('rr.title')}</Link>} />
    <Pills tabs={[['tb', t('pa.tb')], ['wip', t('pa.wip')], ['oh', t('pa.overheads')]]} tab={tab} setTab={setTab} label={t('pa.title')} prefix="pa-tab" />
    {tab === 'tb' && <TrialBalance />}{tab === 'wip' && <Wip />}{tab === 'oh' && <Overheads />}</section>);
}
