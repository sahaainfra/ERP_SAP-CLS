import { useMemo, useState } from 'react';
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
import { JN_TONE, ap, gl, money, pm } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';

// Part 23.04: the pages of payments — the payment proposal (a three-step form: the bank and the mode, the bills and advances to pay, the review), the payment run
// (the proposal as an object page: its lines, the approval with its evidence, the release with the bank file or the cheques, the bank's confirmation), the payments
// with the cheque register, and the company's bank accounts.
const big = { minHeight: 48, fontSize: '1rem' };
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const can = (session, p) => Boolean(session?.permissions?.includes(p));
const RUN_TONE = { NONE: 'DRAFT', RELEASED: 'IN_REVIEW', PART_CONFIRMED: 'IN_REVIEW', CONFIRMED: 'APPROVED' };
const PAY_TONE = { PENDING: 'IN_REVIEW', PAID: 'APPROVED', FAILED: 'REJECTED', CANCELLED: 'CANCELLED' };
const guardOf = (q, what, permission) => (q.error?.status === 403 || q.error?.status === 404 ? <NoPermission what={what} permission={permission} /> : q.isPending ? <Skeleton label={what} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : null);
const Tabs = ({ tabs, tab, setTab, label, prefix }) => (
  <div className="actions-row" role="tablist" aria-label={label}>{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} style={{ minHeight: 44 }} onClick={() => setTab(k)} data-testid={`${prefix}-${k}`}>{l}</button>)}</div>
);

// ---- the proposal form (FR-01): the bank and the mode, the lines, the review ----
function ProposalForm({ existing }) {
  const t = useT('fin'); const session = useSession();
  const [f, setF] = useState(() => ({ bankAccountId: existing ? String(existing.bankAccountId) : '', payMode: existing?.payMode ?? 'NEFT', payDate: existing?.payDate ?? today(), purpose: existing?.purpose ?? '' }));
  const [step, setStep] = useState(1);
  const [filt, setFilt] = useState({ dueBy: '', msmeOnly: false });
  const [sel, setSel] = useState(() => Object.fromEntries((existing?.lines ?? []).filter((l) => l.status === 'PROPOSED').map((l) => [l.kind === 'BILL' ? `b${l.billId}` : l.kind === 'ADVANCE' ? `a${l.advanceId}` : `o${l.lineNo}`, { kind: l.kind, billId: l.billId, advanceId: l.advanceId, partnerId: l.partnerId, payee: l.payee, ref: l.billDoc ?? l.advanceDoc ?? l.purpose, amount: String(l.amount), purpose: l.purpose ?? '' }])));
  const [oa, setOa] = useState({ partnerId: '', projectId: '', amount: '', purpose: '' });
  const cand = useQuery({ queryKey: ['gl', 'pm-cand', filt, existing?.id], queryFn: () => pm.candidates({ dueBy: filt.dueBy || undefined, msmeOnly: filt.msmeOnly ? '1' : undefined, exceptProposal: existing?.id }), retry: false });
  const partners = useQuery({ queryKey: ['gl', 'ap-partners'], queryFn: ap.partners, retry: false });
  const opt = useQuery({ queryKey: ['gl', 'options'], queryFn: gl.options, retry: false });
  const { error, busy, run } = useGlRunner();
  const lines = Object.values(sel); const total = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);
  if (cand.error?.status === 403) return <NoPermission what={t('pm.new')} permission="fin.proposal.create" />;
  if (cand.isPending) return <Skeleton label={t('pm.new')} rows={5} />;
  if (cand.isError) return <ErrorState error={cand.error} onRetry={cand.refetch} />;
  const c = cand.data; const bank = c.banks.find((b) => String(b.id) === f.bankAccountId);
  const band = total > c.limits.cfo ? 'DIR' : total > c.limits.accmgr ? 'CFO' : 'ACCMGR';
  const fe = error?.fields ?? {}; const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (k, v) => setSel((s) => { const n = { ...s }; if (n[k]) delete n[k]; else n[k] = v; return n; });
  const body = () => ({ bankAccountId: Number(f.bankAccountId), payMode: f.payMode, payDate: f.payDate, purpose: f.purpose || undefined, lines: lines.map((l) => ({ kind: l.kind, ...(l.billId ? { billId: l.billId } : {}), ...(l.advanceId ? { advanceId: l.advanceId } : {}), ...(l.kind === 'ON_ACCOUNT' ? { partnerId: l.partnerId, projectId: l.projectId ?? null } : {}), amount: l.amount, ...(l.purpose ? { purpose: l.purpose } : {}) })), total: total.toFixed(2) });
  const save = async (submit) => {
    const r = await run(async () => { const x = existing ? await pm.update(existing.id, { ...body(), version: existing.version }) : await pm.create(body()); if (submit) await pm.act(x.id, 'submit'); return x; }, submit ? t('jn.submitted') : t('jn.saved'));
    if (r) navigateTo(`/finance/payment-proposals?id=${r.id}`);
  };
  const lineErr = (i, k) => fe[`lines.${i}.${k}`];
  const lineErrors = Object.entries(fe).filter(([k]) => k.startsWith('lines.'));
  return (
    <form className="mdm-panel" data-testid="pm-form" onSubmit={(e) => { e.preventDefault(); save(false); }} noValidate>
      <Tabs tabs={[[1, `1 · ${t('pm.step1')}`], [2, `2 · ${t('pm.step2')}`], [3, `3 · ${t('pm.step3')}`]]} tab={step} setTab={setStep} label={t('pm.new')} prefix="pm-step" />
      <GlError error={error} />
      {lineErrors.length > 0 && <ul className="mdm-banner" data-testid="pm-line-errors">{lineErrors.map(([k, m]) => <li key={k}>{t('jn.line', { n: Number(k.split('.')[1]) + 1 })}: {m}</li>)}</ul>}
      {step === 1 && <div className="form-grid">
        <Field label={t('pm.bank')} name="bankAccountId" error={fe.bankAccountId}><select value={f.bankAccountId} onChange={set('bankAccountId')} style={big} data-testid="pm-bank"><option value="">—</option>{c.banks.map((b) => <option key={b.id} value={b.id}>{b.name} {b.account}</option>)}</select></Field>
        <Field label={t('pm.mode')} name="payMode" error={fe.payMode}><select value={f.payMode} onChange={set('payMode')} style={big} data-testid="pm-mode">{['NEFT', 'RTGS', 'IMPS', 'CHEQUE'].map((m) => <option key={m} value={m}>{t(`pm.m.${m}`)}</option>)}</select></Field>
        <Field label={t('pm.payDate')} name="payDate" error={fe.payDate}><input type="date" value={f.payDate} min={today()} onChange={set('payDate')} style={big} data-testid="pm-date" /></Field>
        <Field label={t('pm.purpose')} name="purpose" error={fe.purpose}><input value={f.purpose} onChange={set('purpose')} style={big} maxLength={300} data-testid="pm-purpose" /></Field>
        {bank && <p className="muted" data-testid="pm-bank-facts">{t('pm.bookBalance')} {money(bank.balance)}{f.payMode === 'CHEQUE' ? ` · ${t('pm.chequesLeft', { n: bank.chequesLeft })}` : ''}</p>}
        {c.banks.length === 0 && <EmptyState compact title={t('pm.noBank')} message={t('pm.noBankBody')} />}
        <p className="muted">{t('pm.modeRules', { rtgs: money(c.limits.rtgsMin), imps: money(c.limits.impsMax) })}</p>
      </div>}
      {step === 2 && <div data-testid="pm-candidates">
        <div className="form-grid">
          <Field label={t('pm.dueBy')} name="dueBy" error={null}><input type="date" value={filt.dueBy} onChange={(e) => setFilt({ ...filt, dueBy: e.target.value })} style={big} /></Field>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 48 }}><input type="checkbox" checked={filt.msmeOnly} onChange={(e) => setFilt({ ...filt, msmeOnly: e.target.checked })} style={{ width: 24, height: 24 }} />{t('pm.msmeOnly')}</label>
        </div>
        <h2>{t('py.bills')}</h2>
        {c.bills.length === 0 ? <EmptyState compact title={t('pm.noBills')} message={t('pm.noBillsBody')} /> : <ul className="lp-list" aria-label={t('py.bills')}>{c.bills.map((b) => { const k = `b${b.billId}`; const on = Boolean(sel[k]); const off = Boolean(b.blocked || (f.payMode !== 'CHEQUE' && b.bankProblem)); return (
          <li key={k} data-testid="pm-cand-bill" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0' }}>
            <input type="checkbox" aria-label={`${b.docNo} ${b.payee}`} checked={on} disabled={off && !on} onChange={() => toggle(k, { kind: 'BILL', billId: b.billId, partnerId: b.partnerId, payee: b.payee, ref: b.docNo, amount: String(b.left) })} style={{ width: 24, height: 24 }} data-testid={`pm-pick-${b.billId}`} />
            <span style={{ flex: '1 1 14rem', minWidth: 0 }}><strong>{b.payee}</strong> · {b.docNo}{b.billNo ? ` (${b.billNo})` : ''}<br /><span className="muted small">{t('ap.due')} {b.msmeDue ?? b.dueDate}{b.msme ? ' · MSME' : ''}{b.overdue ? ` · ${t('py.overdue')}` : ''}{b.bank ? ` · ${b.bank}` : ''}</span>{(b.blocked || b.bankProblem) && <><br /><span className="small" role="note">{b.blocked ?? b.bankProblem}</span></>}</span>
            <span className="num">{money(b.left)}</span>
            {on && <input inputMode="decimal" aria-label={t('pm.amountFor', { ref: b.docNo })} value={sel[k].amount} onChange={(e) => setSel({ ...sel, [k]: { ...sel[k], amount: e.target.value } })} style={{ ...big, width: '9rem' }} />}
          </li>); })}</ul>}
        <h2>{t('pm.advances')}</h2>
        {c.advances.length === 0 ? <p className="muted">{t('pm.noAdvances')}</p> : <ul className="lp-list" aria-label={t('pm.advances')}>{c.advances.map((a) => { const k = `a${a.advanceId}`; const on = Boolean(sel[k]); return (
          <li key={k} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0' }}>
            <input type="checkbox" aria-label={`${a.docNo} ${a.payee}`} checked={on} disabled={Boolean(a.blocked) && !on} onChange={() => toggle(k, { kind: 'ADVANCE', advanceId: a.advanceId, partnerId: a.partnerId, payee: a.payee, ref: a.docNo, amount: String(a.left) })} style={{ width: 24, height: 24 }} />
            <span style={{ flex: '1 1 14rem', minWidth: 0 }}><strong>{a.payee}</strong> · {a.docNo} · {a.type}{a.blocked ? <><br /><span className="small">{a.blocked}</span></> : null}</span><span className="num">{money(a.left)}</span>
            {on && <input inputMode="decimal" aria-label={t('pm.amountFor', { ref: a.docNo })} value={sel[k].amount} onChange={(e) => setSel({ ...sel, [k]: { ...sel[k], amount: e.target.value } })} style={{ ...big, width: '9rem' }} />}
          </li>); })}</ul>}
        <h2>{t('pm.onAccount')}</h2>
        <div className="form-grid">
          <Field label={t('pm.payee')} name="oaPartner" error={null}><select value={oa.partnerId} onChange={(e) => setOa({ ...oa, partnerId: e.target.value })} style={big}><option value="">—</option>{(partners.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
          <Field label={t('ap.project')} name="oaProject" error={null}><select value={oa.projectId} onChange={(e) => setOa({ ...oa, projectId: e.target.value })} style={big}><option value="">—</option>{(opt.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
          <Field label={t('ap.amount')} name="oaAmount" error={null}><input inputMode="decimal" value={oa.amount} onChange={(e) => setOa({ ...oa, amount: e.target.value })} style={big} /></Field>
          <Field label={t('pm.purpose')} name="oaPurpose" error={null}><input value={oa.purpose} onChange={(e) => setOa({ ...oa, purpose: e.target.value })} style={big} maxLength={200} /></Field>
        </div>
        <div className="actions-row"><button type="button" className="btn" style={big} disabled={!oa.partnerId || !(Number(oa.amount) > 0) || oa.purpose.trim().length < 3} onClick={() => { const p = partners.data.find((x) => String(x.id) === oa.partnerId); setSel({ ...sel, [`o${Date.now()}`]: { kind: 'ON_ACCOUNT', partnerId: Number(oa.partnerId), projectId: oa.projectId ? Number(oa.projectId) : null, payee: p?.name, ref: oa.purpose, amount: oa.amount, purpose: oa.purpose } }); setOa({ partnerId: '', projectId: '', amount: '', purpose: '' }); }}>{t('pm.addOnAccount')}</button></div>
      </div>}
      {step === 3 && <div data-testid="pm-review">
        {lines.length === 0 ? <EmptyState compact title={t('pm.noLines')} message={t('pm.noLinesBody')} /> : <div className="table-scroll"><table className="data-table" aria-label={t('jn.lines')}><thead><tr><th scope="col">#</th><th scope="col">{t('pm.payee')}</th><th scope="col">{t('pm.for')}</th><th scope="col" className="num">{t('ap.amount')}</th><th scope="col"><span className="sr-only">{t('pm.remove')}</span></th></tr></thead>
          <tbody>{Object.entries(sel).map(([k, l], i) => <tr key={k} data-testid="pm-review-line"><td>{i + 1}</td><td>{l.payee}{lineErr(i, 'partnerId') || lineErr(i, 'billId') || lineErr(i, 'amount') ? <><br /><span className="small" role="alert">{lineErr(i, 'partnerId') ?? lineErr(i, 'billId') ?? lineErr(i, 'amount')}</span></> : null}</td><td>{t(`pm.k.${l.kind}`)} · {l.ref}</td><td className="num">{money(l.amount)}</td><td><button type="button" className="btn btn-small" style={{ minHeight: 44 }} onClick={() => toggle(k)} aria-label={t('pm.removeLine', { n: i + 1 })}>{t('pm.remove')}</button></td></tr>)}</tbody></table></div>}
        <p className="mdm-banner" role="status" data-testid="pm-band">{t(`pm.band.${band}`)}</p>
        {bank && total > bank.balance && <p className="mdm-banner" role="note">{t('pm.overBalance', { balance: money(bank.balance) })}</p>}
      </div>}
      <div className="ff-actionbar" data-testid="pm-totals"><span>{t('pm.lines', { n: lines.length })}</span><span>{t('ap.total')} <strong data-testid="pm-total">{money(total)}</strong></span>
        {step < 3 && <button type="button" className="btn" style={big} onClick={() => setStep(step + 1)} data-testid="pm-next">{t('pm.next')}</button>}
        <button type="submit" className="btn" style={big} disabled={busy || !lines.length || !f.bankAccountId} data-testid="pm-save">{t('jn.saveDraft')}</button>
        {can(session.data, 'fin.proposal.submit') && <button type="button" className="btn btn-primary" style={big} disabled={busy || !lines.length || !f.bankAccountId} onClick={() => save(true)} data-testid="pm-save-submit">{t('jn.saveSubmit')}</button>}
      </div>
    </form>
  );
}

function Decide({ x, run, busy, setError }) {
  const t = useT('fin'); const [comment, setComment] = useState('');
  if (!x.approve || !x.taskId) return null;
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('act.sayWhy') }); return; } run(() => gl.decide(x.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <div className="mdm-panel no-print" data-testid="pm-decide"><h2>{t('act.decision')}</h2>
      <label>{t('act.comment')}<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></label>
      <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => decide('approve')} data-testid="pm-approve">{t('act.approve')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('return')}>{t('act.return')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide('reject')}>{t('act.reject')}</button></div>
    </div>
  );
}

// ---- the payment run (the proposal as an object page): release, the bank file or the cheques, the confirmation ----
function Confirm({ x, run, busy }) {
  const t = useT('fin'); const [rows, setRows] = useState({}); const [result, setResult] = useState(null);
  const open = x.payments.filter((p) => p.status === 'PENDING');
  if (!x.can.confirm || !open.length) return null;
  const upload = async (file) => { if (!file) return; const csv = await file.text(); const r = await run(() => pm.confirm({ csv }), t('pm.confirmed')); if (r) setResult(r); };
  const one = async (p, status) => { const v = rows[p.id] ?? {}; const r = await run(() => pm.confirm({ rows: [{ paymentId: p.id, status, ...(status === 'PAID' ? { utr: v.utr || undefined, paidOn: v.paidOn || today() } : { reason: v.reason }) }] }), t('pm.confirmed')); if (r) setResult(r); };
  return (
    <div className="mdm-panel no-print" data-testid="pm-confirm"><h2>{t('pm.confirmTitle')}</h2><p className="muted">{t('pm.confirmIntro')}</p>
      <label className="btn" style={{ ...big, display: 'inline-flex', alignItems: 'center' }}>{t('pm.uploadResponse')}<input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => upload(e.target.files?.[0])} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} data-testid="pm-upload" /></label>
      <ul className="lp-list">{open.map((p) => { const v = rows[p.id] ?? {}; const setV = (k) => (e) => setRows({ ...rows, [p.id]: { ...v, [k]: e.target.value } }); return (
        <li key={p.id} data-testid="pm-confirm-row" style={{ display: 'grid', gap: 8, padding: '8px 0' }}><span><strong>{p.docNo}</strong> · {p.payee} · {money(p.amount)}{p.chequeNo ? ` · ${t('pm.cheque')} ${p.chequeNo}` : ''}</span>
          <div className="form-grid">
            {x.payMode !== 'CHEQUE' && <Field label="UTR" name={`utr${p.id}`} error={null}><input value={v.utr ?? ''} onChange={setV('utr')} style={big} autoCapitalize="characters" maxLength={22} data-testid={`pm-utr-${p.id}`} /></Field>}
            <Field label={t('pm.paidOn')} name={`on${p.id}`} error={null}><input type="date" value={v.paidOn ?? today()} onChange={setV('paidOn')} style={big} /></Field>
            <Field label={t('pm.reason')} name={`why${p.id}`} error={null}><input value={v.reason ?? ''} onChange={setV('reason')} style={big} maxLength={300} /></Field>
          </div>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => one(p, 'PAID')} data-testid={`pm-paid-${p.id}`}>{x.payMode === 'CHEQUE' ? t('pm.cleared') : t('pm.markPaid')}</button><button type="button" className="btn" style={big} disabled={busy || !(v.reason ?? '').trim()} onClick={() => one(p, x.payMode === 'CHEQUE' ? 'CANCELLED' : 'FAILED')}>{x.payMode === 'CHEQUE' ? t('pm.cancelCheque') : t('pm.returned')}</button></div>
        </li>); })}</ul>
      {result && <ul data-testid="pm-confirm-result">{result.results.map((r, i) => <li key={i}>{r.ref}: {r.message}</li>)}</ul>}
    </div>
  );
}
function Proposal({ id }) {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'pm-proposal', id], queryFn: () => pm.proposal(id), retry: false }); const { error, setError, note, busy, run } = useGlRunner(); const [tab, setTab] = useState('lines');
  const hist = useQuery({ queryKey: ['gl', 'pm-history', id], queryFn: () => pm.history(id), retry: false, enabled: tab === 'approvals' });
  usePageTitle(t('pm.run'));
  const g = guardOf(q, t('pm.run'), 'fin.proposal.view'); if (g) return g; const x = q.data; const c = x.can ?? {};
  const why = (action) => { const r = globalThis.prompt(t('act.why')); if (r) run(() => pm.act(x.id, action, { reason: r })); };
  const drop = (l) => { const r = globalThis.prompt(t('pm.dropWhy')); if (r) run(() => pm.dropLine(x.id, l.id, r)); };
  const fileName = (x.fileName ?? `${x.docNo.replaceAll('/', '-')}.csv`);
  const fact = (k, v, tid) => <div className="kv"><dt>{t(k)}</dt><dd data-testid={tid}>{v}</dd></div>;
  return (
    <div data-testid="pm-run" data-status={x.status} data-run={x.runStatus}>
      <PageHeader id="pm-h" title={<>{x.docNo} <StatusBadge status={JN_TONE[x.status]} label={t(`st.${x.status}`)} /> <StatusBadge status={RUN_TONE[x.runStatus]} label={t(`pm.run.${x.runStatus}`)} /></>} subtitle={`${t(`pm.m.${x.payMode}`)} · ${x.bank?.name ?? ''} ${x.bank?.account ?? ''} · ${x.payDate}`} meta={<Link to="/finance/payment-proposals">{t('pm.title')}</Link>} />
      <KpiRow label={t('pm.run')}><KpiTile label={t('ap.total')} value={money(x.total)} amount={x.total} kind="money" valueTestid="pm-run-total" /><KpiTile label={t('jn.lines')} value={String(x.linesCount)} /><KpiTile label={t('pm.bookBalance')} value={money(x.bank?.balance)} amount={x.bank?.balance} kind="money" /></KpiRow>
      <dl className="kv-list" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>{fact('pm.approvedBy', x.bandLabel)}{fact('pm.preparedBy', x.requestedBy ?? x.createdBy)}{x.releasedBy && fact('pm.releasedBy', `${x.releasedBy} · ${x.releasedAt?.slice(0, 16).replace('T', ' ')}`)}{x.purpose && fact('pm.purpose', x.purpose)}</dl>
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      {c.releaseBlocked && <p className="mdm-banner" role="note" data-testid="pm-sod">{c.releaseBlocked}</p>}
      <div className="ff-actionbar no-print" data-testid="pm-actions">
        {c.edit && <button type="button" className="btn" style={big} onClick={() => navigateTo(`/finance/payment-proposals?edit=${x.id}`)}>{t('act.edit')}</button>}
        {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => pm.act(x.id, 'submit'), t('jn.submitted'))} data-testid="pm-submit">{t('act.submit')}</button>}
        {c.withdraw && <button type="button" className="btn" style={big} disabled={busy} onClick={() => why('withdraw')}>{t('act.withdraw')}</button>}
        {c.cancel && <button type="button" className="btn" style={big} disabled={busy} onClick={() => why('cancel')}>{t('act.cancel')}</button>}
        {c.release && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => { if (globalThis.confirm(t('pm.releaseConfirm', { n: x.linesCount, total: money(x.total) }))) run(() => pm.act(x.id, 'release'), t('pm.released')); }} data-testid="pm-release">{t('pm.release')}</button>}
        {c.file && <button type="button" className="btn" style={big} onClick={() => gl.file(`/proposals/${x.id}/bank-file`, fileName).catch(() => setError({ form: t('act.exportFailed') }))} data-testid="pm-file">{t('pm.bankFile')}</button>}
        {c.cheques && <button type="button" className="btn" style={big} onClick={() => gl.file(`/proposals/${x.id}/cheques`, `cheques-${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('act.exportFailed') }))} data-testid="pm-cheques">{t('pm.printCheques')}</button>}
        {c.print && <button type="button" className="btn" style={big} onClick={() => gl.file(`/proposals/${x.id}/print`, `${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('act.exportFailed') }))}>{t('act.print')}</button>}
      </div>
      <Decide x={x} run={run} busy={busy} setError={setError} />
      <Tabs tabs={[['lines', t('jn.lines')], ['payments', t('pm.payments')], ['approvals', t('pm.evidence')]]} tab={tab} setTab={setTab} label={t('pm.run')} prefix="pm-tab" />
      {tab === 'lines' && <div className="table-scroll"><table className="data-table" aria-label={t('jn.lines')}><thead><tr><th scope="col">#</th><th scope="col">{t('pm.payee')}</th><th scope="col">{t('pm.for')}</th><th scope="col">{t('pm.payeeBank')}</th><th scope="col" className="num">{t('ap.amount')}</th><th scope="col">{t('pm.lineStatus')}</th><th scope="col"><span className="sr-only">{t('pm.actions')}</span></th></tr></thead>
        <tbody>{x.lines.map((l) => <tr key={l.id} data-testid="pm-line"><td>{l.lineNo}</td><td>{l.payee}</td><td>{t(`pm.k.${l.kind}`)} · {l.billId ? <Link to={`/finance/ap-bills?id=${l.billId}`}>{l.billDoc}</Link> : l.advanceDoc ?? l.purpose}{l.msmeDue ? ' · MSME' : ''}</td><td>{l.bank ?? (x.payMode === 'CHEQUE' ? t('pm.m.CHEQUE') : '—')}{l.nameMatch === 'OK' ? ` · ${t('pm.nameOk')}` : ''}</td><td className="num">{money(l.amount)}</td><td>{t(`pm.ls.${l.status}`)}{l.removedReason ? ` · ${l.removedReason}` : ''}</td>
          <td>{(c.release || c.releaseBlocked) && l.status === 'PROPOSED' && x.status === 'APPROVED' && x.runStatus === 'NONE' && <button type="button" className="btn btn-small" style={{ minHeight: 44 }} onClick={() => drop(l)}>{t('pm.drop')}</button>}</td></tr>)}</tbody></table></div>}
      {tab === 'payments' && (x.payments.length === 0 ? <EmptyState compact title={t('pm.noPayments')} message={t('pm.noPaymentsBody')} /> : <div className="table-scroll"><table className="data-table" aria-label={t('pm.payments')}><thead><tr><th scope="col">{t('pm.payment')}</th><th scope="col">{t('pm.payee')}</th><th scope="col">UTR / {t('pm.cheque')}</th><th scope="col" className="num">{t('ap.amount')}</th><th scope="col">{t('pm.status')}</th></tr></thead>
        <tbody>{x.payments.map((p) => <tr key={p.id} data-testid="pm-payment"><td><Link to={`/finance/payments?id=${p.id}`}>{p.docNo}</Link></td><td>{p.payee}</td><td>{p.utr ?? p.chequeNo ?? '—'}</td><td className="num">{money(p.amount)}</td><td><StatusBadge status={PAY_TONE[p.status]} label={t(`pm.ps.${p.status}`)} /></td></tr>)}</tbody></table></div>)}
      {tab === 'approvals' && <div data-testid="pm-evidence">
        <ul className="lp-list" aria-label={t('pm.evidence')}>{x.evidence.map((e) => <li key={e.lineNo}><strong>{e.lineNo}. {e.payee}</strong> · {e.source} · {e.bank ?? ''} {e.nameMatch === 'OK' ? `· ${t('pm.nameOk')}` : ''} · {e.holds.length ? `${t('ap.holds')}: ${e.holds.join('; ')}` : t('ap.noHolds')}</li>)}</ul>
        {hist.data && <ul className="lp-list" aria-label={t('pm.history')}>{[...hist.data.approvals.map((h) => ({ at: h.at, who: h.actor, what: `${h.step_code ?? ''} ${h.event}`, why: h.comment })), ...hist.data.audit.map((a) => ({ at: a.created_at ?? a.at, who: a.actor, what: a.action, why: a.reason }))].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((h, i) => <li key={i}>{String(h.at).slice(0, 16).replace('T', ' ')} · {h.who} · {h.what}{h.why ? ` · ${h.why}` : ''}</li>)}</ul>}
      </div>}
      <Confirm x={x} run={run} busy={busy} />
    </div>
  );
}

function MyApprovals() {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'pm-tasks'], queryFn: pm.myTasks, retry: false });
  const rows = (q.data?.rows ?? []).filter((x) => x.instance?.docType === 'FIN_PAYMENT');
  if (!rows.length) return null;
  return (<div className="mdm-panel" data-testid="pm-worklist"><h2>{t('pm.worklist')}</h2><ul className="lp-list">{rows.map((x) => <li key={x.id}><Link to={`/finance/payment-proposals?id=${x.instance.docId}`}>{x.instance.ref ?? x.instance.docId}</Link> · {x.instance.title ?? ''}</li>)}</ul></div>);
}
function EditProposal({ id }) {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'pm-proposal', id], queryFn: () => pm.proposal(id), retry: false });
  const g = guardOf(q, t('pm.new'), 'fin.proposal.edit'); if (g) return g;
  return <ProposalForm existing={q.data} />;
}
export function PaymentProposalsPage() {
  const t = useT('fin'); usePageTitle(t('pm.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const edit = Number(sp.get('edit')) || null; const session = useSession();
  if (id) return <section aria-labelledby="pm-h"><Proposal id={id} /></section>;
  if (edit) return <section aria-labelledby="pme-h"><PageHeader id="pme-h" title={t('pm.edit')} meta={<Link to={`/finance/payment-proposals?id=${edit}`}>{t('pm.run')}</Link>} /><EditProposal id={edit} /></section>;
  if (sp.get('new')) return <section aria-labelledby="pmn-h"><PageHeader id="pmn-h" title={t('pm.new')} subtitle={t('pm.newIntro')} meta={<Link to="/finance/payment-proposals">{t('pm.title')}</Link>} /><ProposalForm /></section>;
  return (
    <section aria-labelledby="pms-h" data-testid="pm-proposals"><PageHeader id="pms-h" title={t('pm.title')} subtitle={t('pm.intro')} meta={<><Link to="/finance/payments">{t('pm.payments')}</Link> · <Link to="/finance/bank-accounts">{t('pm.banks')}</Link></>} />
      <MyApprovals />
      <ListReport listCode="fin.payment_proposals" endpoint="/fin/proposals" title={t('pm.title')} session={session.data} rowHref={(r) => `/finance/payment-proposals?id=${r.id}`} onOpen={(r) => navigateTo(`/finance/payment-proposals?id=${r.id}`)} cardFields={['docNo', 'payDate', 'mode', 'total', 'status', 'run']} statusKey="status" dateKey="payDate"
        newAction={{ label: t('pm.new'), permission: 'fin.proposal.create', onClick: () => navigateTo('/finance/payment-proposals?new=1') }} empty={{ title: t('pm.emptyTitle'), text: t('pm.emptyBody') }} />
    </section>
  );
}

// ---- payments and the cheque register ----
function Payment({ id }) {
  const t = useT('fin'); const q = useQuery({ queryKey: ['gl', 'pm-payment', id], queryFn: () => pm.payment(id), retry: false }); const { error, setError, note, busy, run } = useGlRunner(); usePageTitle(t('pm.payment'));
  const g = guardOf(q, t('pm.payment'), 'fin.payment.view'); if (g) return g; const x = q.data;
  const row = (k, v, tid) => <tr><th scope="row">{t(k)}</th><td data-testid={tid}>{v}</td></tr>;
  return (
    <div data-testid="pm-payment-page" data-status={x.status}>
      <PageHeader id="pp-h" title={<>{x.docNo} <StatusBadge status={PAY_TONE[x.status]} label={t(`pm.ps.${x.status}`)} /></>} subtitle={x.payee} meta={<><Link to="/finance/payments">{t('pm.payments')}</Link> · <Link to={`/finance/payment-proposals?id=${x.proposalId}`}>{x.proposalNo}</Link></>} />
      <KpiRow label={t('pm.payment')}><KpiTile label={t('ap.amount')} value={money(x.amount)} amount={x.amount} kind="money" /></KpiRow>
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="table-scroll"><table className="data-table"><tbody>
        {row('pm.for', `${t(`pm.k.${x.kind}`)}${x.bill ? ` · ${x.bill.docNo}` : x.advance ? ` · ${x.advance.docNo}` : x.purpose ? ` · ${x.purpose}` : ''}`)}{row('pm.mode', `${t(`pm.m.${x.mode}`)} · ${x.bank}`)}{x.bankAccount && row('pm.payeeBank', x.bankAccount)}
        {row('pm.releasedOn', x.releasedOn)}{row('pm.paidOn', x.paidOn ?? '—')}{row('UTR', x.utr ?? '—', 'pm-p-utr')}{x.chequeNo && row('pm.cheque', x.chequeNo)}{x.failureReason && row('pm.reason', x.failureReason)}
        {x.bill && row('ap.tds', `${money(x.bill.tds)} ${x.bill.tdsSection ?? ''}`)}{row('pm.advice', x.adviceStatus ? `${x.adviceStatus} · ${x.adviceAt?.slice(0, 16).replace('T', ' ')}` : '—', 'pm-p-advice')}
        {x.journalId && row('jn.voucher', <Link to={`/finance/journals?id=${x.journalId}`}>{t('common.open')}</Link>)}
      </tbody></table></div>
      <div className="actions-row no-print">
        {x.can.print && <button type="button" className="btn" style={big} onClick={() => gl.file(`/payments/${x.id}/advice`, `advice-${x.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('act.exportFailed') }))} data-testid="pm-advice-pdf">{t('pm.advicePdf')}</button>}
        {x.can.advice && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => pm.advice(x.id), t('pm.adviceSent'))}>{t('pm.adviceAgain')}</button>}
      </div>
      {x.history?.length > 0 && <ul className="lp-list" aria-label={t('pm.history')}>{x.history.map((h, i) => <li key={i}>{String(h.at).slice(0, 16).replace('T', ' ')} · {h.actor} · {h.action}{h.reason ? ` · ${h.reason}` : ''}</li>)}</ul>}
    </div>
  );
}
function ChequeRegister() {
  const t = useT('fin'); const banks = useQuery({ queryKey: ['gl', 'pm-banks'], queryFn: pm.banks, retry: false }); const [bid, setBid] = useState('');
  const chosen = bid || String(banks.data?.find((b) => b.chequeNext != null)?.id ?? '');
  const q = useQuery({ queryKey: ['gl', 'pm-cheques', chosen], queryFn: () => pm.chequeRegister(chosen), enabled: Boolean(chosen), retry: false });
  const g = guardOf(banks, t('pm.chequeRegister'), 'fin.payment.view'); if (g) return g;
  const x = q.data;
  return (
    <div data-testid="pm-cheque-register">
      <div className="form-grid"><Field label={t('pm.bank')} name="bank" error={null}><select value={chosen} onChange={(e) => setBid(e.target.value)} style={big}><option value="">—</option>{banks.data.map((b) => <option key={b.id} value={b.id}>{b.name} {b.account}</option>)}</select></Field></div>
      {!chosen ? <EmptyState title={t('pm.chequeRegister')} message={t('pm.pickBank')} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : !x ? <Skeleton label={t('pm.chequeRegister')} rows={4} /> : <>
        <KpiRow label={t('pm.chequeRegister')}><KpiTile label={t('pm.chq.issued')} value={String(x.issued)} /><KpiTile label={t('pm.chq.cleared')} value={String(x.cleared)} /><KpiTile label={t('pm.chq.cancelled')} value={String(x.cancelled)} /><KpiTile label={t('pm.chq.left')} value={String(x.bank.left)} /></KpiRow>
        {x.rows.length === 0 ? <EmptyState compact title={t('pm.noCheques')} message={t('pm.noChequesBody')} /> : <div className="table-scroll"><table className="data-table" aria-label={t('pm.chequeRegister')}><thead><tr><th scope="col">{t('pm.cheque')}</th><th scope="col">{t('pm.payee')}</th><th scope="col">{t('pm.releasedOn')}</th><th scope="col">{t('pm.paidOn')}</th><th scope="col" className="num">{t('ap.amount')}</th><th scope="col">{t('pm.status')}</th></tr></thead>
          <tbody>{x.rows.map((r) => <tr key={r.id} data-testid="pm-cheque-row"><td><Link to={`/finance/payments?id=${r.id}`}>{r.chequeNo}</Link></td><td>{r.payee}</td><td>{r.issued}</td><td>{r.cleared ?? '—'}</td><td className="num">{money(r.amount)}</td><td>{r.statusLabel}{r.reason ? ` · ${r.reason}` : ''}</td></tr>)}</tbody></table></div>}
      </>}
    </div>
  );
}
export function PaymentsPage() {
  const t = useT('fin'); usePageTitle(t('pm.payments')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const [tab, setTab] = useState(sp.get('tab') === 'cheques' ? 'cheques' : 'list');
  if (id) return <section aria-labelledby="pp-h"><Payment id={id} /></section>;
  return (
    <section aria-labelledby="pps-h" data-testid="pm-payments"><PageHeader id="pps-h" title={t('pm.payments')} subtitle={t('pm.paymentsIntro')} meta={<><Link to="/finance/payment-proposals">{t('pm.title')}</Link> · <Link to="/finance/bank-accounts">{t('pm.banks')}</Link></>} />
      <Tabs tabs={[['list', t('pm.payments')], ['cheques', t('pm.chequeRegister')]]} tab={tab} setTab={setTab} label={t('pm.payments')} prefix="pm-ptab" />
      {tab === 'list' ? <ListReport listCode="fin.payments" endpoint="/fin/payments" title={t('pm.payments')} session={session.data} rowHref={(r) => `/finance/payments?id=${r.id}`} onOpen={(r) => navigateTo(`/finance/payments?id=${r.id}`)} cardFields={['docNo', 'payee', 'amount', 'mode', 'utr', 'status']} statusKey="status" dateKey="released"
        newAction={{ label: t('pm.new'), permission: 'fin.proposal.create', onClick: () => navigateTo('/finance/payment-proposals?new=1') }} empty={{ title: t('pm.noPayments'), text: t('pm.noPaymentsBody') }} /> : <ChequeRegister />}
    </section>
  );
}

// ---- the company's bank accounts ----
function BankForm({ x, onDone }) {
  const t = useT('fin'); const opt = useQuery({ queryKey: ['gl', 'options'], queryFn: gl.options, retry: false }); const fmts = useQuery({ queryKey: ['gl', 'pm-formats'], queryFn: pm.formats, retry: false }); const { error, busy, run } = useGlRunner();
  const [f, setF] = useState(() => ({ code: x?.code ?? '', name: x?.name ?? '', bankName: x?.bankName ?? '', ifsc: x?.ifsc ?? '', accountNo: '', glAccountId: x ? String(x.glAccountId) : '', fileFormat: x?.fileFormat ?? 'GENERIC_CSV', chequeFrom: x?.chequeNext ?? '', chequeTo: x?.chequeLast ?? '', blocked: x?.status === 'BLOCKED' }));
  const bankAccounts = useMemo(() => (opt.data?.accounts ?? []).filter((a) => a.type === 'BANK' || a.accountType === 'BANK'), [opt.data]);
  if (opt.isPending || fmts.isPending) return <Skeleton label={t('pm.banks')} rows={4} />;
  const fe = error?.fields ?? {}; const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { const r = await run(() => pm.saveBank(x?.id ?? null, { code: f.code.trim().toUpperCase(), name: f.name, bankName: f.bankName, ifsc: f.ifsc.trim().toUpperCase(), ...(f.accountNo ? { accountNo: f.accountNo.trim() } : {}), glAccountId: Number(f.glAccountId), fileFormat: f.fileFormat, chequeFrom: f.chequeFrom === '' ? null : Number(f.chequeFrom), chequeTo: f.chequeTo === '' ? null : Number(f.chequeTo), blocked: Boolean(f.blocked), ...(x ? { version: x.version } : {}) }), t('jn.saved')); if (r) onDone(); };
  return (
    <form className="mdm-panel" data-testid="pm-bank-form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
      <GlError error={error} />
      <div className="form-grid">
        <Field label={t('pm.bankCode')} name="code" error={fe.code}><input value={f.code} onChange={set('code')} style={big} maxLength={20} autoCapitalize="characters" /></Field>
        <Field label={t('pm.bankLabel')} name="name" error={fe.name}><input value={f.name} onChange={set('name')} style={big} maxLength={100} /></Field>
        <Field label={t('pm.bankName')} name="bankName" error={fe.bankName}><input value={f.bankName} onChange={set('bankName')} style={big} maxLength={100} /></Field>
        <Field label="IFSC" name="ifsc" error={fe.ifsc}><input value={f.ifsc} onChange={set('ifsc')} style={big} maxLength={11} autoCapitalize="characters" /></Field>
        <Field label={x ? t('pm.accountNoChange') : t('pm.accountNo')} name="accountNo" error={fe.accountNo}><input inputMode="numeric" autoComplete="off" value={f.accountNo} onChange={set('accountNo')} style={big} maxLength={18} /></Field>
        <Field label={t('pm.glAccount')} name="glAccountId" error={fe.glAccountId}><select value={f.glAccountId} onChange={set('glAccountId')} style={big}><option value="">—</option>{bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></Field>
        <Field label={t('pm.fileFormat')} name="fileFormat" error={fe.fileFormat ?? fe.template}><select value={f.fileFormat} onChange={set('fileFormat')} style={big}>{fmts.data.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</select></Field>
        <Field label={t('pm.chequeFrom')} name="chequeFrom" error={fe.chequeFrom}><input inputMode="numeric" value={f.chequeFrom} onChange={set('chequeFrom')} style={big} /></Field>
        <Field label={t('pm.chequeTo')} name="chequeTo" error={fe.chequeTo}><input inputMode="numeric" value={f.chequeTo} onChange={set('chequeTo')} style={big} /></Field>
        {x && <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 48 }}><input type="checkbox" checked={f.blocked} onChange={(e) => setF({ ...f, blocked: e.target.checked })} style={{ width: 24, height: 24 }} />{t('pm.blocked')}</label>}
      </div>
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy}>{t('act.save')}</button><button type="button" className="btn" style={big} onClick={onDone}>{t('act.close')}</button></div>
    </form>
  );
}
export function BankAccountsPage() {
  const t = useT('fin'); usePageTitle(t('pm.banks')); const session = useSession(); const q = useQuery({ queryKey: ['gl', 'pm-banks'], queryFn: pm.banks, retry: false }); const [edit, setEdit] = useState(null);
  const g = guardOf(q, t('pm.banks'), 'fin.bank.view');
  const manage = can(session.data, 'fin.bank.manage');
  return (
    <section aria-labelledby="pb-h" data-testid="pm-banks"><PageHeader id="pb-h" title={t('pm.banks')} subtitle={t('pm.banksIntro')} meta={<Link to="/finance/payment-proposals">{t('pm.title')}</Link>} actions={manage && !edit ? <button type="button" className="btn btn-primary" style={big} onClick={() => setEdit('new')}>{t('pm.newBank')}</button> : null} />
      {edit && <BankForm x={edit === 'new' ? null : edit} onDone={() => setEdit(null)} />}
      {g ?? (q.data.length === 0 ? <EmptyState title={t('pm.noBank')} message={t('pm.noBankBody')} /> : <ul className="lp-list" aria-label={t('pm.banks')}>{q.data.map((b) => (
        <li key={b.id} data-testid="pm-bank-row" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0' }}>
          <span style={{ flex: '1 1 16rem', minWidth: 0 }}><strong>{b.name}</strong> · {b.code} {b.status === 'BLOCKED' && <StatusBadge status="CANCELLED" label={t('pm.blocked')} />}<br /><span className="muted small">{b.bankName} · {b.ifsc} · {b.account} · {b.glAccount?.code} {b.glAccount?.name} · {b.fileFormatLabel}{b.chequeNext != null ? ` · ${t('pm.chequesLeft', { n: b.chequesLeft })}` : ''}</span></span>
          <span className="num">{money(b.balance)}</span>
          {manage && <button type="button" className="btn btn-small" style={{ minHeight: 44 }} onClick={() => setEdit(b)}>{t('act.edit')}</button>}
        </li>))}</ul>)}
    </section>
  );
}
