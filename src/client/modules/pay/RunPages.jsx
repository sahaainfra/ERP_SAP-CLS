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
import { money } from '../fin/api.js';
import { GlError, useGlRunner } from '../fin/JournalsPage.jsx';
import { Decide, Pills, Rows, big, guardOf, istToday, lastMonth } from '../fin/finparts.jsx';
import { TONE, file, runs } from './api.js';

// Part 24.02: the payroll run as a wizard (1 inputs check, 2 compute, 3 review with the checks and holds, 4 approve), the payroll register with the variance
// against last month, and the tax declarations (the employee's own on the phone; payroll verifies).
const row = { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };
const card = { padding: 12, margin: '6px 0' };
const amt = (v, t) => (v == null ? t('pr.masked') : money(v));
const STEPS = ['inputs', 'compute', 'review', 'approve'];

function Readiness({ t, period, run, busy, onCreate }) {
  const q = useQuery({ queryKey: ['gl', 'pay-ready', period], queryFn: () => runs.readiness({ period }), retry: false }); const g = guardOf(q, t('pr.inputs'), 'pay.run.view'); if (g) return g; const x = q.data;
  return (<div data-testid="pr-ready"><KpiRow label={t('pr.inputs')}><KpiTile label={t('pr.employees')} value={String(x.employees)} /><KpiTile label={t('pr.attLocked')} value={`${x.attendance.locked} / ${x.employees}`} valueTestid="pr-att-locked" /><KpiTile label={t('pr.arrears')} value={String(x.arrears)} /><KpiTile label={t('pr.inputsPending')} value={String(x.inputs)} /></KpiRow>
    <div className="mdm-panel"><Rows rows={[[t('pr.calendar'), x.calendar ? t('pr.calendarLine', { status: t(`pr.cs.${x.calendar.status}`), att: x.calendar.attendanceCutoff, pay: x.calendar.payDate }) : t('pr.noCalendar')], [t('pr.attOpen'), x.attendance.open ? t('pr.attOpenLine', { n: x.attendance.open }) : null], [t('pr.attNone'), x.attendance.none ? String(x.attendance.none) : null], [t('pr.withoutPay'), x.withoutPay ? String(x.withoutPay) : null], [t('pr.advances'), String(x.advances)]]} /></div>
    {x.attendance.open > 0 && <p className="mdm-banner" role="status">{t('pr.lockFirst')}</p>}
    <div className="ff-actionbar">{x.regular ? <button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} onClick={() => navigateTo(`/payroll/runs?id=${x.regular.id}`)} data-testid="pr-open">{t('pr.openRun', { doc: x.regular.docNo })}</button> : x.canCreate && <button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy || !x.calendar} onClick={onCreate} data-testid="pr-create">{t('pr.compute')}</button>}</div>{run}</div>);
}

function LineCard({ l, t, x, run, busy }) {
  const [open, setOpen] = useState(false);
  return (<li className="mdm-panel" style={card} data-testid={`pr-line-${l.employeeId}`} data-hold={l.hold ? '1' : '0'}>
    <button type="button" className="btn-link" style={{ display: 'grid', gap: 4, width: '100%', minHeight: 44, background: 'none', border: 0, color: 'inherit', textAlign: 'left' }} onClick={() => setOpen(!open)}>
      <span style={row}><strong>{l.employee}</strong><span className="num">{amt(l.net, t)} ›</span></span>
      <span className="small">{t('pr.daysLine', { payable: l.payableDays, days: l.daysInMonth, lop: l.lopDays, ot: l.otHours })}{l.hold ? ` · ${t('pr.held')}: ${l.holdReason}` : ''}</span>
      {l.flags.filter((f) => f.severity !== 'INFO').map((f) => <span key={f.code} className="small" style={f.severity === 'BLOCK' ? { color: 'var(--erp-color-status-error-fg)', fontWeight: 700 } : undefined}>{f.severity === 'BLOCK' ? '⛔' : '⚠'} {f.text}</span>)}</button>
    {open && l.components && <div style={{ marginTop: 6 }}><ul className="lp-list small">{l.components.map((c) => <li key={c.code} style={{ ...row, minHeight: 32 }}><span>{c.code} · {c.name}</span><span className="num">{c.type === 'DEDUCTION' ? '−' : ''}{money(c.amount)}</span></li>)}</ul>
      <Rows rows={[[t('pr.gross'), money(l.gross)], [t('pr.deductions'), money(l.deductions)], ['TDS', `${money(l.tds)}${l.tdsWorking?.regime ? ` (${l.tdsWorking.regime}, ${t('pr.projected')} ${money(l.tdsWorking.projectedAnnual ?? 0)})` : ''}`], [t('pr.employer'), money(l.employer)], [t('pr.allocation'), l.allocation.map((a) => `${a.siteId ? `site ${a.siteId}` : `project ${a.projectId}`} ${Math.round(a.share * 100)} %`).join(', ') || '—']]} /></div>}
    {x.can.hold && <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => { if (l.hold) run(() => runs.hold(x.id, l.id, { hold: false }), t('pr.released')); else { const r = globalThis.prompt?.(t('pr.whyHold')); if (r && r.trim().length >= 5) run(() => runs.hold(x.id, l.id, { hold: true, reason: r.trim() }), t('pr.heldDone')); } }} data-testid={`pr-hold-${l.employeeId}`}>{l.hold ? t('pr.release') : t('pr.hold')}</button></div>}
  </li>);
}

function Run({ id }) {
  const t = useT('pr'); const q = useQuery({ queryKey: ['gl', 'pay-run', id], queryFn: () => runs.get(id), retry: false, refetchInterval: (qq) => (qq.state.data?.computing ? 2000 : false) }); const { error, note, busy, run } = useGlRunner(); const [step, setStep] = useState(null); usePageTitle(t('pr.title'));
  const g = guardOf(q, t('pr.title'), 'pay.run.view'); if (g) return g; const x = q.data; const c = x.can; const cur = step ?? (x.status === 'SUBMITTED' || x.status === 'APPROVED' ? 'approve' : 'review');
  return (<section aria-labelledby="pr-h" data-testid="pr-run" data-status={x.status}><PageHeader id="pr-h" title={`${x.docNo} · ${x.period}`} subtitle={`${t(`pr.type.${x.type}`)} · ${t('pr.employeesN', { n: x.employees })}`} meta={<StatusBadge status={TONE[x.status] ?? 'CANCELLED'} label={x.lockedAt ? t('pr.locked') : t(`pr.st.${x.status}`)} />} />
    <p><Link to="/payroll/runs">{t('pr.back')}</Link> · <Link to={`/payroll/register?run=${x.id}`}>{t('rg.title')}</Link></p><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    {x.computing && <p className="mdm-banner" role="status" data-testid="pr-computing">{t('pr.computing', { p: x.job.progress ?? 0, msg: x.job.message ?? '' })}</p>}{x.job?.status === 'FAILED' && <p className="field-error" role="alert">{t('pr.computeFailed', { e: x.job.error ?? '' })}</p>}
    <Pills tabs={STEPS.map((k, i) => [k, `${i + 1}. ${t(`pr.step.${k}`)}`])} tab={cur} setTab={setStep} label={t('pr.steps')} prefix="pr-step" />
    {cur === 'inputs' && <div className="mdm-panel"><Rows rows={[[t('pr.excluded'), (x.inputs.excluded ?? []).map((e) => `${e.employee} (${t(`pr.why.${e.reason}`)})`).join('; ') || '—'], [t('pr.arrears'), String(x.inputs.arrears ?? 0)], [t('pr.inputsPending'), String(x.inputs.inputs ?? 0)]]} /></div>}
    {cur === 'compute' && <div className="mdm-panel"><p className="small">{t('pr.computedAt', { at: String(x.computedAt ?? '').slice(0, 16).replace('T', ' ') })}</p>{c.compute && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => runs.compute(x.id), t('pr.recomputed'))} data-testid="pr-recompute">{t('pr.recompute')}</button>}</div>}
    {cur === 'review' && <><KpiRow label={t('pr.totals')}><KpiTile label={t('pr.net')} value={amt(x.net, t)} amount={x.net ?? 0} kind="money" valueTestid="pr-net" /><KpiTile label={t('pr.gross')} value={amt(x.gross, t)} amount={x.gross ?? 0} kind="money" /><KpiTile label={t('pr.employer')} value={amt(x.employer, t)} amount={x.employer ?? 0} kind="money" /><KpiTile label={t('pr.checks')} value={`${x.flags} · ${t('pr.heldN', { n: x.held })}`} valueTestid="pr-flags" /></KpiRow>
      {x.blocking > 0 && <p className="mdm-banner" role="alert" data-testid="pr-blocking">{t('pr.blockingLine', { n: x.blocking })}</p>}
      <ul className="lp-list" data-testid="pr-lines">{x.lines.map((l) => <LineCard key={l.id} l={l} t={t} x={x} run={run} busy={busy} />)}</ul></>}
    {cur === 'approve' && <><Decide x={x} run={run} busy={busy} t={t} p="pr" testid="pr-decide" />{x.history?.approvals?.length > 0 && <div className="mdm-panel"><h2>{t('pr.history')}</h2><ul className="lp-list">{x.history.approvals.map((h, i) => <li key={i} style={{ minHeight: 44 }}>{String(h.at).slice(0, 16).replace('T', ' ')} · {h.event}{h.step_code ? ` (${h.step_code})` : ''} · {h.actor}</li>)}</ul></div>}</>}
    <div className="actions-row ff-actionbar" style={{ position: 'sticky', bottom: 0 }}>
      <span className="num small" style={{ alignSelf: 'center' }}>{t('pr.net')} {amt(x.net, t)}</span>
      {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => runs.act(x.id, 'submit'), t('pr.sent'))} data-testid="pr-submit">{t('pr.submit')}</button>}
      {!x.masked && <button type="button" className="btn" style={big} onClick={() => file(`/runs/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => globalThis.alert?.(t('pr.fileFailed')))}>{t('pr.print')}</button>}
    </div></section>);
}

export function RunsPage() {
  const t = useT('pr'); usePageTitle(t('pr.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const [period, setPeriod] = useState(lastMonth()); const { error, note, busy, run } = useGlRunner();
  const lq = useQuery({ queryKey: ['gl', 'pay-runs'], queryFn: () => runs.list({ pageSize: 25 }), retry: false, enabled: !id });
  if (id) return <Run id={id} />;
  return (<section aria-labelledby="prl-h" data-testid="pr-page"><PageHeader id="prl-h" title={t('pr.title')} subtitle={t('pr.intro')} meta={<Link to="/payroll/register">{t('rg.title')}</Link>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <Pills tabs={STEPS.map((k, i) => [k, `${i + 1}. ${t(`pr.step.${k}`)}`])} tab="inputs" setTab={() => {}} label={t('pr.steps')} prefix="pr-step0" />
    <Field label={t('pr.period')} name="period" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} data-testid="pr-period" /></Field>
    <Readiness t={t} period={period} busy={busy} onCreate={() => run(() => runs.create({ period }), t('pr.created')).then((r) => r && navigateTo(`/payroll/runs?id=${r.id}`))} />
    <h2 className="small" style={{ margin: '16px 0 4px' }}>{t('pr.runs')}</h2>
    {guardOf(lq, t('pr.runs'), 'pay.run.view') ?? (lq.data.length === 0 ? <EmptyState compact title={t('pr.none')} message={t('pr.noneBody')} /> : <ul className="lp-list">{lq.data.map((r) => <li key={r.id} className="mdm-panel" style={card}><Link to={`/payroll/runs?id=${r.id}`} style={{ display: 'grid', gap: 4, minHeight: 44, textDecoration: 'none', color: 'inherit' }}><span style={row}><strong>{r.docNo} · {r.period}</strong><span>{amt(r.net, t)} ›</span></span><span><StatusBadge status={TONE[r.status] ?? 'CANCELLED'} label={r.lockedAt ? t('pr.locked') : t(`pr.st.${r.status}`)} /> {t('pr.employeesN', { n: r.employees })}</span></Link></li>)}</ul>)}
  </section>);
}

export function RegisterPage() {
  const t = useT('pr'); usePageTitle(t('rg.title')); const sp = useSearch(); const [runId, setRunId] = useState(sp.get('run') ?? ''); const [tab, setTab] = useState('register');
  const lq = useQuery({ queryKey: ['gl', 'pay-runs'], queryFn: () => runs.list({ pageSize: 25 }), retry: false }); const rid = runId || lq.data?.[0]?.id;
  const q = useQuery({ queryKey: ['gl', 'pay-run', rid], queryFn: () => runs.get(rid), retry: false, enabled: Boolean(rid) }); const vq = useQuery({ queryKey: ['gl', 'pay-var', rid], queryFn: () => runs.variance(rid), retry: false, enabled: Boolean(rid) && tab === 'variance' });
  const x = q.data; const codes = x && !x.masked ? [...new Set(x.lines.flatMap((l) => l.components.map((c) => c.code)))] : [];
  return (<section aria-labelledby="rg-h" data-testid="rg-page"><PageHeader id="rg-h" title={t('rg.title')} subtitle={t('rg.intro')} meta={<Link to="/payroll/runs">{t('pr.title')}</Link>} />
    {guardOf(lq, t('rg.title'), 'pay.run.view') ?? (lq.data.length === 0 ? <EmptyState compact title={t('pr.none')} message={t('pr.noneBody')} /> : <>
      <Field label={t('rg.run')} name="run" error={null}><select value={rid ?? ''} onChange={(e) => setRunId(e.target.value)} style={big} data-testid="rg-run">{lq.data.map((r) => <option key={r.id} value={r.id}>{r.docNo} · {r.period} · {t(`pr.st.${r.status}`)}</option>)}</select></Field>
      <Pills tabs={[['register', t('rg.register')], ['variance', t('rg.variance')]]} tab={tab} setTab={setTab} label={t('rg.title')} prefix="rg-tab" />
      {guardOf(q, t('rg.title'), 'pay.run.view') ?? (tab === 'register' ? <>
        {!x.masked && codes.length > 0 && <div className="mdm-panel"><Chart type="bar" data={{ categories: codes, series: [{ name: t('rg.total'), values: codes.map((k) => Math.round(x.lines.reduce((a, l) => a + (l.components.find((c) => c.code === k)?.amount ?? 0), 0))) }], unit: '₹' }} title={t('rg.byComponent')} exportName={`payroll-${x.period}`} tableSwitch /></div>}
        <KpiRow label={t('pr.totals')}><KpiTile label={t('pr.net')} value={amt(x.net, t)} amount={x.net ?? 0} kind="money" valueTestid="rg-net" /><KpiTile label={t('pr.gross')} value={amt(x.gross, t)} amount={x.gross ?? 0} kind="money" /><KpiTile label="TDS" value={amt(x.tds, t)} amount={x.tds ?? 0} kind="money" /><KpiTile label={t('pr.employer')} value={amt(x.employer, t)} amount={x.employer ?? 0} kind="money" /></KpiRow>
        <ul className="lp-list" data-testid="rg-lines">{x.lines.map((l) => <li key={l.id} className="mdm-panel" style={card}><div style={row}><strong>{l.employee}</strong><span className="num">{amt(l.net, t)}</span></div><span className="small">{t('pr.gross')} {amt(l.gross, t)} · {t('pr.deductions')} {amt(l.deductions, t)} · {t('pr.daysLine', { payable: l.payableDays, days: l.daysInMonth, lop: l.lopDays, ot: l.otHours })}{l.hold ? ` · ${t('pr.held')}` : ''}</span></li>)}
          <li style={{ ...row, fontWeight: 700, position: 'sticky', bottom: 0 }} className="mdm-panel"><span>{t('rg.total')}</span><span className="num">{amt(x.net, t)}</span></li></ul>
        {!x.masked && <div className="actions-row"><button type="button" className="btn" style={big} onClick={() => file(`/runs/${x.id}/export`, `payroll-${x.period}.csv`).catch(() => globalThis.alert?.(t('pr.fileFailed')))}>{t('rg.export')}</button><button type="button" className="btn" style={big} onClick={() => file(`/runs/${x.id}/print`, `payroll-${x.period}.pdf`).catch(() => globalThis.alert?.(t('pr.fileFailed')))}>{t('pr.print')}</button></div>}</>
        : guardOf(vq, t('rg.variance'), 'pay.run.view') ?? <div data-testid="rg-variance"><p className="muted small">{vq.data.previous ? t('rg.against', { doc: vq.data.previous.docNo, pct: vq.data.thresholdPct }) : t('rg.noPrevious')} · {t('rg.joinedLeft', { j: vq.data.joined, l: vq.data.left })}</p>
          <ul className="lp-list">{vq.data.rows.map((r) => <li key={r.employeeId} className="mdm-panel" style={card}><div style={row}><strong>{r.employee}</strong><span className="num" style={r.beyond ? { color: 'var(--erp-color-status-error-fg)', fontWeight: 700 } : undefined}>{r.isNew ? t('rg.new') : `${r.changePct ?? 0} %`}</span></div><span className="small">{amt(r.net, t)}{r.previousNet != null ? ` · ${t('rg.was')} ${amt(r.previousNet, t)}` : ''}</span></li>)}</ul></div>)}</>)}
  </section>);
}

export function DeclarationsPage() {
  const t = useT('pr'); usePageTitle(t('dc.title')); const fyNow = (() => { const d = istToday(); const y = Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; })(); const [fy, setFy] = useState(fyNow); const { error, note, busy, run } = useGlRunner();
  const mq = useQuery({ queryKey: ['gl', 'pay-decl-mine', fy], queryFn: () => runs.myDeclaration({ fy }), retry: false }); const aq = useQuery({ queryKey: ['gl', 'pay-decls', fy], queryFn: () => runs.declarations({ fy }), retry: false });
  const d = mq.data?.declaration; const [f, setF] = useState(null); const form = f ?? { regime: d?.regime ?? 'NEW', sec80C: d?.declarations?.sec80C ?? '', sec80D: d?.declarations?.sec80D ?? '', sec24b: d?.declarations?.sec24b ?? '', sec80CCD1B: d?.declarations?.sec80CCD1B ?? '' };
  const set = (k) => (e) => setF({ ...form, [k]: e.target.value }); const body = (submit) => ({ fy, regime: form.regime, declarations: Object.fromEntries(['sec80C', 'sec80D', 'sec24b', 'sec80CCD1B'].filter((k) => form[k] !== '').map((k) => [k, Number(form[k])])), submit });
  return (<section aria-labelledby="dc-h" data-testid="dc-page"><PageHeader id="dc-h" title={t('dc.title')} subtitle={t('dc.intro')} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <Field label={t('dc.fy')} name="fy" error={null}><input value={fy} onChange={(e) => setFy(e.target.value)} style={big} /></Field>
    {mq.error?.status === 403 ? null : mq.isPending ? null : mq.isError ? <p className="muted small">{mq.error?.message}</p> : <div className="mdm-panel" data-testid="dc-mine"><h2>{t('dc.mine', { name: mq.data.employee })}</h2>{d && <p><StatusBadge status={d.status === 'VERIFIED' ? 'APPROVED' : d.status === 'SUBMITTED' ? 'IN_REVIEW' : d.status === 'RETURNED' ? 'RETURNED' : 'DRAFT'} label={t(`dc.st.${d.status}`)} />{d.note ? ` ${d.note}` : ''}</p>}
      <Pills tabs={[['NEW', t('dc.new')], ['OLD', t('dc.old')]]} tab={form.regime} setTab={(k) => setF({ ...form, regime: k })} label={t('dc.regime')} prefix="dc-regime" />
      {form.regime === 'OLD' && <div className="form-grid">{[['sec80C', '80C'], ['sec80CCD1B', '80CCD(1B)'], ['sec80D', '80D'], ['sec24b', '24(b)']].map(([k, l]) => <Field key={k} label={`${l} (${t('dc.upTo')} ${money(mq.data.caps[k])})`} name={k} error={null}><input inputMode="decimal" value={form[k]} onChange={set(k)} style={big} data-testid={`dc-${k}`} /></Field>)}</div>}
      <div className="actions-row ff-actionbar"><button type="button" className="btn" style={big} disabled={busy || d?.status === 'VERIFIED'} onClick={() => run(() => runs.saveDeclaration(body(false)), t('dc.saved'))}>{t('dc.save')}</button><button type="button" className="btn btn-primary" style={big} disabled={busy || d?.status === 'VERIFIED'} onClick={() => run(() => runs.saveDeclaration(body(true)), t('dc.sent'))} data-testid="dc-submit">{t('dc.submit')}</button></div></div>}
    {aq.error?.status === 403 ? null : aq.data && <div className="mdm-panel" data-testid="dc-all"><h2>{t('dc.all')}</h2>{aq.data.length === 0 ? <p className="muted">{t('dc.noneYet')}</p> : <ul className="lp-list">{aq.data.map((x) => <li key={x.id} style={{ ...card, display: 'grid', gap: 4 }}><span style={row}><strong>{x.employee}</strong><span>{x.regime} · {t(`dc.st.${x.status}`)}</span></span><span className="small">{Object.entries(x.declarations).map(([k, v]) => `${k} ${money(v)}`).join(' · ') || '—'}</span>
      {x.status === 'SUBMITTED' && <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => runs.verify(x.id, { action: 'verify' }), t('dc.verified'))} data-testid={`dc-verify-${x.id}`}>{t('dc.verify')}</button><button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => { const n = globalThis.prompt?.(t('dc.whyReturn')); if (n) run(() => runs.verify(x.id, { action: 'return', note: n }), t('dc.returned')); }}>{t('dc.return')}</button></div>}</li>)}</ul>}</div>}
  </section>);
}
