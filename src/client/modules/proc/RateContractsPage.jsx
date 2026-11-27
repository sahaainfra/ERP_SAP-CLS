import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import ItemSelector from '../../platform/items/ItemSelector.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { PO_TONE, RC_TONE, addDays, download, fmtDate, fmtQty, fmtRs, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Rate contracts (part 15.06): the list with consumption and expiry; the contract with its rates and ceilings, the call-off orders made from it, the price-variation history and the index; a form to make or change one. A call-off is made from the contract
// (Create purchase order) within its validity and ceilings; a price-variation revision is worked out from the index and applied only when approved.
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['proc'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function Rc({ t, id }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['proc', 'rc', id], queryFn: () => pc.rc(id), retry: false });
  const hq = useQuery({ queryKey: ['proc', 'rc-history', id, q.data?.status, q.data?.revisions?.length], queryFn: () => pc.rcHistory(id), enabled: q.isSuccess, retry: false });
  const iq = useQuery({ queryKey: ['proc', 'rc-indices', q.data?.pv?.indexCode], queryFn: () => pc.indices(q.data.pv.indexCode), enabled: Boolean(q.data?.pv?.indexCode), retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [comment, setComment] = useState(''); const [ix, setIx] = useState({ period: '', value: '' }); const [period, setPeriod] = useState('');
  usePageTitle(t('r.title'));
  if (q.error?.status === 403) return <NoPermission what={t('r.title')} permission="proc.rate_contract.view" />;
  if (q.isPending) return <Skeleton label={t('r.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can; const m = (n) => (r.canSeeRates ? fmtRs(n) : '—');
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (action, msg) => { const x = window.prompt(t('r.why')); if (x) run(() => pc.rcAct(r.id, action, { reason: x }), msg).then((d) => { if (d && action === 'amend') navigateTo(`/proc/rate-contracts?id=${d.id}`); }); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('r.sayWhy') }); return; } run(() => pc.decide(r.taskId, action, comment.trim() || null), t(`r.done.${action}`)); };
  return (
    <div data-testid="rc-object" data-status={r.status}>
      <PageHeader id="rc-h" title={<>{r.docNo} <StatusBadge status={RC_TONE[r.status]} label={t(`r.s.${r.status}`)} />{r.expired && <> <StatusBadge status="AT_RISK" label={t('r.expired')} /></>}</>} meta={<><Link to="/proc/rate-contracts">{t('r.back')}</Link> · {r.title}</>} />
      <dl className="kv" data-testid="rc-figures"><div><dt>{t('r.vendor')}</dt><dd>{r.vendor}</dd></div><div><dt>{t('r.validity')}</dt><dd>{fmtDate(r.validFrom)} – {fmtDate(r.validTo)}{r.status === 'APPROVED' && ` (${r.daysLeft} ${t('r.daysLeft')})`}</dd></div>
        <div><dt>{t('r.ceilingValue')}</dt><dd>{r.ceilingValue ? m(r.ceilingValue) : t('r.none')}</dd></div><div><dt>{t('r.used')}</dt><dd data-testid="rc-used">{m(r.consumedValue)} · {r.usedPct}%</dd></div>
        <div><dt>{t('r.pv')}</dt><dd>{r.pv ? `${r.pv.indexCode} (${r.pv.source}), ${t(`r.freq.${r.pv.frequency}`)}, ${t('r.base')} ${r.pv.baseIndex} ${r.pv.basePeriod}, ${r.pv.linkedPct}% ${t('r.linked')}` : t('r.none')}</dd></div>{r.paymentTerms && <div><dt>{t('r.payment')}</dt><dd>{r.paymentTerms}</dd></div>}</dl>
      <progress value={Math.min(100, r.usedPct)} max="100" aria-label={t('r.used')} style={{ width: '100%' }} data-testid="rc-bar" />
      {r.warnings.map((w, i) => <p key={i} className="mdm-banner" role="status" data-testid="rc-warning">{w.message}</p>)}
      {error?.form && <p className="field-error" role="alert" data-testid="rc-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="rc-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="rc-lines"><caption>{t('r.lines')}</caption><thead><tr><th>#</th><th>{t('r.item')}</th><th>{t('r.uom')}</th>{r.canSeeRates && <><th className="num">{t('r.rate')}</th><th className="num">{t('r.baseRate')}</th></>}<th className="num">{t('r.ceilingQty')}</th><th className="num">{t('r.consumed')}</th><th className="num">{t('r.remaining')}</th><th>{t('r.pvLinked')}</th></tr></thead>
        <tbody>{r.lines.map((l) => <tr key={l.id} data-testid="rc-line"><td>{l.lineNo}</td><td>{l.itemCode ? `${l.itemCode} · ` : ''}{l.description}</td><td>{l.uom}</td>{r.canSeeRates && <><td className="num" data-testid="rc-rate">{fmtRs(l.rate)}</td><td className="num">{fmtRs(l.baseRate)}</td></>}<td className="num">{l.ceilingQty ? fmtQty(l.ceilingQty) : '—'}</td><td className="num">{fmtQty(l.consumedQty)}{l.usedPct != null ? ` (${l.usedPct}%)` : ''}</td><td className="num">{l.remainingQty == null ? '—' : fmtQty(l.remainingQty)}</td><td>{l.pvLinked ? t('r.yes') : ''}</td></tr>)}</tbody></table></div>
      <div className="actions-row no-print">
        {can.edit && <Link to={`/proc/rate-contracts?new=1&edit=${r.id}`}>{t('r.edit')}</Link>}
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pc.rcAct(r.id, 'submit'), t('r.submitted'))} data-testid="rc-submit">{t('r.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('r.withdrawn'))}>{t('r.withdraw')}</button>}
        {can.calloff && <Link to={`/proc/po-new?rc=${r.id}`}>{t('r.callOff')}</Link>}
        {can.amend && <button type="button" className="btn" onClick={() => why('amend')} data-testid="rc-amend">{t('r.amend')}</button>}
        {can.close && <button type="button" className="btn" onClick={() => why('close', t('r.closed'))} data-testid="rc-close">{t('r.close')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('r.cancelled'))} data-testid="rc-cancel">{t('r.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('r.deleteAsk')) && await run(() => pc.rcDelete(r.id))) navigateTo('/proc/rate-contracts'); }}>{t('r.delete')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/rate-contracts/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('r.fileFailed') }))} data-testid="rc-print">{t('r.print')}</button>}
        {r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('r.approval')}</Link>}
      </div>
      {r.taskId && <div className="mdm-panel no-print" data-testid="rc-decide"><h2>{t('r.decide')}</h2><label>{t('r.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="rc-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="rc-approve">{t('r.approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('r.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('r.reject')}</button></div></div>}
      {r.pv && r.status === 'APPROVED' && (
        <div className="mdm-panel" data-testid="rc-pv"><h2>{t('r.pvTitle')}</h2><p className="muted">{t('r.pvHelp')}</p>
          {iq.data && iq.data.length > 0 && <p className="small" data-testid="rc-indices">{iq.data.slice(0, 6).map((x) => `${x.period}: ${x.value}`).join(' · ')}</p>}
          <div className="actions-row no-print"><input value={ix.period} placeholder="2026-11" maxLength={7} onChange={(e) => setIx({ ...ix, period: e.target.value })} style={{ minHeight: 44, width: 110 }} aria-label={t('r.period')} data-testid="rc-ix-period" /><input type="number" step="0.01" value={ix.value} placeholder={t('r.indexValue')} onChange={(e) => setIx({ ...ix, value: e.target.value })} style={{ minHeight: 44, width: 130 }} aria-label={t('r.indexValue')} data-testid="rc-ix-value" />
            <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy || !ix.period || !ix.value} onClick={() => run(() => pc.indexSet({ indexCode: r.pv.indexCode, period: ix.period, value: Number(ix.value), source: r.pv.source }), t('r.indexSaved')).then(() => { qc.invalidateQueries({ queryKey: ['proc', 'rc-indices'] }); setPeriod(ix.period); })} data-testid="rc-ix-save">{t('r.saveIndex')}</button></div>
          {can.pv && <div className="actions-row no-print"><input value={period} placeholder="2026-11" maxLength={7} onChange={(e) => setPeriod(e.target.value)} style={{ minHeight: 44, width: 110 }} aria-label={t('r.period')} data-testid="rc-pv-period" /><button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={busy || !period} onClick={() => run(() => pc.rcAct(r.id, 'price-variation', { period }), t('r.pvSent'))} data-testid="rc-pv-go">{t('r.requestPv')}</button></div>}</div>)}
      {r.revisions.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="rc-revisions"><caption>{t('r.pvHistory')}</caption><thead><tr><th>#</th><th>{t('r.period')}</th><th>{t('r.index')}</th><th>{t('r.changes')}</th><th>{t('r.status')}</th></tr></thead>
        <tbody>{r.revisions.map((v) => <tr key={v.id} data-testid="rc-revision"><td>{v.revisionNo}</td><td>{v.period}</td><td>{v.indexCode} {v.indexValue} / {v.baseIndex}</td><td>{v.changes.map((c) => <div key={c.rcLineId}>{c.description}: {fmtRs(c.oldRate)} → <strong>{fmtRs(c.newRate)}</strong> ({c.changePct}%)</div>)}</td><td>{t(`r.pvs.${v.status}`)}</td></tr>)}</tbody></table></div>}
      {r.callOffs.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="rc-calloffs"><caption>{t('r.calloffs')}</caption><thead><tr><th>{t('r.order')}</th><th>{t('r.date')}</th><th>{t('r.project')}</th>{r.canSeeRates && <th className="num">{t('r.basic')}</th>}<th>{t('r.status')}</th></tr></thead>
        <tbody>{r.callOffs.map((p) => <tr key={p.id}><td><Link to={`/proc/purchase-orders?id=${p.id}`}>{p.docNo}</Link></td><td>{fmtDate(p.date)}</td><td>{p.projectCode}</td>{r.canSeeRates && <td className="num">{fmtRs(p.basic)}</td>}<td><StatusBadge status={PO_TONE[p.status]} label={p.status} /></td></tr>)}</tbody></table></div>}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="rc-history"><caption>{t('r.history')}</caption><thead><tr><th>{t('r.when')}</th><th>{t('r.who')}</th><th>{t('r.what')}</th><th>{t('r.comment')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table></div>)}
    </div>
  );
}

function RcForm({ t, editId }) {
  const eq = useQuery({ queryKey: ['proc', 'rc', editId], queryFn: () => pc.rc(editId), enabled: Boolean(editId), retry: false }); const pq = useQuery({ queryKey: ['proc', 'projects'], queryFn: pc.projects, retry: false });
  const vq = useQuery({ queryKey: ['proc', 'po-options-vendors'], queryFn: async () => { const ps = await pc.projects(); return ps[0] ? (await pc.poOptions(ps[0].id)).vendors : []; }, retry: false });
  const [f, setF] = useState(null); const [rows, setRows] = useState(null); const [picking, setPicking] = useState(false); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const e = eq.data;
  const form = f ?? { title: e?.title ?? '', vendorId: e ? String(e.vendorId) : '', validFrom: e?.validFrom ?? addDays(0), validTo: e?.validTo ?? addDays(365), ceilingValue: e?.ceilingValue ? String(e.ceilingValue) : '', paymentTerms: e?.paymentTerms ?? '', terms: e?.terms ?? '', projectIds: e?.projectIds ?? [], pvOn: Boolean(e?.pv), indexCode: e?.pv?.indexCode ?? '', source: e?.pv?.source ?? 'MANUAL', frequency: e?.pv?.frequency ?? 'MONTHLY', basePeriod: e?.pv?.basePeriod ?? '', baseIndex: e?.pv ? String(e.pv.baseIndex) : '', linkedPct: e?.pv ? String(e.pv.linkedPct) : '' };
  const lines = rows ?? (e ? e.lines.map((l) => ({ itemId: l.itemId, label: `${l.itemCode ?? ''} ${l.description}`, uoms: [l.uom], uom: l.uom, rate: String(l.rate ?? ''), ceilingQty: l.ceilingQty ? String(l.ceilingQty) : '', pvLinked: l.pvLinked, taxCode: l.taxCode })) : []);
  usePageTitle(t('r.new'));
  if (pq.error?.status === 403) return <NoPermission what={t('r.new')} permission="proc.rate_contract.create" />;
  if (pq.isPending || (editId && eq.isPending)) return <Skeleton label={t('r.new')} rows={4} />;
  const set = (k, v) => setF({ ...form, [k]: v }); const setRow = (i, k, v) => setRows(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const body = () => ({ title: form.title.trim(), vendorId: Number(form.vendorId), validFrom: form.validFrom, validTo: form.validTo, ceilingValue: form.ceilingValue ? Number(form.ceilingValue) : 0, projectIds: form.projectIds.map(Number), paymentTerms: form.paymentTerms.trim() || null, terms: form.terms.trim() || null,
    pv: form.pvOn ? { enabled: true, indexCode: form.indexCode.trim(), source: form.source, frequency: form.frequency, basePeriod: form.basePeriod, baseIndex: Number(form.baseIndex), linkedPct: Number(form.linkedPct) } : null,
    lines: lines.map((l) => ({ itemId: l.itemId ?? null, description: l.itemId ? undefined : l.label.trim(), uom: l.uom, rate: Number(l.rate), taxCode: l.taxCode ?? null, ceilingQty: l.ceilingQty ? Number(l.ceilingQty) : 0, pvLinked: Boolean(l.pvLinked) })) });
  const save = async () => { setError(null); setBusy(true); try { const b = body(); const d = editId ? await pc.rcUpdate(editId, { ...b, vendorId: undefined, rowVersion: e.rowVersion }) : await pc.rcCreate(b); navigateTo(`/proc/rate-contracts?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="rcn-h" data-testid="proc-rc-form"><PageHeader id="rcn-h" title={editId ? t('r.edit') : t('r.new')} subtitle={t('r.newHelp')} meta={<Link to="/proc/rate-contracts">{t('r.back')}</Link>} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(); }} noValidate>
        <div className="form-grid">
          <Field label={t('r.titleField')} name="title" error={error}><input value={form.title} maxLength={200} onChange={(ev) => set('title', ev.target.value)} style={{ minHeight: 44 }} data-testid="rcn-title" /></Field>
          <Field label={t('r.vendor')} name="vendorId" error={error}><select value={form.vendorId} disabled={Boolean(editId)} onChange={(ev) => set('vendorId', ev.target.value)} style={{ minHeight: 44 }} data-testid="rcn-vendor"><option value="">{t('r.choose')}</option>{(vq.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
          <Field label={t('r.validFrom')} name="validFrom" error={error}><input type="date" value={form.validFrom} onChange={(ev) => set('validFrom', ev.target.value)} style={{ minHeight: 44 }} /></Field>
          <Field label={t('r.validTo')} name="validTo" error={error}><input type="date" value={form.validTo} onChange={(ev) => set('validTo', ev.target.value)} style={{ minHeight: 44 }} data-testid="rcn-valid-to" /></Field>
          <Field label={t('r.ceilingValueField')} name="ceilingValue" error={error}><input type="number" min="0" step="0.01" value={form.ceilingValue} onChange={(ev) => set('ceilingValue', ev.target.value)} style={{ minHeight: 44 }} data-testid="rcn-ceiling" /></Field>
          <Field label={t('r.appliesTo')} name="projectIds" error={error}><select multiple value={form.projectIds.map(String)} onChange={(ev) => set('projectIds', [...ev.target.selectedOptions].map((o) => o.value))} style={{ minHeight: 88 }} data-testid="rcn-projects">{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
          <Field label={t('r.payment')} name="paymentTerms" error={error}><input value={form.paymentTerms} maxLength={500} onChange={(ev) => set('paymentTerms', ev.target.value)} style={{ minHeight: 44 }} /></Field>
          <Field label={t('r.terms')} name="terms" error={error}><input value={form.terms} maxLength={5000} onChange={(ev) => set('terms', ev.target.value)} style={{ minHeight: 44 }} /></Field>
        </div>
        <label><input type="checkbox" checked={form.pvOn} onChange={(ev) => set('pvOn', ev.target.checked)} data-testid="rcn-pv-on" /> {t('r.pvOn')}</label>
        {form.pvOn && <div className="form-grid" data-testid="rcn-pv"><Field label={t('r.indexCode')} name="pv.indexCode" error={error}><input value={form.indexCode} maxLength={30} onChange={(ev) => set('indexCode', ev.target.value)} style={{ minHeight: 44 }} data-testid="rcn-index-code" /></Field>
          <Field label={t('r.indexSource')} name="pv.source" error={error}><select value={form.source} onChange={(ev) => set('source', ev.target.value)} style={{ minHeight: 44 }}>{['MANUAL', 'RBI', 'JPC', 'IMPORT'].map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
          <Field label={t('r.frequency')} name="pv.frequency" error={error}><select value={form.frequency} onChange={(ev) => set('frequency', ev.target.value)} style={{ minHeight: 44 }}><option value="MONTHLY">{t('r.freq.MONTHLY')}</option><option value="QUARTERLY">{t('r.freq.QUARTERLY')}</option></select></Field>
          <Field label={t('r.basePeriod')} name="pv.basePeriod" error={error}><input value={form.basePeriod} placeholder="2026-04" maxLength={7} onChange={(ev) => set('basePeriod', ev.target.value)} style={{ minHeight: 44 }} data-testid="rcn-base-period" /></Field>
          <Field label={t('r.baseIndex')} name="pv.baseIndex" error={error}><input type="number" step="0.01" value={form.baseIndex} onChange={(ev) => set('baseIndex', ev.target.value)} style={{ minHeight: 44 }} data-testid="rcn-base-index" /></Field>
          <Field label={t('r.linkedPct')} name="pv.linkedPct" error={error}><input type="number" min="0" max="100" step="0.01" value={form.linkedPct} onChange={(ev) => set('linkedPct', ev.target.value)} style={{ minHeight: 44 }} data-testid="rcn-linked" /></Field></div>}
        <h2>{t('r.lines')}</h2>{lines.length === 0 && <p className="muted">{t('r.noLines')}</p>}
        {lines.map((l, i) => <div key={i} className="mdm-panel" data-testid="rcn-line"><strong>{l.label}</strong><div className="form-grid">
          <Field label={t('r.rate')} name={`lines.${i}.rate`} error={error}><input type="number" min="0" step="0.01" value={l.rate} onChange={(ev) => setRow(i, 'rate', ev.target.value)} style={{ minHeight: 44 }} data-testid="rcn-rate" /></Field>
          <Field label={t('r.uom')} name={`lines.${i}.uom`} error={error}><select value={l.uom} onChange={(ev) => setRow(i, 'uom', ev.target.value)} style={{ minHeight: 44 }}>{l.uoms.map((u) => <option key={u} value={u}>{u}</option>)}</select></Field>
          <Field label={t('r.ceilingQty')} name={`lines.${i}.ceilingQty`} error={error}><input type="number" min="0" step="0.001" value={l.ceilingQty} onChange={(ev) => setRow(i, 'ceilingQty', ev.target.value)} style={{ minHeight: 44 }} data-testid="rcn-ceiling-qty" /></Field>
          <label><input type="checkbox" checked={Boolean(l.pvLinked)} onChange={(ev) => setRow(i, 'pvLinked', ev.target.checked)} data-testid="rcn-pv-linked" /> {t('r.pvLinked')}</label></div>
          <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setRows(lines.filter((_, j) => j !== i))}>{t('r.removeLine')}</button></div>)}
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} onClick={() => setPicking(true)} data-testid="rcn-add">{t('r.addItems')}</button></div>
        <ItemSelector open={picking} onClose={() => setPicking(false)} onPick={(items) => setRows([...lines, ...items.map((it) => ({ itemId: it.id, label: `${it.code} · ${it.name}`, uoms: it.uoms ?? [it.uom], uom: it.uom, rate: '', ceilingQty: '', pvLinked: false }))])} title={t('r.addItems')} />
        {error?.form && <p className="field-error" role="alert" data-testid="rcn-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !form.title.trim() || !form.vendorId || lines.length === 0} data-testid="rcn-save">{t('r.saveDraft')}</button></div></form></section>
  );
}

export default function RateContractsPage() {
  const t = useT('proc'); usePageTitle(t('r.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (sp.get('new') === '1') return <RcForm key={sp.get('edit') ?? 'new'} t={t} editId={Number(sp.get('edit')) || null} />;
  if (id) return <section aria-labelledby="rc-h" data-testid="proc-rcs"><Rc key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="rcs-h" data-testid="proc-rcs"><PageHeader id="rcs-h" title={t('r.title')} subtitle={t('r.intro')} />
      <div className="actions-row no-print">{perms.includes('proc.rate_contract.create') && <Link to="/proc/rate-contracts?new=1">{t('r.new')}</Link>} <Link to="/proc/purchase-orders">{t('r.orders')}</Link></div>
      <ListReport listCode="proc.rate_contracts" endpoint="/proc/rate-contracts" exportEndpoint="/ui/lists/proc.rate_contracts/export" title={t('r.title')} session={session.data} rowHref={(r) => `/proc/rate-contracts?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/rate-contracts?id=${r.id}`)}
        cardFields={['docNo', 'vendor', 'validTo', 'ceiling', 'used']} statusKey="status" empty={{ title: t('r.emptyTitle'), text: t('r.emptyBody') }} /></section>
  );
}
