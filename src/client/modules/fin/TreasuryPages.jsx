import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import Chart from '../../platform/charts/Chart.jsx';
import { EmptyState } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../site/parts.jsx';
import { JN_TONE, cf, gl, money } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';
import { Decide, Pills, Rows, big, guardOf, istToday } from './finparts.jsx';

// Part 23.13: the treasury and cash position (bank balances, OD use, guarantee limits, facilities, the published forecast), the 13-week cash forecast object
// (the weeks, the lines by category and source, adjustments with their reason, the scenarios, the ACCMGR → CFO publication), the payment priority, and the
// reports (the project cash curve; actual against forecast).
const CATS = ['AR_OPEN', 'BILLS_PENDING', 'UNBILLED', 'RETENTION', 'ADVANCE_IN', 'OTHER_IN', 'AP_DUE', 'COMMITMENTS', 'PAYROLL', 'STATUTORY', 'LOAN_EMI', 'CAPEX', 'OVERHEADS', 'OTHER_OUT'];
const SCEN = ['BASE', 'DELAYED_COLLECTIONS', 'ACCELERATED_PAYMENTS', 'BOTH'];
const row = { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };
const neg = (v) => (v < 0 ? { color: 'var(--erp-color-status-error-fg)', fontWeight: 700 } : undefined);

function Adjust({ x, run, busy, t }) {
  const [f, setF] = useState({ category: 'OTHER_IN', date: x.weekStart, amount: '', reason: '' }); const [err, setErr] = useState(null); const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = () => { if (!(Number(f.amount) > 0)) { setErr(t('cf.giveAmount')); return; } if (f.reason.trim().length < 5) { setErr(t('cf.sayWhy')); return; } setErr(null); run(() => cf.adjust(x.id, { category: f.category, date: f.date, amount: Number(f.amount), reason: f.reason.trim() }), t('cf.adjusted')).then(() => setF({ ...f, amount: '', reason: '' })); };
  return (<div className="mdm-panel" data-testid="cf-adjust"><h2>{t('cf.adjust')}</h2>{err && <p className="field-error" role="alert">{err}</p>}
    <div className="form-grid"><Field label={t('cf.category')} name="category" error={null}><select value={f.category} onChange={set('category')} style={big} data-testid="cf-adj-cat">{CATS.map((c) => <option key={c} value={c}>{t(`cf.cat.${c}`)}</option>)}</select></Field>
      <Field label={t('cf.date')} name="date" error={null}><input type="date" value={f.date} onChange={set('date')} style={big} /></Field>
      <Field label={t('cf.amount')} name="amount" error={null}><input inputMode="decimal" value={f.amount} onChange={set('amount')} style={big} data-testid="cf-adj-amount" /></Field>
      <Field label={t('cf.reason')} name="reason" error={null}><input value={f.reason} onChange={set('reason')} style={big} data-testid="cf-adj-reason" /></Field></div>
    <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={go} data-testid="cf-adj-save">{t('cf.addAdjustment')}</button></div></div>);
}

function Forecast({ id }) {
  const t = useT('cf'); const [scenario, setScenario] = useState('BASE'); const [tab, setTab] = useState('weeks'); const [week, setWeek] = useState(null); usePageTitle(t('cf.forecast'));
  const q = useQuery({ queryKey: ['gl', 'cf', id, scenario], queryFn: () => cf.get(id, { scenario }), retry: false }); const { error, note, busy, run } = useGlRunner();
  const g = guardOf(q, t('cf.forecast'), 'fin.cash_forecast.view'); if (g) return g; const x = q.data; const c = x.can;
  const lines = week ? x.lines.filter((l) => l.week === week) : x.lines;
  return (<section aria-labelledby="cf-h" data-testid="cf-forecast" data-status={x.status}>
    <PageHeader id="cf-h" title={`${x.docNo} · ${t('cf.weekOf', { week: x.weekStart })}`} subtitle={t('cf.weeksN', { n: x.weeks })} meta={<StatusBadge status={JN_TONE[x.status] ?? 'CANCELLED'} label={t(`cf.st.${x.status}`)} />} />
    <p><Link to="/finance/treasury">{t('cf.back')}</Link></p>
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <KpiRow label={t('cf.forecast')}><KpiTile label={t('cf.opening')} value={money(x.opening)} amount={x.opening} kind="money" /><KpiTile label={t('cf.inflow')} value={money(x.inflow)} amount={x.inflow} kind="money" /><KpiTile label={t('cf.outflow')} value={money(x.outflow)} amount={x.outflow} kind="money" /><KpiTile label={t('cf.closing')} value={money(x.scenario.closing)} amount={x.scenario.closing} kind="money" valueTestid="cf-closing" /><KpiTile label={t('cf.lowest')} value={`${money(x.scenario.lowest)} · ${x.scenario.lowestWeek ?? '—'}`} valueTestid="cf-lowest" /></KpiRow>
    {x.scenario.lowest < 0 && <p className="mdm-banner" role="alert" data-testid="cf-short">{t('cf.shortBanner', { week: x.scenario.lowestWeek, amount: money(x.scenario.lowest) })}</p>}
    <Field label={t('cf.scenario')} name="scenario" error={null}><select value={scenario} onChange={(e) => setScenario(e.target.value)} style={big} data-testid="cf-scenario">{SCEN.map((s) => <option key={s} value={s}>{t(`cf.sc.${s}`)}</option>)}</select></Field>
    <div className="mdm-panel"><Chart type="line" data={{ categories: x.weeksTable.map((w) => w.week.slice(5)), series: [{ name: t('cf.closing'), values: x.weeksTable.map((w) => Math.round(w.closing)) }, { name: t('cf.inflow'), values: x.weeksTable.map((w) => Math.round(w.inflow)) }, { name: t('cf.outflow'), values: x.weeksTable.map((w) => Math.round(w.outflow)) }], unit: '₹' }} title={t('cf.chart')} exportName={`cash-forecast-${x.weekStart}`} tableSwitch /></div>
    <Pills tabs={[['weeks', t('cf.tab.weeks')], ['lines', t('cf.tab.lines')], ['sources', t('cf.tab.sources')], ['history', t('cf.tab.history')]]} tab={tab} setTab={setTab} label={t('cf.forecast')} prefix="cf-tab" />
    {tab === 'weeks' && <ul className="lp-list" data-testid="cf-weeks">{x.weeksTable.map((w) => <li key={w.week} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><button type="button" className="btn-link" style={{ ...row, width: '100%', minHeight: 'var(--erp-target-min)', alignItems: 'center', background: 'none', border: 0, color: 'inherit', textAlign: 'left' }} onClick={() => { setWeek(w.week); setTab('lines'); }}>
      <strong>{w.week}</strong><span className="num">+{money(w.inflow)} · −{money(w.outflow)} · <span style={neg(w.closing)}>{money(w.closing)}</span></span></button></li>)}</ul>}
    {tab === 'lines' && <>{week && <p>{t('cf.weekOf', { week })} · <button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => setWeek(null)}>{t('cf.allWeeks')}</button></p>}
      {lines.length === 0 ? <EmptyState compact title={t('cf.noLines')} message={t('cf.noLinesBody')} /> : <ul className="lp-list" data-testid="cf-lines">{lines.map((l) => <li key={l.id} style={{ display: 'grid', gap: 2, minHeight: 'var(--erp-target-min)', padding: '6px 0' }}><span style={row}><strong>{t(`cf.cat.${l.category}`)}{l.project ? ` · ${l.project}` : ''}</strong><span className="num">{l.inflow ? `+${money(l.inflow)}` : `−${money(l.outflow)}`}</span></span>
        <span className="muted small">{l.week}{l.dueDate ? ` · ${t('cf.due')} ${l.dueDate}` : ''}{l.sourceDoc ? ` · ${l.sourceDoc}` : ''}{l.counterparty ? ` · ${l.counterparty}` : ''} · {t(`cf.conf.${l.confidence}`)}{l.source === 'MANUAL' ? ` · ${t('cf.manual')}: ${l.reason}` : ''}</span>
        {l.source === 'MANUAL' && c.adjust && <span><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} disabled={busy} onClick={() => { const r = globalThis.prompt?.(t('cf.whyRemove')); if (r && r.trim().length >= 5) run(() => cf.unadjust(x.id, l.id, r.trim()), t('cf.removed')); }}>{t('cf.remove')}</button></span>}</li>)}</ul>}</>}
    {tab === 'sources' && <div className="mdm-panel"><Rows rows={(x.sources ?? []).map((s) => [t(`cf.cat.${s.code}`), `${s.available ? t('cf.nLines', { n: s.lines }) : t('cf.notAvailable')}${s.note ? ` · ${s.note}` : ''}`])} /></div>}
    {tab === 'history' && <div className="mdm-panel"><ul className="lp-list">{(x.history?.approvals ?? []).map((h, i) => <li key={i} style={{ minHeight: 'var(--erp-target-min)' }}>{String(h.at).slice(0, 16).replace('T', ' ')} · {h.event}{h.step_code ? ` (${h.step_code})` : ''} · {h.actor}</li>)}</ul></div>}
    {c.adjust && <Adjust x={x} run={run} busy={busy} t={t} />}
    <Decide x={x} run={run} busy={busy} t={t} p="cf" testid="cf-decide" />
    <div className="actions-row ff-actionbar">
      {c.adjust && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => cf.act(x.id, 'refresh'), t('cf.refreshed'))} data-testid="cf-refresh">{t('cf.refresh')}</button>}
      {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => cf.act(x.id, 'submit'), t('cf.sent'))} data-testid="cf-submit">{t('cf.submit')}</button>}
      <button type="button" className="btn" style={big} onClick={() => gl.file(`/cash-forecasts/${x.id}/print?scenario=${scenario}`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => globalThis.alert?.(t('cf.fileFailed')))}>{t('cf.print')}</button>
      <button type="button" className="btn" style={big} onClick={() => gl.file(`/cash-forecasts/${x.id}/export`, `${x.docNo.replaceAll('/', '-')}-lines.csv`).catch(() => globalThis.alert?.(t('cf.fileFailed')))}>{t('cf.export')}</button>
    </div>
  </section>);
}

function Facility({ run, busy, t }) {
  const [f, setF] = useState({ bankName: '', limitType: 'CASH_CREDIT', limit: '', utilised: '', emi: '', emiDay: '' }); const set = (k) => (e) => setF({ ...f, [k]: e.target.value }); const [err, setErr] = useState(null);
  const go = () => { if (f.bankName.trim().length < 2 || !(Number(f.limit) > 0)) { setErr(t('cf.facilityNeeds')); return; } setErr(null); run(() => cf.facility({ bankName: f.bankName.trim(), limitType: f.limitType, limit: Number(f.limit), utilised: Number(f.utilised || 0), emi: Number(f.emi || 0), emiDay: f.emiDay ? Number(f.emiDay) : null }), t('cf.facilitySaved')); };
  return (<div className="mdm-panel"><h3>{t('cf.addFacility')}</h3>{err && <p className="field-error" role="alert">{err}</p>}<div className="form-grid">
    <Field label={t('cf.bank')} name="bankName" error={null}><input value={f.bankName} onChange={set('bankName')} style={big} /></Field>
    <Field label={t('cf.type')} name="limitType" error={null}><select value={f.limitType} onChange={set('limitType')} style={big}>{['TERM_LOAN', 'CASH_CREDIT', 'OVERDRAFT', 'BG', 'LC', 'OTHER'].map((k) => <option key={k} value={k}>{t(`cf.lt.${k}`)}</option>)}</select></Field>
    <Field label={t('cf.limit')} name="limit" error={null}><input inputMode="decimal" value={f.limit} onChange={set('limit')} style={big} /></Field>
    <Field label={t('cf.utilised')} name="utilised" error={null}><input inputMode="decimal" value={f.utilised} onChange={set('utilised')} style={big} /></Field>
    {f.limitType === 'TERM_LOAN' && <><Field label={t('cf.emi')} name="emi" error={null}><input inputMode="decimal" value={f.emi} onChange={set('emi')} style={big} /></Field><Field label={t('cf.emiDay')} name="emiDay" error={null}><input inputMode="numeric" value={f.emiDay} onChange={set('emiDay')} style={big} /></Field></>}
  </div><div className="ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={go}>{t('cf.save')}</button></div></div>);
}

function Priorities({ t, run, busy, manage }) {
  const q = useQuery({ queryKey: ['gl', 'cf-prio'], queryFn: () => cf.priorities(), retry: false }); const oq = useQuery({ queryKey: ['gl', 'jn-options'], queryFn: gl.options, retry: false, enabled: manage }); const [partnerId, setPartnerId] = useState(''); const [reason, setReason] = useState('');
  const g = guardOf(q, t('cf.priority'), 'fin.cash_forecast.view'); if (g) return g; const x = q.data;
  return (<div data-testid="cf-priorities"><p className="muted">{t('cf.priorityIntro', { date: x.dueBy, amount: money(x.available) })}</p>
    {x.rows.length === 0 ? <EmptyState compact title={t('cf.nothingDue')} message={t('cf.nothingDueBody')} /> : <ul className="lp-list">{x.rows.map((r, i) => <li key={i} style={{ display: 'grid', gap: 2, minHeight: 'var(--erp-target-min)', padding: '6px 0' }}><span style={row}><strong>{t(`cf.pc.${r.class}`)} · {r.label}</strong><span className="num">{money(r.amount)}</span></span><span className="muted small">{t('cf.due')} {r.due} · {t('cf.cumulative')} {money(r.cumulative)} · {r.covered ? t('cf.covered') : <span style={neg(-1)}>{t('cf.notCovered')}</span>}</span></li>)}</ul>}
    <h3>{t('cf.criticalSuppliers')}</h3>
    {x.critical.length === 0 ? <p className="muted">{t('cf.noCritical')}</p> : <ul className="lp-list">{x.critical.map((c) => <li key={c.id} style={{ ...row, minHeight: 'var(--erp-target-min)', alignItems: 'center' }}><span>{c.partner} · <span className="muted small">{c.reason}</span></span>{manage && <button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} disabled={busy} onClick={() => { const r = globalThis.prompt?.(t('cf.whyRemove')); if (r && r.trim().length >= 5) run(() => cf.uncritical(c.id, r.trim()), t('cf.removed')).then(() => q.refetch()); }}>{t('cf.remove')}</button>}</li>)}</ul>}
    {manage && <div className="form-grid"><Field label={t('cf.supplier')} name="partner" error={null}><select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} style={big}><option value="">{t('cf.choose')}</option>{(oq.data?.partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label={t('cf.reason')} name="creason" error={null}><input value={reason} onChange={(e) => setReason(e.target.value)} style={big} /></Field>
      <button type="button" className="btn" style={big} disabled={busy || !partnerId || reason.trim().length < 5} onClick={() => run(() => cf.critical({ partnerId: Number(partnerId), reason: reason.trim() }), t('cf.marked')).then(() => { setPartnerId(''); setReason(''); q.refetch(); })}>{t('cf.markCritical')}</button></div>}
  </div>);
}

export function TreasuryPage() {
  const t = useT('cf'); usePageTitle(t('cf.title')); const sp = useSearch(); const fid = Number(sp.get('forecast')) || null; const [tab, setTab] = useState('position'); const { error, note, busy, run } = useGlRunner();
  const q = useQuery({ queryKey: ['gl', 'treasury'], queryFn: cf.treasury, retry: false, enabled: !fid }); const lq = useQuery({ queryKey: ['gl', 'cf-list'], queryFn: () => cf.list({ pageSize: 25 }), retry: false, enabled: !fid && tab === 'forecasts' });
  if (fid) return <Forecast id={fid} />;
  const g = guardOf(q, t('cf.title'), 'fin.cash_forecast.view'); if (g) return g; const x = q.data;
  const create = () => run(() => cf.create({ weekStart: istToday() }), t('cf.created')).then((r) => r && navigateTo(`/finance/treasury?forecast=${r.id}`));
  return (<section aria-labelledby="tr-h" data-testid="treasury-page"><PageHeader id="tr-h" title={t('cf.title')} subtitle={t('cf.intro', { date: x.date })} meta={<Link to="/finance/cash-reports">{t('cr.title')}</Link>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <KpiRow label={t('cf.position')}><KpiTile label={t('cf.balance')} value={money(x.totals.balance)} amount={x.totals.balance} kind="money" valueTestid="tr-balance" /><KpiTile label={t('cf.available')} value={money(x.totals.available)} amount={x.totals.available} kind="money" valueTestid="tr-available" /><KpiTile label={t('cf.blocked')} value={money(x.totals.blocked)} amount={x.totals.blocked} kind="money" /><KpiTile label={t('cf.odUsed')} value={`${money(x.totals.odUsed)} / ${money(x.totals.odLimit)}`} /></KpiRow>
    {x.forecast ? <div className="mdm-panel" data-testid="tr-forecast"><div style={row}><strong>{t('cf.published')}: <Link to={`/finance/treasury?forecast=${x.forecast.id}`}>{x.forecast.docNo}</Link> · {t('cf.weekOf', { week: x.forecast.weekStart })}</strong><span className="num">{t('cf.closing')} {money(x.forecast.closing)} · {t('cf.lowest')} <span style={neg(x.forecast.lowest)}>{money(x.forecast.lowest)}</span> ({x.forecast.lowestWeek})</span></div></div>
      : <EmptyState compact title={t('cf.noPublished')} message={t('cf.noPublishedBody')} />}
    <div className="actions-row ff-actionbar">{x.open ? <Link to={`/finance/treasury?forecast=${x.open.id}`} className="btn" style={big}>{t('cf.openDraft', { doc: x.open.docNo })}</Link> : x.can.create && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={create} data-testid="cf-create">{t('cf.prepare')}</button>}</div>
    <Pills tabs={[['position', t('cf.tab.position')], ['facilities', t('cf.tab.facilities')], ['priority', t('cf.tab.priority')], ['forecasts', t('cf.tab.forecasts')]]} tab={tab} setTab={setTab} label={t('cf.title')} prefix="tr-tab" />
    {tab === 'position' && <ul className="lp-list" data-testid="tr-banks">{x.banks.map((b) => <li key={b.id} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><div style={row}><strong>{b.name} · {b.account}</strong><span className="num" style={neg(b.balance)}>{money(b.balance)}</span></div><span className="muted small">{b.bank} · {t(`cf.kind.${b.kind}`)}{b.odLimit ? ` · ${t('cf.odLimit')} ${money(b.odLimit)}` : ''} · {t('cf.available')} {money(b.available)}</span></li>)}
      <li className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><div style={row}><strong>{t('cf.cashOnHand')}</strong><span className="num">{money(x.cashOnHand)}</span></div></li></ul>}
    {tab === 'facilities' && <div data-testid="tr-facilities">{x.bgLimits.length > 0 && <><h3>{t('cf.bgLimits')}</h3><ul className="lp-list">{x.bgLimits.map((l) => <li key={l.bank} style={{ display: 'grid', gap: 2, minHeight: 'var(--erp-target-min)' }}><span style={row}><strong>{l.bank}</strong><span className="num">{money(l.used)} / {money(l.limit)} ({l.usedPct} %)</span></span><span className="muted small">{t('cf.free')} {money(l.free)} · {t('cf.nGuarantees', { n: l.guarantees })}</span></li>)}</ul></>}
      <h3>{t('cf.facilities')}</h3>{x.facilities.length === 0 ? <p className="muted">{t('cf.noFacilities')}</p> : <ul className="lp-list">{x.facilities.map((f) => <li key={f.id} style={{ display: 'grid', gap: 2, minHeight: 'var(--erp-target-min)' }}><span style={row}><strong>{f.bank} · {t(`cf.lt.${f.type}`)}</strong><span className="num">{money(f.utilised)} / {money(f.limit)}</span></span><span className="muted small">{t('cf.free')} {money(f.free)}{f.emi ? ` · ${t('cf.emi')} ${money(f.emi)} (${f.emiDay})` : ''}{f.endDate ? ` · ${f.endDate}` : ''} · {f.status}</span></li>)}</ul>}
      {x.can.manage && <Facility run={(fn, m) => run(fn, m).then(() => q.refetch())} busy={busy} t={t} />}</div>}
    {tab === 'priority' && <Priorities t={t} run={run} busy={busy} manage={x.can.manage} />}
    {tab === 'forecasts' && (guardOf(lq, t('cf.forecasts'), 'fin.cash_forecast.view') ?? <ul className="lp-list" data-testid="cf-list">{(lq.data ?? []).map((f) => <li key={f.id} style={{ ...row, minHeight: 'var(--erp-target-min)', alignItems: 'center' }}><Link to={`/finance/treasury?forecast=${f.id}`}>{f.docNo} · {f.weekStart}</Link><span className="num">{money(f.closing)} · {t(`cf.st.${f.status}`)}</span></li>)}</ul>)}
  </section>);
}

function Curve({ t }) {
  const oq = useQuery({ queryKey: ['gl', 'jn-options'], queryFn: gl.options, retry: false }); const sp = useSearch(); const [projectId, setProjectId] = useState(sp.get('projectId') ?? '');
  const q = useQuery({ queryKey: ['gl', 'cf-curve', projectId], queryFn: () => cf.curve({ projectId }), retry: false, enabled: Boolean(projectId) }); const x = q.data;
  return (<div data-testid="cr-curve"><Field label={t('cf.project')} name="project" error={null}>{oq.data ? <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={big} data-testid="cr-project"><option value="">{t('cf.choose')}</option>{oq.data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select> : <input inputMode="numeric" value={projectId} onChange={(e) => setProjectId(e.target.value)} style={big} data-testid="cr-project" />}</Field>
    {!projectId ? <EmptyState compact title={t('cf.choose')} message={t('cr.chooseBody')} /> : guardOf(q, t('cr.curve'), 'fin.cash_curve.view') ?? <>
      <KpiRow label={x.project}><KpiTile label={t('cr.contract')} value={money(x.contractRevenue)} amount={x.contractRevenue} kind="money" /><KpiTile label={t('cr.eac')} value={x.eac == null ? '—' : money(x.eac)} /><KpiTile label={t('cr.peakNeed')} value={money(x.peakNeed)} valueTestid="cr-peak" /><KpiTile label={t('cr.completion')} value={x.completion == null ? '—' : `${x.completion} %`} /></KpiRow>
      {x.rows.length === 0 ? <EmptyState compact title={t('cr.noMonths')} message={t('cr.noMonthsBody')} /> : <><div className="mdm-panel"><Chart type="line" data={{ categories: x.rows.map((r) => r.month), series: [{ name: t('cr.cumulative'), values: x.rows.map((r) => Math.round(r.cumulative)) }, { name: t('cr.net'), values: x.rows.map((r) => Math.round(r.net)) }], unit: '₹' }} title={t('cr.curve')} exportName={`cash-curve-${x.projectId}`} tableSwitch /></div>
        <ul className="lp-list">{x.rows.map((r) => <li key={r.month} style={{ display: 'grid', gap: 2, minHeight: 'var(--erp-target-min)' }}><span style={row}><strong>{r.month} · {r.actual ? t('cr.actual') : t('cr.forecast')}</strong><span className="num" style={neg(r.cumulative)}>{money(r.cumulative)}</span></span><span className="muted small">+{money(r.actual ? r.actualIn : r.forecastIn)} · −{money(r.actual ? r.actualOut : r.forecastOut)}</span></li>)}</ul></>}
    </>}</div>);
}

function Variance({ t }) {
  const q = useQuery({ queryKey: ['gl', 'cf-var'], queryFn: () => cf.variance(), retry: false }); const g = guardOf(q, t('cr.variance'), 'fin.cash_forecast.view'); if (g) return g; const x = q.data;
  if (!x.forecast) return <EmptyState compact title={t('cf.noPublished')} message={t('cf.noPublishedBody')} />;
  return (<div data-testid="cr-variance"><p className="muted">{t('cr.varianceOf', { doc: x.forecast.docNo, week: x.forecast.weekStart })}</p>
    {x.rows.length === 0 ? <EmptyState compact title={t('cr.noWeeks')} message={t('cr.noWeeksBody')} /> : <><div className="mdm-panel"><Chart type="bar" data={{ categories: x.rows.map((r) => r.week.slice(5)), series: [{ name: t('cr.forecastNet'), values: x.rows.map((r) => Math.round(r.forecastNet)) }, { name: t('cr.actualNet'), values: x.rows.map((r) => Math.round(r.actualNet)) }], unit: '₹' }} title={t('cr.variance')} exportName="cash-variance" tableSwitch /></div>
      <ul className="lp-list">{x.rows.map((r) => <li key={r.week} style={{ display: 'grid', gap: 2, minHeight: 'var(--erp-target-min)' }}><span style={row}><strong>{r.week}{r.complete ? '' : ` · ${t('cr.running')}`}</strong><span className="num" style={neg(r.varianceNet)}>{money(r.varianceNet)}</span></span><span className="muted small">{t('cf.inflow')} {money(r.actualIn)} / {money(r.forecastIn)} · {t('cf.outflow')} {money(r.actualOut)} / {money(r.forecastOut)}</span></li>)}</ul></>}</div>);
}

export function CashReportsPage() {
  const t = useT('cf'); usePageTitle(t('cr.title')); const [tab, setTab] = useState('curve');
  return (<section aria-labelledby="cr-h" data-testid="cash-reports-page"><PageHeader id="cr-h" title={t('cr.title')} subtitle={t('cr.intro')} meta={<Link to="/finance/treasury">{t('cf.title')}</Link>} />
    <Pills tabs={[['curve', t('cr.curve')], ['variance', t('cr.variance')]]} tab={tab} setTab={setTab} label={t('cr.title')} prefix="cr-tab" />
    {tab === 'curve' ? <Curve t={t} /> : <Variance t={t} />}</section>);
}
