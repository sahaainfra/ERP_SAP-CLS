import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import { EmptyState } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../site/parts.jsx';
import { money } from '../fin/api.js';
import { GlError, useGlRunner } from '../fin/JournalsPage.jsx';
import { Decide, Pills, Rows, big, guardOf, istToday } from '../fin/finparts.jsx';
import { TONE, file, settle } from './api.js';

// Part 24.05: the end of the payroll cycle.
//  Post Payroll & Create Payment (a wizard: 1 post the approved run to the ledger, 2 pay the net pay through a checked bank file and confirm it, 3 the payslips
//  and their distribution); the wage runs and their posting. Full & Final Settlement (an object page: the components with their working, adjustments, the
//  approvals, the payment, the related separation and the relieving letter). My Payslips (self-service, on the phone).
const row = { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };
const card = { padding: 12, margin: '6px 0' };
const amt = (v, t) => (v == null ? t('pp.masked') : money(v));
const STEPS = ['post', 'pay', 'payslips'];
const TT = { DRAFT: 'DRAFT', RELEASED: 'IN_REVIEW', PART_CONFIRMED: 'IN_REVIEW', CONFIRMED: 'APPROVED', CANCELLED: 'CANCELLED' };
const PT = { POSTED: 'APPROVED', FAILED: 'REJECTED', RESOLVED: 'APPROVED', SKIPPED: 'CANCELLED', IGNORED: 'CANCELLED' };

function PostingChip({ p, t }) { return p ? <StatusBadge status={PT[p.status] ?? 'DRAFT'} label={`${t(`pp.ps.${p.status}`)}${p.voucher ? ` · ${p.voucher}` : ''}`} /> : <StatusBadge status="DRAFT" label={t('pp.notPosted')} />; }

function Transfer({ tr, t, run, busy }) {
  const [open, setOpen] = useState(false); const [rows, setRows] = useState({});
  const q = useQuery({ queryKey: ['gl', 'pp-transfer', tr.id], queryFn: () => settle.transfer(tr.id), retry: false, enabled: open });
  const set = (id, k, v) => setRows({ ...rows, [id]: { status: 'PAID', paidOn: istToday(), ...rows[id], [k]: v } });
  const ready = Object.entries(rows).filter(([, r]) => (r.status === 'PAID' ? (r.utr ?? '').trim().length >= 12 : (r.reason ?? '').trim().length >= 3));
  return (<li className="mdm-panel" style={card} data-testid={`pp-transfer-${tr.id}`} data-status={tr.status}>
    <div style={row}><strong>{tr.docNo}</strong><StatusBadge status={TT[tr.status] ?? 'DRAFT'} label={tr.statusLabel} /></div>
    <span className="small">{t('pp.trLine', { n: tr.lines, mode: tr.mode, date: tr.payDate, bank: tr.bank?.name ?? '' })} · {money(tr.total)}{tr.voucher ? ` · ${tr.voucher}` : ''}</span>
    {tr.can.releaseBlocked && <span className="small muted">{tr.can.releaseBlocked}</span>}
    <div className="actions-row">
      {tr.can.release && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => settle.release(tr.id), t('pp.released'))} data-testid={`pp-release-${tr.id}`}>{t('pp.release')}</button>}
      {tr.can.file && <button type="button" className="btn" style={big} onClick={() => file(`/transfers/${tr.id}/file`, tr.fileName ?? `${tr.docNo}.csv`).catch(() => globalThis.alert?.(t('pp.fileFailed')))} data-testid={`pp-file-${tr.id}`}>{t('pp.bankFile')}</button>}
      {tr.can.cancel && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = globalThis.prompt?.(t('pp.whyCancel')); if (r && r.trim().length >= 5) run(() => settle.cancelTransfer(tr.id, { reason: r.trim() }), t('pp.cancelled')); }}>{t('pp.cancel')}</button>}
      <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setOpen(!open)} aria-expanded={open} data-testid={`pp-open-${tr.id}`}>{open ? t('pp.hideLines') : t('pp.showLines')}</button>
    </div>
    {open && (guardOf(q, t('pp.lines'), 'pay.transfer.view') ?? <><ul className="lp-list" data-testid={`pp-lines-${tr.id}`}>{q.data.items.map((l) => <li key={l.id} style={{ ...card, borderTop: '1px solid var(--erp-color-border-subtle)' }} data-testid={`pp-line-${l.id}`}>
      <div style={row}><span>{l.employee}</span><span className="num">{amt(l.amount, t)}</span></div><span className="small">{l.bank} · {t(`pp.ls.${l.status}`)}{l.utr ? ` · UTR ${l.utr}` : ''}{l.reason ? ` · ${l.reason}` : ''}</span>
      {tr.can.confirm && l.status === 'INCLUDED' && <div className="form-grid">
        <Field label={t('pp.outcome')} name={`st${l.id}`} error={null}><select value={rows[l.id]?.status ?? 'PAID'} onChange={(e) => set(l.id, 'status', e.target.value)} style={big} data-testid={`pp-outcome-${l.id}`}><option value="PAID">{t('pp.ls.PAID')}</option><option value="FAILED">{t('pp.ls.FAILED')}</option></select></Field>
        {(rows[l.id]?.status ?? 'PAID') === 'PAID' ? <Field label="UTR" name={`utr${l.id}`} error={null}><input value={rows[l.id]?.utr ?? ''} onChange={(e) => set(l.id, 'utr', e.target.value.toUpperCase())} style={big} autoCapitalize="characters" inputMode="text" data-testid={`pp-utr-${l.id}`} /></Field>
          : <Field label={t('pp.returnReason')} name={`rs${l.id}`} error={null}><input value={rows[l.id]?.reason ?? ''} onChange={(e) => set(l.id, 'reason', e.target.value)} style={big} /></Field>}
        <Field label={t('pp.paidOn')} name={`pd${l.id}`} error={null}><input type="date" value={rows[l.id]?.paidOn ?? istToday()} onChange={(e) => set(l.id, 'paidOn', e.target.value)} style={big} /></Field></div>}
    </li>)}</ul>
    {tr.can.confirm && <div className="actions-row ff-actionbar"><button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy || !ready.length} onClick={() => run(() => settle.confirm(tr.id, { rows: ready.map(([lineId, r]) => ({ lineId: Number(lineId), status: r.status, paidOn: r.paidOn ?? istToday(), ...(r.status === 'PAID' ? { utr: r.utr.trim() } : { reason: r.reason.trim() }) })) }), t('pp.confirmed')).then((x) => x && setRows({}))} data-testid={`pp-confirm-${tr.id}`}>{t('pp.confirmN', { n: ready.length })}</button></div>}</>)}
  </li>);
}

function Pay({ x, t, run, busy }) {
  const bq = useQuery({ queryKey: ['gl', 'pp-banks'], queryFn: () => settle.banks(), retry: false, enabled: x.can.transfer }); const [f, setF] = useState({ bankAccountId: '', payDate: istToday(), mode: 'NEFT' });
  const ready = x.unpaid.filter((u) => u.reason === 'READY'); const bank = f.bankAccountId || bq.data?.[0]?.id || '';
  return (<div data-testid="pp-pay"><KpiRow label={t('pp.payState')}><KpiTile label={t('pp.paid')} value={String(x.paid)} valueTestid="pp-paid" /><KpiTile label={t('pp.inTransfer')} value={String(x.inTransfer)} /><KpiTile label={t('pp.toPay')} value={String(ready.length)} valueTestid="pp-topay" /><KpiTile label={t('pp.held')} value={String(x.unpaid.filter((u) => u.hold).length)} /></KpiRow>
    {x.unpaid.length > 0 && <div className="mdm-panel"><h2>{t('pp.notPaid')}</h2><ul className="lp-list" data-testid="pp-unpaid">{x.unpaid.map((u) => <li key={u.lineId} style={{ ...row, minHeight: 44, alignItems: 'center' }} data-testid={`pp-unpaid-${u.employeeId}`}><span>{u.employee}<br /><span className="small">{t(`pp.why.${u.reason}`)}{u.holdReason ? `: ${u.holdReason}` : ''}</span></span><span className="num">{amt(u.net, t)}</span>
      {x.can.hold && <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => { const r = globalThis.prompt?.(u.hold ? t('pp.whyRelease') : t('pp.whyHold')); if (r && r.trim().length >= 5) run(() => settle.hold(x.run.id, u.lineId, { hold: !u.hold, reason: r.trim() }), u.hold ? t('pp.holdReleased') : t('pp.holdSet')); }} data-testid={`pp-hold-${u.employeeId}`}>{u.hold ? t('pp.releaseHold') : t('pp.hold')}</button>}</li>)}</ul></div>}
    {x.can.transfer && ready.length > 0 && <div className="mdm-panel" data-testid="pp-new"><h2>{t('pp.newTransfer')}</h2>
      {bq.data?.length === 0 ? <p className="small">{t('pp.noBank')}</p> : <div className="form-grid">
        <Field label={t('pp.bank')} name="bank" error={null} required><select value={bank} onChange={(e) => setF({ ...f, bankAccountId: e.target.value })} style={big} data-testid="pp-bank">{(bq.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name} {b.account}</option>)}</select></Field>
        <Field label={t('pp.payDate')} name="payDate" error={null} required><input type="date" value={f.payDate} min={istToday()} onChange={(e) => setF({ ...f, payDate: e.target.value })} style={big} data-testid="pp-paydate" /></Field>
        <Field label={t('pp.mode')} name="mode" error={null}><select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} style={big}><option>NEFT</option><option>RTGS</option><option>IMPS</option></select></Field></div>}
      <div className="actions-row ff-actionbar"><button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy || !bank} onClick={() => run(() => settle.createTransfer({ runId: x.run.id, bankAccountId: Number(bank), payDate: f.payDate, mode: f.mode }), t('pp.prepared'))} data-testid="pp-prepare">{t('pp.prepare', { n: ready.length })}</button></div></div>}
    <h2 className="small" style={{ margin: '12px 0 4px' }}>{t('pp.transfers')}</h2>
    {x.transfers.length === 0 ? <EmptyState compact title={t('pp.noTransfers')} message={t('pp.noTransfersBody')} /> : <ul className="lp-list">{x.transfers.map((tr) => <Transfer key={tr.id} tr={tr} t={t} run={run} busy={busy} />)}</ul>}
  </div>);
}

function Payslips({ x, t, run, busy }) {
  const q = useQuery({ queryKey: ['gl', 'pp-slips', x.run.id], queryFn: () => settle.payslips(x.run.id), retry: false }); const g = guardOf(q, t('pp.payslips'), 'pay.payslip.view'); if (g) return g; const s = q.data;
  return (<div data-testid="pp-slips"><KpiRow label={t('pp.distribution')}><KpiTile label={t('pp.generated')} value={`${s.counts.generated} / ${s.run.employees}`} valueTestid="pp-generated" /><KpiTile label={t('pp.emailed')} value={String(s.counts.emailed)} valueTestid="pp-emailed" /><KpiTile label={t('pp.noAddress')} value={String(s.counts.noAddress)} /><KpiTile label={t('pp.viewed')} value={String(s.counts.viewed)} /></KpiRow>
    <p className="small muted">{t('pp.passwordRule')}</p>
    {s.rows.length === 0 ? <EmptyState compact title={t('pp.noSlips')} message={t('pp.noSlipsBody')} /> : <ul className="lp-list" data-testid="pp-slip-list">{s.rows.map((p) => <li key={p.id} className="mdm-panel" style={card} data-testid={`pp-slip-${p.employeeId}`}><div style={row}><strong>{p.employee}</strong><span className="num">{amt(p.net, t)}</span></div>
      <span className="small">{p.lang === 'hi' ? 'हिन्दी' : 'English'} · {t(`pp.es.${p.email}`)}{p.emailTo ? ` · ${p.emailTo}` : ''}{p.viewedAt ? ` · ${t('pp.viewedOn', { d: p.viewedAt.slice(0, 10) })}` : ''}</span></li>)}</ul>}
    <div className="actions-row ff-actionbar" style={{ position: 'sticky', bottom: 0 }}>
      {x.can.payslips && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => settle.generate({ runId: x.run.id, lang: 'auto' }), t('pp.slipsMade'))} data-testid="pp-generate">{s.counts.generated ? t('pp.regenerate') : t('pp.generate')}</button>}
      {x.can.email && s.counts.generated > 0 && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => settle.email({ runId: x.run.id }), t('pp.mailed'))} data-testid="pp-email">{t('pp.email')}</button>}
    </div></div>);
}

function RunWizard({ id, initial }) {
  const t = useT('pp'); const q = useQuery({ queryKey: ['gl', 'pp-run', id], queryFn: () => settle.run(id), retry: false }); const { error, note, busy, run } = useGlRunner(); const [step, setStep] = useState(initial ?? null); usePageTitle(t('pp.title'));
  const g = guardOf(q, t('pp.title'), 'pay.posting.view'); if (g) return g; const x = q.data; const cur = step ?? (x.posting?.status === 'POSTED' ? 'pay' : 'post');
  return (<section aria-labelledby="pp-h" data-testid="pp-run"><PageHeader id="pp-h" title={`${x.run.docNo} · ${x.run.period}`} subtitle={t('pp.runLine', { n: x.run.employees, held: x.run.held })} meta={<PostingChip p={x.posting} t={t} />} />
    <p><Link to="/payroll/posting">{t('pp.back')}</Link></p><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <Pills tabs={STEPS.map((k, i) => [k, `${i + 1}. ${t(`pp.step.${k}`)}`])} tab={cur} setTab={setStep} label={t('pp.steps')} prefix="pp-step" />
    {cur === 'post' && <div data-testid="pp-post"><KpiRow label={t('pp.totals')}><KpiTile label={t('pp.net')} value={amt(x.run.net, t)} amount={x.run.net ?? 0} kind="money" valueTestid="pp-net" /><KpiTile label={t('pp.gross')} value={amt(x.run.gross, t)} amount={x.run.gross ?? 0} kind="money" /><KpiTile label={t('pp.balanced')} value={x.totals.balanced ? t('pp.yes') : t('pp.no')} valueTestid="pp-balanced" /></KpiRow>
      {x.posting?.status === 'FAILED' && <p className="field-error" role="alert" data-testid="pp-post-error">{x.posting.error}</p>}
      {x.byProject.length > 0 && <div className="mdm-panel"><h2>{t('pp.byProject')}</h2><ul className="lp-list">{x.byProject.map((p) => <li key={p.project} style={{ ...row, minHeight: 36 }}><span>{p.project}</span><span className="num">{money(p.amount)}</span></li>)}</ul></div>}
      {x.preview.length > 0 && <div className="mdm-panel"><h2>{t('pp.journal')}</h2><ul className="lp-list small" data-testid="pp-preview">{x.preview.map((l, i) => <li key={i} style={{ ...row, minHeight: 32 }}><span>{l.side === 'DR' ? t('pp.dr') : t('pp.cr')} {l.account} {l.name}{l.dims ? ` · ${l.dims}` : ''}</span><span className="num">{money(l.amount)}</span></li>)}</ul>
        <Rows rows={[[t('pp.debits'), money(x.totals.debit)], [t('pp.credits'), money(x.totals.credit)]]} /></div>}
      <div className="actions-row ff-actionbar" style={{ position: 'sticky', bottom: 0 }}>{x.can.post && x.posting?.status !== 'POSTED' && <button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy} onClick={() => run(() => settle.post(x.run.id), t('pp.postedNote'))} data-testid="pp-post-btn">{t('pp.post')}</button>}
        {x.posting?.status === 'POSTED' && <button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} onClick={() => setStep('pay')} data-testid="pp-next-pay">{t('pp.next')}</button>}</div></div>}
    {cur === 'pay' && <Pay x={x} t={t} run={run} busy={busy} />}
    {cur === 'payslips' && <Payslips x={x} t={t} run={run} busy={busy} />}
  </section>);
}

function WageRuns({ t }) {
  const q = useQuery({ queryKey: ['gl', 'pp-wage'], queryFn: () => settle.wageRuns({}), retry: false }); const { error, note, busy, run } = useGlRunner(); const g = guardOf(q, t('pp.wageRuns'), 'pay.posting.view'); if (g) return g;
  return (<div data-testid="pp-wage"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}{q.data.length === 0 ? <EmptyState compact title={t('pp.noWage')} message={t('pp.noWageBody')} /> : <ul className="lp-list">{q.data.map((w) => <li key={w.id} className="mdm-panel" style={card}><div style={row}><strong>{w.docNo}</strong><PostingChip p={w.posting} t={t} /></div>
    <span className="small">{w.project} · {w.site} · {w.periodFrom} – {w.periodTo} · {t('pp.workers', { n: w.workers })} · {amt(w.net, t)} · {t('pp.paymentsPosted', { n: w.payments.posted, m: w.payments.n })}</span>
    {w.posting?.status !== 'POSTED' && <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => settle.postWage(w.id), t('pp.postedNote'))}>{t('pp.post')}</button></div>}</li>)}</ul>}</div>);
}

export function PostingPage() {
  const t = useT('pp'); usePageTitle(t('pp.title')); const sp = useSearch(); const id = Number(sp.get('run')) || null; const tid = Number(sp.get('transfer')) || null; const [tab, setTab] = useState('staff');
  const tq = useQuery({ queryKey: ['gl', 'pp-tr', tid], queryFn: () => settle.transfer(tid), retry: false, enabled: Boolean(tid) && !id });
  const lq = useQuery({ queryKey: ['gl', 'pp-runs'], queryFn: () => settle.runs({}), retry: false, enabled: !id && !tid });
  if (id) return <RunWizard id={id} />;
  if (tid) { if (tq.data?.runId) return <RunWizard id={tq.data.runId} initial="pay" />; if (tq.data?.fnfId) { navigateTo(`/payroll/fnf?id=${tq.data.fnfId}`); return null; } return guardOf(tq, t('pp.title'), 'pay.transfer.view') ?? null; }
  return (<section aria-labelledby="ppl-h" data-testid="pp-page"><PageHeader id="ppl-h" title={t('pp.title')} subtitle={t('pp.intro')} meta={<Link to="/payroll/fnf">{t('ff.title')}</Link>} />
    <Pills tabs={[['staff', t('pp.staff')], ['wage', t('pp.wageRuns')]]} tab={tab} setTab={setTab} label={t('pp.title')} prefix="pp-tab" />
    {tab === 'wage' ? <WageRuns t={t} /> : (guardOf(lq, t('pp.runs'), 'pay.posting.view') ?? (lq.data.length === 0 ? <EmptyState compact title={t('pp.noRuns')} message={t('pp.noRunsBody')} action={<Link to="/payroll/runs">{t('pp.toRuns')}</Link>} /> : <ul className="lp-list" data-testid="pp-runs">{lq.data.map((r) => <li key={r.id} className="mdm-panel" style={card} data-testid={`pp-runrow-${r.id}`}>
      <Link to={`/payroll/posting?run=${r.id}`} style={{ display: 'grid', gap: 4, minHeight: 44, textDecoration: 'none', color: 'inherit' }}><span style={row}><strong>{r.docNo} · {r.period}</strong><PostingChip p={r.posting} t={t} /></span>
        <span className="small">{t('pp.rowLine', { n: r.employees, paid: r.paid, transfer: r.inTransfer, held: r.held, slips: r.payslips, sent: r.payslipsSent })} · {amt(r.net, t)}</span></Link></li>)}</ul>))}
  </section>);
}

// ================================================================ Full & Final Settlement
const TABS = ['details', 'adjust', 'approvals', 'payment', 'related'];
function FnfObject({ id }) {
  const t = useT('pp'); const q = useQuery({ queryKey: ['gl', 'ff', id], queryFn: () => settle.fnf(id), retry: false }); const { error, note, busy, run } = useGlRunner(); const [tab, setTab] = useState('details'); const [adj, setAdj] = useState(null); const [pay, setPay] = useState({ bankAccountId: '', payDate: istToday() });
  const bq = useQuery({ queryKey: ['gl', 'pp-banks'], queryFn: () => settle.banks(), retry: false, enabled: Boolean(q.data?.can?.pay) }); usePageTitle(t('ff.title'));
  const g = guardOf(q, t('ff.title'), 'pay.fnf.view'); if (g) return g; const x = q.data; const c = x.can; const list = adj ?? x.adjustments; const bank = pay.bankAccountId || bq.data?.[0]?.id || '';
  const earn = x.components.filter((k) => k.type === 'EARNING'); const ded = x.components.filter((k) => k.type === 'DEDUCTION'); const info = x.components.filter((k) => k.type === 'EMPLOYER' || k.type === 'INFO');
  const Comp = ({ k }) => <li style={{ padding: '6px 0', borderTop: '1px solid var(--erp-color-border-subtle)' }} data-testid={`ff-c-${k.code}`}><div style={row}><span>{k.label}</span><span className="num">{k.type === 'DEDUCTION' ? '−' : ''}{money(k.amount)}</span></div><span className="small muted">{k.working}</span></li>;
  return (<section aria-labelledby="ff-h" data-testid="ff-object" data-status={x.status}>
    <PageHeader id="ff-h" title={`${x.docNo} · ${x.employee}`} subtitle={[x.designation, x.department].filter(Boolean).join(' · ')} meta={<><StatusBadge status={TONE[x.status] ?? 'CANCELLED'} label={x.statusLabel} /> <StatusBadge status={x.payStatus === 'PAID' ? 'APPROVED' : 'DRAFT'} label={`${x.payStatusLabel}${x.late ? ` · ${t('ff.late')}` : ''}`} /></>} />
    <p><Link to="/payroll/fnf">{t('ff.back')}</Link></p><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <KpiRow label={t('ff.facts')}><KpiTile label={t('ff.net')} value={x.net == null ? t('pp.masked') : x.net < 0 ? `${money(-x.net)} ${t('ff.toRecover')}` : money(x.net)} amount={Math.abs(x.net ?? 0)} kind="money" valueTestid="ff-net" /><KpiTile label={t('ff.lwd')} value={x.lastWorkingDay} /><KpiTile label={t('ff.payBy')} value={x.dueDate ?? '—'} valueTestid="ff-due" /><KpiTile label={t('ff.tds')} value={amt(x.tds, t)} /></KpiRow>
    {x.blockers.length > 0 && <div className="mdm-banner" role="alert" data-testid="ff-blockers">{x.blockers.map((b) => <p key={b} style={{ margin: 0 }}>⛔ {b}</p>)}</div>}
    <Pills tabs={TABS.map((k) => [k, t(`ff.tab.${k}`)])} tab={tab} setTab={setTab} label={t('ff.title')} prefix="ff-tab" />
    {tab === 'details' && <div data-testid="ff-details">
      {x.working && <div className="mdm-panel"><Rows rows={[[t('ff.joined'), x.doj], [t('ff.service'), x.working.gratuity ? t('ff.serviceLine', { y: x.working.gratuity.service.years, m: x.working.gratuity.service.months, d: x.working.gratuity.service.days, n: x.working.gratuity.countedYears }) : null], [t('ff.monthly'), x.working.monthly ? t('ff.monthlyLine', { g: money(x.working.monthly.gross), b: money(x.working.monthly.basicDa) }) : null], [t('ff.lastSalary'), x.working.lastSalaryPeriods.length ? x.working.lastSalaryPeriods.join(', ') : t('ff.paidByRun')], [t('ff.taxLine'), x.working.tax ? `${x.working.tax.regime} · ${money(x.working.tax.yearTaxable)}` : null]]} /></div>}
      <div className="mdm-panel"><h2>{t('ff.earnings')}</h2><ul className="lp-list">{earn.map((k) => <Comp key={k.code} k={k} />)}</ul><Rows rows={[[t('ff.gross'), amt(x.gross, t)]]} /></div>
      <div className="mdm-panel"><h2>{t('ff.deductions')}</h2><ul className="lp-list">{ded.map((k) => <Comp key={k.code} k={k} />)}</ul><Rows rows={[[t('ff.totalDed'), amt(x.deductions, t)]]} /></div>
      {info.length > 0 && <div className="mdm-panel"><h2>{t('ff.notes')}</h2><ul className="lp-list">{info.map((k) => <Comp key={k.code} k={k} />)}</ul></div>}
    </div>}
    {tab === 'adjust' && <div className="mdm-panel" data-testid="ff-adjust"><h2>{t('ff.adjustments')}</h2>
      {list.length === 0 && <p className="small">{t('ff.noAdj')}</p>}
      {list.map((a, i) => <div key={i} className="form-grid" style={{ borderTop: '1px solid var(--erp-color-border-subtle)', paddingTop: 6 }}>
        <Field label={t('ff.label')} name={`l${i}`} error={null}><input value={a.label} disabled={!c.compute} onChange={(e) => setAdj(list.map((y, k) => (k === i ? { ...y, label: e.target.value } : y)))} style={big} /></Field>
        <Field label={t('ff.kind')} name={`k${i}`} error={null}><select value={a.type} disabled={!c.compute} onChange={(e) => setAdj(list.map((y, k) => (k === i ? { ...y, type: e.target.value } : y)))} style={big}><option value="EARNING">{t('ff.earning')}</option><option value="DEDUCTION">{t('ff.deduction')}</option></select></Field>
        <Field label={t('ff.amount')} name={`a${i}`} error={null}><input type="number" inputMode="decimal" min="0" step="0.01" value={a.amount} disabled={!c.compute} onChange={(e) => setAdj(list.map((y, k) => (k === i ? { ...y, amount: e.target.value } : y)))} style={big} /></Field>
        <Field label={t('ff.reason')} name={`r${i}`} error={null}><input value={a.reason} disabled={!c.compute} onChange={(e) => setAdj(list.map((y, k) => (k === i ? { ...y, reason: e.target.value } : y)))} style={big} /></Field>
        {c.compute && <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setAdj(list.filter((_, k) => k !== i))}>{t('ff.remove')}</button>}</div>)}
      {c.compute && <div className="actions-row"><button type="button" className="btn" style={big} onClick={() => setAdj([...list, { label: '', type: 'EARNING', amount: '', reason: '' }])} data-testid="ff-add">{t('ff.add')}</button>
        <button type="button" className="btn btn-primary" style={big} disabled={busy || !adj} onClick={() => run(() => settle.updateFnf(x.id, { version: x.version, adjustments: list.map((a) => ({ label: a.label.trim(), type: a.type, amount: Number(a.amount), reason: a.reason.trim() })) }), t('ff.saved')).then((r) => r && setAdj(null))} data-testid="ff-save">{t('ff.saveAdj')}</button></div>}
    </div>}
    {tab === 'approvals' && <><Decide x={x} run={run} busy={busy} t={t} p="ff" testid="ff-decide" /><div className="mdm-panel"><h2>{t('ff.history')}</h2>{(x.history?.approvals ?? []).length === 0 ? <p className="small">{t('ff.noHistory')}</p> : <ul className="lp-list">{x.history.approvals.map((h, i) => <li key={i} style={{ minHeight: 44 }}>{String(h.at).slice(0, 16).replace('T', ' ')} · {h.actor} · {h.event}{h.comment ? ` · ${h.comment}` : ''}</li>)}</ul>}</div></>}
    {tab === 'payment' && <div data-testid="ff-payment">
      {c.pay && <div className="mdm-panel"><h2>{t('ff.payTitle')}</h2><div className="form-grid">
        <Field label={t('pp.bank')} name="bank" error={null} required><select value={bank} onChange={(e) => setPay({ ...pay, bankAccountId: e.target.value })} style={big} data-testid="ff-bank">{(bq.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name} {b.account}</option>)}</select></Field>
        <Field label={t('pp.payDate')} name="payDate" error={null} required><input type="date" min={istToday()} value={pay.payDate} onChange={(e) => setPay({ ...pay, payDate: e.target.value })} style={big} /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !bank} onClick={() => run(() => settle.createTransfer({ fnfId: x.id, bankAccountId: Number(bank), payDate: pay.payDate, mode: 'NEFT' }), t('pp.prepared'))} data-testid="ff-pay">{t('ff.pay', { a: money(x.payable ?? 0) })}</button></div></div>}
      {x.transfers.length === 0 ? <EmptyState compact title={t('pp.noTransfers')} message={t('ff.noPayBody')} /> : <ul className="lp-list">{x.transfers.map((tr) => <Transfer key={tr.id} tr={tr} t={t} run={run} busy={busy} />)}</ul>}
    </div>}
    {tab === 'related' && <div className="mdm-panel" data-testid="ff-related"><Rows rows={[[t('ff.separation'), `${x.separation} (${x.separationType})`], [t('ff.posting'), x.posting ? `${t(`pp.ps.${x.posting.status}`)}${x.posting.voucher ? ` · ${x.posting.voucher}` : ''}` : t('pp.notPosted')], [t('ff.relieving'), x.relievingIssued ? t('ff.issued') : t('ff.notIssued')], [t('ff.amends'), x.amendsId ? `#${x.amendsId}` : null]]} />
      <div className="actions-row">{c.relieving && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => settle.letter(x.separationId), t('ff.letterIssued'))} data-testid="ff-relieving">{t('ff.issueRelieving')}</button>}<Link to={`/exit/separation?id=${x.separationId}`}>{t('ff.openSeparation')}</Link></div></div>}
    <div className="actions-row ff-actionbar" style={{ position: 'sticky', bottom: 0 }}>
      {c.compute && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => settle.fnfAct(x.id, 'compute'), t('ff.recomputed'))} data-testid="ff-compute">{t('ff.compute')}</button>}
      {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy || x.blockers.length > 0} onClick={() => run(() => settle.fnfAct(x.id, 'submit'), t('ff.sent'))} data-testid="ff-submit">{t('ff.submit')}</button>}
      {c.amend && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = globalThis.prompt?.(t('ff.whyAmend')); if (r && r.trim().length >= 5) run(() => settle.fnfAct(x.id, 'amend', { reason: r.trim() }), t('ff.amended')).then((y) => y && navigateTo(`/payroll/fnf?id=${y.id}`)); }}>{t('ff.amend')}</button>}
      {c.print && <button type="button" className="btn" style={big} onClick={() => file(`/fnf/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => globalThis.alert?.(t('pp.fileFailed')))} data-testid="ff-print">{t('ff.statement')}</button>}
    </div></section>);
}

export function FnfPage() {
  const t = useT('pp'); usePageTitle(t('ff.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const { error, note, busy, run } = useGlRunner();
  const cq = useQuery({ queryKey: ['gl', 'ff-cand'], queryFn: () => settle.candidates(), retry: false, enabled: !id }); const lq = useQuery({ queryKey: ['gl', 'ff-list'], queryFn: () => settle.fnfList({ pageSize: 50 }), retry: false, enabled: !id });
  if (id) return <FnfObject id={id} />;
  const g = guardOf(lq, t('ff.title'), 'pay.fnf.view'); const rows = lq.data?.data ?? [];
  return (<section aria-labelledby="ffl-h" data-testid="ff-page"><PageHeader id="ffl-h" title={t('ff.title')} subtitle={t('ff.intro')} meta={<Link to="/payroll/posting">{t('pp.title')}</Link>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    {g ?? <>{(cq.data ?? []).length > 0 && <div className="mdm-panel" data-testid="ff-candidates"><h2>{t('ff.candidates')}</h2><ul className="lp-list">{cq.data.map((s) => <li key={s.separationId} style={{ ...row, minHeight: 44, alignItems: 'center' }}><span>{s.employee}<br /><span className="small">{s.separation} · {t('ff.lwd')} {s.lastWorkingDay}</span></span>
        <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => settle.createFnf({ separationId: s.separationId }), t('ff.drafted')).then((r) => r && navigateTo(`/payroll/fnf?id=${r.id}`))} data-testid={`ff-start-${s.separationId}`}>{t('ff.start')}</button></li>)}</ul></div>}
      <KpiRow label={t('ff.summary')}><KpiTile label={t('ff.open')} value={String(rows.filter((r) => ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)).length)} /><KpiTile label={t('ff.toPayN')} value={String(rows.filter((r) => r.status === 'APPROVED' && ['UNPAID', 'IN_TRANSFER'].includes(r.payStatus)).length)} /><KpiTile label={t('ff.lateN')} value={String(rows.filter((r) => r.late).length)} /></KpiRow>
      {rows.length === 0 ? <EmptyState compact title={t('ff.none')} message={t('ff.noneBody')} /> : <ul className="lp-list" data-testid="ff-list">{rows.map((f) => <li key={f.id} className="mdm-panel" style={card}><Link to={`/payroll/fnf?id=${f.id}`} style={{ display: 'grid', gap: 4, minHeight: 44, textDecoration: 'none', color: 'inherit' }} data-testid={`ff-row-${f.id}`}>
        <span style={row}><strong>{f.docNo} · {f.employee}</strong><StatusBadge status={TONE[f.status] ?? 'CANCELLED'} label={f.statusLabel} /></span><span className="small">{t('ff.lwd')} {f.lastWorkingDay} · {t('ff.payBy')} {f.dueDate ?? '—'} · {f.payStatusLabel}{f.late ? ` · ${t('ff.late')}` : ''} · {amt(f.net, t)}</span></Link></li>)}</ul>}
      {rows.length > 0 && <div className="actions-row"><button type="button" className="btn" style={big} onClick={() => file('/fnf/export', 'full-and-final.csv').catch(() => globalThis.alert?.(t('pp.fileFailed')))}>{t('ff.export')}</button></div>}</>}
  </section>);
}

// ================================================================ My Payslips (self-service)
export function MyPayslipsPage() {
  const t = useT('pp'); usePageTitle(t('my.title')); const q = useQuery({ queryKey: ['gl', 'my-slips'], queryFn: () => settle.mine(), retry: false });
  const g = guardOf(q, t('my.title'), 'pay.payslip.own');
  return (<section aria-labelledby="my-h" data-testid="my-slips"><PageHeader id="my-h" title={t('my.title')} subtitle={q.data?.employee ?? ''} />
    {g ?? <><p className="mdm-banner" role="note" data-testid="my-hint">{t('my.hint')}</p>
      {q.data.rows.length === 0 ? <EmptyState compact title={t('my.none')} message={t('my.noneBody')} /> : <ul className="lp-list">{q.data.rows.map((p) => <li key={p.id} className="mdm-panel" style={card} data-testid={`my-slip-${p.period}`}><div style={row}><strong>{p.month}</strong><span className="num">{money(p.net)}</span></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} onClick={() => file(`/payslips/${p.id}/download`, `payslip-${p.period}.pdf`).catch(() => globalThis.alert?.(t('pp.fileFailed')))} data-testid={`my-download-${p.period}`}>{t('my.download')}</button></div></li>)}</ul>}</>}
  </section>);
}
