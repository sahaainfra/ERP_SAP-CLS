import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { addDays, fmtDate, fmtQty, fmtRs, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Create an RFQ from approved purchase requisition lines (part 15.03, FR-01, FR-02): choose the project, the lines (from one or many requisitions) and how much of each, the terms and the due date, then the vendors from the active ones of the
// partner master (the list shows which match the category of the lines; a vendor on hold or blacklisted cannot be chosen). Fewer vendors than the minimum on a value above the threshold needs a written reason.
export default function RfqNewPage() {
  const t = useT('proc'); usePageTitle(t('q.new')); const sp = useSearch(); const editId = Number(sp.get('edit')) || null;
  const pq = useQuery({ queryKey: ['proc', 'projects'], queryFn: pc.projects, retry: false });
  const eq = useQuery({ queryKey: ['proc', 'rfq', editId], queryFn: () => pc.rfq(editId), enabled: Boolean(editId), retry: false });
  const [f, setF] = useState(null); const [pick, setPick] = useState(null); const [vend, setVend] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const e = eq.data; const projects = pq.data ?? [];
  const form = f ?? { projectId: e ? String(e.projectId) : '', title: e?.title ?? '', dueDate: e?.dueDate ?? addDays(7), delivery: e?.terms?.delivery ?? '', payment: e?.terms?.payment ?? '', validityDays: e?.terms?.validityDays ? String(e.terms.validityDays) : '30', technicalSpecs: e?.terms?.technicalSpecs ?? '', approvedMakes: e?.terms?.approvedMakes ?? '', justification: e?.justification ?? '' };
  const projectId = form.projectId || (projects[0] ? String(projects[0].id) : '');
  const chosen = pick ?? (e ? Object.fromEntries(e.lines.map((l) => [l.prLineId, String(l.qty)])) : {});
  const ids = Object.keys(chosen).map(Number);
  const oq = useQuery({ queryKey: ['proc', 'rfq-options', projectId, ids.join(',')], queryFn: () => pc.rfqOptions(projectId, ids), enabled: Boolean(projectId), retry: false, placeholderData: (prev) => prev }); const o = oq.data;
  const vendors = vend ?? (e ? Object.fromEntries(e.vendors.map((v) => [v.vendorId, v.channel])) : {});
  const count = Object.keys(vendors).length;
  if (pq.error?.status === 403 || oq.error?.status === 403) return <NoPermission what={t('q.new')} permission="proc.rfq.create" />;
  if (pq.isPending || (editId && eq.isPending)) return <Skeleton label={t('q.new')} rows={4} />;
  const set = (k, v) => setF({ ...form, [k]: v });
  const toggleLine = (l) => { const next = { ...chosen }; if (next[l.id]) delete next[l.id]; else next[l.id] = String(l.qty); setPick(next); };
  const toggleVendor = (v) => { const next = { ...vendors }; if (next[v.id]) delete next[v.id]; else next[v.id] = v.email ? 'EMAIL' : v.mobile ? 'WHATSAPP' : 'LINK'; setVend(next); };
  const body = () => ({ title: form.title.trim(), dueDate: form.dueDate, justification: form.justification.trim() || null, terms: { delivery: form.delivery.trim() || null, payment: form.payment.trim() || null, validityDays: form.validityDays ? Number(form.validityDays) : null, technicalSpecs: form.technicalSpecs.trim() || null, approvedMakes: form.approvedMakes.trim() || null },
    lines: ids.map((id) => ({ prLineId: id, qty: Number(chosen[id]) })), vendors: Object.entries(vendors).map(([vendorId, channel]) => ({ vendorId: Number(vendorId), channel })) });
  const save = async () => { setError(null); setBusy(true); try { const d = editId ? await pc.rfqUpdate(editId, { ...body(), rowVersion: e.rowVersion }) : await pc.rfqCreate({ projectId: Number(projectId), ...body() }); navigateTo(`/proc/rfqs?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="rfn-h" data-testid="proc-rfq-form">
      <PageHeader id="rfn-h" title={editId ? t('q.edit') : t('q.new')} subtitle={t('q.newHelp')} meta={<Link to="/proc/rfqs">{t('q.back')}</Link>} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(); }} noValidate>
        <div className="form-grid">
          <Field label={t('q.project')} name="projectId" error={error}><select value={projectId} disabled={Boolean(editId)} onChange={(ev) => { setF({ ...form, projectId: ev.target.value }); setPick({}); setVend({}); }} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="rfn-project">{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
          <Field label={t('q.rfqTitle')} name="title" error={error}><input value={form.title} maxLength={200} onChange={(ev) => set('title', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="rfn-title" /></Field>
          <Field label={t('q.dueDate')} name="dueDate" error={error}><input type="date" value={form.dueDate} min={o ? undefined : undefined} onChange={(ev) => set('dueDate', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="rfn-due" /></Field>
          <Field label={t('q.delivery')} name="terms.delivery" error={error}><input value={form.delivery} maxLength={300} onChange={(ev) => set('delivery', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="rfn-delivery" /></Field>
          <Field label={t('q.payment')} name="terms.payment" error={error}><input value={form.payment} maxLength={300} onChange={(ev) => set('payment', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} /></Field>
          <Field label={t('q.validity')} name="terms.validityDays" error={error}><input type="number" min="1" max="365" value={form.validityDays} onChange={(ev) => set('validityDays', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} /></Field>
          <Field label={t('q.techSpecs')} name="terms.technicalSpecs" error={error}><input value={form.technicalSpecs} maxLength={2000} onChange={(ev) => set('technicalSpecs', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} /></Field>
          <Field label={t('q.makes')} name="terms.approvedMakes" error={error}><input value={form.approvedMakes} maxLength={500} onChange={(ev) => set('approvedMakes', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} /></Field>
        </div>
        <h2>{t('q.pickLines')}</h2>
        {oq.isPending && projectId && <Skeleton label={t('q.pickLines')} rows={2} />}
        {o && o.requisitionLines.length === 0 && <p className="muted" data-testid="rfn-no-lines">{t('q.noLines')}</p>}
        {o && o.requisitionLines.length > 0 && (
          <div className="table-scroll"><table className="data-table" data-testid="rfn-lines"><thead><tr><th /><th>{t('q.requisition')}</th><th>{t('q.item')}</th><th className="num">{t('q.balance')}</th><th className="num">{t('q.rfqQty')}</th><th>{t('q.requiredBy')}</th></tr></thead>
            <tbody>{o.requisitionLines.map((l) => <tr key={l.id} data-testid="rfn-line"><td><input type="checkbox" checked={Boolean(chosen[l.id])} onChange={() => toggleLine(l)} aria-label={`${l.prNo} #${l.lineNo}`} style={{ width: 24, height: 24 }} data-testid="rfn-line-check" /></td><td>{l.prNo} #{l.lineNo}{l.openRfqs > 0 && <div className="muted small">{t('q.onOpenRfq', { n: l.openRfqs })}</div>}</td><td>{l.itemCode ? `${l.itemCode} · ` : ''}{l.itemName}</td><td className="num">{fmtQty(l.qty)} {l.uom}</td>
              <td className="num">{chosen[l.id] != null ? <input type="number" min="0" step="0.001" max={l.qty} value={chosen[l.id]} onChange={(ev) => setPick({ ...chosen, [l.id]: ev.target.value })} style={{ minHeight: 40, width: 110 }} aria-label={t('q.rfqQty')} data-testid="rfn-line-qty" /> : '—'}</td><td>{fmtDate(l.requiredBy)}</td></tr>)}</tbody></table></div>)}
        <h2>{t('q.pickVendors')}</h2><p className="muted">{t('q.vendorsHelp', { n: o?.minVendors ?? 3, v: fmtRs(o?.thresholdValue) })}</p>
        {o && (
          <div className="table-scroll"><table className="data-table" data-testid="rfn-vendors"><thead><tr><th /><th>{t('q.vendor')}</th><th>{t('q.match')}</th><th>{t('q.contact')}</th><th>{t('q.channel')}</th></tr></thead>
            <tbody>{o.vendors.map((v) => <tr key={v.id} data-testid="rfn-vendor" data-vendor={v.code} data-eligible={v.eligible ? '1' : '0'}><td><input type="checkbox" disabled={!v.eligible} checked={Boolean(vendors[v.id])} onChange={() => toggleVendor(v)} aria-label={v.name} style={{ width: 24, height: 24 }} data-testid="rfn-vendor-check" /></td><td>{v.name} <span className="muted small">{v.code}</span></td>
              <td>{v.eligible ? (v.match ? <StatusBadge status="APPROVED" label={t('q.matches')} /> : <span className="muted">—</span>) : <StatusBadge status="REJECTED" label={v.excludedReason} />}</td><td className="small">{v.email ?? ''} {v.mobile ?? ''}</td>
              <td>{vendors[v.id] ? <select value={vendors[v.id]} onChange={(ev) => setVend({ ...vendors, [v.id]: ev.target.value })} style={{ minHeight: 40 }} aria-label={t('q.channel')}>{['EMAIL', 'WHATSAPP', 'LINK'].map((c) => <option key={c} value={c}>{t(`q.ch.${c}`)}</option>)}</select> : ''}</td></tr>)}</tbody></table></div>)}
        {o && count < o.minVendors && count > 0 && <p className="mdm-banner" role="status" data-testid="rfn-few">{t('q.fewVendors', { n: o.minVendors })}</p>}
        {count > 0 && o && count < o.minVendors && <Field label={t('q.justification')} name="justification" error={error} hint={t('q.justHint')}><textarea value={form.justification} maxLength={1000} rows={3} onChange={(ev) => set('justification', ev.target.value)} style={{ width: '100%' }} data-testid="rfn-justification" /></Field>}
        {error?.form && <p className="field-error" role="alert" data-testid="rfn-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy || !projectId || ids.length === 0 || !form.title.trim()} data-testid="rfn-save">{t('q.saveDraft')}</button></div>
      </form>
    </section>
  );
}
