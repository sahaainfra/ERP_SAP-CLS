import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import Chart from '../../platform/charts/Chart.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { JN_TONE, NATURES, ap, gl, money } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';

// Part 23.03: the pages of accounts payable — AP bills (List Report; one bill with its TDS, holds, what is set against it; the direct expense bill and its
// approval), debit notes, and the vendor ledger with the payables reports (ageing, MSME due, TDS deducted).
const big = { minHeight: 'var(--erp-target-large)', fontSize: '1rem' };
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const can = (session, p) => Boolean(session?.permissions?.includes(p));
const guardOf = (q, what, permission) => (q.error?.status === 403 || q.error?.status === 404 ? <NoPermission what={what} permission={permission} /> : q.isPending ? <Skeleton label={what} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : null);

function Decide({ x, run, busy, setError }) {
  const t = useT('fin'); const [comment, setComment] = useState('');
  if (!x.approve || !x.taskId) return null;
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('act.sayWhy') }); return; } run(() => gl.decide(x.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div className="mdm-panel no-print" data-testid="ap-decide"><h2>{t('act.decision')}</h2>
      <label>{t('act.comment')}<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></label>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => decide('approve')} data-testid="ap-approve">{t('act.approve')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('return')}>{t('act.return')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('reject')}>{t('act.reject')}</button></div>
    </div>
  );
}

// ---- the direct expense bill ----
function DirectForm() {
  const t = useT('fin'); const opt = useQuery({ queryKey: ['gl', 'options'], queryFn: gl.options, retry: false }); const partners = useQuery({ queryKey: ['gl', 'ap-partners'], queryFn: ap.partners, retry: false });
  const [f, setF] = useState({ partnerId: '', projectId: '', billNo: '', billDate: today(), creditDays: '', description: '', expenseAccountId: '', amount: '', gst: '', tdsNature: 'CONTRACTOR' }); const { error, busy, run } = useGlRunner();
  const tds = useQuery({ queryKey: ['gl', 'tds', f.partnerId, f.tdsNature, f.billDate, f.amount], queryFn: () => ap.tdsPreview({ partnerId: f.partnerId, nature: f.tdsNature, date: f.billDate, amount: f.amount }), enabled: Boolean(f.partnerId && f.tdsNature && Number(f.amount) > 0), retry: false, placeholderData: (p) => p });
  if (opt.error?.status === 403 || partners.error?.status === 403) return <NoPermission what={t('ap.new')} permission="fin.bill.create" />;
  if (opt.isPending || partners.isPending) return <Skeleton label={t('ap.new')} rows={5} />;
  const fe = error?.fields ?? {}; const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const total = (Number(f.amount) || 0) + (Number(f.gst) || 0); const tdsAmt = f.tdsNature ? (tds.data?.amount ?? 0) : 0;
  const save = async (submit) => { const body = { partnerId: Number(f.partnerId), projectId: f.projectId ? Number(f.projectId) : null, billNo: f.billNo || null, billDate: f.billDate, creditDays: f.creditDays === '' ? null : Number(f.creditDays), description: f.description, expenseAccountId: Number(f.expenseAccountId), amount: f.amount || '0', gst: f.gst || '0', tdsNature: f.tdsNature || null }; const r = await run(async () => { const b = await ap.createBill(body); if (submit) await ap.billAct(b.id, 'submit'); return b; }, submit ? t('jn.submitted') : t('jn.saved')); if (r) navigateTo(`/finance/ap-bills?id=${r.id}`); };
  return (
    <form className="mdm-panel" data-testid="ap-direct-form" onSubmit={(e) => { e.preventDefault(); save(false); }} noValidate>
      <GlError error={error} />
      <div className="form-grid">
        <Field label={t('ap.vendor')} name="partnerId" error={fe.partnerId}><select value={f.partnerId} onChange={set('partnerId')} style={big} data-testid="ap-partner"><option value="">—</option>{partners.data.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}{p.msme ? ` · MSME ${p.msme}` : ''}</option>)}</select></Field>
        <Field label={t('ap.project')} name="projectId" error={fe.projectId}><select value={f.projectId} onChange={set('projectId')} style={big} data-testid="ap-project"><option value="">—</option>{opt.data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('ap.billNo')} name="billNo" error={fe.billNo}><input value={f.billNo} onChange={set('billNo')} style={big} maxLength={60} data-testid="ap-billno" /></Field>
        <Field label={t('ap.billDate')} name="billDate" error={fe.billDate}><input type="date" value={f.billDate} onChange={set('billDate')} style={big} data-testid="ap-billdate" /></Field>
        <Field label={t('ap.creditDays')} name="creditDays" error={fe.creditDays}><input inputMode="numeric" value={f.creditDays} onChange={set('creditDays')} style={big} /></Field>
        <Field label={t('ap.for')} name="description" error={fe.description}><input value={f.description} onChange={set('description')} style={big} maxLength={300} data-testid="ap-desc" /></Field>
        <Field label={t('ap.expense')} name="expenseAccountId" error={fe.expenseAccountId}><select value={f.expenseAccountId} onChange={set('expenseAccountId')} style={big} data-testid="ap-expense"><option value="">—</option>{opt.data.accounts.filter((a) => a.nature === 'EXPENSE' && !a.control).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></Field>
        <Field label={t('ap.amount')} name="amount" error={fe.amount}><input inputMode="decimal" value={f.amount} onChange={set('amount')} style={big} data-testid="ap-amount" /></Field>
        <Field label={t('ap.gst')} name="gst" error={fe.gst}><input inputMode="decimal" value={f.gst} onChange={set('gst')} style={big} data-testid="ap-gst" /></Field>
        <Field label={t('ap.tdsNature')} name="tdsNature" error={fe.tdsNature}><select value={f.tdsNature} onChange={set('tdsNature')} style={big} data-testid="ap-nature"><option value="">{t('ap.noTds')}</option>{NATURES.map((n) => <option key={n} value={n}>{t(`ap.n.${n}`)}</option>)}</select></Field>
      </div>
      {tds.data && f.tdsNature && <p className="mdm-banner" role="status" data-testid="ap-tds-preview">{tds.data.section ? `${t('ap.tdsLine', { section: tds.data.section, act: tds.data.act, rate: tds.data.ratePct, base: money(tds.data.base) })} · ${t(`ap.tdsBasis.${tds.data.basis}`)} · ${money(tds.data.amount)}` : t(`ap.tdsBasis.${tds.data.basis}`)}</p>}
      <div className="ff-actionbar" data-testid="ap-totals"><span>{t('ap.total')} <strong>{money(total)}</strong></span><span>{t('ap.tds')} <strong data-testid="ap-tds-amount">{money(tdsAmt)}</strong></span><span>{t('ap.net')} <strong>{money(total - tdsAmt)}</strong></span>
        <button type="submit" className="btn" style={big} disabled={busy} data-testid="ap-save">{t('jn.saveDraft')}</button><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => save(true)} data-testid="ap-save-submit">{t('jn.saveSubmit')}</button></div>
    </form>
  );
}

function Bill({ id }) {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'ap-bill', id], queryFn: () => ap.bill(id), retry: false }); const { error, setError, note, busy, run } = useGlRunner(); const [adv, setAdv] = useState({ advanceId: '', amount: '' }); usePageTitle(t('ap.title'));
  const g = guardOf(q, t('ap.title'), 'fin.bill.view'); if (g) return g; const x = q.data; const c = x.can ?? {};
  const why = (action) => { const r = globalThis.prompt(t('act.why')); if (r) run(() => ap.billAct(x.id, action, { reason: r })); };
  const hold = (on2) => { const r = globalThis.prompt(t('ap.holdWhy')); if (r) run(() => ap.billAct(x.id, 'hold', { hold: on2, reason: r })); };
  const row = (k, v) => <tr><th scope="row">{t(k)}</th><td>{v}</td></tr>;
  return (
    <div data-testid="ap-bill" data-status={x.status} data-hold={x.onHold ? 'yes' : 'no'}>
      <PageHeader id="ap-h" title={<>{x.docNo} <StatusBadge status={JN_TONE[x.status]} label={t(`st.${x.status}`)} />{x.onHold && <> <StatusBadge status="RETURNED" label={t('ap.held')} /></>}</>} subtitle={x.payee} meta={<><Link to="/finance/ap-bills">{t('ap.title')}</Link> · {x.sourceLabel}{x.billNo ? ` · ${x.billNo}` : ''} · {x.billDate}</>} />
      <KpiRow label={t('ap.title')}><KpiTile label={t('ap.total')} value={money(x.total)} amount={x.total} kind="money" /><KpiTile label={t('ap.tds')} value={money(x.tds)} amount={x.tds} kind="money" valueTestid="ap-bill-tds" /><KpiTile label={t('ap.outstanding')} value={money(x.outstanding)} amount={x.outstanding} kind="money" valueTestid="ap-bill-outstanding" /><KpiTile label={t('ap.due')} value={x.msmeDue ?? x.dueDate} tone={x.msmeDue && x.msmeDue < today() ? 'danger' : 'neutral'} /></KpiRow>
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="table-scroll" data-testid="ap-facts"><table className="data-table"><tbody>
        {row('ap.payee', x.payee)}{row('ap.from', `${x.sourceLabel}${x.sourceRef ? ` · ${x.sourceRef}` : ''}`)}{row('ap.due', x.dueDate)}{x.msme && row('ap.msmeDue', x.msmeDue)}{x.description && row('ap.for', x.description)}
        {row('ap.amount', money(x.gross))}{row('ap.gst', money(x.gst))}
        {row('ap.tds', x.tdsSection ? `${money(x.tds)} · ${t('ap.tdsLine', { section: x.tdsSection, act: x.tdsAct ?? '', rate: x.tdsRate, base: money(x.tdsBase) })} · ${t(`ap.tdsBasis.${x.tdsBasis}`)}` : t('ap.noTds'))}
        {x.tdsCertificate && row('ap.certificate', `${x.tdsCertificate}${x.tdsPaymentCode ? ` · ${t('ap.paymentCode')} ${x.tdsPaymentCode}` : ''}${x.ldcNo ? ` · LDC ${x.ldcNo}` : ''}`)}
        {row('ap.net', money(x.netPayable))}{row('ap.adjusted', money(x.adjusted))}{row('ap.paid', money(x.paid))}
        {x.journalId && row('jn.voucher', <Link to={`/finance/journals?id=${x.journalId}`}>{t('common.open')}</Link>)}
      </tbody></table></div>
      <div className="mdm-panel" data-testid="ap-holds"><h2>{t('ap.holds')}</h2>{x.holds.length ? <ul>{x.holds.map((h, i) => <li key={i}><strong>{h.code}</strong> · {h.reason}</li>)}</ul> : <p className="muted">{t('ap.noHolds')}</p>}
        {c.hold && <div className="actions-row no-print">{x.holds.some((h) => h.code === 'BILL') ? <button type="button" className="btn" style={big} disabled={busy} onClick={() => hold(false)} data-testid="ap-release">{t('ap.release')}</button> : <button type="button" className="btn" style={big} disabled={busy} onClick={() => hold(true)} data-testid="ap-hold">{t('ap.hold')}</button>}</div>}</div>
      {c.adjust && x.advances?.length > 0 && <form className="mdm-panel form-grid no-print" data-testid="ap-advance" onSubmit={(e) => { e.preventDefault(); run(() => ap.billAct(x.id, 'adjust-advance', { advanceId: Number(adv.advanceId), amount: adv.amount })); }}>
        <h2>{t('ap.advance')}</h2>
        <Field label={t('ap.advanceSel')} name="advanceId" error={error?.fields?.advanceId}><select value={adv.advanceId} onChange={(e) => setAdv({ ...adv, advanceId: e.target.value })} style={big}><option value="">—</option>{x.advances.map((a) => <option key={a.id} value={a.id}>{a.docNo} · {money(a.available)}</option>)}</select></Field>
        <Field label={t('ap.amount')} name="amount" error={error?.fields?.amount}><input inputMode="decimal" value={adv.amount} onChange={(e) => setAdv({ ...adv, amount: e.target.value })} style={big} /></Field>
        <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy || !adv.advanceId}>{t('ap.adjust')}</button></div></form>}
      {x.payments?.length > 0 && <div className="table-scroll" data-testid="ap-bill-payments"><table className="data-table"><caption>{t('pm.payments')}</caption><tbody>
        {x.payments.map((p) => <tr key={p.id}><td><Link to={`/finance/payments?id=${p.id}`}>{p.docNo}</Link></td><td>{p.mode}{p.utr ? ` · UTR ${p.utr}` : p.chequeNo ? ` · ${t('pm.cheque')} ${p.chequeNo}` : ''}</td><td>{p.paidOn ?? p.releasedOn}</td><td>{t(`pm.ps.${p.status}`)}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody></table></div>}
      {(x.adjustments?.length > 0 || x.debitNotes?.length > 0) && <div className="table-scroll"><table className="data-table"><caption>{t('ap.adjustments')}</caption><tbody>
        {x.adjustments.map((a) => <tr key={`a${a.id}`}><td>{a.kind === 'ADVANCE' ? t('py.e.ADVANCE') : t('py.e.DEBIT_NOTE')}</td><td>{a.on}</td><td className="num">{money(a.amount)}</td></tr>)}
        {x.debitNotes.map((n) => <tr key={`n${n.id}`}><td><Link to={`/finance/debit-notes?id=${n.id}`}>{n.docNo}</Link></td><td>{t(`dn.r.${n.reason}`)}</td><td className="num">{money(n.total)}</td></tr>)}</tbody></table></div>}
      <div className="actions-row no-print">
        {c.edit && <span className="muted">{t('jn.edit')}</span>}
        {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => ap.billAct(x.id, 'submit'), t('jn.submitted'))} data-testid="ap-submit">{t('act.submit')}</button>}
        {c.withdraw && <button type="button" className="btn" disabled={busy} onClick={() => why('withdraw')}>{t('act.withdraw')}</button>}
        {c.cancel && <button type="button" className="btn" disabled={busy} onClick={() => why('cancel')}>{t('act.cancel')}</button>}
        {c.delete && <button type="button" className="btn" disabled={busy} onClick={() => run(async () => { await ap.removeBill(x.id); navigateTo('/finance/ap-bills'); })}>{t('jn.delete')}</button>}
        {c.print && <button type="button" className="btn" onClick={() => gl.file(`/bills/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => globalThis.alert?.(t('act.exportFailed')))}>{t('act.print')}</button>}
      </div>
      <Decide x={x} run={run} busy={busy} setError={setError} />
    </div>
  );
}

export function ApBillsPage() {
  const t = useT('fin'); usePageTitle(t('ap.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="ap-h"><Bill id={id} /></section>;
  if (sp.get('new')) return <section aria-labelledby="apn-h"><PageHeader id="apn-h" title={t('ap.new')} subtitle={t('ap.newIntro')} meta={<Link to="/finance/ap-bills">{t('ap.title')}</Link>} /><DirectForm /></section>;
  return (
    <section aria-labelledby="aps-h" data-testid="ap-bills"><PageHeader id="aps-h" title={t('ap.title')} subtitle={t('ap.intro')} meta={<><Link to="/finance/debit-notes">{t('dn.title')}</Link> · <Link to="/finance/payables">{t('py.title')}</Link></>} />
      <ListReport listCode="fin.ap_bills" endpoint="/fin/bills" title={t('ap.title')} session={session.data} rowHref={(r) => `/finance/ap-bills?id=${r.id}`} onOpen={(r) => navigateTo(`/finance/ap-bills?id=${r.id}`)} cardFields={['docNo', 'payee', 'dueDate', 'outstanding', 'hold', 'status']} statusKey="status" dateKey="dueDate"
        newAction={{ label: t('ap.new'), permission: 'fin.bill.create', onClick: () => navigateTo('/finance/ap-bills?new=1') }} empty={{ title: t('ap.emptyTitle'), text: t('ap.emptyBody') }} />
    </section>
  );
}

// ---- debit notes ----
function NoteForm() {
  const t = useT('fin'); const partners = useQuery({ queryKey: ['gl', 'ap-partners'], queryFn: ap.partners, retry: false });
  const [f, setF] = useState({ kind: 'DEBIT', partnerId: '', billId: '', reason: 'RATE_DIFFERENCE', noteDate: today(), vendorNoteNo: '', description: '', amount: '', gst: '' }); const { error, busy, run } = useGlRunner();
  if (partners.error?.status === 403) return <NoPermission what={t('dn.new')} permission="fin.debit_note.create" />; if (partners.isPending) return <Skeleton label={t('dn.new')} rows={4} />;
  const fe = error?.fields ?? {}; const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="mdm-panel" data-testid="ap-note-form" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => ap.createNote({ kind: f.kind, partnerId: Number(f.partnerId), billId: f.billId ? Number(f.billId) : null, reason: f.reason, noteDate: f.noteDate, vendorNoteNo: f.vendorNoteNo || null, description: f.description, amount: f.amount || '0', gst: f.gst || '0' }), t('jn.saved')); if (r) navigateTo(`/finance/debit-notes?id=${r.id}`); }}>
      <GlError error={error} />
      <div className="form-grid">
        <Field label={t('dn.kind')} name="kind" error={fe.kind}><select value={f.kind} onChange={set('kind')} style={big}>{['DEBIT', 'VENDOR_CREDIT'].map((k) => <option key={k} value={k}>{t(`dn.kind.${k}`)}</option>)}</select></Field>
        <Field label={t('ap.vendor')} name="partnerId" error={fe.partnerId}><select value={f.partnerId} onChange={set('partnerId')} style={big} data-testid="dn-partner"><option value="">—</option>{partners.data.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
        <Field label={t('dn.bill')} name="billId" error={fe.billId}><input inputMode="numeric" value={f.billId} onChange={set('billId')} style={big} /></Field>
        <Field label={t('dn.reason')} name="reason" error={fe.reason}><select value={f.reason} onChange={set('reason')} style={big}>{['RTV', 'RATE_DIFFERENCE', 'BACK_CHARGE', 'PENALTY', 'SHORT_SUPPLY', 'OTHER'].map((k) => <option key={k} value={k}>{t(`dn.r.${k}`)}</option>)}</select></Field>
        <Field label={t('dn.date')} name="noteDate" error={fe.noteDate}><input type="date" value={f.noteDate} onChange={set('noteDate')} style={big} /></Field>
        <Field label={t('dn.vendorNo')} name="vendorNoteNo" error={fe.vendorNoteNo}><input value={f.vendorNoteNo} onChange={set('vendorNoteNo')} style={big} maxLength={60} /></Field>
        <Field label={t('ap.for')} name="description" error={fe.description}><input value={f.description} onChange={set('description')} style={big} maxLength={300} data-testid="dn-desc" /></Field>
        <Field label={t('ap.amount')} name="amount" error={fe.amount}><input inputMode="decimal" value={f.amount} onChange={set('amount')} style={big} data-testid="dn-amount" /></Field>
        <Field label={t('ap.gst')} name="gst" error={fe.gst}><input inputMode="decimal" value={f.gst} onChange={set('gst')} style={big} /></Field>
      </div>
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy} data-testid="dn-save">{t('jn.saveDraft')}</button></div>
    </form>
  );
}
function Note({ id }) {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'ap-note', id], queryFn: () => ap.note(id), retry: false }); const { error, setError, note, busy, run } = useGlRunner(); usePageTitle(t('dn.title'));
  const g = guardOf(q, t('dn.title'), 'fin.debit_note.view'); if (g) return g; const x = q.data; const c = x.can ?? {};
  const why = (action) => { const r = globalThis.prompt(t('act.why')); if (r) run(() => ap.noteAct(x.id, action, { reason: r })); };
  return (
    <div data-testid="ap-note" data-status={x.status}>
      <PageHeader id="dn-h" title={<>{x.docNo} <StatusBadge status={JN_TONE[x.status]} label={t(`st.${x.status}`)} /></>} subtitle={`${t(`dn.kind.${x.kind}`)} · ${x.partner}`} meta={<><Link to="/finance/debit-notes">{t('dn.title')}</Link> · {t(`dn.r.${x.reason}`)} · {x.noteDate}</>} />
      <KpiRow label={t('dn.title')}><KpiTile label={t('ap.amount')} value={money(x.amount)} amount={x.amount} kind="money" /><KpiTile label={t('ap.gst')} value={money(x.gst)} amount={x.gst} kind="money" /><KpiTile label={t('ap.total')} value={money(x.total)} amount={x.total} kind="money" /></KpiRow>
      <p>{x.description}{x.billId ? <> · <Link to={`/finance/ap-bills?id=${x.billId}`}>{t('dn.bill')}</Link></> : null}{x.journalId ? <> · <Link to={`/finance/journals?id=${x.journalId}`}>{t('jn.voucher')}</Link></> : null}</p>
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="actions-row no-print">
        {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => ap.noteAct(x.id, 'submit'), t('jn.submitted'))} data-testid="dn-submit">{t('act.submit')}</button>}
        {c.withdraw && <button type="button" className="btn" disabled={busy} onClick={() => why('withdraw')}>{t('act.withdraw')}</button>}
        {c.cancel && <button type="button" className="btn" disabled={busy} onClick={() => why('cancel')}>{t('act.cancel')}</button>}
      </div>
      <Decide x={x} run={run} busy={busy} setError={setError} />
    </div>
  );
}
export function DebitNotesPage() {
  const t = useT('fin'); usePageTitle(t('dn.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="dn-h"><Note id={id} /></section>;
  if (sp.get('new')) return <section aria-labelledby="dnn-h"><PageHeader id="dnn-h" title={t('dn.new')} meta={<Link to="/finance/debit-notes">{t('dn.title')}</Link>} /><NoteForm /></section>;
  return (
    <section aria-labelledby="dns-h" data-testid="ap-notes"><PageHeader id="dns-h" title={t('dn.title')} subtitle={t('dn.intro')} meta={<Link to="/finance/ap-bills">{t('ap.title')}</Link>} />
      <ListReport listCode="fin.debit_notes" endpoint="/fin/debit-notes" exportEndpoint="/ui/lists/fin.debit_notes/export" title={t('dn.title')} session={session.data} rowHref={(r) => `/finance/debit-notes?id=${r.id}`} onOpen={(r) => navigateTo(`/finance/debit-notes?id=${r.id}`)} cardFields={['docNo', 'partner', 'reason', 'total', 'status']} statusKey="status"
        newAction={{ label: t('dn.new'), permission: 'fin.debit_note.create', onClick: () => navigateTo('/finance/debit-notes?new=1') }} empty={{ title: t('dn.emptyTitle'), text: t('dn.emptyBody') }} />
    </section>
  );
}

// ---- the vendor ledger and the payables reports ----
function VendorLedger({ session }) {
  const t = useT('fin'); const sp = useSearch(); const partners = useQuery({ queryKey: ['gl', 'ap-partners'], queryFn: ap.partners, retry: false }); const [pid, setPid] = useState(sp.get('partnerId') ?? '');
  const q = useQuery({ queryKey: ['gl', 'vledger', pid], queryFn: () => ap.ledger({ partnerId: pid }), enabled: Boolean(pid), retry: false });
  if (partners.isPending) return <Skeleton label={t('py.tab.ledger')} rows={4} />;
  const x = q.data;
  return (
    <div data-testid="ap-vledger">
      <div className="form-grid"><Field label={t('ap.vendor')} name="partnerId" error={null}><select value={pid} onChange={(e) => setPid(e.target.value)} style={big} data-testid="ap-ledger-partner"><option value="">—</option>{(partners.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field></div>
      {!pid ? <EmptyState title={t('py.tab.ledger')} message={t('py.pick')} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : !x ? <Skeleton label={t('py.tab.ledger')} rows={4} /> : <>
        <KpiRow label={t('py.tab.ledger')}><KpiTile label={t('led.opening')} value={money(x.opening)} amount={x.opening} kind="money" /><KpiTile label={t('py.balance')} value={money(x.closing)} amount={x.closing} kind="money" valueTestid="ap-ledger-closing" /></KpiRow>
        {can(session, 'fin.bill.export') && <div className="actions-row"><button type="button" className="btn" onClick={() => gl.file(`/payables/statement?partnerId=${pid}`, `statement-${x.partner.code}.pdf`).catch(() => globalThis.alert?.(t('act.exportFailed')))} data-testid="ap-statement">{t('py.statement')}</button><button type="button" className="btn" onClick={() => gl.file(`/payables/confirmation?partnerId=${pid}`, `balance-confirmation-${x.partner.code}.pdf`).catch(() => globalThis.alert?.(t('act.exportFailed')))}>{t('py.confirm')}</button></div>}
        <div className="table-scroll"><table className="data-table" aria-label={t('py.tab.ledger')}><thead><tr><th scope="col">{t('jn.date')}</th><th scope="col">{t('py.entry')}</th><th scope="col">{t('jn.voucher')}</th><th scope="col" className="num">{t('jn.debit')}</th><th scope="col" className="num">{t('jn.credit')}</th><th scope="col" className="num">{t('led.balance')}</th></tr></thead>
          <tbody>{x.rows.map((r, i) => <tr key={i} data-testid="ap-ledger-row"><td>{r.d}</td><td>{t(`py.e.${r.kind}`)}</td><td>{r.link ? <Link to={r.link}>{r.ref}</Link> : r.ref}{r.theirRef ? ` · ${r.theirRef}` : ''}</td><td className="num">{r.debit ? money(r.debit) : ''}</td><td className="num">{r.credit ? money(r.credit) : ''}</td><td className="num">{money(r.balance)}</td></tr>)}</tbody></table></div>
        </>}
    </div>
  );
}
function Ageing() {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'ageing'], queryFn: () => ap.ageing(), retry: false }); const g = guardOf(q, t('py.tab.ageing'), 'fin.bill.view'); if (g) return g; const x = q.data;
  const chart = { categories: [t('py.b0'), t('py.b31'), t('py.b61'), t('py.b91')], series: [{ name: t('ap.outstanding'), values: [x.totals.b0, x.totals.b31, x.totals.b61, x.totals.b91].map((v) => Math.round(v)) }], unit: '' };
  return (
    <div data-testid="ap-ageing">{x.rows.length > 0 && <div className="mdm-panel"><Chart type="bar" data={chart} title={t('py.tab.ageing')} exportName={`ageing-${x.asOf}`} tableSwitch /></div>}
      {x.rows.length === 0 ? <EmptyState title={t('py.tab.ageing')} message={t('ap.emptyBody')} /> : <div className="table-scroll"><table className="data-table" aria-label={t('py.tab.ageing')}><thead><tr><th scope="col">{t('ap.payee')}</th><th scope="col" className="num">{t('py.b0')}</th><th scope="col" className="num">{t('py.b31')}</th><th scope="col" className="num">{t('py.b61')}</th><th scope="col" className="num">{t('py.b91')}</th><th scope="col" className="num">{t('tb.total')}</th><th scope="col" className="num">{t('py.overdue')}</th></tr></thead>
        <tbody>{x.rows.map((r, i) => <tr key={i}><td>{r.partnerId ? <Link to={`/finance/payables?tab=ledger&partnerId=${r.partnerId}`}>{r.payee}</Link> : r.payee}</td><td className="num">{money(r.b0)}</td><td className="num">{money(r.b31)}</td><td className="num">{money(r.b61)}</td><td className="num">{money(r.b91)}</td><td className="num"><strong>{money(r.total)}</strong></td><td className="num">{money(r.overdue)}</td></tr>)}</tbody>
        <tfoot><tr><th scope="row">{t('tb.total')}</th><td className="num">{money(x.totals.b0)}</td><td className="num">{money(x.totals.b31)}</td><td className="num">{money(x.totals.b61)}</td><td className="num">{money(x.totals.b91)}</td><td className="num"><strong>{money(x.totals.total)}</strong></td><td /></tr></tfoot></table></div>}
    </div>
  );
}
function Msme() {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'msme'], queryFn: () => ap.msme(), retry: false }); const g = guardOf(q, t('py.tab.msme'), 'fin.bill.view'); if (g) return g; const x = q.data;
  const tone = { OK: 'APPROVED', DUE_SOON: 'RETURNED', OVERDUE: 'REJECTED' };
  return (
    <div data-testid="ap-msme"><KpiRow label={t('py.tab.msme')}><KpiTile label={t('py.state.OVERDUE')} value={money(x.overdue)} amount={x.overdue} kind="money" tone={x.overdue ? 'danger' : 'neutral'} /><KpiTile label={t('py.state.DUE_SOON')} value={money(x.dueSoon)} amount={x.dueSoon} kind="money" /></KpiRow>
      {x.rows.length === 0 ? <EmptyState title={t('py.tab.msme')} message={t('ap.emptyBody')} /> : <div className="table-scroll"><table className="data-table" aria-label={t('py.tab.msme')}><thead><tr><th scope="col">{t('jn.voucher')}</th><th scope="col">{t('ap.payee')}</th><th scope="col">{t('ap.msmeDue')}</th><th scope="col" className="num">{t('py.daysLeft')}</th><th scope="col" className="num">{t('ap.outstanding')}</th><th scope="col">{t('jn.kind')}</th></tr></thead>
        <tbody>{x.rows.map((r) => <tr key={r.id}><td><Link to={`/finance/ap-bills?id=${r.id}`}>{r.docNo}</Link></td><td>{r.payee}</td><td>{r.msmeDue}</td><td className="num">{r.daysLeft}</td><td className="num">{money(r.outstanding)}</td><td><StatusBadge status={tone[r.state]} label={t(`py.state.${r.state}`)} /></td></tr>)}</tbody></table></div>}
    </div>
  );
}
function Tds() {
  const t = useT('fin'); const [f, setF] = useState({ from: '2026-04-01', to: today() }); const q = useQuery({ queryKey: ['gl', 'tds-rep', f], queryFn: () => ap.tds(f), retry: false, placeholderData: (p) => p }); const g = guardOf(q, t('py.tab.tds'), 'fin.bill.view'); if (g) return g; const x = q.data;
  return (
    <div data-testid="ap-tds">
      <div className="form-grid"><Field label={t('led.from')} name="from" error={null}><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} style={big} /></Field><Field label={t('led.to')} name="to" error={null}><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} style={big} /></Field></div>
      <KpiRow label={t('py.tab.tds')}><KpiTile label={t('ap.tds')} value={money(x.total)} amount={x.total} kind="money" valueTestid="ap-tds-total" /></KpiRow>
      <div className="actions-row"><button type="button" className="btn" onClick={() => gl.file(`/payables/tds/export?from=${f.from}&to=${f.to}`, `tds-${f.to}.csv`).catch(() => globalThis.alert?.(t('act.exportFailed')))}>{t('led.export')}</button></div>
      <div className="table-scroll"><table className="data-table" aria-label={t('py.bySection')}><thead><tr><th scope="col">{t('py.section')}</th><th scope="col">{t('ap.tdsNature')}</th><th scope="col" className="num">{t('py.base')}</th><th scope="col" className="num">{t('ap.tds')}</th></tr></thead><tbody>{x.bySection.map((s) => <tr key={`${s.section}${s.nature}`}><td>{s.section} ({s.act})</td><td>{t(`ap.n.${s.nature}`)}</td><td className="num">{money(s.base)}</td><td className="num">{money(s.tds)}</td></tr>)}</tbody></table></div>
      <div className="table-scroll"><table className="data-table" aria-label={t('py.tab.tds')}><thead><tr><th scope="col">{t('jn.voucher')}</th><th scope="col">{t('py.quarter')}</th><th scope="col">{t('ap.payee')}</th><th scope="col">{t('py.pan')}</th><th scope="col">{t('py.section')}</th><th scope="col" className="num">{t('py.base')}</th><th scope="col" className="num">{t('ap.tds')}</th><th scope="col">{t('ap.certificate')}</th></tr></thead>
        <tbody>{x.rows.map((r) => <tr key={r.id}><td><Link to={`/finance/ap-bills?id=${r.id}`}>{r.docNo}</Link></td><td>{r.quarter}</td><td>{r.payee}</td><td>{r.pan}</td><td>{r.section}</td><td className="num">{money(r.base)}</td><td className="num">{money(r.tds)}</td><td>{r.certificate ?? ''}{r.paymentCode ? ` · ${r.paymentCode}` : ''}</td></tr>)}</tbody></table></div>
    </div>
  );
}
export function PayablesPage() {
  const t = useT('fin'); usePageTitle(t('py.title')); const sp = useSearch(); const session = useSession(); const [tab, setTab] = useState(sp.get('tab') ?? 'ledger');
  if (session.data && !can(session.data, 'fin.bill.view')) return <NoPermission what={t('py.title')} permission="fin.bill.view" />;
  return (
    <section aria-labelledby="py-h" data-testid="ap-payables"><PageHeader id="py-h" title={t('py.title')} subtitle={t('py.intro')} meta={<Link to="/finance/ap-bills">{t('ap.title')}</Link>} />
      <div className="actions-row" role="tablist">{['ledger', 'ageing', 'msme', 'tds'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => setTab(k)} data-testid={`ap-tab-${k}`}>{t(`py.tab.${k}`)}</button>)}</div>
      {tab === 'ledger' && <VendorLedger session={session.data} />}{tab === 'ageing' && <Ageing />}{tab === 'msme' && <Msme />}{tab === 'tds' && <Tds />}
    </section>
  );
}

export { money };
