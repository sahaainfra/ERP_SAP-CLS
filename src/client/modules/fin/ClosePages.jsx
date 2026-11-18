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
import { JN_TONE, gl, money, pc } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';
import { Decide, Pills, Rows, big, guardOf, lastMonth, pct } from './finparts.jsx';

// Part 23.14: the close of a month as a board (the tasks by state, one column at a time on a phone with a column switcher; a task moves by its menu, not by
// dragging), the module locks, the submission and the CFO's decision, the reopen; the financial statements (Schedule III) with comparatives and the accounts of
// each line; the finance dashboard; the year-end closing wizard.
const row = { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };
const neg = (v) => (v < 0 ? { color: 'var(--erp-color-status-error-fg)', fontWeight: 700 } : undefined);
const COLS = ['OPEN', 'IN_PROGRESS', 'DONE'];
const colOf = (t) => (t.status === 'NOT_APPLICABLE' ? 'DONE' : t.status);
const OTHER_MODULES = ['inventory', 'payroll', 'procurement', 'plant', 'projects'];

function TaskCard({ x, t, tk, run, busy }) {
  const [open, setOpen] = useState(false); const [note, setNote] = useState(''); const [na, setNa] = useState(false);
  const ok = tk.check.ok === true ? '✓' : tk.check.ok === false ? '✗' : '•';
  return (<li className="mdm-panel" style={{ padding: 12, margin: '6px 0' }} data-testid={`pc-task-${tk.code}`} data-status={tk.status}>
    <div style={row}><strong>{tk.name}{tk.mandatory ? '' : ` · ${t('pc.optional')}`}</strong><span className="muted small">{tk.owner ?? '—'} · {t('pc.due')} {tk.dueDate}{tk.overdue ? ` · ${t('pc.overdue')}` : ''}</span></div>
    <p className="small" style={{ margin: '4px 0', ...(tk.check.ok === false ? neg(-1) : {}) }}>{ok} {tk.check.detail}</p>
    {tk.waitingFor.length > 0 && <p className="muted small" style={{ margin: 0 }}>{t('pc.waitingFor', { list: tk.waitingFor.join(', ') })}</p>}
    {tk.evidence && <p className="muted small" style={{ margin: 0 }}>{t('pc.evidence')}: {tk.evidence} · {tk.doneBy}</p>}
    <div className="actions-row">
      {tk.can.complete && tk.status === 'OPEN' && <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => pc.updateTask(x.id, tk.id, { started: true }), t('pc.started'))}>{t('pc.start')}</button>}
      {tk.can.complete && <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} onClick={() => setOpen(!open)} data-testid={`pc-done-${tk.code}`}>{t('pc.markDone')}</button>}
      {tk.can.reopen && <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => { const r = globalThis.prompt?.(t('pc.whyReopen')); if (r && r.trim().length >= 5) run(() => pc.reopenTask(x.id, tk.id, r.trim()), t('pc.taskReopened')); }}>{t('pc.reopenTask')}</button>}
    </div>
    {open && <div style={{ display: 'grid', gap: 8, marginTop: 8 }}><label>{t('pc.evidenceNote')}<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} data-testid={`pc-note-${tk.code}`} /></label>
      {!tk.mandatory && <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={na} onChange={(e) => setNa(e.target.checked)} />{t('pc.notApplicable')}</label>}
      <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => pc.completeTask(x.id, tk.id, { note: note.trim() || null, notApplicable: na || undefined }), t('pc.done')).then((r) => r && setOpen(false))} data-testid={`pc-save-${tk.code}`}>{t('pc.save')}</button></div>}
  </li>);
}

function Reopen({ id }) {
  const t = useT('pc'); const q = useQuery({ queryKey: ['gl', 'pc-ro', id], queryFn: () => pc.reopenGet(id), retry: false }); const { error, note, busy, run } = useGlRunner(); usePageTitle(t('pc.reopen'));
  const g = guardOf(q, t('pc.reopen'), 'fin.period_reopen.view'); if (g) return g; const x = q.data;
  return (<section aria-labelledby="ro-h" data-testid="pc-reopen" data-status={x.status}><PageHeader id="ro-h" title={`${x.docNo} · ${t('pc.reopenOf', { period: x.period })}`} subtitle={x.reason} meta={<StatusBadge status={JN_TONE[x.status] ?? 'CANCELLED'} label={t(`pc.st.${x.status}`)} />} />
    <p><Link to={`/finance/close?id=${x.closeId}`}>{t('pc.backClose')}</Link></p><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <div className="mdm-panel"><Rows rows={[[t('pc.modules'), x.modules.join(', ')], [t('pc.reopenAs'), x.targetStatus], [t('pc.requestedBy'), x.requestedBy]]} /></div>
    <Decide x={x} run={run} busy={busy} t={t} p="pc" testid="ro-decide" />
    <div className="mdm-panel"><h2>{t('pc.history')}</h2><ul className="lp-list">{(x.history?.approvals ?? []).map((h, i) => <li key={i} style={{ minHeight: 44 }}>{String(h.at).slice(0, 16).replace('T', ' ')} · {h.event}{h.step_code ? ` (${h.step_code})` : ''} · {h.actor}</li>)}</ul></div></section>);
}

function Close({ id }) {
  const t = useT('pc'); const q = useQuery({ queryKey: ['gl', 'pc', id], queryFn: () => pc.get(id), retry: false }); const { error, note, busy, run } = useGlRunner(); const [col, setCol] = useState('OPEN'); const [name, setName] = useState(''); usePageTitle(t('pc.title'));
  const g = guardOf(q, t('pc.title'), 'fin.period.view'); if (g) return g; const x = q.data; const c = x.can; const f = x.figures ?? {};
  const column = (k) => <div key={k} data-testid={`pc-col-${k}`}><h2 className="small" style={{ margin: '8px 0' }}>{t(`pc.col.${k}`)} ({x.tasks.filter((tk) => colOf(tk) === k).length})</h2><ul className="lp-list">{x.tasks.filter((tk) => colOf(tk) === k).map((tk) => <TaskCard key={tk.id} x={x} t={t} tk={tk} run={run} busy={busy} />)}</ul></div>;
  const phone = typeof window !== 'undefined' && window.innerWidth < 768;
  return (<section aria-labelledby="pc-h" data-testid="pc-close" data-status={x.status} data-state={x.closeState}>
    <PageHeader id="pc-h" title={`${x.docNo} · ${t('pc.closeOf', { period: x.period })}`} subtitle={t('pc.progress', { done: x.progress.done, total: x.progress.total, open: x.progress.mandatoryOpen })} meta={<StatusBadge status={JN_TONE[x.status] ?? 'CANCELLED'} label={t(`pc.state.${x.closeState}`)} />} />
    <p><Link to="/finance/close">{t('pc.allCloses')}</Link> · <Link to={`/finance/statements?period=${x.period}`}>{t('st.title')}</Link></p>
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <KpiRow label={t('pc.figures')}><KpiTile label={t('pc.tb')} value={f.balanced ? t('pc.balanced') : t('pc.notBalanced')} valueTestid="pc-tb" /><KpiTile label={t('pc.revenue')} value={money(f.revenue ?? 0)} amount={f.revenue ?? 0} kind="money" /><KpiTile label={t('pc.pat')} value={money(f.pat ?? 0)} amount={f.pat ?? 0} kind="money" /><KpiTile label={t('pc.cash')} value={money(f.cash ?? 0)} amount={f.cash ?? 0} kind="money" /></KpiRow>
    <div className="mdm-panel" data-testid="pc-modules"><h2>{t('pc.locks')}</h2><ul className="lp-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{Object.entries(x.modules).map(([m, s]) => <li key={m} className="small" style={{ minHeight: 32 }}>{t(`pc.mod.${m}`)}: <strong>{s}</strong></li>)}</ul>
      {c.lock && OTHER_MODULES.some((m) => x.modules[m] === 'Open') && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => pc.lock(x.id, OTHER_MODULES.filter((m) => x.modules[m] === 'Open')), t('pc.locked'))} data-testid="pc-lock">{t('pc.lockOthers')}</button>}</div>
    {phone && <Pills tabs={COLS.map((k) => [k, t(`pc.col.${k}`)])} tab={col} setTab={setCol} label={t('pc.board')} prefix="pc-pill" />}
    <div data-testid="pc-board" style={{ display: 'grid', gridTemplateColumns: phone ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 12 }}>{phone ? column(col) : COLS.map(column)}</div>
    {c.addTask && <div className="mdm-panel"><h3>{t('pc.addTask')}</h3><div className="form-grid"><Field label={t('pc.taskName')} name="tname" error={null}><input value={name} onChange={(e) => setName(e.target.value)} style={big} /></Field><button type="button" className="btn" style={big} disabled={busy || name.trim().length < 3} onClick={() => run(() => pc.addTask(x.id, { name: name.trim(), mandatory: false }), t('pc.taskAdded')).then(() => setName(''))}>{t('pc.add')}</button></div></div>}
    <Decide x={x} run={run} busy={busy} t={t} p="pc" testid="pc-decide" />
    {x.reopens.length > 0 && <div className="mdm-panel"><h2>{t('pc.reopens')}</h2><ul className="lp-list">{x.reopens.map((r) => <li key={r.id} style={{ minHeight: 44 }}><Link to={`/finance/close?reopen=${r.id}`}>{r.docNo}</Link> · {t(`pc.st.${r.status}`)} · {r.reason}</li>)}</ul></div>}
    <div className="actions-row ff-actionbar">
      {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => pc.act(x.id, 'submit'), t('pc.sent'))} data-testid="pc-submit">{t('pc.submit')}</button>}
      {c.reopen && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = globalThis.prompt?.(t('pc.whyReopenMonth')); if (r && r.trim().length >= 10) run(() => pc.reopen(x.id, { reason: r.trim(), modules: ['finance'] }), t('pc.reopenSent')); }} data-testid="pc-reopen-btn">{t('pc.askReopen')}</button>}
      <button type="button" className="btn" style={big} onClick={() => gl.file(`/periods/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => globalThis.alert?.(t('pc.fileFailed')))}>{t('pc.print')}</button>
    </div>
  </section>);
}

export function ClosePage() {
  const t = useT('pc'); usePageTitle(t('pc.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const ro = Number(sp.get('reopen')) || null; const [period, setPeriod] = useState(lastMonth()); const { error, note, busy, run } = useGlRunner();
  const q = useQuery({ queryKey: ['gl', 'pc-list'], queryFn: () => pc.list({ pageSize: 24 }), retry: false, enabled: !id && !ro });
  if (ro) return <Reopen id={ro} />; if (id) return <Close id={id} />;
  const g = guardOf(q, t('pc.title'), 'fin.period.view'); if (g) return g;
  return (<section aria-labelledby="pcl-h" data-testid="pc-page"><PageHeader id="pcl-h" title={t('pc.title')} subtitle={t('pc.intro')} meta={<Link to="/finance/year-end">{t('ye.title')}</Link>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    <div className="form-grid"><Field label={t('pc.month')} name="period" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} data-testid="pc-period" /></Field>
      <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => pc.create({ period }), t('pc.created')).then((r) => r && navigateTo(`/finance/close?id=${r.id}`))} data-testid="pc-create">{t('pc.start')}</button></div>
    {q.data.length === 0 ? <EmptyState compact title={t('pc.none')} message={t('pc.noneBody')} /> : <ul className="lp-list" data-testid="pc-list">{q.data.map((x) => <li key={x.id} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><div style={row}><Link to={`/finance/close?id=${x.id}`}>{x.docNo} · {x.period}</Link><span>{t(`pc.state.${x.closeState}`)} · {t(`pc.st.${x.status}`)}</span></div></li>)}</ul>}
  </section>);
}

// ---- the statements ----
function Lines({ rows, stmt, from, to }) {
  const [open, setOpen] = useState(null); let section = null;
  return (<ul className="lp-list" data-testid={`st-${stmt}`}>{rows.map((r) => { const head = r.section !== section ? (section = r.section) : null; return (<li key={r.code} style={{ padding: '4px 0' }}>{head && <h3 className="small" style={{ margin: '12px 0 4px' }}>{head}</h3>}
    <button type="button" className="btn-link" style={{ ...row, width: '100%', minHeight: 44, alignItems: 'center', background: 'none', border: 0, color: 'inherit', textAlign: 'left' }} onClick={() => setOpen(open === r.code ? null : r.code)} disabled={!r.accounts.length}>
      <span>{r.label}</span><span className="num">{money(r.amount)} <span className="muted small">· {money(r.previous)} · {money(r.lastYear)}</span></span></button>
    {open === r.code && <ul className="lp-list small" style={{ paddingLeft: 12 }} data-testid={`st-note-${r.code}`}>{r.accounts.map((a) => <li key={a.accountId} style={{ ...row, minHeight: 36 }}><Link to={`/finance/ledger?accountId=${a.accountId}&from=${from}&to=${to}`}>{a.code} {a.name}</Link><span className="num">{money(a.amount)}</span></li>)}</ul>}</li>); })}</ul>);
}
export function StatementsPage() {
  const t = useT('pc'); usePageTitle(t('st.title')); const sp = useSearch(); const [period, setPeriod] = useState(sp.get('period') ?? lastMonth()); const [basis, setBasis] = useState('MONTH'); const [tab, setTab] = useState('BS');
  const q = useQuery({ queryKey: ['gl', 'st', period, basis], queryFn: () => pc.statements({ period, basis }), retry: false }); const x = q.data;
  return (<section aria-labelledby="st-h" data-testid="st-page"><PageHeader id="st-h" title={t('st.title')} subtitle={t('st.intro')} meta={<Link to="/finance/dashboard">{t('db.title')}</Link>} />
    <div className="form-grid"><Field label={t('pc.month')} name="period" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} data-testid="st-period" /></Field>
      <Field label={t('st.basis')} name="basis" error={null}><select value={basis} onChange={(e) => setBasis(e.target.value)} style={big} data-testid="st-basis">{['MONTH', 'QUARTER', 'YTD', 'YEAR'].map((b) => <option key={b} value={b}>{t(`st.b.${b}`)}</option>)}</select></Field></div>
    {guardOf(q, t('st.title'), 'fin.statements.view') ?? <>
      <p className="muted small">{x.from} – {x.to} · {t('st.columns', { prev: `${x.previous.from} – ${x.previous.to}`, ly: `${x.lastYear.from} – ${x.lastYear.to}` })}</p>
      <KpiRow label={t('st.tieOut')}><KpiTile label={t('st.assets')} value={money(x.tieOut.assets)} amount={x.tieOut.assets} kind="money" valueTestid="st-assets" /><KpiTile label={t('st.eqLiab')} value={money(x.tieOut.equityLiabilities)} amount={x.tieOut.equityLiabilities} kind="money" /><KpiTile label={t('pc.tb')} value={x.tieOut.balanced && x.tieOut.balanceSheetBalances ? t('pc.balanced') : t('pc.notBalanced')} valueTestid="st-balanced" /><KpiTile label={t('pc.pat')} value={money(x.profitAndLoss.totals.pat)} amount={x.profitAndLoss.totals.pat} kind="money" /></KpiRow>
      <Pills tabs={[['BS', t('st.bs')], ['PL', t('st.pl')], ['CF', t('st.cf')], ['TB', t('st.tb')]]} tab={tab} setTab={setTab} label={t('st.title')} prefix="st-tab" />
      <div className="mdm-panel">
        {tab === 'BS' && <Lines rows={x.balanceSheet.rows} stmt="BS" from={x.from} to={x.to} />}
        {tab === 'PL' && <><Lines rows={x.profitAndLoss.rows} stmt="PL" from={x.from} to={x.to} /><Rows rows={[[t('st.pbt'), money(x.profitAndLoss.totals.pbt)], [t('st.ebitda'), money(x.profitAndLoss.totals.ebitda)], [t('pc.pat'), money(x.profitAndLoss.totals.pat)]]} /></>}
        {tab === 'CF' && <div data-testid="st-CF">{[['operating', x.cashFlow.operating], ['investing', x.cashFlow.investing], ['financing', x.cashFlow.financing]].map(([k, list]) => <div key={k}><h3 className="small">{t(`st.cf.${k}`)} · {money(x.cashFlow.totals[k])}</h3><ul className="lp-list">{list.map((r) => <li key={r.label} style={{ ...row, minHeight: 36 }}><span>{r.label}</span><span className="num" style={neg(r.amount)}>{money(r.amount)}</span></li>)}</ul></div>)}
          <Rows rows={[[t('st.netChange'), money(x.cashFlow.net)], [t('st.openingCash'), money(x.cashFlow.openingCash)], [t('st.closingCash'), money(x.cashFlow.closingCash)], [t('st.reconciled'), x.cashFlow.reconciled ? t('pc.balanced') : t('pc.notBalanced')]]} /></div>}
        {tab === 'TB' && <ul className="lp-list" data-testid="st-TB">{x.trialBalance.rows.map((r) => <li key={r.accountId} style={{ ...row, minHeight: 36 }}><Link to={`/finance/ledger?accountId=${r.accountId}&to=${x.to}`}>{r.code} {r.name}</Link><span className="num">{r.debit ? `Dr ${money(r.debit)}` : `Cr ${money(r.credit)}`}</span></li>)}<li style={{ ...row, fontWeight: 700 }}><span>{t('st.total')}</span><span className="num">{money(x.trialBalance.totals.debit)} / {money(x.trialBalance.totals.credit)}</span></li></ul>}
      </div>
      <div className="actions-row ff-actionbar"><button type="button" className="btn" style={big} onClick={() => gl.file(`/statements/print?period=${period}&basis=${basis}`, `statements-${period}.pdf`).catch(() => globalThis.alert?.(t('pc.fileFailed')))}>{t('pc.print')}</button><button type="button" className="btn" style={big} onClick={() => gl.file(`/statements/export?period=${period}&basis=${basis}`, `statements-${period}.csv`).catch(() => globalThis.alert?.(t('pc.fileFailed')))}>{t('st.export')}</button></div>
    </>}</section>);
}

// ---- the dashboard ----
export function FinanceDashboardPage() {
  const t = useT('pc'); usePageTitle(t('db.title')); const [period, setPeriod] = useState(lastMonth());
  const q = useQuery({ queryKey: ['gl', 'fdb', period], queryFn: () => pc.dashboard({ period }), retry: false }); const x = q.data; const k = x?.kpis;
  return (<section aria-labelledby="db-h" data-testid="db-page"><PageHeader id="db-h" title={t('db.title')} subtitle={t('db.intro')} meta={<Link to="/finance/statements">{t('st.title')}</Link>} />
    <Field label={t('pc.month')} name="period" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} data-testid="db-period" /></Field>
    {guardOf(q, t('db.title'), 'fin.dashboard.view') ?? <>
      <KpiRow label={t('db.title')}><KpiTile label={t('db.revenueYtd')} value={money(k.revenueYtd)} amount={k.revenueYtd} kind="money" valueTestid="db-revenue" to={`/finance/statements?period=${period}`} /><KpiTile label={t('db.grossMargin')} value={`${money(k.grossMargin)} · ${pct(k.grossMarginPct)}`} valueTestid="db-gm" /><KpiTile label={t('db.ebitda')} value={money(k.ebitdaYtd)} amount={k.ebitdaYtd} kind="money" /><KpiTile label={t('pc.cash')} value={money(k.cash)} amount={k.cash} kind="money" valueTestid="db-cash" to={'/finance/treasury'} />
        <KpiTile label={t('db.receivables')} value={`${money(k.receivables)} · DSO ${k.dso ?? '—'}`} to={'/finance/receivables'} /><KpiTile label={t('db.payables')} value={`${money(k.payables)} · DPO ${k.dpo ?? '—'}`} /><KpiTile label={t('db.workingCapital')} value={money(k.workingCapital)} amount={k.workingCapital} kind="money" /><KpiTile label={t('db.debt')} value={`${money(k.debt)}${k.debtEquity != null ? ` · D/E ${k.debtEquity}` : ''}`} /></KpiRow>
      <p className="small" data-testid="db-reconciled">{x.reconciled.tbBalanced && x.reconciled.balanceSheetBalances ? t('db.reconciled', { dr: money(x.reconciled.tbDebit), cr: money(x.reconciled.tbCredit) }) : t('db.notReconciled')}</p>
      {x.trend.length > 0 && <div className="mdm-panel"><Chart type="bar" data={{ categories: x.trend.map((r) => r.month), series: [{ name: t('pc.revenue'), values: x.trend.map((r) => Math.round(r.revenue)) }, { name: t('db.ebitda'), values: x.trend.map((r) => Math.round(r.ebitda)) }], unit: '₹' }} title={t('db.trend')} exportName={`finance-trend-${period}`} tableSwitch /></div>}
      <div className="mdm-panel"><Chart type="bar" data={{ categories: x.receivablesAgeing.buckets.map((b) => t(`db.age.${b.bucket}`)), series: [{ name: t('db.receivables'), values: x.receivablesAgeing.buckets.map((b) => Math.round(b.amount)) }, { name: t('db.payables'), values: x.payablesAgeing.buckets.map((b) => Math.round(b.amount)) }], unit: '₹' }} title={t('db.ageing')} exportName={`ageing-${period}`} tableSwitch /></div>
      <div className="mdm-panel" data-testid="db-exceptions"><h2>{t('db.exceptions')}</h2>{x.exceptions.length === 0 ? <p className="muted">{t('db.noExceptions')}</p> : <ul className="lp-list">{x.exceptions.map((e, i) => <li key={i} style={{ minHeight: 44 }}>{e.link ? <Link to={e.link}>{e.text}</Link> : e.text}</li>)}</ul>}<p><Link to="/finance/close">{t('db.viewAll')} ›</Link></p></div>
      <div className="mdm-panel"><h2>{t('db.pending')}</h2>{x.pending.length === 0 ? <p className="muted">{t('db.noPending')}</p> : <ul className="lp-list">{x.pending.map((e, i) => <li key={i} style={{ minHeight: 44 }}><Link to={e.link}>{e.text}</Link> · {e.due}</li>)}</ul>}</div>
    </>}</section>);
}

// ---- the year end ----
export function YearEndPage() {
  const t = useT('pc'); usePageTitle(t('ye.title')); const [fyId, setFyId] = useState(''); const { error, note, busy, run } = useGlRunner();
  const q = useQuery({ queryKey: ['gl', 'ye', fyId], queryFn: () => pc.yearEnd(fyId ? { fyId } : {}), retry: false }); const x = q.data;
  return (<section aria-labelledby="ye-h" data-testid="ye-page"><PageHeader id="ye-h" title={t('ye.title')} subtitle={t('ye.intro')} meta={<Link to="/finance/close">{t('pc.title')}</Link>} />
    <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
    {guardOf(q, t('ye.title'), 'fin.period.view') ?? <>
      <Field label={t('ye.year')} name="fy" error={null}><select value={fyId || x.fy.id} onChange={(e) => setFyId(e.target.value)} style={big} data-testid="ye-fy">{x.years.map((y) => <option key={y.id} value={y.id}>{y.code} · {y.status}</option>)}</select></Field>
      <ol className="lp-list" data-testid="ye-steps">{x.steps.map((s, i) => <li key={s.code} className="mdm-panel" style={{ padding: 12, margin: '6px 0' }}><div style={row}><strong>{i + 1}. {t(`ye.step.${s.code}`)}</strong><span>{s.done ? '✓' : '…'}</span></div><span className="muted small">{s.detail}</span></li>)}</ol>
      <KpiRow label={x.fy.code}><KpiTile label={t('st.pbt')} value={money(x.profit.pbt)} amount={x.profit.pbt} kind="money" /><KpiTile label={t('pc.pat')} value={money(x.profit.pat)} amount={x.profit.pat} kind="money" /><KpiTile label={t('ye.monthsClosed')} value={`${x.periods.filter((p) => p.closed).length} / ${x.periods.length}`} /></KpiRow>
      <ul className="lp-list">{x.periods.map((p) => <li key={p.id} style={{ ...row, minHeight: 44, alignItems: 'center' }}><span>{p.name}</span>{p.close ? <Link to={`/finance/close?id=${p.close.id}`}>{p.close.docNo} · {t(`pc.state.${p.close.state}`)}</Link> : <span className="muted">{t('ye.notStarted')}</span>}</li>)}</ul>
      <div className="actions-row ff-actionbar">
        {x.can.carryForward && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => pc.carryForward(x.fy.id), t('ye.carried'))}>{t('ye.carryForward')}</button>}
        {x.carryForward && <Link to={`/finance/journals?id=${x.carryForward.id}`} className="btn" style={big}>{x.carryForward.ref}</Link>}
        {x.can.close && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => { const r = globalThis.prompt?.(t('ye.whyClose')); if (r && r.trim().length >= 5) run(() => pc.closeYear(x.fy.id, r.trim()), t('ye.closed')); }}>{t('ye.closeYear')}</button>}
      </div>
    </>}</section>);
}
