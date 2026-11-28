import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import { EmptyState } from '../../platform/feedback/states.jsx';
import CodeScanner from '../../platform/device/CodeScanner.jsx';
import { FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../site/parts.jsx';
import { money } from '../fin/api.js';
import { GlError, useGlRunner } from '../fin/JournalsPage.jsx';
import { Decide, Pills, Rows, big, guardOf, istToday, lastMonth } from '../fin/finparts.jsx';
import { TONE, file, openSlips, wages } from './api.js';

// Part 24.03: the labour wage run as a wizard (1 period, 2 muster and wages of each worker, 3 review, 4 approval, 5 payment and the worker's acknowledgement on
// the supervisor's phone), the wage register with the muster roll, and the contractor wage verification worklist (verify, return or hold on each card).
const row = { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };
const card = { padding: 12, margin: '6px 0' };
const amt = (v, t) => (v == null ? t('wr.masked') : money(v));
const STEPS = ['period', 'muster', 'review', 'approve', 'pay'];
const mondayOf = (iso) => { const d = new Date(`${iso}T00:00:00Z`); const k = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - k - 7); return d.toISOString().slice(0, 10); };
const Flags = ({ flags }) => flags.filter((f) => f.severity !== 'INFO').map((f) => <span key={f.code} className="small" style={f.severity === 'BLOCK' ? { color: 'var(--erp-color-status-error-fg)', fontWeight: 700 } : undefined}>{f.severity === 'BLOCK' ? '⛔' : '⚠'} {f.message}</span>);

function NewRun({ t, run, busy }) {
  const q = useQuery({ queryKey: ['gl', 'wr-options'], queryFn: () => wages.options(), retry: false }); const [f, setF] = useState({ siteId: '', contractorId: '', cycle: 'WEEKLY', periodFrom: mondayOf(istToday()) });
  const g = guardOf(q, t('wr.new'), 'pay.wage_run.view'); if (g) return g; const o = q.data; const sites = o.sites.filter((s) => s.canCreate); if (!sites.length) return null;
  const set = (k) => (e) => { const v = e.target.value; setF((x) => ({ ...x, [k]: v, ...(k === 'cycle' ? { periodFrom: v === 'WEEKLY' ? mondayOf(istToday()) : `${lastMonth()}-${v === 'FORTNIGHTLY' ? '16' : '01'}` } : {}) })); };
  return (<div className="mdm-panel" data-testid="wr-new"><h2>{t('wr.new')}</h2><div className="form-grid">
    <Field label={`${t('wr.site')} *`} name="siteId" error={null}><select value={f.siteId} onChange={set('siteId')} style={big} data-testid="wr-site"><option value="">{t('wr.choose')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
    <Field label={`${t('wr.contractor')} *`} name="contractorId" error={null} hint={t('wr.contractorHint')}><select value={f.contractorId} onChange={set('contractorId')} style={big} data-testid="wr-contractor"><option value="">{t('wr.choose')}</option>{o.contractors.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.workers})</option>)}</select></Field>
    <Field label={t('wr.cycle')} name="cycle" error={null}><select value={f.cycle} onChange={set('cycle')} style={big} data-testid="wr-cycle">{o.cycles.map((c) => <option key={c} value={c}>{t(`wr.cy.${c}`)}</option>)}</select></Field>
    <Field label={t('wr.from')} name="periodFrom" error={null} hint={t(`wr.fromHint.${f.cycle}`)}><input type="date" value={f.periodFrom} onChange={set('periodFrom')} style={big} data-testid="wr-from" /></Field></div>
    <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy || !f.siteId || !f.contractorId} onClick={() => run(() => wages.create({ siteId: Number(f.siteId), contractorId: Number(f.contractorId), cycle: f.cycle, periodFrom: f.periodFrom }), t('wr.created')).then((r) => r && navigateTo(`/payroll/wage-runs?id=${r.id}`))} data-testid="wr-create">{t('wr.compute')}</button></div></div>);
}

function LineEdit({ l, x, t, run, busy, onClose }) {
  const [f, setF] = useState({ basis: l.basis, pieceQty: l.pieceQty ?? '', pieceRate: l.pieceRate ?? '', mbId: '', rateOverride: l.rateOverride ?? '', allowances: l.allowances ?? 0, advance: l.advance ?? 0, canteen: l.canteen ?? 0, otherDeductions: l.other ?? 0, days: '', otHours: '', reason: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value }); const n = (v) => (v === '' || v == null ? undefined : Number(v));
  const save = () => { const b = { basis: f.basis, allowances: n(f.allowances) ?? 0, advance: n(f.advance) ?? 0, canteen: n(f.canteen) ?? 0, otherDeductions: n(f.otherDeductions) ?? 0, version: l.version };
    if (x.rates) b.rateOverride = f.rateOverride === '' ? null : Number(f.rateOverride);
    if (f.basis === 'PIECE') { if (f.mbId) b.pieceSources = [{ mbId: Number(f.mbId), qty: Number(f.pieceQty) }]; else b.pieceQty = n(f.pieceQty) ?? 0; if (f.pieceRate !== '') b.pieceRate = Number(f.pieceRate); }
    if (f.days || f.otHours) b.adjust = { days: n(f.days), otHours: n(f.otHours), reason: f.reason };
    run(() => wages.line(x.id, l.id, b), t('wr.lineSaved')).then((r) => r && onClose()); };
  const num = (k, label, hint) => <Field label={label} name={k} error={null} hint={hint}><input inputMode="decimal" value={f[k]} onChange={set(k)} style={big} data-testid={`wr-edit-${k}`} /></Field>;
  return (<div className="mdm-panel" style={{ marginTop: 6 }} data-testid="wr-edit"><Pills tabs={[['DAILY', t('wr.daily')], ['PIECE', t('wr.piece')]]} tab={f.basis} setTab={(k) => setF({ ...f, basis: k })} label={t('wr.basis')} prefix="wr-basis" />
    <div className="form-grid">{x.rates && f.basis === 'DAILY' && num('rateOverride', t('wr.rateOverride'), t('wr.rateHint', { min: l.minRate ?? '—' }))}
      {f.basis === 'PIECE' && <>{num('pieceQty', t('wr.pieceQty'))}{num('pieceRate', t('wr.pieceRate'))}{num('mbId', t('wr.mbId'), t('wr.mbHint'))}</>}
      {num('allowances', t('wr.allowances'))}{num('advance', t('wr.advance'))}{num('canteen', t('wr.canteen'))}{num('otherDeductions', t('wr.other'))}
      {num('days', t('wr.adjDays'), t('wr.adjHint'))}{num('otHours', t('wr.adjOt'))}
      {(f.days || f.otHours) && <Field label={`${t('wr.reason')} *`} name="reason" error={null}><input value={f.reason} onChange={set('reason')} style={big} data-testid="wr-edit-reason" /></Field>}</div>
    <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={save} data-testid="wr-edit-save">{t('wr.saveLine')}</button><button type="button" className="btn" style={big} onClick={onClose}>{t('wr.close')}</button></div></div>);
}

function LineCard({ l, x, t, run, busy, mode, picked, pick }) {
  const [open, setOpen] = useState(false); const [ack, setAck] = useState(false);
  return (<li className="mdm-panel" style={card} data-testid={`wr-line-${l.workerCode}`} data-ack={l.ack}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      {mode === 'pay' && x.can.disburse && !l.paidOn && <input type="checkbox" aria-label={t('wr.pick', { w: l.worker })} checked={picked} onChange={() => pick(l.id)} style={{ width: 28, height: 28, marginTop: 8 }} data-testid={`wr-pick-${l.workerCode}`} />}
      <button type="button" className="btn-link" style={{ display: 'grid', gap: 4, flex: '1 1 auto', minWidth: 0, minHeight: 'var(--erp-target-min)', background: 'none', border: 0, color: 'inherit', textAlign: 'left', textDecoration: 'none' }} onClick={() => setOpen(!open)}>
        <span style={{ ...row, width: '100%' }}><strong>{l.workerCode} · {l.worker}</strong><span className="num">{money(l.net)} ›</span></span>
        <span className="small">{t('wr.daysLine', { days: l.days, ot: l.otHours, trade: l.trade ?? '', basis: t(l.basis === 'PIECE' ? 'wr.piece' : 'wr.daily') })}{l.rate != null && l.basis === 'DAILY' ? ` · ₹${l.rate}/${t('wr.day')}` : ''}</span>
        {l.paidOn && <span className="small">{t('wr.paidLine', { on: l.paidOn, mode: t(`wr.mode.${l.paidMode}`) })}{l.late ? ` · ${t('wr.late')}` : ''} · {t(`wr.ack.${l.ack}`)}</span>}
        <Flags flags={l.flags} /></button></div>
    {open && <><Rows rows={[[t('wr.rate'), amt(l.rate, t)], [t('wr.minRate'), amt(l.minRate, t)], [t('wr.basic'), amt(l.basic, t)], [t('wr.piece'), l.basis === 'PIECE' ? `${amt(l.piece, t)} (${l.pieceQty} ${l.pieceUom ?? ''})` : null], [t('wr.topup'), l.topup ? amt(l.topup, t) : null], [t('wr.ot'), amt(l.ot, t)], [t('wr.allowances'), amt(l.allowances, t)], [t('wr.gross'), amt(l.gross, t)], [t('wr.pf'), l.pf ? amt(l.pf, t) : null], [t('wr.esi'), l.esi ? amt(l.esi, t) : null], [t('wr.deductions'), amt(l.deductions, t)], [t('wr.net'), money(l.net)], [t('wr.bank'), l.bank ?? t('wr.noBank')]]} />
      {l.dayLog.length > 0 && <ul className="lp-list small">{l.dayLog.map((d) => <li key={d.date} style={{ ...row, minHeight: 32 }}><span>{d.date}</span><span>{d.day === 1 ? 'P' : d.day === 0.5 ? '½' : 'A'}{d.otMinutes ? ` · OT ${d.otMinutes / 60} h` : ''}{d.missingOut ? ` · ${t('wr.noOut')}` : ''}</span></li>)}</ul>}
      {mode === 'muster' && x.can.compute && <LineEdit l={l} x={x} t={t} run={run} busy={busy} onClose={() => setOpen(false)} />}</>}
    {mode === 'pay' && x.can.acknowledge && l.paidOn && l.ack === 'PENDING' && (!ack ? <button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} onClick={() => setAck(true)} data-testid={`wr-ack-${l.workerCode}`}>{t('wr.takeAck')}</button>
      : <div className="mdm-panel" data-testid="wr-ack-panel"><p className="small">{t('wr.ackHelp', { net: money(l.net) })}</p><CodeScanner busy={busy} onCode={(code) => run(() => wages.ack(x.id, l.id, { method: 'CARD', badge: code }), t('wr.acked')).then((r) => r && setAck(false))} />
        <p className="small">{t('wr.orPhoto')}</p><FileUploader entity="pay_wage_lines" entityId={l.id} stripExif onDone={(f) => run(() => wages.ack(x.id, l.id, { method: 'PHOTO', fileId: f.id }), t('wr.acked')).then((r) => r && setAck(false))} /></div>)}
  </li>);
}

function Run({ id }) {
  const t = useT('wr'); const q = useQuery({ queryKey: ['gl', 'wr-run', id], queryFn: () => wages.get(id), retry: false }); const { error, note, busy, run } = useGlRunner(); const [step, setStep] = useState(null); const [picked, setPicked] = useState([]); const [pay, setPay] = useState({ mode: 'CASH', paidOn: istToday(), reference: '' }); usePageTitle(t('wr.title'));
  const g = guardOf(q, t('wr.title'), 'pay.wage_run.view'); if (g) return g; const x = q.data; const c = x.can; const cur = step ?? (x.status === 'APPROVED' ? 'pay' : x.status === 'SUBMITTED' ? 'approve' : 'muster');
  const pick = (lid) => setPicked((p) => (p.includes(lid) ? p.filter((v) => v !== lid) : [...p, lid])); const unpaid = x.lines.filter((l) => !l.paidOn);
  return (<section aria-labelledby="wr-h" data-testid="wr-run" data-status={x.status}><PageHeader id="wr-h" title={`${x.docNo} · ${x.site}`} subtitle={`${x.contractor} · ${t(`wr.cy.${x.cycle}`)} ${x.periodFrom} – ${x.periodTo} · ${t('wr.workersN', { n: x.workers })}`} meta={<StatusBadge status={TONE[x.status] ?? 'CANCELLED'} label={t(`wr.st.${x.status}`)} />} />
    <p><Link to="/payroll/wage-runs">{t('wr.back')}</Link> · <Link to={`/payroll/wage-register?run=${x.id}`}>{t('wg.title')}</Link></p><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <Pills tabs={STEPS.map((k, i) => [k, `${i + 1}. ${t(`wr.step.${k}`)}`])} tab={cur} setTab={setStep} label={t('wr.steps')} prefix="wr-step" />
    {cur === 'period' && <div className="mdm-panel"><Rows rows={[[t('wr.site'), `${x.project} · ${x.site}`], [t('wr.contractor'), x.contractor], [t('wr.period'), `${x.periodFrom} – ${x.periodTo}`], [t('wr.payDue'), x.payDueOn], [t('wr.state'), x.state ?? t('wr.stateWorker')], [t('wr.excluded'), (x.summary?.excluded ?? []).map((e) => `${e.worker} (${e.reason})`).join('; ') || null]]} />
      {c.compute && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => wages.compute(x.id), t('wr.recomputed'))} data-testid="wr-recompute">{t('wr.recompute')}</button>}</div>}
    {(cur === 'muster' || cur === 'pay') && <>{cur === 'pay' && <KpiRow label={t('wr.payment')}><KpiTile label={t('wr.paidN')} value={`${x.paid} / ${x.workers}`} valueTestid="wr-paid" /><KpiTile label={t('wr.ackN')} value={`${x.acknowledged} / ${x.workers}`} valueTestid="wr-acked" /><KpiTile label={t('wr.payDue')} value={x.payDueOn} /></KpiRow>}
      {cur === 'pay' && x.status !== 'APPROVED' && <p className="mdm-banner" role="status">{t('wr.payAfter')}</p>}
      {cur === 'pay' && c.disburse && unpaid.length > 0 && <div className="mdm-panel" data-testid="wr-pay"><h2>{t('wr.payTitle')}</h2><div className="form-grid">
        <Field label={t('wr.modeL')} name="mode" error={null}><select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })} style={big} data-testid="wr-mode"><option value="CASH">{t('wr.mode.CASH')}</option><option value="BANK">{t('wr.mode.BANK')}</option></select></Field>
        <Field label={t('wr.paidOn')} name="paidOn" error={null}><input type="date" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} style={big} /></Field>
        {pay.mode === 'BANK' && <Field label={`${t('wr.reference')} *`} name="reference" error={null}><input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} style={big} /></Field>}</div>
        <div className="actions-row"><button type="button" className="btn" style={big} onClick={() => setPicked(unpaid.map((l) => l.id))}>{t('wr.pickAll')}</button><button type="button" className="btn btn-primary" style={big} disabled={busy || !picked.length} onClick={() => run(() => wages.pay(x.id, { lineIds: picked, mode: pay.mode, paidOn: pay.paidOn, ...(pay.reference ? { reference: pay.reference } : {}) }), t('wr.paidDone')).then((r) => r && setPicked([]))} data-testid="wr-pay-go">{t('wr.payN', { n: picked.length })}</button></div></div>}
      {x.lines.length === 0 ? <EmptyState compact title={t('wr.noWorkers')} message={t('wr.noWorkersBody')} /> : <ul className="lp-list" data-testid="wr-lines">{x.lines.map((l) => <LineCard key={l.id} l={l} x={x} t={t} run={run} busy={busy} mode={cur} picked={picked.includes(l.id)} pick={pick} />)}</ul>}</>}
    {cur === 'review' && <><KpiRow label={t('wr.totals')}><KpiTile label={t('wr.net')} value={money(x.net)} amount={x.net ?? 0} kind="money" valueTestid="wr-net" /><KpiTile label={t('wr.gross')} value={money(x.gross)} amount={x.gross ?? 0} kind="money" /><KpiTile label={t('wr.employer')} value={money(x.employer)} amount={x.employer ?? 0} kind="money" /><KpiTile label={t('wr.daysOt')} value={`${x.days} · ${x.otHours} h`} /></KpiRow>
      {x.blocking > 0 && <p className="mdm-banner" role="alert" data-testid="wr-blocking">{t('wr.blockingLine', { n: x.blocking })}</p>}
      <ul className="lp-list">{x.lines.filter((l) => l.flags.some((f) => f.severity !== 'INFO')).map((l) => <li key={l.id} className="mdm-panel" style={{ ...card, display: 'grid', gap: 4 }}><strong>{l.workerCode} · {l.worker}</strong><Flags flags={l.flags} /></li>)}</ul></>}
    {cur === 'approve' && <><Decide x={x} run={run} busy={busy} t={t} p="wr" testid="wr-decide" />{x.history?.approvals?.length > 0 ? <div className="mdm-panel"><h2>{t('wr.history')}</h2><ul className="lp-list">{x.history.approvals.map((h, i) => <li key={i} style={{ minHeight: 'var(--erp-target-min)' }}>{String(h.at).slice(0, 16).replace('T', ' ')} · {h.event}{h.step_code ? ` (${h.step_code})` : ''} · {h.actor}</li>)}</ul></div> : <p className="muted">{t('wr.notSent')}</p>}</>}
    <div className="actions-row ff-actionbar" style={{ position: 'sticky', bottom: 0 }}>
      <span className="num small" style={{ alignSelf: 'center' }} data-testid="wr-total">{t('wr.net')} {money(x.net)}</span>
      {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy || x.blocking > 0 || !x.workers} onClick={() => run(() => wages.act(x.id, 'submit'), t('wr.sent'))} data-testid="wr-submit">{t('wr.submit')}</button>}
      {c.delete && <button type="button" className="btn" style={big} disabled={busy} onClick={() => globalThis.confirm?.(t('wr.confirmDelete')) && run(() => wages.remove(x.id), t('wr.deleted')).then((r) => r && navigateTo('/payroll/wage-runs'))}>{t('wr.delete')}</button>}
      <button type="button" className="btn" style={big} onClick={() => openSlips(x.id, document.documentElement.lang === 'hi' ? 'hi' : 'en').catch(() => globalThis.alert?.(t('wr.fileFailed')))} data-testid="wr-slips">{t('wr.slips')}</button>
    </div></section>);
}

export function WageRunsPage() {
  const t = useT('wr'); usePageTitle(t('wr.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const { error, note, busy, run } = useGlRunner();
  const lq = useQuery({ queryKey: ['gl', 'wr-runs'], queryFn: () => wages.list({ pageSize: 25 }), retry: false, enabled: !id });
  if (id) return <Run id={id} />;
  return (<section aria-labelledby="wrl-h" data-testid="wr-page"><PageHeader id="wrl-h" title={t('wr.title')} subtitle={t('wr.intro')} meta={<Link to="/payroll/wage-register">{t('wg.title')}</Link>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <Pills tabs={STEPS.map((k, i) => [k, `${i + 1}. ${t(`wr.step.${k}`)}`])} tab="period" setTab={() => {}} label={t('wr.steps')} prefix="wr-step0" />
    <NewRun t={t} run={run} busy={busy} />
    <h2 className="small" style={{ margin: '16px 0 4px' }}>{t('wr.runs')}</h2>
    {guardOf(lq, t('wr.runs'), 'pay.wage_run.view') ?? (lq.data.length === 0 ? <EmptyState compact title={t('wr.none')} message={t('wr.noneBody')} /> : <ul className="lp-list" data-testid="wr-list">{lq.data.map((r) => <li key={r.id} className="mdm-panel" style={card}><Link to={`/payroll/wage-runs?id=${r.id}`} style={{ display: 'grid', gap: 4, minHeight: 'var(--erp-target-min)', textDecoration: 'none', color: 'inherit' }}><span style={row}><strong>{r.docNo} · {r.site}</strong><span className="num">{money(r.net)} ›</span></span><span className="small"><StatusBadge status={TONE[r.status] ?? 'CANCELLED'} label={t(`wr.st.${r.status}`)} /> {r.periodFrom} – {r.periodTo} · {t('wr.workersN', { n: r.workers })}{r.status === 'APPROVED' ? ` · ${t('wr.paidOf', { p: r.paid, n: r.workers })}` : ''}</span></Link></li>)}</ul>)}
  </section>);
}

export function WageRegisterPage() {
  const t = useT('wr'); usePageTitle(t('wg.title')); const sp = useSearch(); const m = lastMonth(); const [f, setF] = useState({ from: `${m}-01`, to: istToday() }); const runId = sp.get('run');
  const q = useQuery({ queryKey: ['gl', 'wr-register', f.from, f.to], queryFn: () => wages.register({ from: f.from, to: f.to }), retry: false }); const x = q.data;
  const runs = x ? [...new Map(x.rows.map((r) => [r.runId, r])).values()] : [];
  return (<section aria-labelledby="wg-h" data-testid="wg-page"><PageHeader id="wg-h" title={t('wg.title')} subtitle={t('wg.intro')} meta={<Link to="/payroll/wage-runs">{t('wr.title')}</Link>} />
    <div className="form-grid"><Field label={t('wg.from')} name="from" error={null}><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={big} data-testid="wg-from" /></Field><Field label={t('wg.to')} name="to" error={null}><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={big} /></Field></div>
    {guardOf(q, t('wg.title'), 'pay.wage_run.view') ?? (x.rows.length === 0 ? <EmptyState compact title={t('wg.none')} message={t('wg.noneBody')} /> : <>
      <KpiRow label={t('wr.totals')}><KpiTile label={t('wr.net')} value={money(x.totals.net)} amount={x.totals.net} kind="money" valueTestid="wg-net" /><KpiTile label={t('wg.workers')} value={String(x.totals.workers)} /><KpiTile label={t('wg.days')} value={String(x.totals.days)} /><KpiTile label={t('wg.lateAck')} value={`${x.totals.late} · ${x.totals.acknowledged}/${x.totals.workers}`} valueTestid="wg-late" /></KpiRow>
      <ul className="lp-list" data-testid="wg-rows">{x.rows.map((l) => <li key={`${l.runId}-${l.id}`} className="mdm-panel" style={{ ...card, ...(String(l.runId) === runId ? { outline: '2px solid var(--erp-color-border-focus)' } : {}) }}><div style={row}><strong>{l.workerCode} · {l.worker}</strong><span className="num">{money(l.net)}</span></div><span className="small">{l.docNo} · {l.site} · {l.periodFrom} – {l.periodTo} · {t('wr.daysLine', { days: l.days, ot: l.otHours, trade: l.trade ?? '', basis: t(l.basis === 'PIECE' ? 'wr.piece' : 'wr.daily') })} · {l.paidOn ? `${t('wr.paidLine', { on: l.paidOn, mode: t(`wr.mode.${l.paidMode}`) })}${l.late ? ` · ${t('wr.late')}` : ''}` : t('wg.unpaid')}</span></li>)}</ul>
      <div className="actions-row"><button type="button" className="btn" style={big} onClick={() => file(`/wage-register/export?from=${f.from}&to=${f.to}`, `wage-register-${f.from}-${f.to}.csv`).catch(() => globalThis.alert?.(t('wr.fileFailed')))} data-testid="wg-export">{t('wg.export')}</button><button type="button" className="btn" style={big} onClick={() => file(`/wage-register/export?from=${f.from}&to=${f.to}&format=pdf`, `wage-register-${f.from}-${f.to}.pdf`).catch(() => globalThis.alert?.(t('wr.fileFailed')))}>{t('wg.pdf')}</button></div>
      <h2 className="small" style={{ margin: '16px 0 4px' }}>{t('wg.muster')}</h2><ul className="lp-list">{runs.map((r) => <li key={r.runId} className="mdm-panel" style={{ ...card, ...row }}><span>{r.docNo} · {r.site}</span><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => file(`/wage-runs/${r.runId}/muster`, `muster-${r.docNo.replaceAll('/', '-')}.csv`).catch(() => globalThis.alert?.(t('wr.fileFailed')))}>{t('wg.musterCsv')}</button></li>)}</ul></>)}
  </section>);
}

function CheckDetail({ id, t }) {
  const q = useQuery({ queryKey: ['gl', 'wc', id], queryFn: () => wages.check(id), retry: false }); const { error, note, busy, run } = useGlRunner(); const [decNote, setDecNote] = useState(''); usePageTitle(t('wc.title'));
  const g = guardOf(q, t('wc.title'), 'pay.wage_check.view'); if (g) return g; const x = q.data;
  const readCsv = async (ev) => { const fl = ev.target.files?.[0]; ev.target.value = ''; if (!fl) return; const text = await fl.text(); run(() => wages.sheet(x.id, { csv: text, version: x.version }), t('wc.sheetSaved')); };
  return (<section aria-labelledby="wc-h" data-testid="wc-detail" data-status={x.status}><PageHeader id="wc-h" title={`${x.docNo} · ${x.contractor}`} subtitle={`${x.project}${x.site ? ` · ${x.site}` : ''} · ${x.period}`} meta={<StatusBadge status={x.status === 'VERIFIED' ? 'APPROVED' : x.status === 'SUBMITTED' ? 'IN_REVIEW' : x.status === 'VARIANCE' ? 'REJECTED' : x.status === 'RETURNED' ? 'RETURNED' : 'DRAFT'} label={t(`wc.st.${x.status}`)} />} />
    <p><Link to="/payroll/contractor-wages">{t('wc.back')}</Link></p><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <KpiRow label={t('wc.compare')}><KpiTile label={t('wc.attDays')} value={String(x.attendanceDays)} /><KpiTile label={t('wc.sheetDays')} value={String(x.sheetDays)} /><KpiTile label={t('wc.variances')} value={`${x.variances} · ${x.blocking} ${t('wc.blocking')}`} valueTestid="wc-variances" /><KpiTile label={t('wc.sheetNet')} value={money(x.sheetNet)} amount={x.sheetNet} kind="money" /></KpiRow>
    <div className="mdm-panel"><Rows rows={[[t('wc.payDue'), x.payDueOn], [t('wc.verifyDue'), x.verifyDueOn], [t('wc.hold'), x.hold ? t('wc.held') : null], [t('wc.note'), x.note]]} /></div>
    {x.varianceList.length > 0 && <div className="mdm-panel" data-testid="wc-list"><h2>{t('wc.variances')}</h2><ul className="lp-list">{x.varianceList.map((v, i) => <li key={i} style={{ display: 'grid', gap: 2, minHeight: 'var(--erp-target-min)' }}><strong style={v.severity === 'BLOCK' ? { color: 'var(--erp-color-status-error-fg)' } : undefined}>{v.severity === 'BLOCK' ? '⛔' : '⚠'} {v.workerCode} {v.worker ?? ''} · {t(`wc.v.${v.code}`)}</strong><span className="small">{v.message}</span></li>)}</ul></div>}
    <div className="mdm-panel"><h2>{t('wc.attendance')}</h2><ul className="lp-list small">{x.attendance.map((a) => <li key={a.workerId} style={{ ...row, minHeight: 32 }}><span>{a.code} · {a.name}</span><span>{t('wc.attLine', { d: a.days, ot: a.otHours, min: a.minRate ?? '—' })}</span></li>)}</ul></div>
    {x.can.edit && <div className="mdm-panel" data-testid="wc-edit"><h2>{t('wc.sheet')}</h2><p className="small">{t('wc.csvHelp')}</p><input type="file" accept=".csv,text/csv" onChange={readCsv} style={big} data-testid="wc-csv" aria-label={t('wc.uploadCsv')} />
      <h3 className="small">{t('wc.sheetFile')}{x.sheetFileId ? ' ✓' : ''}</h3><FileUploader entity="pay_contractor_wage_checks" entityId={x.id} onDone={(f) => run(() => wages.attach(x.id, { kind: 'SHEET', fileId: f.id }), t('wc.attached'))} />
      <h3 className="small">{t('wc.proofFile')}{x.proofFileId ? ' ✓' : ''}</h3><FileUploader entity="pay_contractor_wage_checks" entityId={x.id} onDone={(f) => run(() => wages.attach(x.id, { kind: 'PROOF', fileId: f.id }), t('wc.attached'))} />
      <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy} onClick={() => run(() => wages.submitCheck(x.id), t('wc.sent'))} data-testid="wc-submit">{t('wc.submit')}</button></div></div>}
    {x.can.verify && <div className="mdm-panel" data-testid="wc-decide"><h2>{t('wc.decision')}</h2><label>{t('wc.note')}<textarea value={decNote} onChange={(e) => setDecNote(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></label>
      <div className="actions-row ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy || x.blocking > 0} onClick={() => run(() => wages.decide(x.id, { decision: 'VERIFY', ...(decNote ? { note: decNote } : {}) }), t('wc.verified'))} data-testid="wc-verify">{t('wc.verify')}</button>
        <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => wages.decide(x.id, { decision: 'RETURN', note: decNote }), t('wc.returned'))}>{t('wc.return')}</button>
        <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => wages.decide(x.id, { decision: 'HOLD', note: decNote }), t('wc.heldDone'))} data-testid="wc-hold">{t('wc.holdPay')}</button></div></div>}
  </section>);
}

function NewCheck({ t, run, busy }) {
  const q = useQuery({ queryKey: ['gl', 'wr-options'], queryFn: () => wages.options(), retry: false }); const [f, setF] = useState({ siteId: '', contractorId: '', period: lastMonth() }); if (!q.data) return null; const o = q.data;
  const site = o.sites.find((s) => String(s.id) === f.siteId);
  return (<details className="mdm-panel" data-testid="wc-new"><summary style={{ minHeight: 'var(--erp-target-min)', display: 'flex', alignItems: 'center' }}>{t('wc.new')}</summary><div className="form-grid">
    <Field label={`${t('wr.site')} *`} name="siteId" error={null}><select value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })} style={big} data-testid="wc-site"><option value="">{t('wr.choose')}</option>{o.sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
    <Field label={`${t('wr.contractor')} *`} name="contractorId" error={null}><select value={f.contractorId} onChange={(e) => setF({ ...f, contractorId: e.target.value })} style={big} data-testid="wc-contractor"><option value="">{t('wr.choose')}</option>{o.contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
    <Field label={t('wc.period')} name="period" error={null}><input type="month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} style={big} /></Field></div>
    <button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy || !site || !f.contractorId} onClick={() => run(() => wages.createCheck({ projectId: site.projectId, siteId: site.id, contractorId: Number(f.contractorId), period: f.period }), t('wc.created')).then((r) => r && navigateTo(`/payroll/contractor-wages?id=${r.id}`))} data-testid="wc-create">{t('wc.create')}</button></details>);
}

export function ContractorWagesPage() {
  const t = useT('wr'); usePageTitle(t('wc.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const { error, note, busy, run } = useGlRunner();
  const q = useQuery({ queryKey: ['gl', 'wc-worklist'], queryFn: () => wages.worklist(), retry: false, enabled: !id });
  if (id) return <CheckDetail id={id} t={t} />;
  const quick = (x, decision) => { if (decision === 'RETURN') { const n = globalThis.prompt?.(t('wc.whyReturn')); if (!n || n.trim().length < 5) return; run(() => wages.decide(x.id, { decision, note: n.trim() }), t('wc.returned')); } else run(() => wages.decide(x.id, { decision }), t('wc.verified')); };
  return (<section aria-labelledby="wc-h" data-testid="wc-page"><PageHeader id="wc-h" title={t('wc.title')} subtitle={t('wc.intro')} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    {guardOf(q, t('wc.title'), 'pay.wage_check.view') ?? <><KpiRow label={t('wc.queue')}><KpiTile label={t('wc.toVerify')} value={String(q.data.counts.toVerify)} valueTestid="wc-count" /><KpiTile label={t('wc.overdue')} value={String(q.data.counts.overdue)} /><KpiTile label={t('wc.heldN')} value={String(q.data.counts.held)} /><KpiTile label={t('wc.openN')} value={String(q.data.counts.open)} /></KpiRow>
      {q.data.rows.length === 0 ? <EmptyState compact title={t('wc.none')} message={t('wc.noneBody')} /> : <ul className="lp-list" data-testid="wc-rows">{q.data.rows.map((x) => <li key={x.id} className="mdm-panel" style={card} data-testid={`wc-card-${x.id}`}>
        <div style={{ display: 'grid', gap: 4 }}><span style={row}><Link to={`/payroll/contractor-wages?id=${x.id}`} style={{ minHeight: 'var(--erp-target-min)', display: 'inline-flex', alignItems: 'center', fontWeight: 700 }}>{x.contractor} · {x.period}</Link><span className="small" style={{ padding: '2px 8px', borderRadius: 12, alignSelf: 'center', background: x.overdueDays > 0 ? 'var(--erp-color-status-error-bg)' : 'var(--erp-color-status-info-bg)', color: x.overdueDays > 0 ? 'var(--erp-color-status-error-fg)' : 'var(--erp-color-status-info-fg)' }} data-testid={`wc-sla-${x.id}`}>{x.overdueDays > 0 ? t('wc.overdueBy', { n: x.overdueDays }) : t('wc.dueOn', { d: x.verifyDueOn })}</span></span>
          <span className="small">{x.docNo} · {x.project}{x.site ? ` · ${x.site}` : ''} · {t(`wc.st.${x.status}`)} · {t('wc.varLine', { v: x.variances, b: x.blocking, w: x.workers })}</span>{x.top.map((m, i) => <span key={i} className="small">• {m}</span>)}</div>
        {x.can.verify && <div className="actions-row"><button type="button" className="btn btn-primary" style={{ ...big, flex: 1 }} disabled={busy || x.blocking > 0} onClick={() => quick(x, 'VERIFY')} data-testid={`wc-approve-${x.id}`}>{t('wc.verify')}</button><button type="button" className="btn" style={{ ...big, flex: 1 }} disabled={busy} onClick={() => quick(x, 'RETURN')} data-testid={`wc-return-${x.id}`}>{t('wc.return')}</button></div>}</li>)}</ul>}
      <NewCheck t={t} run={run} busy={busy} /></>}
  </section>);
}
