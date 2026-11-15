import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { authHeaders } from '../../platform/excel/api.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { dayIST, exp } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// New Expense Claim (HR, part 07.12, FR-03 to FR-05): the claim of an employee with its lines: category, date, amount, GST invoice details, the photo of the bill (taken with the phone camera), project and cost code; per diem and mileage are
// computed by the server from the policy of the grade. The page shows the same checks the server makes as the lines are typed: the limit, the receipt rule, a bill that is claimed already, an old bill; a flagged line needs a justification and
// the approver sees the flag. An advance can be settled; the page shows the net payable or recoverable. The accounts manager passes an approved claim for payment and records the payment here.
const transport = browserTransport(authHeaders);
const CATS = ['TRAVEL', 'LODGING', 'FOOD', 'LOCAL_CONVEYANCE', 'SITE_PURCHASE', 'PER_DIEM', 'MILEAGE', 'OTHER'];
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', PASSED: 'ACTIVE', PAID: 'COMPLETED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
const blankLine = () => ({ key: Math.random().toString(36).slice(2), category: 'TRAVEL', date: dayIST(0), description: '', amount: '', gst: '', vendorName: '', vendorGstin: '', invoiceNo: '', fileId: null, costCodeId: '', projectId: '', km: '', days: '', justification: '' });
const inr = (n) => (n == null ? '—' : `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export default function ClaimPage() {
  const t = useT('exp');
  const qc = useQueryClient();
  const session = useSession();
  const canCost = (session.data?.permissions ?? []).includes('fin.coa.view');
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get('id')) || null;
  const q = useQuery({ queryKey: ['exp', 'claim', id], queryFn: () => exp.claim(id), enabled: Boolean(id), retry: false });
  const h = useQuery({ queryKey: ['exp', 'claim-history', id], queryFn: () => exp.claimHistory(id), enabled: Boolean(id) && q.isSuccess, retry: false });
  const [head, setHead] = useState({ periodFrom: dayIST(-5), periodTo: dayIST(0), purpose: '', cityTier: 'T2', advanceId: '', travelRequestId: params.get('travel') ?? '' });
  const [lines, setLines] = useState([blankLine()]);
  const [pv, setPv] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState('');
  const loaded = useRef(false);
  const c = q.data;
  usePageTitle(c ? `${c.docNo}` : t('claim.title'));
  useEffect(() => {
    if (!c || loaded.current) return; loaded.current = true;
    setHead({ periodFrom: c.periodFrom, periodTo: c.periodTo, purpose: c.purpose, cityTier: c.cityTier, advanceId: c.advanceId ? String(c.advanceId) : '', travelRequestId: c.travelRequestId ? String(c.travelRequestId) : '' });
    setLines(c.lines.map((l) => ({ key: String(l.id), category: l.category, date: l.date, description: l.description, amount: l.category === 'PER_DIEM' || l.category === 'MILEAGE' ? '' : String(l.amount), gst: l.gst ? String(l.gst) : '', vendorName: l.vendorName ?? '', vendorGstin: l.vendorGstin ?? '', invoiceNo: l.invoiceNo ?? '', fileId: l.fileId, costCodeId: l.costCodeId ? String(l.costCodeId) : '', projectId: l.projectId ? String(l.projectId) : '', km: l.km ? String(l.km) : '', days: l.days ? String(l.days) : '', justification: l.justification ?? '' })));
  }, [c]);
  const editable = !id || Boolean(c?.can.edit);
  const body = () => ({ periodFrom: head.periodFrom, periodTo: head.periodTo, purpose: head.purpose.trim() || 'Expense claim', cityTier: head.cityTier, travelRequestId: head.travelRequestId ? Number(head.travelRequestId) : null, advanceId: head.advanceId ? Number(head.advanceId) : null,
    lines: lines.map((l) => ({ category: l.category, date: l.date, description: l.description.trim() || '—', amount: ['PER_DIEM', 'MILEAGE'].includes(l.category) || l.amount === '' ? null : Number(l.amount), gst: l.gst === '' ? 0 : Number(l.gst), vendorName: l.vendorName.trim() || null, vendorGstin: l.vendorGstin.trim().toUpperCase() || null, invoiceNo: l.invoiceNo.trim() || null, fileId: l.fileId, costCodeId: l.costCodeId ? Number(l.costCodeId) : null, projectId: l.projectId ? Number(l.projectId) : null, km: l.km ? Number(l.km) : null, days: l.days ? Number(l.days) : null, justification: l.justification.trim() || null })) });
  useEffect(() => {
    if (!editable || !lines.length) return undefined;
    const timer = setTimeout(async () => { try { setPv(await exp.previewClaim({ ...body(), id: id ?? undefined })); } catch { setPv(null); } }, 400);
    return () => clearTimeout(timer);
  }, [JSON.stringify(head), JSON.stringify(lines), editable]);
  if (id && q.error?.status === 403) return <NoPermission what={t('claim.title')} permission="hr.claim.view" />;
  if (id && q.isPending) return <Skeleton label={t('claim.title')} rows={6} />;
  if (id && q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const set = (k, patch) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const refresh = () => qc.invalidateQueries({ queryKey: ['exp'] });
  const run = async (fn, done) => { setError(null); setNote(null); setBusy('x'); try { const r = await fn(); if (done) setNote(done); refresh(); return r; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(''); } };
  const save = (submit) => run(async () => {
    const r = id ? await exp.updateClaim(id, { ...body(), version: c.rowVersion }) : await exp.createClaim({ ...body(), submit });
    if (id && submit) await exp.claimAct(id, 'submit');
    if (!id) navigateTo(`/expenses/claim?id=${r.id}`, { force: true }); else loaded.current = false;
    return r;
  }, submit ? t('claim.sent') : t('claim.saved'));
  const photo = async (key, file) => {
    if (!file || !id) return;
    await run(async () => { const stored = await uploadFile(file, { transport, entity: 'exp_claim', entityId: id, stripExif: true }); set(key, { fileId: stored.id }); }, t('claim.photoAdded'));
  };
  const problem = (i, k) => error?.fields?.[`lines.${i}.${k}`] ?? null;
  const flagOf = (i) => pv?.lines?.find((x) => x.lineNo === i + 1);
  const needs = pv?.submitProblems ?? [];
  const advOptions = c?.openAdvances ?? [];
  return (
    <section aria-labelledby="cl-title" data-testid="claim" data-status={c?.status ?? 'NEW'}>
      <PageHeader id="cl-title" title={c ? <>{c.docNo} <StatusBadge status={TONE[c.status]} label={t(`cst.${c.status}`)} /></> : t('claim.title')} />
      {c && <p className="muted">{c.employee} · {c.employeeCode}{c.grade ? ` · ${t('claim.grade')} ${c.grade}` : ''}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="cl-error">{error.form}{error.fields ? ` ${Object.entries(error.fields).map(([k, v]) => `${k}: ${v}`).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="cl-note">{note}</p>}
      <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }} data-testid="cl-form" aria-label={t('claim.title')}>
        <Field label={t('claim.purpose')} name="purpose" error={error}><input value={head.purpose} maxLength={300} disabled={!editable} onChange={(e) => setHead({ ...head, purpose: e.target.value })} required data-testid="cl-purpose" /></Field>
        <Field label={t('claim.from')} name="periodFrom" error={error}><input type="date" value={head.periodFrom} disabled={!editable} onChange={(e) => setHead({ ...head, periodFrom: e.target.value })} data-testid="cl-from" /></Field>
        <Field label={t('claim.to')} name="periodTo" error={error}><input type="date" value={head.periodTo} disabled={!editable} onChange={(e) => setHead({ ...head, periodTo: e.target.value })} data-testid="cl-to" /></Field>
        <Field label={t('claim.tier')} name="cityTier" error={error} hint={t('claim.tierHint')}><select value={head.cityTier} disabled={!editable} onChange={(e) => setHead({ ...head, cityTier: e.target.value })} data-testid="cl-tier">{['T1', 'T2', 'T3'].map((x) => <option key={x} value={x}>{t(`tier.${x}`)}</option>)}</select></Field>
        {id && editable && advOptions.length > 0 && <Field label={t('claim.advance')} name="advanceId" error={error}><select value={head.advanceId} onChange={(e) => setHead({ ...head, advanceId: e.target.value })} data-testid="cl-advance"><option value="">{t('claim.noAdvance')}</option>{advOptions.map((a) => <option key={a.id} value={a.id}>{a.docNo} · {t('claim.outstanding')} {inr(a.outstanding)}</option>)}</select></Field>}
        <h2>{t('claim.lines')}</h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t('claim.lines')}>
          <table className="grid exp-lines" data-testid="cl-lines">
            <thead><tr><th>#</th><th>{t('claim.category')}</th><th>{t('claim.date')}</th><th>{t('claim.description')}</th><th>{t('claim.amount')}</th><th>GST</th><th>{t('claim.invoice')}</th><th>{t('claim.bill')}</th><th><span className="sr-only">{t('claim.flag')}</span></th></tr></thead>
            <tbody>{lines.map((l, i) => {
              const f = flagOf(i); const computed = ['PER_DIEM', 'MILEAGE'].includes(l.category);
              return (
                <tr key={l.key} data-testid="cl-line" data-flag={f?.flag ?? c?.lines?.[i]?.flag ?? 'NONE'}>
                  <th scope="row" data-label="#">{i + 1}</th>
                  <td data-label={t('claim.category')}><select value={l.category} disabled={!editable} onChange={(e) => set(l.key, { category: e.target.value })} aria-label={t('claim.category')} data-testid="cl-category">{CATS.map((x) => <option key={x} value={x}>{t(`cat.${x}`)}</option>)}</select></td>
                  <td data-label={t('claim.date')}><input type="date" value={l.date} disabled={!editable} onChange={(e) => set(l.key, { date: e.target.value })} aria-label={t('claim.date')} data-testid="cl-date" /></td>
                  <td data-label={t('claim.description')}><input value={l.description} maxLength={200} disabled={!editable} onChange={(e) => set(l.key, { description: e.target.value })} aria-label={t('claim.description')} data-testid="cl-desc" />
                    {l.category === 'PER_DIEM' && <label>{t('claim.days')} <input type="number" min="1" value={l.days} disabled={!editable} onChange={(e) => set(l.key, { days: e.target.value })} data-testid="cl-days" /></label>}
                    {l.category === 'MILEAGE' && <label>{t('claim.km')} <input type="number" min="1" value={l.km} disabled={!editable} onChange={(e) => set(l.key, { km: e.target.value })} data-testid="cl-km" /></label>}
                    {!computed && <input value={l.vendorName} maxLength={120} placeholder={t('claim.vendor')} aria-label={t('claim.vendor')} disabled={!editable} onChange={(e) => set(l.key, { vendorName: e.target.value })} data-testid="cl-vendor" />}
                    {!computed && <input value={l.vendorGstin} maxLength={15} placeholder="GSTIN" aria-label="GSTIN" disabled={!editable} onChange={(e) => set(l.key, { vendorGstin: e.target.value.toUpperCase() })} data-testid="cl-gstin" />}
                    <LookupField id={`cl-proj-${l.key}`} label={t('claim.project')} lookup="iam/projects" value={l.projectId} onChange={(x) => set(l.key, { projectId: x })} readOnly={!editable} compact />
                    {canCost && <LookupField id={`cl-cc-${l.key}`} label={t('claim.costCode')} lookup="fin/cost-codes" value={l.costCodeId} onChange={(x) => set(l.key, { costCodeId: x })} readOnly={!editable} compact />}
                  </td>
                  <td data-label={t('claim.amount')}>{computed ? <strong data-testid="cl-computed">{f?.amount != null ? inr(f.amount) : '—'}</strong> : <input type="number" min="0" step="0.01" value={l.amount} disabled={!editable} onChange={(e) => set(l.key, { amount: e.target.value })} aria-label={t('claim.amount')} data-testid="cl-amount" />}</td>
                  <td data-label="GST">{computed ? '—' : <input type="number" min="0" step="0.01" value={l.gst} disabled={!editable} onChange={(e) => set(l.key, { gst: e.target.value })} aria-label="GST" data-testid="cl-gst" />}</td>
                  <td data-label={t('claim.invoice')}>{computed ? '—' : <input value={l.invoiceNo} maxLength={40} disabled={!editable} onChange={(e) => set(l.key, { invoiceNo: e.target.value })} aria-label={t('claim.invoice')} data-testid="cl-invoice" />}</td>
                  <td data-label={t('claim.bill')}>{computed ? '—' : l.fileId ? <a href={`/api/v1/core/files/${l.fileId}/download`} target="_blank" rel="noreferrer" data-testid="cl-bill">{t('claim.open')}</a> : editable && id ? <label className="btn btn-small">{t('claim.takePhoto')}<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => photo(l.key, e.target.files?.[0])} data-testid="cl-photo" /></label> : <span className="muted small">{editable ? t('claim.saveFirst') : '—'}</span>}</td>
                  <td data-label={t('claim.flag')}>{(f?.flag ?? c?.lines?.[i]?.flag ?? 'NONE') !== 'NONE' && <div><StatusBadge status="AT_RISK" label={t(`flag.${f?.flag ?? c.lines[i].flag}`)} /> <span className="small" data-testid="cl-flag-text">{f?.flagText ?? c?.lines?.[i]?.flagText}</span>
                    <label>{t('claim.justification')} <textarea rows="2" value={l.justification} disabled={!editable} onChange={(e) => set(l.key, { justification: e.target.value })} data-testid="cl-justification" /></label></div>}
                    {problem(i, 'amount') && <p className="field-error" role="alert">{problem(i, 'amount')}</p>}
                    {editable && lines.length > 1 && <button type="button" className="btn btn-small" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t('claim.removeLine', { n: i + 1 })} data-testid="cl-remove-line">×</button>}</td>
                </tr>);
            })}</tbody>
          </table>
        </div>
        {editable && <div className="actions"><button type="button" className="btn" onClick={() => setLines((ls) => [...ls, blankLine()])} data-testid="cl-add-line">{t('claim.addLine')}</button></div>}
        <dl className="op-figures" data-testid="cl-totals">
          <div><dt>{t('claim.total')}</dt><dd data-testid="cl-total">{inr(pv?.total ?? c?.total)}</dd></div><div><dt>GST</dt><dd>{inr(pv?.gst ?? c?.gst)}</dd></div>
          <div><dt>{t('claim.adjusted')}</dt><dd data-testid="cl-adjusted">{inr(pv?.advanceAdjusted ?? c?.advanceAdjusted)}</dd></div><div><dt>{t('claim.net')}</dt><dd data-testid="cl-net">{inr(pv?.netPayable ?? c?.netPayable)}</dd></div>
          <div><dt>{t('claim.recoverable')}</dt><dd>{inr(pv?.recoverable ?? c?.recoverable)}</dd></div><div><dt>{t('claim.level')}</dt><dd data-testid="cl-level">{t(`level.${pv?.level ?? c?.level ?? 1}`)}</dd></div>
        </dl>
        {editable && needs.length > 0 && <ul className="mdm-list" data-testid="cl-needs" aria-label={t('claim.toFix')}>{needs.map((n, i) => <li key={i} className="field-error">{n.message}</li>)}</ul>}
        <div className="actions no-print">
          {editable && <button type="submit" className="btn" disabled={Boolean(busy)} data-testid="cl-save">{t('act.saveDraft')}</button>}
          {editable && <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => save(true)} data-testid="cl-send">{t('act.saveSend')}</button>}
        </div>
      </form>
      {c && (
        <div className="actions-row no-print" data-testid="cl-actions">
          {c.can.delete && <button type="button" className="btn" onClick={() => run(async () => { await exp.removeClaim(id); navigateTo('/expenses', { force: true }); })} data-testid="cl-delete">{t('act.delete')}</button>}
          {c.can.withdraw && <button type="button" className="btn" onClick={() => { const why = window.prompt(t('act.why')); if (why) run(() => exp.claimAct(id, 'withdraw', { reason: why })); }} data-testid="cl-withdraw">{t('act.withdraw')}</button>}
          {c.can.cancel && <button type="button" className="btn" onClick={() => { const why = window.prompt(t('act.why')); if (why) run(() => exp.claimAct(id, 'cancel', { reason: why })); }} data-testid="cl-cancel">{t('act.cancel')}</button>}
          {c.can.pass && <button type="button" className="btn btn-primary" onClick={() => run(() => exp.claimAct(id, 'pass'), t('claim.passed'))} data-testid="cl-pass">{t('claim.pass')}</button>}
          {c.can.paid && <button type="button" className="btn btn-primary" onClick={() => { const ref = window.prompt(t('claim.payRef')); if (ref) run(() => exp.claimAct(id, 'paid', { reference: ref }), t('claim.paidNote')); }} data-testid="cl-paid">{t('claim.markPaid')}</button>}
          {c.can.print && <a className="btn" href={`/api/v1/hr/claims/${id}/print`} target="_blank" rel="noreferrer" data-testid="cl-print">{t('act.print')}</a>}
        </div>
      )}
      {h.data && (h.data.approvals.length > 0 || h.data.audit.length > 0) && <><h2>{t('act.history')}</h2><ul className="mdm-list" data-testid="cl-history">{[...h.data.approvals.map((a) => ({ at: a.at, text: `${a.event} · ${a.actor}${a.comment ? `: ${a.comment}` : ''}` })), ...h.data.audit.map((a) => ({ at: a.at, text: `${a.action} · ${a.by}${a.reason ? `: ${a.reason}` : ''}` }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((x, i) => <li key={i}><span className="muted small">{String(x.at).slice(0, 16).replace('T', ' ')}</span> {x.text}</li>)}</ul></>}
      <p className="small"><Link to="/expenses">{t('my.title')}</Link></p>
    </section>
  );
}
