import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import ItemSelector from '../../platform/items/ItemSelector.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { CHECK_TONE, STATUS_TONE, addDays, download, fmtDate, fmtQty, fmtRs, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Purchase Requisitions (part 15.01, FR-03 to FR-06): the list; the requisition with its budget panel, stock panel, possible duplicates, lines with the request lines they came from, approvals and the orders to come; a form for a direct
// requisition (with an emergency path). Approval is by value; nobody approves what they raised; a blocked budget or free stock needs an approved exception of the control engine.
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['proc'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function Panels({ t, c }) {
  return (
    <div data-testid="pr-panels">
      <div className="mdm-panel" data-testid="pr-budget"><h2>{t('p.budgetPanel')}</h2>
        <p><StatusBadge status={CHECK_TONE[c.summary.budget]} label={t(`p.bs.${c.summary.budget}`)} /> {c.summary.exception?.required && <span data-testid="pr-exception-needed">{t('p.exceptionNeeded')} <Link to="/controls/exceptions">{t('p.raiseException')}</Link></span>}</p>
        <ul>{c.lines.filter((l) => l.budget.result !== 'NOT_CHECKED').map((l) => <li key={l.lineId} data-testid="pr-budget-line">#{l.lineNo} {l.budget.wbs ?? ''} {l.budget.costCode ?? ''}: {t('p.available')} {fmtRs(Number(l.budget.available))}, {t('p.after')} {fmtRs(Number(l.budget.after))}{l.budget.message ? ` · ${l.budget.message}` : ''}{l.budget.beyondQty ? ` · ${t('p.beyondQty', { n: fmtQty(l.budget.beyondBy) })}` : ''}</li>)}</ul></div>
      <div className="mdm-panel" data-testid="pr-stock"><h2>{t('p.stockPanel')}</h2>
        <ul>{c.lines.filter((l) => l.stock.result !== 'NA').map((l) => <li key={l.lineId} data-testid="pr-stock-line">#{l.lineNo}: <StatusBadge status={CHECK_TONE[l.stock.result]} label={t(`p.ss.${l.stock.result}`)} /> {t('p.freeNeed', { f: fmtQty(l.stock.freeQty), n: fmtQty(l.stock.needQty) })}{l.stock.stores.length > 0 && <span className="muted small"> ({l.stock.stores.map((s) => `${s.storeName} ${fmtQty(s.freeQty)}`).join(', ')})</span>}</li>)}</ul>
        {c.summary.stock === 'COVERED' && <p className="field-error" role="status">{t('p.stockCovers')} <Link to="/controls/exceptions">{t('p.raiseException')}</Link></p>}</div>
      {c.summary.duplicates > 0 && <div className="mdm-panel" data-testid="pr-dups"><h2>{t('p.dupPanel')}</h2><ul>{c.lines.flatMap((l) => l.duplicates.map((d) => <li key={`${l.lineId}-${d.prId}`}>#{l.lineNo}: <Link to={`/proc/requisitions?id=${d.prId}`}>{d.docNo}</Link> ({t(`p.s.${d.status}`)}) {t('p.balance', { n: fmtQty(d.balance) })}</li>))}</ul></div>}
    </div>
  );
}

function Pr({ t, id }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['proc', 'pr', id], queryFn: () => pc.pr(id), retry: false });
  const cq = useQuery({ queryKey: ['proc', 'pr-checks', id, q.data?.rowVersion, q.data?.status], queryFn: () => pc.prChecks(id), enabled: q.isSuccess, retry: false });
  const hq = useQuery({ queryKey: ['proc', 'pr-history', id, q.data?.status], queryFn: () => pc.prHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [comment, setComment] = useState('');
  usePageTitle(t('p.prTitle'));
  if (q.error?.status === 403) return <NoPermission what={t('p.prTitle')} permission="proc.requisition.view" />;
  if (q.isPending) return <Skeleton label={t('p.prTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data; const can = r.can;
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (action, msg) => { const x = window.prompt(t('p.why')); if (x) run(() => pc.prAct(r.id, action, { reason: x }), msg).then((d) => { if (d && action === 'amend') navigateTo(`/proc/requisitions?id=${d.id}`); }); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('p.sayWhy') }); return; } run(() => pc.decide(r.taskId, action, comment.trim() || null), t(`p.done.${action}`)); };
  return (
    <div data-testid="pr-object" data-status={r.status}>
      <PageHeader id="pr-h" title={<>{r.docNo} <StatusBadge status={STATUS_TONE[r.status]} label={t(`p.s.${r.status}`)} />{r.isEmergency && <> <StatusBadge status="AT_RISK" label={t('p.emergency')} /></>}</>} meta={<Link to="/proc/requisitions">{t('p.back')}</Link>} />
      {r.isEmergency && r.regulariseBy && !r.regularisedAt && <p className="mdm-banner" role="status" data-testid="pr-emergency">{t('p.emergencyBy', { d: String(r.regulariseBy).slice(0, 16).replace('T', ' ') })} {r.emergencyReason}</p>}
      <dl className="kv" data-testid="pr-figures"><div><dt>{t('p.project')}</dt><dd>{r.projectCode}{r.siteCode ? ` · ${r.siteCode}` : ''}</dd></div><div><dt>{t('p.source')}</dt><dd>{t(`p.src.${r.source}`)}{r.directReason ? `: ${r.directReason}` : ''}</dd></div><div><dt>{t('p.requiredBy')}</dt><dd>{fmtDate(r.requiredBy)}</dd></div><div><dt>{t('p.priority')}</dt><dd>{t(`p.pri.${r.priority}`)}</dd></div><div><dt>{t('p.total')}</dt><dd data-testid="pr-total">{r.canSeeCost ? fmtRs(r.totalAmount) : t('p.masked')}</dd></div><div><dt>{t('p.requestedBy')}</dt><dd>{r.requestedBy}</dd></div>{r.approvedBy && <div><dt>{t('p.approvedBy')}</dt><dd>{r.approvedBy}</dd></div>}</dl>
      {error?.form && <p className="field-error" role="alert" data-testid="pr-error">{error.form}{error.code === 'EXCEPTION_REQUIRED' && <> <Link to="/controls/exceptions">{t('p.raiseException')}</Link></>}</p>}{note && <p className="mdm-banner" role="status" data-testid="pr-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="pr-lines"><caption>{t('p.lines')}</caption><thead><tr><th>#</th><th>{t('p.item')}</th><th className="num">{t('p.qty')}</th>{r.canSeeCost && <th className="num">{t('p.estRate')}</th>}{r.canSeeCost && <th className="num">{t('p.estAmount')}</th>}<th>{t('p.requiredBy')}</th><th>{t('p.deliverTo')}</th><th>{t('p.fromRequests')}</th><th className="num">{t('p.balanceToOrder')}</th></tr></thead>
        <tbody>{r.lines.map((l) => <tr key={l.id} data-testid="pr-line"><td>{l.lineNo}</td><td>{l.itemCode ? `${l.itemCode} · ` : ''}{l.itemName}{l.spec ? <div className="muted small">{l.spec}</div> : null}</td><td className="num">{fmtQty(l.qty)} {l.uom}</td>{r.canSeeCost && <td className="num">{fmtRs(l.estRate)}<div className="muted small">{t(`p.rs.${l.rateSource}`)}</div></td>}{r.canSeeCost && <td className="num">{fmtRs(l.estAmount)}</td>}<td>{fmtDate(l.requiredBy)}</td><td>{l.deliverySite ?? '—'}</td>
          <td data-testid="pr-sources">{l.sources.map((s) => <div key={`${s.mrId}-${s.qty}`}><Link to={`/proc/material-requests?id=${s.mrId}`}>{s.mrNo}</Link> ({fmtQty(s.qty)})</div>)}</td><td className="num">{fmtQty(l.balanceQty)}{l.orderedQty > 0 ? <div className="muted small">{t('p.ordered', { n: fmtQty(l.orderedQty) })}</div> : null}</td></tr>)}</tbody></table></div>
      {cq.data && ['DRAFT', 'RETURNED', 'SUBMITTED', 'EMERGENCY', 'APPROVED'].includes(r.status) && <Panels t={t} c={cq.data} />}
      <div className="actions-row no-print">
        {can.edit && r.source !== 'MR' && <Link to={`/proc/requisitions?new=1&edit=${r.id}`}>{t('p.edit')}</Link>}
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pc.prAct(r.id, 'submit'), t('p.sent'))} data-testid="pr-submit">{t('p.send')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('p.withdrawn'))} data-testid="pr-withdraw">{t('p.withdraw')}</button>}
        {can.amend && <button type="button" className="btn" onClick={() => why('amend')} data-testid="pr-amend">{t('p.amend')}</button>}
        {can.close && <button type="button" className="btn" onClick={() => why('close', t('p.closed'))} data-testid="pr-close">{t('p.shortClose')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('p.cancelled'))} data-testid="pr-cancel">{t('p.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('p.deleteAsk')) && await run(() => pc.prDelete(r.id))) navigateTo('/proc/requisitions'); }} data-testid="pr-delete">{t('p.delete')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => download(`/requisitions/${r.id}/print`, `${r.docNo.replaceAll('/', '-')}.pdf`).catch(() => setError({ form: t('p.fileFailed') }))} data-testid="pr-print">{t('p.print')}</button>}
        {r.workflowInstanceId && <Link to={`/workflow/instance?id=${r.workflowInstanceId}`}>{t('p.approval')}</Link>}
      </div>
      {r.taskId && (
        <div className="mdm-panel no-print" data-testid="pr-decide"><h2>{t('p.decide')}</h2>
          <label>{t('p.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="pr-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="pr-approve">{t('p.approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')} data-testid="pr-return">{t('p.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')} data-testid="pr-reject">{t('p.reject')}</button></div>
        </div>
      )}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="pr-history"><caption>{t('p.history')}</caption><thead><tr><th>{t('p.when')}</th><th>{t('p.who')}</th><th>{t('p.what')}</th><th>{t('p.comment')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((x, i) => <tr key={i}><td>{String(x.at ?? '').slice(0, 16).replace('T', ' ')}</td><td>{x.who}</td><td>{x.what}</td><td>{x.note ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

/** A requisition raised directly, or an edit of one: items from the selector or a service described in words, with the rate asked of the server and the total it works out. */
function PrForm({ t, editId }) {
  const pq = useQuery({ queryKey: ['proc', 'projects'], queryFn: pc.projects, retry: false });
  const eq = useQuery({ queryKey: ['proc', 'pr', editId], queryFn: () => pc.pr(editId), enabled: Boolean(editId), retry: false });
  const [f, setF] = useState(null); const [lines, setLines] = useState(null); const [picking, setPicking] = useState(false); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const projects = (pq.data ?? []).filter((p) => p.canRaisePr); const e = eq.data;
  const form = f ?? { projectId: e ? String(e.projectId) : '', siteId: e?.siteId ? String(e.siteId) : '', requiredBy: e?.requiredBy ?? addDays(7), priority: e?.priority ?? 'NORMAL', purpose: e?.purpose ?? '', directReason: e?.directReason ?? '', isEmergency: e?.isEmergency ?? false, emergencyReason: e?.emergencyReason ?? '' };
  const projectId = form.projectId || (projects[0] ? String(projects[0].id) : '');
  const rows = lines ?? (e ? e.lines.map((l) => ({ itemId: l.itemId, label: l.itemCode ? `${l.itemCode} · ${l.itemName}` : l.itemName, serviceDesc: l.serviceDesc ?? '', uoms: [l.uom], uom: l.uom, qty: String(l.qty), estRate: l.estRate == null ? '' : String(l.estRate), wbsId: l.wbsId ? String(l.wbsId) : '', costCodeId: l.costCodeId ? String(l.costCodeId) : '' })) : []);
  const oq = useQuery({ queryKey: ['proc', 'pr-options', projectId], queryFn: () => pc.prOptions(projectId), enabled: Boolean(projectId), retry: false }); const o = oq.data;
  usePageTitle(t('p.prNew'));
  if (pq.error?.status === 403) return <NoPermission what={t('p.prNew')} permission="proc.requisition.create" />;
  if (pq.isPending || (editId && eq.isPending)) return <Skeleton label={t('p.prNew')} rows={4} />;
  const set = (k, v) => setF({ ...form, [k]: v }); const setRow = (i, k, v) => setLines(rows.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const pick = (items) => setLines([...rows, ...items.map((it) => ({ itemId: it.id, label: `${it.code} · ${it.name}`, serviceDesc: '', uoms: it.uoms ?? [it.uom], uom: it.uom, qty: '', estRate: '', wbsId: '', costCodeId: '' }))]);
  const body = () => ({ siteId: form.siteId ? Number(form.siteId) : null, requiredBy: form.requiredBy, priority: form.priority, purpose: form.purpose.trim() || null, directReason: form.directReason.trim() || null, isEmergency: form.isEmergency, emergencyReason: form.isEmergency ? form.emergencyReason.trim() || null : null,
    lines: rows.map((l) => ({ itemId: l.itemId ?? null, serviceDesc: l.itemId ? null : l.serviceDesc.trim() || null, qty: Number(l.qty), uom: l.uom, estRate: l.estRate === '' ? undefined : Number(l.estRate), wbsId: l.wbsId ? Number(l.wbsId) : null, costCodeId: l.costCodeId ? Number(l.costCodeId) : null })) });
  const save = async (send) => { setError(null); setBusy(true); try { const d = editId ? await pc.prUpdate(editId, { ...body(), rowVersion: e.rowVersion }) : await pc.prCreate({ projectId: Number(projectId), ...body() }); if (send) await pc.prAct(d.id, 'submit'); navigateTo(`/proc/requisitions?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="prn-h" data-testid="proc-pr-form">
      <PageHeader id="prn-h" title={editId ? t('p.prEdit') : t('p.prNew')} subtitle={t('p.prNewHelp')} />
      <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); save(false); }} noValidate>
        <div className="form-grid">
          <Field label={t('p.project')} name="projectId" error={error}><select value={projectId} disabled={Boolean(editId)} onChange={(ev) => setF({ ...form, projectId: ev.target.value, siteId: '' })} style={{ minHeight: 44 }} data-testid="prn-project">{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}{editId && e && !projects.length && <option value={e.projectId}>{e.projectCode}</option>}</select></Field>
          <Field label={t('p.deliverTo')} name="siteId" error={error}><select value={form.siteId} onChange={(ev) => set('siteId', ev.target.value)} style={{ minHeight: 44 }} data-testid="prn-site"><option value="">{t('p.none')}</option>{(o?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
          <Field label={t('p.requiredBy')} name="requiredBy" error={error}><input type="date" value={form.requiredBy} min={o?.today} onChange={(ev) => set('requiredBy', ev.target.value)} style={{ minHeight: 44 }} data-testid="prn-required" /></Field>
          <Field label={t('p.priority')} name="priority" error={error}><select value={form.priority} onChange={(ev) => set('priority', ev.target.value)} style={{ minHeight: 44 }} data-testid="prn-priority">{['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((x) => <option key={x} value={x}>{t(`p.pri.${x}`)}</option>)}</select></Field>
          <Field label={t('p.directReason')} name="directReason" error={error}><input value={form.directReason} maxLength={500} onChange={(ev) => set('directReason', ev.target.value)} style={{ minHeight: 44 }} data-testid="prn-reason" /></Field>
          <Field label={t('p.purpose')} name="purpose" error={error}><input value={form.purpose} maxLength={500} onChange={(ev) => set('purpose', ev.target.value)} style={{ minHeight: 44 }} /></Field>
        </div>
        {o?.canEmergency && <div className="form-grid"><label><input type="checkbox" checked={form.isEmergency} onChange={(ev) => set('isEmergency', ev.target.checked)} data-testid="prn-emergency" /> {t('p.emergency')}</label>{form.isEmergency && <Field label={t('p.emergencyReason')} name="emergencyReason" error={error}><input value={form.emergencyReason} maxLength={500} onChange={(ev) => set('emergencyReason', ev.target.value)} style={{ minHeight: 44 }} data-testid="prn-emergency-reason" /></Field>}</div>}
        <h2>{t('p.lines')}</h2>
        {rows.length === 0 && <p className="muted">{t('p.noLines')}</p>}
        {rows.map((l, i) => (
          <div key={i} className="mdm-panel" data-testid="prn-line"><strong>{l.itemId ? l.label : t('p.service')}</strong>
            <div className="form-grid">
              {!l.itemId && <Field label={t('p.serviceDesc')} name={`lines.${i}.serviceDesc`} error={error}><input value={l.serviceDesc} maxLength={300} onChange={(ev) => setRow(i, 'serviceDesc', ev.target.value)} style={{ minHeight: 44 }} data-testid="prn-service" /></Field>}
              <Field label={t('p.qty')} name={`lines.${i}.qty`} error={error}><input type="number" inputMode="decimal" min="0" step="0.001" value={l.qty} onChange={(ev) => setRow(i, 'qty', ev.target.value)} style={{ minHeight: 44 }} data-testid="prn-qty" /></Field>
              <Field label={t('p.uom')} name={`lines.${i}.uom`} error={error}>{l.itemId ? <select value={l.uom} onChange={(ev) => setRow(i, 'uom', ev.target.value)} style={{ minHeight: 44 }} data-testid="prn-uom">{l.uoms.map((u) => <option key={u} value={u}>{u}</option>)}</select> : <input value={l.uom} maxLength={20} onChange={(ev) => setRow(i, 'uom', ev.target.value)} style={{ minHeight: 44 }} data-testid="prn-uom" />}</Field>
              {o?.canCost && <Field label={t('p.estRate')} name={`lines.${i}.estRate`} error={error}><input type="number" inputMode="decimal" min="0" step="0.01" value={l.estRate} placeholder={t('p.rateDefault')} onChange={(ev) => setRow(i, 'estRate', ev.target.value)} style={{ minHeight: 44 }} data-testid="prn-rate" /></Field>}
              <Field label={t('p.wbs')} name={`lines.${i}.wbsId`} error={error}><select value={l.wbsId} onChange={(ev) => setRow(i, 'wbsId', ev.target.value)} style={{ minHeight: 44 }}><option value="">{t('p.none')}</option>{(o?.wbs ?? []).map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select></Field>
              <Field label={t('p.costCode')} name={`lines.${i}.costCodeId`} error={error}><select value={l.costCodeId} onChange={(ev) => setRow(i, 'costCodeId', ev.target.value)} style={{ minHeight: 44 }}><option value="">{t('p.none')}</option>{(o?.costCodes ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
            </div>
            <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setLines(rows.filter((_, j) => j !== i))}>{t('p.removeLine')}</button>
          </div>
        ))}
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} onClick={() => setPicking(true)} data-testid="prn-add">{t('p.addItems')}</button><button type="button" className="btn" style={{ minHeight: 48 }} onClick={() => setLines([...rows, { itemId: null, label: '', serviceDesc: '', uoms: [], uom: 'LS', qty: '1', estRate: '', wbsId: '', costCodeId: '' }])} data-testid="prn-add-service">{t('p.addService')}</button></div>
        <ItemSelector open={picking} onClose={() => setPicking(false)} onPick={pick} title={t('p.addItems')} />
        {error?.form && <p className="field-error" role="alert" data-testid="prn-error">{error.form}</p>}
        <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 48 }} disabled={busy || !projectId || rows.length === 0} data-testid="prn-save">{t('p.saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !projectId || rows.length === 0} onClick={() => save(true)} data-testid="prn-send">{t('p.send')}</button><Link to="/proc/requisitions">{t('p.cancel')}</Link></div>
      </form>
    </section>
  );
}

export default function RequisitionsPage() {
  const t = useT('proc'); usePageTitle(t('p.prTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (sp.get('new') === '1') return <PrForm key={sp.get('edit') ?? 'new'} t={t} editId={Number(sp.get('edit')) || null} />;
  if (id) return <section aria-labelledby="pr-h" data-testid="proc-prs"><Pr key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="prs-h" data-testid="proc-prs">
      <PageHeader id="prs-h" title={t('p.prTitle')} subtitle={t('p.prIntro')} />
      <div className="actions-row no-print">{perms.includes('proc.requisition.create') && <Link to="/proc/requisitions?new=1">{t('p.prNew')}</Link>} {perms.includes('proc.requisition.create') && <Link to="/proc/consolidate">{t('p.consolidate')}</Link>} <Link to="/proc/material-requests">{t('p.mrTitle')}</Link></div>
      <ListReport listCode="proc.requisitions" endpoint="/proc/requisitions" title={t('p.prTitle')} session={session.data} rowHref={(r) => `/proc/requisitions?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/requisitions?id=${r.id}`)}
        cardFields={['docNo', 'project', 'requiredBy', 'amount', 'budget']} statusKey="status" empty={{ title: t('p.prEmptyTitle'), text: t('p.prEmptyBody') }} />
    </section>
  );
}
