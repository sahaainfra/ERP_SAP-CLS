import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { JN_TONE, ar, gl, money, pm } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';

// Part 23.05: the pages of receivables — the receivables with their ageing (List Report; a receivable with what settled it, its credit notes, write-offs and
// follow-ups), the receipt entry with its allocation, other-income invoices, credit notes and write-offs; and the collections worklist with the client statement,
// the ageing and DSO, and the TDS deducted by clients.
const big = { minHeight: 48, fontSize: '1rem' };
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const can = (session, p) => Boolean(session?.permissions?.includes(p));
const SLA_TONE = { RED: 'REJECTED', AMBER: 'RETURNED', YELLOW: 'IN_REVIEW', GREEN: 'APPROVED' };
const guardOf = (q, what, permission) => (q.error?.status === 403 || q.error?.status === 404 ? <NoPermission what={what} permission={permission} /> : q.isPending ? <Skeleton label={what} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : null);
const Tabs = ({ tabs, tab, setTab, label, prefix }) => (
  <div className="actions-row" role="tablist" aria-label={label}>{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} style={{ minHeight: 44 }} onClick={() => setTab(k)} data-testid={`${prefix}-${k}`}>{l}</button>)}</div>
);
function Decide({ x, run, busy, setError }) {
  const t = useT('fin'); const [comment, setComment] = useState('');
  if (!x.approve || !x.taskId) return null;
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('act.sayWhy') }); return; } run(() => gl.decide(x.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div className="mdm-panel no-print" data-testid="ar-decide"><h2>{t('act.decision')}</h2>
      <label>{t('act.comment')}<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></label>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => decide('approve')} data-testid="ar-approve">{t('act.approve')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('return')}>{t('act.return')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('reject')}>{t('act.reject')}</button></div>
    </div>
  );
}

// ---- the receipt entry with its allocation (FR-02, BR-01) ----
function ReceiptForm({ partnerId: startPartner }) {
  const t = useT('fin'); const clients = useQuery({ queryKey: ['gl', 'ar-clients'], queryFn: ar.clients, retry: false }); const banks = useQuery({ queryKey: ['gl', 'pm-banks'], queryFn: pm.banks, retry: false });
  const [f, setF] = useState({ partnerId: startPartner ? String(startPartner) : '', receiptDate: today(), bankAccountId: '', reference: '', amount: '', tds: '', tdsSection: '393(1)', gstTds: '', retention: '' });
  const [alloc, setAlloc] = useState({}); const [auto, setAuto] = useState(true);
  const open = useQuery({ queryKey: ['gl', 'ar-open', f.partnerId], queryFn: () => ar.openInvoices(f.partnerId), enabled: Boolean(f.partnerId), retry: false });
  const { error, busy, run } = useGlRunner();
  if (clients.error?.status === 403 || banks.error?.status === 403) return <NoPermission what={t('ar.newReceipt')} permission="fin.receipt.create" />;
  if (clients.isPending || banks.isPending) return <Skeleton label={t('ar.newReceipt')} rows={5} />;
  const fe = error?.fields ?? {}; const set = (k) => (e) => setF({ ...f, [k]: e.target.value }); const n = (v) => Number(v) || 0;
  const brings = n(f.amount) + n(f.tds) + n(f.gstTds) + n(f.retention);
  // oldest first, as the server does it; or what was typed
  let left = brings; const plan = (open.data ?? []).map((i) => { const a = auto ? Math.min(Math.max(left, 0), i.balance) : n(alloc[i.id]); left -= a; return { ...i, take: a }; });
  const allocated = plan.reduce((s, i) => s + i.take, 0); const onAccount = brings - allocated;
  const save = async (post) => { const r = await run(() => ar.createReceipt({ partnerId: Number(f.partnerId), receiptDate: f.receiptDate, bankAccountId: Number(f.bankAccountId), reference: f.reference || null, amount: f.amount || '0', tds: f.tds || '0', tdsSection: n(f.tds) ? f.tdsSection : null, gstTds: f.gstTds || '0', retention: f.retention || '0', auto, ...(auto ? {} : { allocations: plan.filter((i) => i.take > 0).map((i) => ({ invoiceId: i.id, amount: i.take.toFixed(2) })) }), post }), post ? t('ar.posted') : t('jn.saved')); if (r) navigateTo(`/finance/receivables?receipt=${r.id}`); };
  return (
    <form className="mdm-panel" data-testid="ar-receipt-form" onSubmit={(e) => { e.preventDefault(); save(false); }} noValidate>
      <GlError error={error} />
      <div className="form-grid">
        <Field label={t('ar.client')} name="partnerId" error={fe.partnerId}><select value={f.partnerId} onChange={set('partnerId')} style={big} data-testid="ar-client"><option value="">—</option>{clients.data.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('ar.date')} name="receiptDate" error={fe.receiptDate}><input type="date" value={f.receiptDate} max={today()} onChange={set('receiptDate')} style={big} /></Field>
        <Field label={t('ar.bank')} name="bankAccountId" error={fe.bankAccountId}><select value={f.bankAccountId} onChange={set('bankAccountId')} style={big} data-testid="ar-bank"><option value="">—</option>{banks.data.map((b) => <option key={b.id} value={b.id}>{b.name} {b.account}</option>)}</select></Field>
        <Field label={t('ar.reference')} name="reference" error={fe.reference}><input value={f.reference} onChange={set('reference')} style={big} maxLength={60} data-testid="ar-ref" /></Field>
        <Field label={t('ar.received')} name="amount" error={fe.amount}><input inputMode="decimal" value={f.amount} onChange={set('amount')} style={big} data-testid="ar-amount" /></Field>
        <Field label={t('ar.tds')} name="tds" error={fe.tds}><input inputMode="decimal" value={f.tds} onChange={set('tds')} style={big} data-testid="ar-tds" /></Field>
        {n(f.tds) > 0 && <Field label={t('ar.tdsSection')} name="tdsSection" error={fe.tdsSection}><input value={f.tdsSection} onChange={set('tdsSection')} style={big} maxLength={20} /></Field>}
        <Field label={t('ar.gstTds')} name="gstTds" error={fe.gstTds}><input inputMode="decimal" value={f.gstTds} onChange={set('gstTds')} style={big} data-testid="ar-gsttds" /></Field>
        <Field label={t('ar.retention')} name="retention" error={fe.retention}><input inputMode="decimal" value={f.retention} onChange={set('retention')} style={big} data-testid="ar-retention" /></Field>
      </div>
      <h2>{t('ar.allocation')}</h2>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 48 }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} style={{ width: 24, height: 24 }} data-testid="ar-auto" />{t('ar.oldestFirst')}</label>
      {!f.partnerId ? <p className="muted">{t('ar.pickClient')}</p> : open.isPending ? <Skeleton label={t('ar.allocation')} rows={3} /> : plan.length === 0 ? <EmptyState compact title={t('ar.noOpen')} message={t('ar.noOpenBody')} /> : (
        <ul className="lp-list" aria-label={t('ar.allocation')} data-testid="ar-alloc">{plan.map((i) => (
          <li key={i.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0' }} data-testid="ar-alloc-row">
            <span style={{ flex: '1 1 14rem', minWidth: 0 }}><strong>{i.invoiceNo ?? i.docNo}</strong> · {t('ar.due')} {i.dueDate}{i.daysOverdue ? ` · ${t('ar.overdueDays', { n: i.daysOverdue })}` : ''}<br /><span className="muted small">{t('ar.open')} {money(i.balance)}</span></span>
            {auto ? <span className="num" data-testid={`ar-take-${i.id}`}>{money(i.take)}</span> : <input inputMode="decimal" aria-label={t('ar.allocateTo', { ref: i.invoiceNo ?? i.docNo })} value={alloc[i.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })} style={{ ...big, width: '9rem' }} />}
          </li>))}</ul>)}
      {fe.allocations && <p role="alert" className="mdm-banner">{fe.allocations}</p>}
      <div className="ff-actionbar" data-testid="ar-totals"><span>{t('ar.brings')} <strong data-testid="ar-brings">{money(brings)}</strong></span><span>{t('ar.allocated')} <strong>{money(allocated)}</strong></span><span>{t('ar.onAccount')} <strong data-testid="ar-onaccount" style={onAccount < 0 ? { color: 'var(--erp-color-status-error-fg)' } : undefined}>{money(onAccount)}</strong></span>
        <button type="submit" className="btn" style={big} disabled={busy || !f.partnerId} data-testid="ar-save">{t('jn.saveDraft')}</button>
        <button type="button" className="btn btn-primary" style={big} disabled={busy || !f.partnerId || onAccount < 0} onClick={() => save(true)} data-testid="ar-post">{t('ar.post')}</button></div>
    </form>
  );
}

// ---- other income (FR-01) ----
function IncomeForm() {
  const t = useT('fin'); const clients = useQuery({ queryKey: ['gl', 'ap-partners'], queryFn: () => gl.options(), retry: false }); const parties = useQuery({ queryKey: ['gl', 'ar-clients'], queryFn: ar.clients, retry: false });
  const [f, setF] = useState({ partnerId: '', projectId: '', incomeKind: 'SCRAP', incomeAccountId: '', description: '', invoiceNo: '', invoiceDate: today(), amount: '', gst: '' }); const { error, busy, run } = useGlRunner();
  if (clients.isPending || parties.isPending) return <Skeleton label={t('ar.newIncome')} rows={4} />;
  if (parties.error?.status === 403) return <NoPermission what={t('ar.newIncome')} permission="fin.invoice.create" />;
  const fe = error?.fields ?? {}; const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (submit) => { const r = await run(async () => { const x = await ar.createInvoice({ partnerId: Number(f.partnerId), projectId: f.projectId ? Number(f.projectId) : null, incomeKind: f.incomeKind, incomeAccountId: Number(f.incomeAccountId), description: f.description, invoiceNo: f.invoiceNo || null, invoiceDate: f.invoiceDate, amount: f.amount || '0', gst: f.gst || '0' }); if (submit) await ar.invoiceAct(x.id, 'submit'); return x; }, submit ? t('jn.submitted') : t('jn.saved')); if (r) navigateTo(`/finance/receivables?id=${r.id}`); };
  return (
    <form className="mdm-panel" data-testid="ar-income-form" onSubmit={(e) => { e.preventDefault(); save(false); }} noValidate>
      <GlError error={error} />
      <div className="form-grid">
        <Field label={t('ar.party')} name="partnerId" error={fe.partnerId}><select value={f.partnerId} onChange={set('partnerId')} style={big}><option value="">—</option>{parties.data.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('ap.project')} name="projectId" error={fe.projectId}><select value={f.projectId} onChange={set('projectId')} style={big}><option value="">—</option>{(clients.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('ar.kind')} name="incomeKind" error={fe.incomeKind}><select value={f.incomeKind} onChange={set('incomeKind')} style={big}>{['SCRAP', 'HIRE_OUT', 'RENT', 'OTHER'].map((k) => <option key={k} value={k}>{t(`ar.k.${k}`)}</option>)}</select></Field>
        <Field label={t('ar.incomeAccount')} name="incomeAccountId" error={fe.incomeAccountId}><select value={f.incomeAccountId} onChange={set('incomeAccountId')} style={big}><option value="">—</option>{(clients.data?.accounts ?? []).filter((a) => String(a.code).startsWith('4') && !a.control).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></Field>
        <Field label={t('ap.for')} name="description" error={fe.description}><input value={f.description} onChange={set('description')} style={big} maxLength={300} /></Field>
        <Field label={t('ar.invoiceNo')} name="invoiceNo" error={fe.invoiceNo}><input value={f.invoiceNo} onChange={set('invoiceNo')} style={big} maxLength={60} /></Field>
        <Field label={t('ar.date')} name="invoiceDate" error={fe.invoiceDate}><input type="date" value={f.invoiceDate} onChange={set('invoiceDate')} style={big} /></Field>
        <Field label={t('ap.amount')} name="amount" error={fe.amount}><input inputMode="decimal" value={f.amount} onChange={set('amount')} style={big} /></Field>
        <Field label={t('ap.gst')} name="gst" error={fe.gst}><input inputMode="decimal" value={f.gst} onChange={set('gst')} style={big} /></Field>
      </div>
      <div className="ff-actionbar"><span>{t('pm.total')} <strong>{money((Number(f.amount) || 0) + (Number(f.gst) || 0))}</strong></span><button type="submit" className="btn" style={big} disabled={busy}>{t('jn.saveDraft')}</button><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => save(true)}>{t('jn.saveSubmit')}</button></div>
    </form>
  );
}

// ---- one receivable ----
function Invoice({ id }) {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'ar-invoice', id], queryFn: () => ar.invoice(id), retry: false }); const { error, setError, note, busy, run } = useGlRunner(); usePageTitle(t('ar.title'));
  const [fu, setFu] = useState({ date: today(), action: 'CALL', notes: '', contact: '', promisedDate: '', promised: '', nextDate: '' }); const [cn, setCn] = useState({ reason: 'RATE_REVISION', taxable: '', description: '' }); const [wo, setWo] = useState({ amount: '', reason: '' });
  const g = guardOf(q, t('ar.title'), 'fin.invoice.view'); if (g) return g; const x = q.data; const c = x.can ?? {};
  const why = (action) => { const r = globalThis.prompt(t('act.why')); if (r) run(() => ar.invoiceAct(x.id, action, { reason: r })); };
  const row = (k, v, tid) => <tr><th scope="row">{t(k)}</th><td data-testid={tid}>{v}</td></tr>;
  const fe = error?.fields ?? {};
  return (
    <div data-testid="ar-invoice" data-status={x.status}>
      <PageHeader id="ar-h" title={<>{x.invoiceNo ?? x.docNo} <StatusBadge status={JN_TONE[x.status]} label={t(`pm.st.${x.status}`)} />{x.daysOverdue > 0 && <> <StatusBadge status="REJECTED" label={t('ar.overdueDays', { n: x.daysOverdue })} /></>}</>} subtitle={x.client} meta={<><Link to="/finance/receivables">{t('ar.title')}</Link> · {x.docNo} · {t(`ar.src.${x.source}`)}</>} />
      <KpiRow label={t('ar.title')}><KpiTile label={t('pm.amount')} value={money(x.amount)} amount={x.amount} kind="money" /><KpiTile label={t('ar.balance')} value={money(x.balance)} amount={x.balance} kind="money" valueTestid="ar-balance" /><KpiTile label={t('ar.interest')} value={money(x.interest)} amount={x.interest} kind="money" /></KpiRow>
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="table-scroll"><table className="data-table"><tbody>
        {row('ar.date', x.invoiceDate)}{row('ar.due', x.dueDate)}{row('ar.received', money(x.received))}{row('ar.credited', money(x.credited))}{row('ar.writtenOff', money(x.writtenOff))}
        {x.interestPct > 0 && row('ar.interestRate', `${x.interestPct}%`)}{x.promisedDate && row('ar.promised', x.promisedDate)}{x.description && row('ap.for', x.description)}
        {x.journalId && row('jn.voucher', <Link to={`/finance/journals?id=${x.journalId}`}>{t('common.open')}</Link>)}
      </tbody></table></div>
      <div className="actions-row no-print">
        {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => ar.invoiceAct(x.id, 'submit'), t('jn.submitted'))}>{t('act.submit')}</button>}
        {c.withdraw && <button type="button" className="btn" style={big} disabled={busy} onClick={() => why('withdraw')}>{t('act.withdraw')}</button>}
        {c.cancel && <button type="button" className="btn" style={big} disabled={busy} onClick={() => why('cancel')}>{t('act.cancel')}</button>}
        {c.receipt && <button type="button" className="btn btn-primary" style={big} onClick={() => navigateTo(`/finance/receivables?new=receipt&partnerId=${x.partnerId}`)}>{t('ar.newReceipt')}</button>}
        {c.print && x.balance > 0 && x.daysOverdue > 0 && <button type="button" className="btn" style={big} onClick={() => gl.file(`/invoices/${x.id}/dunning`, `reminder-${x.docNo.replaceAll('/', '-')}.pdf`).then(() => q.refetch()).catch(() => setError({ form: t('act.exportFailed') }))} data-testid="ar-dunning">{t('ar.dunning')}</button>}
        {c.print && <button type="button" className="btn" style={big} onClick={() => gl.file(`/invoices/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('act.exportFailed') }))}>{t('act.print')}</button>}
      </div>
      <Decide x={x} run={run} busy={busy} setError={setError} />
      {x.allocations?.length > 0 && <div className="table-scroll"><table className="data-table"><caption>{t('ar.settledBy')}</caption><tbody>{x.allocations.map((a) => <tr key={a.id}><td><Link to={`/finance/receivables?receipt=${a.receiptId}`}>{a.receiptNo}</Link></td><td>{a.date}</td><td>{a.reference ?? ''}</td><td className="num">{money(a.amount)}</td></tr>)}</tbody></table></div>}
      {(x.creditNotes?.length > 0 || x.writeOffs?.length > 0) && <ul className="lp-list" aria-label={t('ar.adjustments')}>{x.creditNotes.map((n) => <li key={`c${n.id}`}><Link to={`/finance/receivables?cn=${n.id}`}>{n.docNo}</Link> · {t(`ar.r.${n.reason}`)} · {money(n.total)} · {t(`pm.st.${n.status}`)}</li>)}{x.writeOffs.map((w) => <li key={`w${w.id}`}><Link to={`/finance/receivables?wo=${w.id}`}>{w.docNo}</Link> · {t('ar.writeOff')} · {money(w.amount)} · {t(`pm.st.${w.status}`)}</li>)}</ul>}
      {c.followup && <form className="mdm-panel no-print" data-testid="ar-followup" onSubmit={(e) => { e.preventDefault(); run(() => ar.followup(x.id, { date: fu.date, action: fu.action, notes: fu.notes, contact: fu.contact || null, promisedDate: fu.promisedDate || null, promised: fu.promised || null, nextDate: fu.nextDate || null }), t('ar.logged')).then((r) => { if (r) setFu({ ...fu, notes: '', promisedDate: '', promised: '' }); }); }}>
        <h2>{t('ar.logFollowup')}</h2>
        <div className="form-grid">
          <Field label={t('ar.action')} name="action" error={fe.action}><select value={fu.action} onChange={(e) => setFu({ ...fu, action: e.target.value })} style={big}>{['CALL', 'EMAIL', 'VISIT', 'LETTER', 'REMINDER'].map((k) => <option key={k} value={k}>{t(`ar.a.${k}`)}</option>)}</select></Field>
          <Field label={t('ar.date')} name="date" error={fe.date}><input type="date" value={fu.date} onChange={(e) => setFu({ ...fu, date: e.target.value })} style={big} /></Field>
          <Field label={t('ar.notes')} name="notes" error={fe.notes}><input value={fu.notes} onChange={(e) => setFu({ ...fu, notes: e.target.value })} style={big} maxLength={500} data-testid="ar-fu-notes" /></Field>
          <Field label={t('ar.contact')} name="contact" error={fe.contact}><input value={fu.contact} onChange={(e) => setFu({ ...fu, contact: e.target.value })} style={big} maxLength={100} /></Field>
          <Field label={t('ar.promisedDate')} name="promisedDate" error={fe.promisedDate}><input type="date" value={fu.promisedDate} onChange={(e) => setFu({ ...fu, promisedDate: e.target.value })} style={big} data-testid="ar-fu-promise" /></Field>
          <Field label={t('ar.promisedAmount')} name="promised" error={fe.promised}><input inputMode="decimal" value={fu.promised} onChange={(e) => setFu({ ...fu, promised: e.target.value })} style={big} /></Field>
        </div>
        <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy || fu.notes.trim().length < 3} data-testid="ar-fu-save">{t('ar.log')}</button></div>
      </form>}
      {x.followups?.length > 0 && <ul className="lp-list" aria-label={t('ar.followups')} data-testid="ar-followups">{x.followups.map((f) => <li key={f.id}>{f.date} · <strong>{t(`ar.a.${f.action}`)}</strong> · {f.notes}{f.contact ? ` · ${f.contact}` : ''}{f.promisedDate ? ` · ${t('ar.promised')} ${f.promisedDate}${f.promised ? ` ${money(f.promised)}` : ''}` : ''} · {f.by}</li>)}</ul>}
      {c.creditNote && <form className="mdm-panel no-print" onSubmit={(e) => { e.preventDefault(); run(() => ar.createCreditNote({ invoiceId: x.id, reason: cn.reason, noteDate: today(), description: cn.description, taxable: cn.taxable || '0' })).then((r) => { if (r) navigateTo(`/finance/receivables?cn=${r.id}`); }); }}>
        <h2>{t('ar.newCreditNote')}</h2>
        <div className="form-grid">
          <Field label={t('ar.reason')} name="reason" error={fe.reason}><select value={cn.reason} onChange={(e) => setCn({ ...cn, reason: e.target.value })} style={big}>{['RATE_REVISION', 'DISPUTE', 'QUANTITY', 'OTHER'].map((k) => <option key={k} value={k}>{t(`ar.r.${k}`)}</option>)}</select></Field>
          <Field label={t('ar.taxable')} name="taxable" error={fe.taxable}><input inputMode="decimal" value={cn.taxable} onChange={(e) => setCn({ ...cn, taxable: e.target.value })} style={big} /></Field>
          <Field label={t('ap.for')} name="description" error={fe.description}><input value={cn.description} onChange={(e) => setCn({ ...cn, description: e.target.value })} style={big} maxLength={300} /></Field>
        </div>
        <div className="actions-row"><button type="submit" className="btn" style={big} disabled={busy}>{t('jn.saveDraft')}</button></div>
      </form>}
      {c.writeOff && <form className="mdm-panel no-print" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await ar.createWriteOff({ invoiceId: x.id, amount: wo.amount || '0', reason: wo.reason }); await ar.writeOffAct(r.id, 'submit'); return r; }, t('jn.submitted')); }}>
        <h2>{t('ar.proposeWriteOff')}</h2>
        <div className="form-grid">
          <Field label={t('pm.amount')} name="amount" error={fe.amount}><input inputMode="decimal" value={wo.amount} onChange={(e) => setWo({ ...wo, amount: e.target.value })} style={big} /></Field>
          <Field label={t('ar.reason')} name="reason" error={fe.reason}><input value={wo.reason} onChange={(e) => setWo({ ...wo, reason: e.target.value })} style={big} maxLength={300} /></Field>
        </div>
        <div className="actions-row"><button type="submit" className="btn" style={big} disabled={busy}>{t('ar.sendWriteOff')}</button></div>
      </form>}
    </div>
  );
}
function Receipt({ id }) {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'ar-receipt', id], queryFn: () => ar.receipt(id), retry: false }); const { error, note, busy, run } = useGlRunner(); usePageTitle(t('ar.receipt'));
  const g = guardOf(q, t('ar.receipt'), 'fin.receipt.view'); if (g) return g; const x = q.data; const c = x.can ?? {};
  const row = (k, v, tid) => <tr><th scope="row">{t(k)}</th><td data-testid={tid}>{v}</td></tr>;
  return (
    <div data-testid="ar-receipt" data-status={x.status}>
      <PageHeader id="arr-h" title={<>{x.docNo} <StatusBadge status={JN_TONE[x.status]} label={x.status === 'APPROVED' ? t('ar.postedState') : t(`pm.st.${x.status}`)} /></>} subtitle={x.client} meta={<><Link to="/finance/receivables?tab=receipts">{t('ar.receipts')}</Link> · {x.date} · {x.bank}</>} />
      <KpiRow label={t('ar.receipt')}><KpiTile label={t('ar.received')} value={money(x.amount)} amount={x.amount} kind="money" /><KpiTile label={t('ar.brings')} value={money(x.gross)} amount={x.gross} kind="money" /><KpiTile label={t('ar.onAccount')} value={money(x.unallocated)} amount={x.unallocated} kind="money" valueTestid="ar-r-onaccount" /></KpiRow>
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="table-scroll"><table className="data-table"><tbody>{row('ar.reference', x.reference ?? '—')}{row('ar.tds', `${money(x.tds)}${x.tdsSection ? ` · ${x.tdsSection} · ${x.tdsQuarter}` : ''}${x.tds ? ` · ${x.tdsMatched ? t('ar.in26as') : t('ar.not26as')}` : ''}`)}{row('ar.gstTds', money(x.gstTds))}{row('ar.retention', money(x.retention))}{x.journalId && row('jn.voucher', <Link to={`/finance/journals?id=${x.journalId}`}>{t('common.open')}</Link>)}</tbody></table></div>
      <div className="actions-row no-print">
        {c.post && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => ar.receiptAct(x.id, 'submit'), t('ar.posted'))}>{t('ar.post')}</button>}
        {c.allocate && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => ar.receiptAct(x.id, 'allocate', { auto: true }), t('ar.allocatedDone'))}>{t('ar.allocateOldest')}</button>}
        {c.tdsMatch && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => ar.receiptAct(x.id, 'tds-matched', { matched: !x.tdsMatched }))}>{x.tdsMatched ? t('ar.unmark26as') : t('ar.mark26as')}</button>}
        {c.cancel && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = globalThis.prompt(t('act.why')); if (r) run(() => ar.receiptAct(x.id, 'cancel', { reason: r })); }}>{t('act.cancel')}</button>}
      </div>
      {x.allocations?.length > 0 && <div className="table-scroll"><table className="data-table"><caption>{t('ar.allocation')}</caption><tbody>{x.allocations.map((a) => <tr key={a.id}><td><Link to={`/finance/receivables?id=${a.invoiceId}`}>{a.invoiceNo ?? a.docNo}</Link></td><td>{a.on}</td><td className="num">{money(a.amount)}</td></tr>)}</tbody></table></div>}
    </div>
  );
}
function Approvable({ id, kind }) {
  const t = useT('fin'); const fetcher = kind === 'cn' ? ar.creditNote : ar.writeOff; const actor = kind === 'cn' ? ar.creditNoteAct : ar.writeOffAct;
  const q = useQuery({ queryKey: ['gl', `ar-${kind}`, id], queryFn: () => fetcher(id), retry: false }); const { error, setError, note, busy, run } = useGlRunner(); usePageTitle(kind === 'cn' ? t('ar.creditNote') : t('ar.writeOff'));
  const g = guardOf(q, kind === 'cn' ? t('ar.creditNote') : t('ar.writeOff'), kind === 'cn' ? 'fin.credit_note.view' : 'fin.writeoff.view'); if (g) return g; const x = q.data; const c = x.can ?? {};
  return (
    <div data-testid={`ar-${kind}`} data-status={x.status}>
      <PageHeader id="arx-h" title={<>{x.docNo} <StatusBadge status={JN_TONE[x.status]} label={t(`pm.st.${x.status}`)} /></>} subtitle={x.client} meta={<><Link to={`/finance/receivables?id=${x.invoiceId}`}>{x.invoiceNo ?? x.invoiceDoc ?? t('ar.title')}</Link> · {kind === 'cn' ? t(`ar.r.${x.reason}`) : x.reason}</>} />
      <KpiRow label={x.docNo}><KpiTile label={t('pm.total')} value={money(x.total ?? x.amount)} amount={x.total ?? x.amount} kind="money" />{kind === 'cn' && <KpiTile label="GST" value={money((x.cgst ?? 0) + (x.sgst ?? 0) + (x.igst ?? 0))} amount={(x.cgst ?? 0) + (x.sgst ?? 0) + (x.igst ?? 0)} kind="money" />}</KpiRow>
      {kind === 'cn' && <p>{x.description}{x.irnRequired ? ` · ${t('ar.irnBy', { date: x.irnDueDate })}` : ''}</p>}
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="actions-row no-print">
        {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => actor(x.id, 'submit'), t('jn.submitted'))}>{t('act.submit')}</button>}
        {c.withdraw && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = globalThis.prompt(t('act.why')); if (r) run(() => actor(x.id, 'withdraw', { reason: r })); }}>{t('act.withdraw')}</button>}
        {c.cancel && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = globalThis.prompt(t('act.why')); if (r) run(() => actor(x.id, 'cancel', { reason: r })); }}>{t('act.cancel')}</button>}
      </div>
      <Decide x={x} run={run} busy={busy} setError={setError} />
    </div>
  );
}
function AgeingTiles() {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'ar-ageing'], queryFn: () => ar.ageing({}), retry: false });
  if (q.isPending) return <Skeleton label={t('ar.ageing')} rows={1} />; if (q.isError) return null; const a = q.data.totals;
  return (<KpiRow label={t('ar.ageing')}><KpiTile label={t('ar.totalOpen')} value={money(a.total)} amount={a.total} kind="money" valueTestid="ar-total-open" /><KpiTile label={t('ar.b.current')} value={money(a.current)} amount={a.current} kind="money" /><KpiTile label={t('ar.b.1')} value={money(a.b1)} amount={a.b1} kind="money" /><KpiTile label={t('ar.b.31')} value={money(a.b31)} amount={a.b31} kind="money" /><KpiTile label={t('ar.b.61')} value={money(a.b61)} amount={a.b61} kind="money" /><KpiTile label={t('ar.b.91')} value={money(a.b91)} amount={a.b91} kind="money" /><KpiTile label="DSO" value={q.data.dso == null ? '—' : t('ar.days', { n: q.data.dso })} /></KpiRow>);
}
function CreditNoteList() {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'ar-cns'], queryFn: ar.creditNotes, retry: false }); const g = guardOf(q, t('ar.creditNotes'), 'fin.credit_note.view'); if (g) return g;
  return q.data.length === 0 ? <EmptyState compact title={t('ar.noCreditNotes')} message={t('ar.noCreditNotesBody')} /> : <ul className="lp-list" aria-label={t('ar.creditNotes')}>{q.data.map((n) => <li key={n.id} style={{ minHeight: 44 }}><Link to={`/finance/receivables?cn=${n.id}`}>{n.docNo}</Link> · {n.client} · {t(`ar.r.${n.reason}`)} · {money(n.total)} · {t(`pm.st.${n.status}`)}</li>)}</ul>;
}
export function ReceivablesPage() {
  const t = useT('fin'); usePageTitle(t('ar.title')); const sp = useSearch(); const session = useSession(); const [tab, setTab] = useState(sp.get('tab') ?? 'invoices');
  const n = (k) => Number(sp.get(k)) || null;
  if (n('id')) return <section aria-labelledby="ar-h"><Invoice id={n('id')} /></section>;
  if (n('receipt')) return <section aria-labelledby="arr-h"><Receipt id={n('receipt')} /></section>;
  if (n('cn')) return <section aria-labelledby="arx-h"><Approvable id={n('cn')} kind="cn" /></section>;
  if (n('wo')) return <section aria-labelledby="arx-h"><Approvable id={n('wo')} kind="wo" /></section>;
  if (sp.get('new') === 'receipt') return <section aria-labelledby="arn-h"><PageHeader id="arn-h" title={t('ar.newReceipt')} subtitle={t('ar.newReceiptIntro')} meta={<Link to="/finance/receivables">{t('ar.title')}</Link>} /><ReceiptForm partnerId={n('partnerId')} /></section>;
  if (sp.get('new') === 'income') return <section aria-labelledby="ari-h"><PageHeader id="ari-h" title={t('ar.newIncome')} subtitle={t('ar.newIncomeIntro')} meta={<Link to="/finance/receivables">{t('ar.title')}</Link>} /><IncomeForm /></section>;
  return (
    <section aria-labelledby="ars-h" data-testid="ar-receivables"><PageHeader id="ars-h" title={t('ar.title')} subtitle={t('ar.intro')} meta={<Link to="/finance/collections">{t('ar.collections')}</Link>} actions={can(session.data, 'fin.receipt.create') ? <button type="button" className="btn btn-primary" style={big} onClick={() => navigateTo('/finance/receivables?new=receipt')} data-testid="ar-new-receipt">{t('ar.newReceipt')}</button> : null} />
      <AgeingTiles />
      <Tabs tabs={[['invoices', t('ar.title')], ['receipts', t('ar.receipts')], ['notes', t('ar.creditNotes')]]} tab={tab} setTab={setTab} label={t('ar.title')} prefix="ar-tab" />
      {tab === 'invoices' && <ListReport listCode="fin.ar_invoices" endpoint="/fin/invoices" title={t('ar.title')} session={session.data} rowHref={(r) => `/finance/receivables?id=${r.id}`} onOpen={(r) => navigateTo(`/finance/receivables?id=${r.id}`)} cardFields={['invoiceNo', 'client', 'dueDate', 'balance', 'overdue', 'status']} statusKey="status" dateKey="dueDate"
        newAction={{ label: t('ar.newIncome'), permission: 'fin.invoice.create', onClick: () => navigateTo('/finance/receivables?new=income') }} empty={{ title: t('ar.emptyTitle'), text: t('ar.emptyBody') }} />}
      {tab === 'receipts' && <ListReport listCode="fin.ar_receipts" endpoint="/fin/receipts" title={t('ar.receipts')} session={session.data} rowHref={(r) => `/finance/receivables?receipt=${r.id}`} onOpen={(r) => navigateTo(`/finance/receivables?receipt=${r.id}`)} cardFields={['docNo', 'client', 'date', 'amount', 'unallocated', 'status']} statusKey="status" dateKey="date"
        newAction={{ label: t('ar.newReceipt'), permission: 'fin.receipt.create', onClick: () => navigateTo('/finance/receivables?new=receipt') }} empty={{ title: t('ar.noReceipts'), text: t('ar.noReceiptsBody') }} />}
      {tab === 'notes' && <CreditNoteList />}
    </section>
  );
}

// ---- collections: the worklist, the client statement, the ageing and DSO, the TDS deducted by clients ----
function Worklist() {
  const t = useT('fin'); const [bucket, setBucket] = useState(''); const q = useQuery({ queryKey: ['gl', 'ar-work', bucket], queryFn: () => ar.collections({ bucket: bucket || undefined }), retry: false });
  const g = guardOf(q, t('ar.collections'), 'fin.followup.view'); if (g) return g; const x = q.data;
  return (
    <div data-testid="ar-worklist">
      <KpiRow label={t('ar.collections')}><KpiTile label={t('ar.overdueTotal')} value={money(x.overdue)} amount={x.overdue} kind="money" valueTestid="ar-overdue" /><KpiTile label={t('ar.toFollow')} value={String(x.count)} /><KpiTile label={t('ar.broken')} value={String(x.brokenPromises)} /></KpiRow>
      <div className="form-grid"><Field label={t('ar.bucket')} name="bucket" error={null}><select value={bucket} onChange={(e) => setBucket(e.target.value)} style={big}><option value="">{t('common.all')}</option>{['0', '30', '60', '90'].map((b) => <option key={b} value={b}>{t(`ar.bk.${b}`)}</option>)}</select></Field></div>
      {x.rows.length === 0 ? <EmptyState title={t('ar.nothingOverdue')} message={t('ar.nothingOverdueBody')} /> : <ul className="lp-list" aria-label={t('ar.collections')}>{x.rows.map((r) => (
        <li key={r.id} data-testid="ar-work-card" className="mdm-panel" style={{ display: 'grid', gap: 8, padding: 12, margin: '8px 0' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}><Link to={`/finance/receivables?id=${r.id}`}><strong>{r.invoiceNo ?? r.docNo}</strong></Link><StatusBadge status={SLA_TONE[r.sla]} label={r.daysOverdue > 0 ? t('ar.overdueDays', { n: r.daysOverdue }) : t('ar.promisedOn', { date: r.promisedDate })} /></div>
          <span>{r.client}</span>
          <span className="muted small">{t('ar.due')} {r.dueDate} · {t('ar.balance')} {money(r.balance)}{r.interest ? ` · ${t('ar.interest')} ${money(r.interest)}` : ''}{r.promisedDate ? ` · ${t('ar.promised')} ${r.promisedDate}${r.promiseBroken ? ` (${t('ar.notKept')})` : ''}` : ''}</span>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={big} onClick={() => navigateTo(`/finance/receivables?id=${r.id}`)} data-testid={`ar-follow-${r.id}`}>{t('ar.logFollowup')}</button></div>
        </li>))}</ul>}
    </div>
  );
}
function Statement() {
  const t = useT('fin'); const session = useSession(); const clients = useQuery({ queryKey: ['gl', 'ar-clients'], queryFn: ar.clients, retry: false }); const [pid, setPid] = useState('');
  const q = useQuery({ queryKey: ['gl', 'ar-statement', pid], queryFn: () => ar.statement({ partnerId: pid }), enabled: Boolean(pid), retry: false });
  const g = guardOf(clients, t('ar.statement'), 'fin.invoice.view'); if (g) return g; const x = q.data;
  return (
    <div data-testid="ar-statement">
      <div className="form-grid"><Field label={t('ar.client')} name="partnerId" error={null}><select value={pid} onChange={(e) => setPid(e.target.value)} style={big} data-testid="ar-st-client"><option value="">—</option>{clients.data.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field></div>
      {!pid ? <EmptyState title={t('ar.statement')} message={t('ar.pickClient')} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : !x ? <Skeleton label={t('ar.statement')} rows={4} /> : <>
        <KpiRow label={t('ar.statement')}><KpiTile label={t('led.opening')} value={money(x.opening)} amount={x.opening} kind="money" /><KpiTile label={t('ar.balanceDue')} value={money(x.closing)} amount={x.closing} kind="money" valueTestid="ar-st-closing" /></KpiRow>
        {can(session.data, 'fin.invoice.export') && <div className="actions-row"><button type="button" className="btn" style={big} onClick={() => gl.file(`/receivables/statement/pdf?partnerId=${pid}`, `client-statement-${x.client.code}.pdf`).catch(() => globalThis.alert?.(t('act.exportFailed')))}>{t('ar.statementPdf')}</button></div>}
        <div className="table-scroll"><table className="data-table" aria-label={t('ar.statement')}><thead><tr><th scope="col">{t('jn.date')}</th><th scope="col">{t('py.entry')}</th><th scope="col">{t('ar.reference')}</th><th scope="col" className="num">{t('jn.debit')}</th><th scope="col" className="num">{t('jn.credit')}</th><th scope="col" className="num">{t('py.balance')}</th></tr></thead>
          <tbody>{x.rows.map((r, i) => <tr key={i} data-testid="ar-st-row"><td>{r.d}</td><td>{t(`ar.e.${r.kind}`)}</td><td>{r.link ? <Link to={r.link}>{r.ref}</Link> : r.ref}</td><td className="num">{r.debit ? money(r.debit) : ''}</td><td className="num">{r.credit ? money(r.credit) : ''}</td><td className="num">{money(r.balance)}</td></tr>)}</tbody></table></div></>}
    </div>
  );
}
function Ageing() {
  const t = useT('fin'); const [asOf, setAsOf] = useState(today()); const q = useQuery({ queryKey: ['gl', 'ar-ageing', asOf], queryFn: () => ar.ageing({ asOf }), retry: false });
  const g = guardOf(q, t('ar.ageing'), 'fin.invoice.view'); if (g) return g; const x = q.data;
  return (
    <div data-testid="ar-ageing">
      <div className="form-grid"><Field label={t('ar.asOf')} name="asOf" error={null}><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={big} /></Field></div>
      <KpiRow label={t('ar.ageing')}><KpiTile label="DSO" value={x.dso == null ? '—' : t('ar.days', { n: x.dso })} valueTestid="ar-dso" /><KpiTile label={t('ar.salesOf', { n: x.dsoDays })} value={money(x.sales)} amount={x.sales} kind="money" /><KpiTile label={t('ar.totalOpen')} value={money(x.totals.total)} amount={x.totals.total} kind="money" /></KpiRow>
      {x.rows.length === 0 ? <EmptyState compact title={t('ar.nothingOpen')} message={t('ar.nothingOpenBody')} /> : <div className="table-scroll"><table className="data-table" aria-label={t('ar.ageing')}><thead><tr><th scope="col">{t('ar.client')}</th>{['current', 'b1', 'b31', 'b61', 'b91', 'total'].map((k) => <th key={k} scope="col" className="num">{t(`ar.col.${k}`)}</th>)}</tr></thead>
        <tbody>{x.rows.map((r) => <tr key={r.partnerId} data-testid="ar-ageing-row"><td>{r.client}</td>{['current', 'b1', 'b31', 'b61', 'b91', 'total'].map((k) => <td key={k} className="num">{money(r[k])}</td>)}</tr>)}</tbody></table></div>}
    </div>
  );
}
function TdsByClients() {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'ar-tds'], queryFn: () => ar.tds({}), retry: false }); const g = guardOf(q, t('ar.tdsTab'), 'fin.receipt.view'); if (g) return g; const x = q.data;
  return (
    <div data-testid="ar-tds-report">
      <KpiRow label={t('ar.tdsTab')}><KpiTile label={t('ar.tds')} value={money(x.tds)} amount={x.tds} kind="money" /><KpiTile label={t('ar.gstTds')} value={money(x.gstTds)} amount={x.gstTds} kind="money" /><KpiTile label={t('ar.not26as')} value={money(x.unmatched)} amount={x.unmatched} kind="money" /></KpiRow>
      {x.rows.length === 0 ? <EmptyState compact title={t('ar.noTds')} message={t('ar.noTdsBody')} /> : <ul className="lp-list">{x.rows.map((r) => <li key={r.id}><Link to={`/finance/receivables?receipt=${r.id}`}>{r.docNo}</Link> · {r.date} · {r.client} · {r.section ?? ''} {r.quarter ?? ''} · TDS {money(r.tds)} · GST-TDS {money(r.gstTds)} · {r.matched ? t('ar.in26as') : t('ar.not26as')}</li>)}</ul>}
    </div>
  );
}
export function CollectionsPage() {
  const t = useT('fin'); usePageTitle(t('ar.collections')); const sp = useSearch(); const [tab, setTab] = useState(sp.get('tab') ?? 'work');
  return (
    <section aria-labelledby="arc-h" data-testid="ar-collections"><PageHeader id="arc-h" title={t('ar.collections')} subtitle={t('ar.collectionsIntro')} meta={<Link to="/finance/receivables">{t('ar.title')}</Link>} />
      <Tabs tabs={[['work', t('ar.followUp')], ['statement', t('ar.statement')], ['ageing', t('ar.ageingDso')], ['tds', t('ar.tdsTab')]]} tab={tab} setTab={setTab} label={t('ar.collections')} prefix="arc-tab" />
      {tab === 'work' && <Worklist />}{tab === 'statement' && <Statement />}{tab === 'ageing' && <Ageing />}{tab === 'tds' && <TdsByClients />}
    </section>
  );
}
