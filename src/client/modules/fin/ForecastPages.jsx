import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import Chart from '../../platform/charts/Chart.jsx';
import { EmptyState } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { JN_TONE, fc, gl, money } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';
import { Decide, Pills, Rows, big, can, guardOf, lastMonth, pct } from './finparts.jsx';

// Part 23.11: the forecast workbench (the projects of a month and their forecast; one forecast with its lines, the method of each, the EAC bridge chart and
// the approval) and the reports (the EAC trend of a project; forecast against budget for all projects).
const METHODS = ['REMAINING_BUDGET', 'CPI', 'BOTTOM_UP', 'COMMITTED_PLUS', 'MANUAL'];

function LineEditor({ x, l, run, busy, t, onDone }) {
  const [f, setF] = useState({ method: l.method, accrued: String(l.accrued ?? 0), remainingQty: l.remainingQty ?? '', rate: l.rate ?? '', manual: l.manual ?? '', notes: l.notes ?? '' });
  const save = () => run(() => fc.line(x.id, l.id, { method: f.method, accrued: Number(f.accrued || 0), ...(f.method === 'BOTTOM_UP' ? { remainingQty: f.remainingQty === '' ? null : Number(f.remainingQty), rate: f.rate === '' ? null : Number(f.rate) } : {}), ...(f.method === 'MANUAL' ? { manual: f.manual === '' ? null : Number(f.manual) } : {}), notes: f.notes || null }), t('fc.lineSaved')).then((r) => r && onDone());
  return (<div className="mdm-panel" data-testid="fc-line-edit"><div className="form-grid">
    <Field label={t('fc.method')} name="method" error={null}><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} style={big} data-testid="fc-line-method">{METHODS.map((m) => <option key={m} value={m}>{t(`fc.m.${m}`)}</option>)}</select></Field>
    <Field label={t('fc.accrued')} name="accrued" error={null}><input inputMode="decimal" value={f.accrued} onChange={(e) => setF({ ...f, accrued: e.target.value })} style={big} /></Field>
    {f.method === 'BOTTOM_UP' && <><Field label={t('fc.remainingQty')} name="remainingQty" error={null}><input inputMode="decimal" value={f.remainingQty} onChange={(e) => setF({ ...f, remainingQty: e.target.value })} style={big} placeholder={String(Math.max(0, l.budgetQty - l.actualQty))} /></Field><Field label={t('fc.rate')} name="rate" error={null}><input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} style={big} placeholder={t('fc.rateHint')} /></Field></>}
    {f.method === 'MANUAL' && <Field label={t('fc.manual')} name="manual" error={null}><input inputMode="decimal" value={f.manual} onChange={(e) => setF({ ...f, manual: e.target.value })} style={big} /></Field>}
    <Field label={f.method === 'MANUAL' ? t('fc.justification') : t('fc.notes')} name="notes" error={null}><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} style={big} /></Field></div>
    <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={save} data-testid="fc-line-save">{t('fc.saveLine')}</button><button type="button" className="btn" style={big} onClick={onDone}>{t('fc.close')}</button></div></div>);
}
function Forecast({ id }) {
  const t = useT('fc'); const q = useQuery({ queryKey: ['gl', 'fc', id], queryFn: () => fc.get(id), retry: false }); const { error, note, busy, run } = useGlRunner(); const [edit, setEdit] = useState(null); const [hdr, setHdr] = useState(null); const [mode, setMode] = useState(null); const [reason, setReason] = useState(''); usePageTitle(t('fc.title'));
  const g = guardOf(q, t('fc.title'), 'fin.forecast.view'); if (g) return g; const x = q.data; const c = x.can; const h = hdr ?? { pendingVarCost: String(x.pendingVarCost ?? 0), pendingVarNote: x.pendingVarNote ?? '', confidence: x.confidence, commentary: x.commentary ?? '' };
  return (
    <section aria-labelledby="fc-h" data-testid="fc-forecast" data-status={x.status}>
      <PageHeader id="fc-h" title={`${x.docNo} · ${x.project}`} subtitle={`${t('fc.month')} ${x.period} · v${x.versionNo}`} meta={<StatusBadge status={JN_TONE[x.status] ?? 'CANCELLED'} label={t(`fc.st.${x.status}`)} />} />
      <p><Link to="/finance/cost-forecasts">{t('fc.back')}</Link></p>
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <KpiRow label={t('fc.title')}><KpiTile label={t('fc.eac')} value={money(x.eac)} amount={x.eac} kind="money" valueTestid="fc-eac" /><KpiTile label={t('fc.vac')} value={money(x.vac)} amount={x.vac} kind="money" /><KpiTile label={t('fc.budget')} value={money(x.budget)} amount={x.budget} kind="money" /><KpiTile label={t('fc.confidence')} value={t(`fc.c.${x.confidence}`)} /></KpiRow>
      {x.lossMaking && <p className="mdm-banner" role="status">{t('fc.lossMaking', { revenue: money(x.contractRevenue) })}</p>}
      <div className="mdm-panel"><Rows rows={[[t('fc.actual'), money(x.actual)], [t('fc.accrued'), money(x.accrued)], [t('fc.committed'), money(x.committed)], [t('fc.etc'), money(x.etc)], [t('fc.linesEac'), money(x.linesEac)], [t('fc.risk'), money(x.riskAllowance)], [t('fc.pendingVar'), x.pendingVarCost ? `${money(x.pendingVarCost)} · ${x.pendingVarNote ?? ''}` : null], [t('fc.contractRevenue'), x.contractRevenue ? money(x.contractRevenue) : null], [t('fc.commentary'), x.commentary]]} /></div>
      {x.bridge?.items?.length > 0 && <div className="mdm-panel" data-testid="fc-bridge"><Chart type="bar" data={{ categories: x.bridge.items.slice(0, 8).map((b) => b.label.slice(0, 24)), series: [{ name: t('fc.change'), values: x.bridge.items.slice(0, 8).map((b) => Math.round(b.change)) }], unit: '₹' }} title={t('fc.bridgeTitle', { from: money(x.bridge.from), to: money(x.bridge.to) })} exportName={`eac-bridge-${x.docNo}`} tableSwitch />
        <ul className="lp-list">{x.bridge.items.map((b, i) => <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, minHeight: 'var(--erp-target-min)', alignItems: 'center', flexWrap: 'wrap' }}><span>{b.label}{b.why ? <span className="muted small"> · {b.why}</span> : null}</span><span className="num">{b.change > 0 ? '+' : ''}{money(b.change)}</span></li>)}</ul></div>}
      <h2>{t('fc.lines')}</h2>
      <ul className="lp-list" aria-label={t('fc.lines')}>{x.lines.map((l) => <li key={l.id} className="mdm-panel" style={{ display: 'grid', gap: 4, padding: 12, margin: '6px 0' }} data-testid="fc-line">
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{l.label}</strong><span className="num">{t('fc.eac')} {money(l.eac)}</span></span>
        <span className="muted small">{t('fc.budget')} {money(l.budget)} · {t('fc.actual')} {money(l.actual)} · {t('fc.committed')} {money(l.committed)} · {t('fc.etc')} {money(l.etc)} ({t(`fc.m.${l.method}`)}) · {t('fc.vac')} {money(l.vac)}</span>
        {l.methodNote && <span className="muted small">{l.methodNote}{l.notes ? ` · ${l.notes}` : ''}</span>}
        {c.recompute && <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => setEdit(edit === l.id ? null : l.id)} data-testid="fc-line-open">{t('fc.changeMethod')}</button></div>}
        {edit === l.id && <LineEditor x={x} l={l} run={run} busy={busy} t={t} onDone={() => setEdit(null)} />}</li>)}</ul>
      {c.recompute && <div className="mdm-panel"><h2>{t('fc.header')}</h2><div className="form-grid">
        <Field label={t('fc.pendingVar')} name="pendingVarCost" error={error?.fields?.pendingVarCost}><input inputMode="decimal" value={h.pendingVarCost} onChange={(e) => setHdr({ ...h, pendingVarCost: e.target.value })} style={big} /></Field>
        <Field label={t('fc.pendingVarNote')} name="pendingVarNote" error={error?.fields?.pendingVarNote}><input value={h.pendingVarNote} onChange={(e) => setHdr({ ...h, pendingVarNote: e.target.value })} style={big} /></Field>
        <Field label={t('fc.confidence')} name="confidence" error={null}><select value={h.confidence} onChange={(e) => setHdr({ ...h, confidence: e.target.value })} style={big}>{['HIGH', 'MEDIUM', 'LOW'].map((k) => <option key={k} value={k}>{t(`fc.c.${k}`)}</option>)}</select></Field>
        <Field label={t('fc.commentary')} name="commentary" error={error?.fields?.commentary}><textarea value={h.commentary} onChange={(e) => setHdr({ ...h, commentary: e.target.value })} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></Field></div>
        <div className="ff-actionbar"><button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => fc.update(x.id, { pendingVarCost: Number(h.pendingVarCost || 0), pendingVarNote: h.pendingVarNote || null, confidence: h.confidence, commentary: h.commentary || null, version: x.version }), t('fc.saved')).then((r) => r && setHdr(null))}>{t('fc.saveHeader')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => fc.act(x.id, 'refresh'), t('fc.refreshed'))}>{t('fc.refresh')}</button></div></div>}
      <Decide x={x} run={run} busy={busy} t={t} p="fc" testid="fc-decide" />
      <div className="actions-row ff-actionbar">
        {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => fc.act(x.id, 'submit'), t('fc.sent'))} data-testid="fc-submit">{t('fc.submit')}</button>}
        {c.delete && <button type="button" className="btn" style={big} disabled={busy} onClick={() => globalThis.confirm?.(t('fc.confirmDelete')) && run(() => fc.remove(x.id), t('fc.deleted')).then((r) => r && navigateTo('/finance/cost-forecasts'))}>{t('fc.delete')}</button>}
        {(c.withdraw || c.cancel || c.amend) && <button type="button" className="btn" style={big} onClick={() => setMode(mode ? null : c.amend ? 'amend' : c.withdraw ? 'withdraw' : 'cancel')}>{c.amend ? t('fc.amend') : c.withdraw ? t('fc.withdraw') : t('fc.cancel')}</button>}
        <button type="button" className="btn" style={big} onClick={() => gl.file(`/cost-forecasts/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => globalThis.alert?.(t('fc.fileFailed')))}>{t('fc.print')}</button>
      </div>
      {mode && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(() => fc.act(x.id, mode, { reason }), t(`fc.${mode}Done`)).then((r) => { if (r && mode === 'amend') navigateTo(`/finance/cost-forecasts?id=${r.id}`); setMode(null); }); }}><Field label={t('fc.reason')} name="reason" error={error?.fields?.reason}><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></Field><div className="ff-actionbar"><button type="submit" className="btn btn-primary" style={big} disabled={busy || reason.trim().length < 5}>{t(`fc.${mode}`)}</button></div></form>}
      {x.history?.approvals?.length > 0 && <div className="mdm-panel"><h2>{t('fc.history')}</h2><ul className="lp-list">{x.history.approvals.map((hh, i) => <li key={i} style={{ minHeight: 'var(--erp-target-min)' }}>{String(hh.at).slice(0, 16).replace('T', ' ')} · {hh.event}{hh.step_code ? ` (${hh.step_code})` : ''} · {hh.actor}{hh.comment ? ` · ${hh.comment}` : ''}</li>)}</ul></div>}
    </section>
  );
}
export function ForecastWorkbenchPage() {
  const t = useT('fc'); usePageTitle(t('fc.title')); const sp = useSearch(); const session = useSession(); const id = Number(sp.get('id')) || null; const [period, setPeriod] = useState(lastMonth()); const { error, note, busy, run } = useGlRunner();
  const q = useQuery({ queryKey: ['gl', 'fc-cand', period], queryFn: () => fc.candidates({ period }), retry: false, enabled: !id });
  if (id) return <Forecast id={id} />;
  const g = guardOf(q, t('fc.title'), 'fin.forecast.view'); const rows = q.data ?? []; const writer = can(session.data, 'fin.forecast.create');
  return (<section aria-labelledby="fcw-h" data-testid="fc-page"><PageHeader id="fcw-h" title={t('fc.title')} subtitle={t('fc.intro')} meta={<Link to="/finance/forecast-reports">{t('fr.title')}</Link>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <div className="form-grid"><Field label={t('fc.month')} name="period" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} data-testid="fc-period" /></Field></div>
    {g ?? (rows.length === 0 ? <EmptyState compact title={t('fc.noProjects')} message={t('fc.noProjectsBody')} /> : <ul className="lp-list">{rows.map((p) => <li key={p.projectId} className="mdm-panel" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 12, margin: '6px 0' }}>
      <strong>{p.project}</strong>{p.forecastId ? <Link to={`/finance/cost-forecasts?id=${p.forecastId}`}>{p.docNo} v{p.versionNo} · {t(`fc.st.${p.status}`)}</Link> : writer ? <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => fc.create({ projectId: p.projectId, period }), t('fc.created')).then((r) => r && navigateTo(`/finance/cost-forecasts?id=${r.id}`))} data-testid="fc-new">{t('fc.new')}</button> : <span className="muted">{t('fc.none')}</span>}</li>)}</ul>)}
  </section>);
}

function Trend() {
  const t = useT('fc'); const cq = useQuery({ queryKey: ['gl', 'fc-cand-all'], queryFn: () => fc.candidates({ period: lastMonth() }), retry: false }); const [projectId, setProjectId] = useState('');
  const q = useQuery({ queryKey: ['gl', 'fc-trend', projectId], queryFn: () => fc.trend({ projectId }), retry: false, enabled: Boolean(projectId) }); const x = q.data;
  return (<div data-testid="fr-trend"><div className="form-grid"><Field label={t('fr.project')} name="project" error={null}><select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={big} data-testid="fr-project"><option value="">{t('fr.choose')}</option>{(cq.data ?? []).map((p) => <option key={p.projectId} value={p.projectId}>{p.project}</option>)}</select></Field></div>
    {!projectId ? <EmptyState compact title={t('fr.choose')} message={t('fr.chooseBody')} /> : guardOf(q, t('fr.trend'), 'fin.forecast.view') ?? (x.rows.length === 0 ? <EmptyState compact title={t('fr.noApproved')} message={t('fr.noApprovedBody')} /> : <>
      <div className="mdm-panel"><Chart type="line" data={{ categories: x.rows.map((r) => r.period), series: [{ name: t('fc.eac'), values: x.rows.map((r) => Math.round(r.eac)) }, { name: t('fc.budget'), values: x.rows.map((r) => Math.round(r.budget)) }, ...(x.contractRevenue ? [{ name: t('fc.contractRevenue'), values: x.rows.map(() => Math.round(x.contractRevenue)) }] : [])], unit: '₹' }} title={t('fr.trendTitle')} exportName="eac-trend" tableSwitch /></div>
      <ul className="lp-list">{x.rows.map((r) => <li key={r.id} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><Link to={`/finance/cost-forecasts?id=${r.id}`} style={{ display: 'grid', gap: 4, minHeight: 'var(--erp-target-min)' }}><strong>{r.period} v{r.versionNo}</strong><span className="muted small">{t('fc.eac')} {money(r.eac)} · {t('fc.vac')} {money(r.vac)} · {t(`fc.c.${r.confidence}`)}</span></Link></li>)}</ul></>)}
  </div>);
}
function Variance() {
  const t = useT('fc'); const [period, setPeriod] = useState(lastMonth()); const q = useQuery({ queryKey: ['gl', 'fc-var', period], queryFn: () => fc.variance({ period }), retry: false }); const g = guardOf(q, t('fr.variance'), 'fin.forecast.view'); const x = q.data;
  return (<div data-testid="fr-variance"><div className="form-grid"><Field label={t('fc.month')} name="vperiod" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} /></Field></div>
    {g ?? (x.rows.length === 0 ? <EmptyState compact title={t('fr.noApproved')} message={t('fr.noApprovedBody')} /> : <>
      <KpiRow label={t('fr.variance')}><KpiTile label={t('fc.budget')} value={money(x.totals.budget)} amount={x.totals.budget} kind="money" /><KpiTile label={t('fc.eac')} value={money(x.totals.eac)} amount={x.totals.eac} kind="money" /><KpiTile label={t('fc.vac')} value={money(x.totals.vac)} amount={x.totals.vac} kind="money" valueTestid="fr-vac" /></KpiRow>
      <div className="mdm-panel"><Chart type="bar" data={{ categories: x.rows.map((r) => r.project.split(' ')[0]), series: [{ name: t('fc.vac'), values: x.rows.map((r) => Math.round(r.vac)) }], unit: '₹' }} title={t('fr.varianceTitle')} exportName={`forecast-variance-${period}`} tableSwitch /></div>
      <ul className="lp-list">{x.rows.map((r) => <li key={r.id} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><Link to={`/finance/cost-forecasts?id=${r.id}`} style={{ display: 'grid', gap: 4, minHeight: 'var(--erp-target-min)' }}><strong>{r.project}{r.lossMaking ? ` · ${t('fr.loss')}` : ''}</strong><span className="muted small">{r.period} · {t('fc.budget')} {money(r.budget)} · {t('fc.eac')} {money(r.eac)} · {t('fc.vac')} {money(r.vac)} ({pct(r.vacPct)})</span></Link></li>)}</ul></>)}
  </div>);
}
export function ForecastReportsPage() {
  const t = useT('fc'); usePageTitle(t('fr.title')); const [tab, setTab] = useState('variance');
  return (<section aria-labelledby="fr-h" data-testid="fr-page"><PageHeader id="fr-h" title={t('fr.title')} subtitle={t('fr.intro')} meta={<Link to="/finance/cost-forecasts">{t('fc.title')}</Link>} />
    <Pills tabs={[['variance', t('fr.variance')], ['trend', t('fr.trend')]]} tab={tab} setTab={setTab} label={t('fr.title')} prefix="fr-tab" />
    {tab === 'variance' ? <Variance /> : <Trend />}</section>);
}
