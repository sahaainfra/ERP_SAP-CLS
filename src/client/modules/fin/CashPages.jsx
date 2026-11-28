import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import Chart from '../../platform/charts/Chart.jsx';
import { authHeaders } from '../../platform/excel/api.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { enqueue, useOffline } from '../../platform/offline/engine.js';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { JN_TONE, cb, gl, money, pm } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';

// Part 23.06: the pages of cash and bank — the bank reconciliation (import the statement, match what is left, the BRS and its sign-off), the site imprest on the phone
// (a voucher with the photo of its bill, kept while offline and sent when the phone is back; replenishments; the cash count) and the daily cash and bank position
// (with the contra entries).
const big = { minHeight: 'var(--erp-target-large)', fontSize: '1rem' };
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const can = (session, p) => Boolean(session?.permissions?.includes(p));
const transport = browserTransport(authHeaders);
const guardOf = (q, what, permission) => (q.error?.status === 403 || q.error?.status === 404 ? <NoPermission what={what} permission={permission} /> : q.isPending ? <Skeleton label={what} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : null);
const Tabs = ({ tabs, tab, setTab, label, prefix }) => (
  <div className="actions-row" role="tablist" aria-label={label}>{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} style={{ minHeight: 'var(--erp-target-min)' }} onClick={() => setTab(k)} data-testid={`${prefix}-${k}`}>{l}</button>)}</div>
);
function Decide({ x, run, busy, setError, ns = 'fin' }) {
  const t = useT(ns); const [comment, setComment] = useState('');
  if (!x?.approve || !x.taskId) return null;
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('act.sayWhy') }); return; } run(() => gl.decide(x.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div className="mdm-panel no-print" data-testid="cb-decide"><h2>{t('act.decision')}</h2>
      <label>{t('act.comment')}<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></label>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => decide('approve')} data-testid="cb-approve">{t('act.approve')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('return')}>{t('act.return')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('reject')}>{t('act.reject')}</button></div>
    </div>
  );
}

// ---- the bank reconciliation: import, match, BRS ----
function ImportStep({ bankId, onDone }) {
  const t = useT('fin'); const [file, setFile] = useState(null); const { error, note, busy, run } = useGlRunner(); const [res, setRes] = useState(null);
  const go = async () => { if (!file) return; const content = await file.text(); const r = await run(() => cb.importStatement({ bankAccountId: Number(bankId), fileName: file.name, content }), t('cb.imported')); if (r) { setRes(r); onDone?.(); } };
  return (
    <div className="mdm-panel" data-testid="cb-import"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <p className="muted">{t('cb.importIntro')}</p>
      <label className="btn" style={{ ...big, display: 'inline-flex', alignItems: 'center' }}>{file ? file.name : t('cb.chooseFile')}<input type="file" accept=".csv,.txt,.sta,.mt940,text/csv,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} data-testid="cb-file" /></label>
      {res && <KpiRow label={t('cb.result')}><KpiTile label={t('cb.linesRead')} value={String(res.lines)} /><KpiTile label={t('cb.matchedAuto')} value={String(res.matched)} valueTestid="cb-matched" /><KpiTile label={t('cb.toMatch')} value={String(res.unmatched)} /><KpiTile label={t('cb.duplicates')} value={String(res.duplicates)} /></KpiRow>}
      <div className="ff-actionbar"><button type="button" className="btn btn-primary" style={big} disabled={busy || !file || !bankId} onClick={go} data-testid="cb-import-go">{t('cb.import')}</button></div>
    </div>
  );
}
function MatchStep({ bankId }) {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'cb-lines', bankId], queryFn: () => cb.lines({ bankAccountId: bankId, status: 'UNMATCHED' }), enabled: Boolean(bankId), retry: false }); const opt = useQuery({ queryKey: ['gl', 'options'], queryFn: gl.options, retry: false });
  const { error, note, busy, run } = useGlRunner(); const [open, setOpen] = useState(null); const [cand, setCand] = useState([]); const [post, setPost] = useState({ accountId: '', narration: '' });
  const g = guardOf(q, t('cb.match'), 'fin.bank_statement.view'); if (g) return g; const x = q.data;
  const show = async (l) => { setOpen(l.id); setCand(await cb.candidates(l.id).catch(() => [])); setPost({ accountId: '', narration: l.debit ? t('cb.chargesNarration') : t('cb.interestNarration') }); };
  return (
    <div data-testid="cb-match"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <KpiRow label={t('cb.match')}><KpiTile label={t('cb.autoRate')} value={x.autoRate == null ? '—' : `${x.autoRate}%`} valueTestid="cb-auto-rate" /><KpiTile label={t('cb.reconciled')} value={x.reconciledRate == null ? '—' : `${x.reconciledRate}%`} /><KpiTile label={t('cb.toMatch')} value={String(x.counts.UNMATCHED ?? 0)} /></KpiRow>
      {x.rows.length === 0 ? <EmptyState title={t('cb.allMatched')} message={t('cb.allMatchedBody')} /> : <ul className="lp-list" aria-label={t('cb.match')}>{x.rows.map((l) => (
        <li key={l.id} className="mdm-panel" data-testid="cb-line" style={{ display: 'grid', gap: 8, padding: 12, margin: '8px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{l.date}</strong><span className="num">{l.debit ? `− ${money(l.debit)}` : `+ ${money(l.credit)}`}</span></div>
          <span>{l.description}{l.ref ? ` · ${l.ref}` : ''}{l.chequeNo ? ` · ${t('pm.cheque')} ${l.chequeNo}` : ''}</span>
          {open !== l.id ? <div className="actions-row"><button type="button" className="btn btn-primary" style={big} onClick={() => show(l)} data-testid={`cb-open-${l.id}`}>{t('cb.settle')}</button></div> : <>
            {cand.length > 0 && <ul className="lp-list" aria-label={t('cb.candidates')}>{cand.map((c) => <li key={`${c.entity}${c.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ flex: '1 1 12rem' }}>{c.date} · {c.label} · {money(c.amount)}</span><button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} disabled={busy} onClick={() => run(() => cb.lineAct(l.id, 'match', { entity: c.entity, id: c.id }), t('cb.matched')).then(() => setOpen(null))}>{t('cb.thisOne')}</button></li>)}</ul>}
            <div className="form-grid">
              <Field label={t('cb.postTo')} name="accountId" error={error?.fields?.accountId}><select value={post.accountId} onChange={(e) => setPost({ ...post, accountId: e.target.value })} style={big}><option value="">—</option>{(opt.data?.accounts ?? []).filter((a) => !a.control && /^[45]/.test(a.code)).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></Field>
              <Field label={t('jn.narration')} name="narration" error={error?.fields?.narration}><input value={post.narration} onChange={(e) => setPost({ ...post, narration: e.target.value })} style={big} maxLength={200} /></Field>
            </div>
            <div className="actions-row"><button type="button" className="btn" style={big} disabled={busy || !post.accountId} onClick={() => run(() => cb.lineAct(l.id, 'post', { accountId: Number(post.accountId), narration: post.narration }), t('cb.posted')).then((r) => { if (r) setOpen(null); })}>{t('cb.post')}</button>
              <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = globalThis.prompt(t('cb.asideWhy')); if (r) run(() => cb.lineAct(l.id, 'ignore', { reason: r }), t('cb.setAside')).then(() => setOpen(null)); }}>{t('cb.aside')}</button></div></>}
        </li>))}</ul>}
    </div>
  );
}
function BrsStep({ bankId }) {
  const t = useT('fin'); const session = useSession(); const [asOf, setAsOf] = useState(today()); const q = useQuery({ queryKey: ['gl', 'cb-brs', bankId, asOf], queryFn: () => cb.brs({ bankAccountId: bankId, asOf }), enabled: Boolean(bankId), retry: false }); const { error, note, busy, run } = useGlRunner();
  const g = guardOf(q, t('cb.brs'), 'fin.brs.view'); if (g) return g; const x = q.data;
  const row = (k, v, tid) => <tr><th scope="row">{t(k)}</th><td className="num" data-testid={tid}>{v}</td></tr>;
  return (
    <div data-testid="cb-brs"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="form-grid"><Field label={t('ar.asOf')} name="asOf" error={null}><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={big} /></Field></div>
      <div className="table-scroll"><table className="data-table" aria-label={t('cb.brs')}><tbody>
        {row('cb.bookBalance', money(x.book))}{row('cb.addUnpresented', money(x.unpresented.total))}{row('cb.lessUncredited', money(x.uncredited.total))}{row('cb.lessBankDebits', money(x.bankOnly.debit))}{row('cb.addBankCredits', money(x.bankOnly.credit))}{row('cb.computed', money(x.computed))}{row('cb.statementBalance', x.statement == null ? '—' : money(x.statement))}{row('cb.difference', x.difference == null ? '—' : money(x.difference), 'cb-diff')}
      </tbody></table></div>
      {x.balanced ? <StatusBadge status="APPROVED" label={t('cb.balances')} /> : <StatusBadge status="RETURNED" label={t('cb.notBalanced')} />}
      {x.signed ? <p data-testid="cb-signed">{t('cb.signedBy', { who: x.signed.by, at: x.signed.at.slice(0, 16).replace('T', ' ') })}</p> : can(session.data, 'fin.brs.sign') && <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !x.can.sign} onClick={() => run(() => cb.signBrs({ bankAccountId: Number(bankId), asOf }), t('cb.signed'))} data-testid="cb-sign">{t('cb.sign')}</button></div>}
      {x.unpresented.rows.length > 0 && <><h2>{t('cb.unpresented')}</h2><ul className="lp-list">{x.unpresented.rows.map((r) => <li key={`${r.entity}${r.id}`}>{r.date} · {r.label} · {money(r.amount)}</li>)}</ul></>}
      {x.uncredited.rows.length > 0 && <><h2>{t('cb.uncredited')}</h2><ul className="lp-list">{x.uncredited.rows.map((r) => <li key={`${r.entity}${r.id}`}>{r.date} · {r.label} · {money(r.amount)}</li>)}</ul></>}
    </div>
  );
}
export function BankReconciliationPage() {
  const t = useT('fin'); usePageTitle(t('cb.recon')); const banks = useQuery({ queryKey: ['gl', 'pm-banks'], queryFn: pm.banks, retry: false }); const [bid, setBid] = useState(''); const [step, setStep] = useState('import');
  const g = guardOf(banks, t('cb.recon'), 'fin.bank.view'); const chosen = bid || String(banks.data?.[0]?.id ?? '');
  return (
    <section aria-labelledby="cbr-h" data-testid="cb-recon"><PageHeader id="cbr-h" title={t('cb.recon')} subtitle={t('cb.reconIntro')} meta={<Link to="/finance/cash-position">{t('cb.position')}</Link>} />
      {g ?? (banks.data.length === 0 ? <EmptyState title={t('pm.noBank')} message={t('pm.noBankBody')} /> : <>
        <div className="form-grid"><Field label={t('pm.bank')} name="bank" error={null}><select value={chosen} onChange={(e) => setBid(e.target.value)} style={big} data-testid="cb-bank">{banks.data.map((b) => <option key={b.id} value={b.id}>{b.name} {b.account}</option>)}</select></Field></div>
        <Tabs tabs={[['import', `1 · ${t('cb.import')}`], ['match', `2 · ${t('cb.match')}`], ['brs', `3 · ${t('cb.brs')}`]]} tab={step} setTab={setStep} label={t('cb.recon')} prefix="cb-step" />
        {step === 'import' && <ImportStep bankId={chosen} />}{step === 'match' && <MatchStep bankId={chosen} />}{step === 'brs' && <BrsStep bankId={chosen} />}
      </>)}
    </section>
  );
}

// ---- the site imprest on the phone ----
const CATS = ['MATERIAL', 'TRANSPORT', 'FOOD', 'REPAIRS', 'SITE_EXPENSE', 'TRAVEL', 'POSTAGE', 'OTHER'];
function VoucherForm({ imp, onDone }) {
  const t = useT('cash'); const off = useOffline(); const { error, note, setNote, busy, run } = useGlRunner();
  const [f, setF] = useState({ date: today(), payee: '', category: 'MATERIAL', description: '', amount: '', gst: '', expenseAccountId: '' }); const [photo, setPhoto] = useState(null);
  const heads = imp.heads ?? [];
  const fe = error?.fields ?? {}; const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const values = () => ({ imprestId: imp.id, date: f.date, payee: f.payee, category: f.category, description: f.description, amount: f.amount || '0', ...(f.gst ? { gst: f.gst } : {}), expenseAccountId: Number(f.expenseAccountId || imp.defaultHead || 0) });
  const save = async () => {
    if (off?.online === false) { const r = await run(() => enqueue({ type: 'imprest_voucher', values: values(), label: `${t('cb.voucher')}: ${f.payee} ${f.amount}`, photos: photo ? [photo] : [] })); if (r) { setNote(t('cb.queued')); setF({ ...f, payee: '', description: '', amount: '', gst: '' }); setPhoto(null); } return; }
    const r = await run(async () => { const v = await cb.createVoucher(values()); if (photo) await uploadFile(photo, { transport, entity: 'fin_imprest_vouchers', entityId: v.id, stripExif: true }); return cb.voucherAct(v.id, 'submit'); }, t('cb.voucherSent'));
    if (r) { setF({ ...f, payee: '', description: '', amount: '', gst: '' }); setPhoto(null); onDone?.(); }
  };
  return (
    <form className="mdm-panel" data-testid="cb-voucher-form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
      <h2>{t('cb.newVoucher')}</h2><GlError error={error} />{note && <p className="mdm-banner" role="status" data-testid="cb-note">{note}</p>}
      {off?.online === false && <p className="mdm-banner" role="status">{t('cb.offline')}</p>}
      <Field label={t('pm.amount')} name="amount" error={fe.amount}><input inputMode="decimal" value={f.amount} onChange={set('amount')} style={{ ...big, fontSize: '1.5rem' }} data-testid="cb-v-amount" /></Field>
      <div className="actions-row" role="group" aria-label={t('cb.category')}>{CATS.map((c) => <button key={c} type="button" className={`btn${f.category === c ? ' btn-primary' : ''}`} style={{ minHeight: 'var(--erp-target-min)' }} aria-pressed={f.category === c} onClick={() => setF({ ...f, category: c })}>{t(`cb.c.${c}`)}</button>)}</div>
      <Field label={t('cb.payee')} name="payee" error={fe.payee}><input value={f.payee} onChange={set('payee')} style={big} maxLength={100} data-testid="cb-v-payee" /></Field>
      <Field label={t('ap.for')} name="description" error={fe.description}><input value={f.description} onChange={set('description')} style={big} maxLength={300} data-testid="cb-v-desc" /></Field>
      <Field label={t('cb.head')} name="expenseAccountId" error={fe.expenseAccountId}><select value={f.expenseAccountId || String(imp.defaultHead ?? '')} onChange={set('expenseAccountId')} style={big}>{heads.length === 0 && <option value="">{t('cb.siteOverheads')}</option>}{heads.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></Field>
      <Field label={t('ap.gst')} name="gst" error={fe.gst}><input inputMode="decimal" value={f.gst} onChange={set('gst')} style={big} /></Field>
      <Field label={t('ar.date')} name="date" error={fe.date}><input type="date" value={f.date} max={today()} onChange={set('date')} style={big} /></Field>
      <label className="btn" style={{ ...big, display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-testid="cb-photo-label">{photo ? `✓ ${photo.name}` : t('cb.billPhoto')}<input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} data-testid="cb-photo" /></label>
      <div className="ff-actionbar"><span>{t('cb.inHand')} <strong>{money(imp.available)}</strong></span><button type="submit" className="btn btn-primary" style={{ ...big, flex: '1 1 100%' }} disabled={busy || !f.amount || !f.payee} data-testid="cb-v-save">{off?.online === false ? t('cb.saveOffline') : t('cb.saveSend')}</button></div>
    </form>
  );
}
function Voucher({ id }) {
  const t = useT('cash'); const q = useQuery({ queryKey: ['gl', 'cb-voucher', id], queryFn: () => cb.voucher(id), retry: false }); const { error, setError, note, busy, run } = useGlRunner(); usePageTitle(t('cb.voucher'));
  const g = guardOf(q, t('cb.voucher'), 'fin.imprest_voucher.view'); if (g) return g; const x = q.data;
  return (
    <div data-testid="cb-voucher" data-status={x.status}>
      <PageHeader id="cbv-h" title={<>{x.docNo} <StatusBadge status={JN_TONE[x.status]} label={t(`pm.st.${x.status}`)} /></>} subtitle={`${x.payee} · ${money(x.total)}`} meta={<Link to="/finance/imprest">{t('cb.imprest')}</Link>} />
      <p>{x.categoryLabel} · {x.description} · {x.date}{x.photos.length ? ` · ${t('cb.photos', { n: x.photos.length })}` : ''}</p>
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="actions-row">{x.can.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => cb.voucherAct(x.id, 'submit'), t('cb.voucherSent'))}>{t('act.submit')}</button>}{x.can.cancel && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = globalThis.prompt(t('act.why')); if (r) run(() => cb.voucherAct(x.id, 'cancel', { reason: r })); }}>{t('act.cancel')}</button>}</div>
      <Decide x={x} run={run} busy={busy} setError={setError} ns="cash" />
    </div>
  );
}
function Replenishment({ id }) {
  const t = useT('cash'); const q = useQuery({ queryKey: ['gl', 'cb-repl', id], queryFn: () => cb.replenishment(id), retry: false }); const { error, setError, note, busy, run } = useGlRunner(); usePageTitle(t('cb.replenishment'));
  const g = guardOf(q, t('cb.replenishment'), 'fin.imprest_replenishment.view'); if (g) return g; const x = q.data;
  return (
    <div data-testid="cb-repl" data-status={x.status}>
      <PageHeader id="cbp-h" title={<>{x.docNo} <StatusBadge status={JN_TONE[x.status]} label={t(`pm.st.${x.status}`)} /></>} subtitle={`${t('cb.vouchersN', { n: x.vouchers })} · ${money(x.amount)}`} meta={<Link to="/finance/imprest">{t('cb.imprest')}</Link>} />
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}<Decide x={x} run={run} busy={busy} setError={setError} ns="cash" />
    </div>
  );
}
export function ImprestPage() {
  const t = useT('cash'); usePageTitle(t('cb.imprest')); const sp = useSearch(); const session = useSession();
  const list = useQuery({ queryKey: ['gl', 'cb-imprests'], queryFn: cb.imprests, retry: false }); const banks = useQuery({ queryKey: ['gl', 'pm-banks'], queryFn: pm.banks, retry: false, enabled: can(session.data, 'fin.imprest_replenishment.create') });
  const [sel, setSel] = useState(''); const [tab, setTab] = useState('voucher'); const [den, setDen] = useState({}); const { error, note, busy, run } = useGlRunner();
  const chosen = sel || String(list.data?.find((i) => i.mine)?.id ?? list.data?.[0]?.id ?? '');
  const one = useQuery({ queryKey: ['gl', 'cb-imprest', chosen], queryFn: () => cb.imprest(chosen), enabled: Boolean(chosen), retry: false });
  const repls = useQuery({ queryKey: ['gl', 'cb-repls'], queryFn: cb.replenishments, retry: false, enabled: can(session.data, 'fin.imprest_replenishment.view') });
  if (Number(sp.get('voucher'))) return <section aria-labelledby="cbv-h"><Voucher id={Number(sp.get('voucher'))} /></section>;
  if (Number(sp.get('replenishment'))) return <section aria-labelledby="cbp-h"><Replenishment id={Number(sp.get('replenishment'))} /></section>;
  const g = guardOf(list, t('cb.imprest'), 'fin.imprest.view'); const x = one.data;
  return (
    <section aria-labelledby="cbi-h" data-testid="cb-imprest"><PageHeader id="cbi-h" title={t('cb.imprest')} subtitle={t('cb.imprestIntro')} />
      {g ?? (list.data.length === 0 ? <EmptyState title={t('cb.noImprest')} message={t('cb.noImprestBody')} /> : <>
        {list.data.length > 1 && <div className="form-grid"><Field label={t('cb.imprest')} name="imprest" error={null}><select value={chosen} onChange={(e) => setSel(e.target.value)} style={big}>{list.data.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.custodian}</option>)}</select></Field></div>}
        {!x ? <Skeleton label={t('cb.imprest')} rows={3} /> : <>
          <KpiRow label={x.name}><KpiTile label={t('cb.inHand')} value={money(x.balance)} amount={x.balance} kind="money" valueTestid="cb-balance" /><KpiTile label={t('cb.limit')} value={money(x.limit)} amount={x.limit} kind="money" /><KpiTile label={t('cb.toReplenish')} value={money(x.toReplenish)} amount={x.toReplenish} kind="money" /><KpiTile label={t('cb.pending')} value={money(x.pending)} amount={x.pending} kind="money" /></KpiRow>
          <Tabs tabs={[['voucher', t('cb.newVoucher')], ['vouchers', t('cb.vouchers')], ['repl', t('cb.replenishments')], ['count', t('cb.count')]]} tab={tab} setTab={setTab} label={t('cb.imprest')} prefix="cb-tab" />
          <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
          {tab === 'voucher' && (x.mine || can(session.data, 'fin.imprest.manage') ? <VoucherForm imp={x} onDone={() => one.refetch()} /> : <p className="muted">{t('cb.custodianOnly', { who: x.custodian })}</p>)}
          {tab === 'vouchers' && (x.vouchers.length === 0 ? <EmptyState compact title={t('cb.noVouchers')} message={t('cb.noVouchersBody')} /> : <ul className="lp-list" aria-label={t('cb.vouchers')} data-testid="cb-vouchers">{x.vouchers.map((v) => <li key={v.id} className="mdm-panel" style={{ display: 'grid', gap: 4, padding: 12, margin: '8px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><Link to={`/finance/imprest?voucher=${v.id}`}><strong>{v.docNo}</strong></Link><StatusBadge status={JN_TONE[v.status]} label={t(`pm.st.${v.status}`)} /></div><span>{v.payee} · {money(v.total)}</span><span className="muted small">{v.date} · {v.categoryLabel}{v.photos.length ? ` · ${t('cb.photos', { n: v.photos.length })}` : ''}{v.replenishmentId ? ` · ${t('cb.inReplenishment')}` : ''}</span></li>)}</ul>)}
          {tab === 'repl' && <div data-testid="cb-repls">
            {x.mine && x.vouchersToReplenish > 0 && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); const bank = new FormData(e.currentTarget).get('bank'); run(() => cb.replenish({ imprestId: x.id, bankAccountId: Number(bank) }), t('cb.replenishSent')).then(() => { one.refetch(); repls.refetch(); }); }}>
              <p>{t('cb.replenishWhat', { n: x.vouchersToReplenish, amount: money(x.toReplenish) })}</p>
              <Field label={t('cb.fromBank')} name="bank" error={null}><select name="bank" style={big}>{(banks.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name} {b.account}</option>)}</select></Field>
              <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy} data-testid="cb-replenish">{t('cb.askReplenish')}</button></div></form>}
            {(repls.data ?? []).length === 0 ? <EmptyState compact title={t('cb.noRepl')} message={t('cb.noReplBody')} /> : <ul className="lp-list">{(repls.data ?? []).map((r) => <li key={r.id} style={{ minHeight: 'var(--erp-target-min)' }}><Link to={`/finance/imprest?replenishment=${r.id}`}>{r.docNo}</Link> · {t('cb.vouchersN', { n: r.vouchers })} · {money(r.amount)} · {t(`pm.st.${r.status}`)}</li>)}</ul>}
          </div>}
          {tab === 'count' && <form className="mdm-panel" data-testid="cb-count" onSubmit={(e) => { e.preventDefault(); run(() => cb.count(x.id, { denominations: Object.fromEntries(Object.entries(den).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])) }), t('cb.counted')).then(() => one.refetch()); }}>
            <div className="form-grid">{['500', '200', '100', '50', '20', '10', '5', '2', '1'].map((dn) => <Field key={dn} label={`₹${dn} ×`} name={`d${dn}`} error={null}><input inputMode="numeric" value={den[dn] ?? ''} onChange={(e) => setDen({ ...den, [dn]: e.target.value })} style={big} /></Field>)}</div>
            <div className="ff-actionbar"><span>{t('cb.counted')} <strong>{money(Object.entries(den).reduce((s, [k, v]) => s + Number(k) * (Number(v) || 0), 0))}</strong></span><button type="submit" className="btn btn-primary" style={big} disabled={busy}>{t('cb.saveCount')}</button></div>
            {x.counts.length > 0 && <ul className="lp-list">{x.counts.map((c) => <li key={c.id}>{c.date} · {money(c.counted)} · {t('cb.diff')} {money(c.difference)} · {c.by}</li>)}</ul>}
          </form>}
        </>}
      </>)}
    </section>
  );
}

// ---- the daily cash and bank position, and contra entries ----
function ContraForm({ banks, imprests, onDone }) {
  const t = useT('fin'); const [f, setF] = useState({ kind: 'WITHDRAWAL', date: today(), fromBankId: '', toBankId: '', fromImprestId: '', toImprestId: '', amount: '', reference: '', purpose: '' }); const { error, busy, run } = useGlRunner();
  const fe = error?.fields ?? {}; const set = (k) => (e) => setF({ ...f, [k]: e.target.value }); const n = (v) => (v ? Number(v) : null);
  const bankSel = (k) => <select value={f[k]} onChange={set(k)} style={big}><option value="">—</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>;
  const impSel = (k) => <select value={f[k]} onChange={set(k)} style={big}><option value="">—</option>{imprests.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>;
  return (
    <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await cb.createContra({ kind: f.kind, date: f.date, fromBankId: n(f.fromBankId), toBankId: n(f.toBankId), fromImprestId: n(f.fromImprestId), toImprestId: n(f.toImprestId), amount: f.amount || '0', reference: f.reference || null, purpose: f.purpose }); await cb.contraAct(r.id, 'submit'); return r; }, t('jn.submitted')).then((r) => { if (r) onDone(); }); }}>
      <h2>{t('cb.newContra')}</h2><GlError error={error} />
      <div className="form-grid">
        <Field label={t('cb.kind')} name="kind" error={fe.kind}><select value={f.kind} onChange={set('kind')} style={big}>{['WITHDRAWAL', 'DEPOSIT', 'TRANSFER'].map((k) => <option key={k} value={k}>{t(`cb.k.${k}`)}</option>)}</select></Field>
        {f.kind === 'DEPOSIT' ? <Field label={t('cb.fromCash')} name="fromImprestId" error={fe.fromImprestId}>{impSel('fromImprestId')}</Field> : <Field label={t('cb.fromBankAcc')} name="fromBankId" error={fe.fromBankId}>{bankSel('fromBankId')}</Field>}
        {f.kind === 'WITHDRAWAL' ? <Field label={t('cb.toCash')} name="toImprestId" error={fe.toImprestId}>{impSel('toImprestId')}</Field> : <Field label={t('cb.toBankAcc')} name="toBankId" error={fe.toBankId}>{bankSel('toBankId')}</Field>}
        <Field label={t('pm.amount')} name="amount" error={fe.amount}><input inputMode="decimal" value={f.amount} onChange={set('amount')} style={big} /></Field>
        <Field label={t('ar.date')} name="date" error={fe.date}><input type="date" value={f.date} onChange={set('date')} style={big} /></Field>
        <Field label={t('ar.reference')} name="reference" error={fe.reference}><input value={f.reference} onChange={set('reference')} style={big} maxLength={60} /></Field>
        <Field label={t('pm.purpose')} name="purpose" error={fe.purpose}><input value={f.purpose} onChange={set('purpose')} style={big} maxLength={200} /></Field>
      </div>
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy}>{t('jn.saveSubmit')}</button></div>
    </form>
  );
}
function Contra({ id }) {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'cb-contra', id], queryFn: () => cb.contra(id), retry: false }); const { error, setError, note, busy, run } = useGlRunner(); usePageTitle(t('cb.contra'));
  const g = guardOf(q, t('cb.contra'), 'fin.contra.view'); if (g) return g; const x = q.data;
  return (<div data-testid="cb-contra" data-status={x.status}><PageHeader id="cbc-h" title={<>{x.docNo} <StatusBadge status={JN_TONE[x.status]} label={t(`pm.st.${x.status}`)} /></>} subtitle={`${x.kindLabel} · ${money(x.amount)}`} meta={<Link to="/finance/cash-position">{t('cb.position')}</Link>} /><p>{x.purpose} · {x.date}{x.reference ? ` · ${x.reference}` : ''}</p><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}<Decide x={x} run={run} busy={busy} setError={setError} /></div>);
}
export function CashPositionPage() {
  const t = useT('fin'); usePageTitle(t('cb.position')); const sp = useSearch(); const session = useSession(); const [date, setDate] = useState(today()); const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['gl', 'cb-position', date], queryFn: () => cb.position(date), retry: false }); const contras = useQuery({ queryKey: ['gl', 'cb-contras'], queryFn: cb.contras, retry: false, enabled: can(session.data, 'fin.contra.view') });
  if (Number(sp.get('contra'))) return <section aria-labelledby="cbc-h"><Contra id={Number(sp.get('contra'))} /></section>;
  const g = guardOf(q, t('cb.position'), 'fin.cash_position.view'); const x = q.data;
  const chart = x ? { categories: [...x.banks.map((b) => b.name), ...x.cash.map((c) => c.name)], series: [{ name: t('cb.balance'), values: [...x.banks.map((b) => Math.round(b.book)), ...x.cash.map((c) => Math.round(c.balance))] }], unit: '₹' } : null;
  return (
    <section aria-labelledby="cbpos-h" data-testid="cb-position"><PageHeader id="cbpos-h" title={t('cb.position')} subtitle={t('cb.positionIntro')} meta={<Link to="/finance/bank-reconciliation">{t('cb.recon')}</Link>} actions={can(session.data, 'fin.contra.create') && !adding ? <button type="button" className="btn btn-primary" style={big} onClick={() => setAdding(true)}>{t('cb.newContra')}</button> : null} />
      <div className="form-grid"><Field label={t('ar.date')} name="date" error={null}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={big} data-testid="cb-pos-date" /></Field></div>
      {adding && x && <ContraForm banks={x.banks} imprests={x.cash} onDone={() => { setAdding(false); contras.refetch(); }} />}
      {g ?? <>
        {chart && chart.categories.length > 0 && <div className="mdm-panel"><Chart type="bar" data={chart} title={t('cb.position')} exportName={`cash-position-${date}`} tableSwitch /></div>}
        <KpiRow label={t('cb.position')}><KpiTile label={t('cb.available')} value={money(x.totals.available)} amount={x.totals.available} kind="money" valueTestid="cb-available" /><KpiTile label={t('cb.inBanks')} value={money(x.totals.bank)} amount={x.totals.bank} kind="money" /><KpiTile label={t('cb.inCash')} value={money(x.totals.cash)} amount={x.totals.cash} kind="money" /><KpiTile label={t('cb.toMatch')} value={String(x.totals.unmatched)} /></KpiRow>
        {x.banks.length + x.cash.length === 0 ? <EmptyState title={t('pm.noBank')} message={t('pm.noBankBody')} /> : <ul className="lp-list" aria-label={t('cb.position')}>
          {x.banks.map((b) => <li key={`b${b.id}`} className="mdm-panel" data-testid="cb-pos-bank" style={{ display: 'grid', gap: 4, padding: 12, margin: '8px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{b.name} {b.account}</strong><span className="num">{money(b.book)}</span></div><span className="muted small">{b.kindLabel} · {t('cb.inToday')} {money(b.received)} · {t('cb.outToday')} {money(b.paid)}{b.statement ? ` · ${t('cb.bankSays', { date: b.statement.date, amount: money(b.statement.balance) })}` : ''}{b.odLimit ? ` · ${t('cb.odLimit')} ${money(b.odLimit)}` : ''}{b.unmatched ? ` · ${t('cb.unmatchedN', { n: b.unmatched })}` : ''}</span></li>)}
          {x.cash.map((c) => <li key={`c${c.id}`} className="mdm-panel" data-testid="cb-pos-cash" style={{ display: 'grid', gap: 4, padding: 12, margin: '8px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{c.name}</strong><span className="num">{money(c.balance)}</span></div><span className="muted small">{c.custodian} · {t('cb.limit')} {money(c.limit)}{c.lastCount ? ` · ${t('cb.lastCount', { date: c.lastCount.date })}` : ''}</span></li>)}
        </ul>}
        <div className="ff-actionbar" data-testid="cb-pos-totals"><span>{t('cb.inBanks')} <strong>{money(x.totals.bank)}</strong></span><span>{t('cb.inCash')} <strong>{money(x.totals.cash)}</strong></span></div>
        {(contras.data ?? []).length > 0 && <><h2>{t('cb.contras')}</h2><ul className="lp-list">{contras.data.map((k) => <li key={k.id} style={{ minHeight: 'var(--erp-target-min)' }}><Link to={`/finance/cash-position?contra=${k.id}`}>{k.docNo}</Link> · {k.kindLabel} · {money(k.amount)} · {t(`pm.st.${k.status}`)}</li>)}</ul></>}
      </>}
    </section>
  );
}
