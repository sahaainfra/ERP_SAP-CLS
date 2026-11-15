import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { RC_TONE, addDays, download, fmtDate, fmtQty, fmtRs, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Service orders (part 15.06, FR-05): the list; the order with its scope, deliverables, lines priced as a lump sum, per unit or per month, what is certified so far and its service entry sheets; a form to make one. Approval is by value as for a purchase order;
// the commitment is posted on approval and released when the order is closed. Certification is by service entry sheets.
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['proc'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function So({ t, id }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['proc', 'so', id], queryFn: () => pc.so(id), retry: false });
  const hq = useQuery({ queryKey: ['proc', 'so-history', id, q.data?.status], queryFn: () => pc.soHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [comment, setComment] = useState('');
  usePageTitle(t('s.title'));
  if (q.error?.status === 403) return <NoPermission what={t('s.title')} permission="proc.service_order.view" />;
  if (q.isPending) return <Skeleton label={t('s.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can; const m = (n) => (r.canSeeRates ? fmtRs(n) : '—');
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (action, msg) => { const x = window.prompt(t('s.why')); if (x) run(() => pc.soAct(r.id, action, { reason: x }), msg).then((d) => { if (d && action === 'amend') navigateTo(`/proc/service-orders?id=${d.id}`); }); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('s.sayWhy') }); return; } run(() => pc.decide(r.taskId, action, comment.trim() || null), t(`s.done.${action}`)); };
  return (
    <div data-testid="so-object" data-status={r.status}>
      <PageHeader id="so-h" title={<>{r.docNo} <StatusBadge status={RC_TONE[r.status]} label={t(`s.s.${r.status}`)} /></>} meta={<><Link to="/proc/service-orders">{t('s.back')}</Link> · {r.title}</>} />
      <dl className="kv" data-testid="so-figures"><div><dt>{t('s.project')}</dt><dd>{r.projectCode}</dd></div><div><dt>{t('s.vendor')}</dt><dd>{r.vendor}</dd></div><div><dt>{t('s.period')}</dt><dd>{fmtDate(r.startDate)} – {fmtDate(r.endDate)}</dd></div><div><dt>{t('s.value')}</dt><dd data-testid="so-value">{m(r.totalValue)}</dd></div><div><dt>{t('s.certified')}</dt><dd data-testid="so-certified">{m(r.certifiedValue)} · {r.certifiedPct}%</dd></div>{r.paymentTerms && <div><dt>{t('s.payment')}</dt><dd>{r.paymentTerms}</dd></div>}</dl>
      <p><strong>{t('s.scope')}:</strong> {r.scope}</p>{r.deliverables && <p><strong>{t('s.deliverables')}:</strong> {r.deliverables}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="so-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="so-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="so-lines"><caption>{t('s.lines')}</caption><thead><tr><th>#</th><th>{t('s.service')}</th><th>{t('s.pricing')}</th><th className="num">{t('s.qty')}</th>{r.canSeeRates && <><th className="num">{t('s.rate')}</th><th className="num">{t('s.amount')}</th></>}<th className="num">{t('s.certifiedQty')}</th><th className="num">{t('s.balance')}</th></tr></thead>
        <tbody>{r.lines.map((l) => <tr key={l.id} data-testid="so-line"><td>{l.lineNo}</td><td>{l.description}</td><td>{l.pricingLabel}</td><td className="num">{fmtQty(l.qty)} {l.uom}</td>{r.canSeeRates && <><td className="num">{fmtRs(l.rate)}</td><td className="num">{fmtRs(l.amount)}</td></>}<td className="num">{fmtQty(l.certifiedQty)}</td><td className="num">{fmtQty(l.balanceQty)}</td></tr>)}</tbody></table></div>
      <div className="actions-row no-print">
        {can.edit && <Link to={`/proc/service-orders?new=1&edit=${r.id}`}>{t('s.edit')}</Link>}
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pc.soAct(r.id, 'submit'), t('s.submitted'))} data-testid="so-submit">{t('s.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('s.withdrawn'))}>{t('s.withdraw')}</button>}
        {can.enter && <Link to={`/proc/service-entries?new=1&so=${r.id}`}>{t('s.newEntry')}</Link>}
        {can.amend && <button type="button" className="btn" onClick={() => why('amend')} data-testid="so-amend">{t('s.amend')}</button>}
        {can.close && <button type="button" className="btn" onClick={() => why('close', t('s.closed'))} data-testid="so-close">{t('s.close')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('s.cancelled'))} data-testid="so-cancel">{t('s.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('s.deleteAsk')) && await run(() => pc.soDelete(r.id))) navigateTo('/proc/service-orders'); }}>{t('s.delete')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/service-orders/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('s.fileFailed') }))} data-testid="so-print">{t('s.print')}</button>}
        {r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('s.approval')}</Link>}
      </div>
      {r.taskId && <div className="mdm-panel no-print" data-testid="so-decide"><h2>{t('s.decide')}</h2><label>{t('s.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="so-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="so-approve">{t('s.approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('s.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('s.reject')}</button></div></div>}
      {r.entries.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="so-entries"><caption>{t('s.entries')}</caption><thead><tr><th>{t('s.sheet')}</th><th>{t('s.period')}</th>{r.canSeeRates && <th className="num">{t('s.amount')}</th>}<th>{t('s.status')}</th></tr></thead><tbody>{r.entries.map((e) => <tr key={e.id} data-testid="so-entry"><td><Link to={`/proc/service-entries?id=${e.id}`}>{e.docNo}</Link></td><td>{fmtDate(e.periodFrom)} – {fmtDate(e.periodTo)}</td>{r.canSeeRates && <td className="num">{fmtRs(e.amount)}</td>}<td>{t(`s.es.${e.status}`)}</td></tr>)}</tbody></table></div>}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="so-history"><caption>{t('s.history')}</caption><thead><tr><th>{t('s.when')}</th><th>{t('s.who')}</th><th>{t('s.what')}</th><th>{t('s.comment')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table></div>)}
    </div>
  );
}

function SoForm({ t, editId }) {
  const pq = useQuery({ queryKey: ['proc', 'projects'], queryFn: pc.projects, retry: false }); const eq = useQuery({ queryKey: ['proc', 'so', editId], queryFn: () => pc.so(editId), enabled: Boolean(editId), retry: false });
  const [f, setF] = useState(null); const [rows, setRows] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const e = eq.data; const projectId = f?.projectId || (e ? String(e.projectId) : pq.data?.[0] ? String(pq.data[0].id) : '');
  const oq = useQuery({ queryKey: ['proc', 'so-options', projectId], queryFn: () => pc.soOptions(projectId), enabled: Boolean(projectId), retry: false }); const o = oq.data;
  const form = f ?? { vendorId: e ? String(e.vendorId) : '', title: e?.title ?? '', scope: e?.scope ?? '', deliverables: e?.deliverables ?? '', startDate: e?.startDate ?? addDays(0), endDate: e?.endDate ?? addDays(180), paymentTerms: e?.paymentTerms ?? '', siteId: e?.siteId ? String(e.siteId) : '' };
  const lines = rows ?? (e ? e.lines.map((l) => ({ description: l.description, pricingKind: l.pricingKind, uom: l.uom, qty: String(l.qty), rate: l.rate == null ? '' : String(l.rate) })) : [{ description: '', pricingKind: 'PER_UNIT', uom: 'unit', qty: '1', rate: '' }]);
  usePageTitle(t('s.new'));
  if (pq.error?.status === 403 || oq.error?.status === 403) return <NoPermission what={t('s.new')} permission="proc.service_order.create" />;
  if (pq.isPending || (editId && eq.isPending)) return <Skeleton label={t('s.new')} rows={4} />;
  const set = (k, v) => setF({ ...form, [k]: v }); const setRow = (i, k, v) => setRows(lines.map((l, j) => (j === i ? { ...l, [k]: v, ...(k === 'pricingKind' ? { uom: v === 'PER_MONTH' ? 'month' : v === 'LUMP_SUM' ? 'LS' : 'unit', qty: v === 'LUMP_SUM' ? '1' : l.qty } : {}) } : l)));
  const body = () => ({ siteId: form.siteId ? Number(form.siteId) : null, title: form.title.trim(), scope: form.scope.trim(), deliverables: form.deliverables.trim() || null, startDate: form.startDate, endDate: form.endDate, paymentTerms: form.paymentTerms.trim() || null, lines: lines.map((l) => ({ description: l.description.trim(), pricingKind: l.pricingKind, uom: l.uom || undefined, qty: Number(l.qty), rate: Number(l.rate) })) });
  const save = async () => { setError(null); setBusy(true); try { const d = editId ? await pc.soUpdate(editId, { ...body(), rowVersion: e.rowVersion }) : await pc.soCreate({ projectId: Number(projectId), vendorId: Number(form.vendorId), ...body() }); navigateTo(`/proc/service-orders?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="son-h" data-testid="proc-so-form"><PageHeader id="son-h" title={editId ? t('s.edit') : t('s.new')} subtitle={t('s.newHelp')} meta={<Link to="/proc/service-orders">{t('s.back')}</Link>} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(); }} noValidate>
        <div className="form-grid">
          <Field label={t('s.project')} name="projectId" error={error}><select value={projectId} disabled={Boolean(editId)} onChange={(ev) => setF({ ...form, projectId: ev.target.value })} style={{ minHeight: 44 }} data-testid="son-project">{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
          <Field label={t('s.vendor')} name="vendorId" error={error}><select value={form.vendorId} disabled={Boolean(editId)} onChange={(ev) => set('vendorId', ev.target.value)} style={{ minHeight: 44 }} data-testid="son-vendor"><option value="">{t('s.choose')}</option>{(o?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          <Field label={t('s.titleField')} name="title" error={error}><input value={form.title} maxLength={200} onChange={(ev) => set('title', ev.target.value)} style={{ minHeight: 44 }} data-testid="son-title" /></Field>
          <Field label={t('s.site')} name="siteId" error={error}><select value={form.siteId} onChange={(ev) => set('siteId', ev.target.value)} style={{ minHeight: 44 }}><option value="">{t('s.none')}</option>{(o?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></Field>
          <Field label={t('s.startDate')} name="startDate" error={error}><input type="date" value={form.startDate} onChange={(ev) => set('startDate', ev.target.value)} style={{ minHeight: 44 }} /></Field>
          <Field label={t('s.endDate')} name="endDate" error={error}><input type="date" value={form.endDate} onChange={(ev) => set('endDate', ev.target.value)} style={{ minHeight: 44 }} data-testid="son-end" /></Field>
          <Field label={t('s.payment')} name="paymentTerms" error={error}><input value={form.paymentTerms} maxLength={500} onChange={(ev) => set('paymentTerms', ev.target.value)} style={{ minHeight: 44 }} /></Field>
          <Field label={t('s.deliverables')} name="deliverables" error={error}><input value={form.deliverables} maxLength={2000} onChange={(ev) => set('deliverables', ev.target.value)} style={{ minHeight: 44 }} /></Field></div>
        <Field label={t('s.scope')} name="scope" error={error}><textarea rows={3} value={form.scope} maxLength={3000} onChange={(ev) => set('scope', ev.target.value)} style={{ width: '100%' }} data-testid="son-scope" /></Field>
        <h2>{t('s.lines')}</h2>
        {lines.map((l, i) => <div key={i} className="mdm-panel" data-testid="son-line"><div className="form-grid">
          <Field label={t('s.service')} name={`lines.${i}.description`} error={error}><input value={l.description} maxLength={300} onChange={(ev) => setRow(i, 'description', ev.target.value)} style={{ minHeight: 44 }} data-testid="son-desc" /></Field>
          <Field label={t('s.pricing')} name={`lines.${i}.pricingKind`} error={error}><select value={l.pricingKind} onChange={(ev) => setRow(i, 'pricingKind', ev.target.value)} style={{ minHeight: 44 }} data-testid="son-kind">{Object.entries(o?.kinds ?? { PER_UNIT: 'Per unit', PER_MONTH: 'Per month', LUMP_SUM: 'Lump sum' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label={t('s.uom')} name={`lines.${i}.uom`} error={error}><input value={l.uom} maxLength={20} onChange={(ev) => setRow(i, 'uom', ev.target.value)} style={{ minHeight: 44 }} /></Field>
          <Field label={t('s.qty')} name={`lines.${i}.qty`} error={error}><input type="number" min="0" step="0.001" value={l.qty} disabled={l.pricingKind === 'LUMP_SUM'} onChange={(ev) => setRow(i, 'qty', ev.target.value)} style={{ minHeight: 44 }} data-testid="son-qty" /></Field>
          <Field label={t('s.rate')} name={`lines.${i}.rate`} error={error}><input type="number" min="0" step="0.01" value={l.rate} onChange={(ev) => setRow(i, 'rate', ev.target.value)} style={{ minHeight: 44 }} data-testid="son-rate" /></Field></div>
          {lines.length > 1 && <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setRows(lines.filter((_, j) => j !== i))}>{t('s.removeLine')}</button>}</div>)}
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} onClick={() => setRows([...lines, { description: '', pricingKind: 'PER_UNIT', uom: 'unit', qty: '1', rate: '' }])} data-testid="son-add">{t('s.addLine')}</button></div>
        {error?.form && <p className="field-error" role="alert" data-testid="son-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !projectId || !form.title.trim() || !form.vendorId} data-testid="son-save">{t('s.saveDraft')}</button></div></form></section>
  );
}

export default function ServiceOrdersPage() {
  const t = useT('proc'); usePageTitle(t('s.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (sp.get('new') === '1') return <SoForm key={sp.get('edit') ?? 'new'} t={t} editId={Number(sp.get('edit')) || null} />;
  if (id) return <section aria-labelledby="so-h" data-testid="proc-sos"><So key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="sos-h" data-testid="proc-sos"><PageHeader id="sos-h" title={t('s.title')} subtitle={t('s.intro')} />
      <div className="actions-row no-print">{perms.includes('proc.service_order.create') && <Link to="/proc/service-orders?new=1">{t('s.new')}</Link>} <Link to="/proc/service-entries">{t('s.entriesTitle')}</Link></div>
      <ListReport listCode="proc.service_orders" endpoint="/proc/service-orders" title={t('s.title')} session={session.data} rowHref={(r) => `/proc/service-orders?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/service-orders?id=${r.id}`)}
        cardFields={['docNo', 'vendor', 'project', 'value', 'certified']} statusKey="status" empty={{ title: t('s.emptyTitle'), text: t('s.emptyBody') }} /></section>
  );
}
