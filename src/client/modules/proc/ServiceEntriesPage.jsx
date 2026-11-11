import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { RC_TONE, download, fmtDate, fmtQty, fmtRs, pc, today } from './api.js';
import { useSearch } from '../site/parts.jsx';

// Service entry sheet (part 15.06, FR-05): the site certification of the services performed in a period against the lines of a service order. A site engineer certifies it and the project manager approves it; only then does it count as certified
// (and become what invoice matching pays against). A certified sheet is amended by a copy that replaces it; a cancelled one is reversed.
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['proc'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function Se({ t, id }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['proc', 'se', id], queryFn: () => pc.se(id), retry: false }); const hq = useQuery({ queryKey: ['proc', 'se-history', id, q.data?.status], queryFn: () => pc.seHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [comment, setComment] = useState('');
  usePageTitle(t('e.title'));
  if (q.error?.status === 403) return <NoPermission what={t('e.title')} permission="proc.service_entry.view" />;
  if (q.isPending) return <Skeleton label={t('e.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can;
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (action, msg) => { const x = window.prompt(t('e.why')); if (x) run(() => pc.seAct(r.id, action, { reason: x }), msg).then((d) => { if (d && action === 'amend') navigateTo(`/proc/service-entries?new=1&edit=${d.id}`); }); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('e.sayWhy') }); return; } run(() => pc.decide(r.taskId, action, comment.trim() || null), t(`e.done.${action}`)); };
  return (
    <div data-testid="se-object" data-status={r.status}>
      <h1 id="se-h">{r.docNo} <StatusBadge status={RC_TONE[r.status]} label={t(`e.s.${r.status}`)} /></h1>
      <p><Link to="/proc/service-entries">{t('e.back')}</Link> · <Link to={`/proc/service-orders?id=${r.soId}`}>{r.soNo}</Link> {r.soTitle}</p>
      <dl className="kv" data-testid="se-figures"><div><dt>{t('e.vendor')}</dt><dd>{r.vendor}</dd></div><div><dt>{t('e.period')}</dt><dd>{fmtDate(r.periodFrom)} – {fmtDate(r.periodTo)}</dd></div>{r.canSeeRates && <div><dt>{t('e.amount')}</dt><dd data-testid="se-amount">{fmtRs(r.amount)}</dd></div>}<div><dt>{t('e.preparedBy')}</dt><dd>{r.requestedBy}</dd></div>{r.certifiedBy && <div><dt>{t('e.certifiedBy')}</dt><dd>{r.certifiedBy}</dd></div>}</dl>
      {error?.form && <p className="field-error" role="alert" data-testid="se-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="se-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="se-lines"><caption>{t('e.lines')}</caption><thead><tr><th>#</th><th>{t('e.service')}</th><th className="num">{t('e.thisPeriod')}</th><th className="num">{t('e.ordered')}</th><th className="num">{t('e.certifiedSoFar')}</th>{r.canSeeRates && <th className="num">{t('e.amount')}</th>}<th>{t('e.note')}</th></tr></thead>
        <tbody>{r.lines.map((l) => <tr key={l.id} data-testid="se-line"><td>{l.lineNo}</td><td>{l.description}</td><td className="num">{fmtQty(l.qty)} {l.uom}</td><td className="num">{fmtQty(l.orderedQty)}</td><td className="num">{fmtQty(l.certifiedQty)}</td>{r.canSeeRates && <td className="num">{fmtRs(l.amount)}</td>}<td>{l.note ?? ''}</td></tr>)}</tbody></table></div>
      <div className="actions-row no-print">
        {can.edit && <Link to={`/proc/service-entries?new=1&edit=${r.id}`}>{t('e.edit')}</Link>}
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pc.seAct(r.id, 'submit'), t('e.submitted'))} data-testid="se-submit">{t('e.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('e.withdrawn'))}>{t('e.withdraw')}</button>}
        {can.amend && <button type="button" className="btn" onClick={() => why('amend')} data-testid="se-amend">{t('e.amend')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('e.cancelled'))} data-testid="se-cancel">{t('e.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('e.deleteAsk')) && await run(() => pc.seDelete(r.id))) navigateTo('/proc/service-entries'); }}>{t('e.delete')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/service-entries/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('e.fileFailed') }))} data-testid="se-print">{t('e.print')}</button>}
        {r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('e.approval')}</Link>}
      </div>
      {r.taskId && <div className="mdm-panel no-print" data-testid="se-decide"><h2>{t('e.decide')}</h2><label>{t('e.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="se-comment" /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="se-approve">{t('e.certify')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('e.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('e.reject')}</button></div></div>}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="se-history"><caption>{t('e.history')}</caption><thead><tr><th>{t('e.when')}</th><th>{t('e.who')}</th><th>{t('e.what')}</th><th>{t('e.comment')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table></div>)}
    </div>
  );
}

function SeForm({ t, soId0, editId }) {
  const oq = useQuery({ queryKey: ['proc', 'se-orders'], queryFn: pc.seOrders, retry: false }); const eq = useQuery({ queryKey: ['proc', 'se', editId], queryFn: () => pc.se(editId), enabled: Boolean(editId), retry: false });
  const e = eq.data; const [soId, setSoId] = useState(e ? String(e.soId) : soId0 ? String(soId0) : ''); const sid = e ? e.soId : Number(soId) || null;
  const sq = useQuery({ queryKey: ['proc', 'so', sid], queryFn: () => pc.so(sid), enabled: Boolean(sid), retry: false }); const so = sq.data;
  const [f, setF] = useState(null); const [qty, setQty] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  usePageTitle(t('e.new'));
  if (oq.error?.status === 403) return <NoPermission what={t('e.new')} permission="proc.service_entry.create" />;
  if (oq.isPending || (editId && eq.isPending) || (sid && sq.isPending)) return <Skeleton label={t('e.new')} rows={4} />;
  const form = f ?? { periodFrom: e?.periodFrom ?? so?.startDate ?? today(), periodTo: e?.periodTo ?? today() }; const q = qty ?? (e ? Object.fromEntries(e.lines.map((l) => [l.soLineId, { qty: String(l.qty), note: l.note ?? '' }])) : {});
  const set = (k, v) => setF({ ...form, [k]: v }); const setQ = (id, k, v) => setQty({ ...q, [id]: { qty: '', note: '', ...(q[id] ?? {}), [k]: v } });
  const body = () => ({ periodFrom: form.periodFrom, periodTo: form.periodTo, lines: Object.entries(q).filter(([, v]) => Number(v.qty) > 0).map(([k, v]) => ({ soLineId: Number(k), qty: Number(v.qty), note: v.note || null })) });
  const save = async (send) => { setError(null); setBusy(true); try { let d = editId ? await pc.seUpdate(editId, { ...body(), rowVersion: e.rowVersion }) : await pc.seCreate({ soId: sid, ...body() }); if (send) d = await pc.seAct(d.id, 'submit'); navigateTo(`/proc/service-entries?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="sen-h" data-testid="proc-se-form"><h1 id="sen-h">{editId ? t('e.edit') : t('e.new')}</h1><p className="muted">{t('e.newHelp')}</p><p><Link to="/proc/service-entries">{t('e.back')}</Link></p>
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate>
        <div className="form-grid">
          <Field label={t('e.order')} name="soId" error={error}><select value={soId} disabled={Boolean(editId)} onChange={(ev) => { setSoId(ev.target.value); setQty({}); }} style={{ minHeight: 44 }} data-testid="sen-order"><option value="">{t('e.choose')}</option>{(oq.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.docNo} · {o.title} ({o.project})</option>)}</select></Field>
          <Field label={t('e.periodFrom')} name="periodFrom" error={error}><input type="date" value={form.periodFrom} onChange={(ev) => set('periodFrom', ev.target.value)} style={{ minHeight: 44 }} data-testid="sen-from" /></Field>
          <Field label={t('e.periodTo')} name="periodTo" error={error}><input type="date" value={form.periodTo} onChange={(ev) => set('periodTo', ev.target.value)} style={{ minHeight: 44 }} data-testid="sen-to" /></Field></div>
        {oq.data.length === 0 && <p className="muted" data-testid="sen-none">{t('e.noOrders')}</p>}
        {so && <div className="table-scroll"><table className="data-table" data-testid="sen-lines"><caption>{t('e.lines')}</caption><thead><tr><th>#</th><th>{t('e.service')}</th><th className="num">{t('e.ordered')}</th><th className="num">{t('e.certifiedSoFar')}</th><th>{t('e.thisPeriod')}</th><th>{t('e.note')}</th></tr></thead>
          <tbody>{(e ? e.soLines : so.lines).map((l) => <tr key={l.id} data-testid="sen-line"><td>{l.lineNo}</td><td>{l.description}</td><td className="num">{fmtQty(l.qty)} {l.uom}</td><td className="num">{fmtQty(l.certifiedQty)}</td>
            <td><input type="number" min="0" step="0.001" value={q[l.id]?.qty ?? ''} onChange={(ev) => setQ(l.id, 'qty', ev.target.value)} style={{ minHeight: 44, width: 110 }} aria-label={`${l.description} ${t('e.thisPeriod')}`} data-testid="sen-qty" /></td><td><input value={q[l.id]?.note ?? ''} maxLength={300} onChange={(ev) => setQ(l.id, 'note', ev.target.value)} style={{ minHeight: 44 }} aria-label={t('e.note')} /></td></tr>)}</tbody></table></div>}
        {error?.form && <p className="field-error" role="alert" data-testid="sen-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 48 }} disabled={busy || !sid} data-testid="sen-save">{t('e.saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !sid} onClick={() => save(true)} data-testid="sen-send">{t('e.sendForCertification')}</button></div></form></section>
  );
}

export default function ServiceEntriesPage() {
  const t = useT('proc'); usePageTitle(t('e.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (sp.get('new') === '1') return <SeForm key={sp.get('edit') ?? sp.get('so') ?? 'new'} t={t} soId0={Number(sp.get('so')) || null} editId={Number(sp.get('edit')) || null} />;
  if (id) return <section aria-labelledby="se-h" data-testid="proc-ses"><Se key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="ses-h" data-testid="proc-ses"><h1 id="ses-h">{t('e.title')}</h1><p className="muted">{t('e.intro')}</p>
      <div className="actions-row no-print">{perms.includes('proc.service_entry.create') && <Link to="/proc/service-entries?new=1">{t('e.new')}</Link>} <Link to="/proc/service-orders">{t('e.orders')}</Link></div>
      <ListReport listCode="proc.service_entries" endpoint="/proc/service-entries" title={t('e.title')} session={session.data} rowHref={(r) => `/proc/service-entries?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/service-entries?id=${r.id}`)}
        cardFields={['docNo', 'order', 'vendor', 'periodTo', 'amount']} statusKey="status" empty={{ title: t('e.emptyTitle'), text: t('e.emptyBody') }} /></section>
  );
}
