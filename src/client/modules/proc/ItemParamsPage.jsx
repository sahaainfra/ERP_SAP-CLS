import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import ItemSelector from '../../platform/items/ItemSelector.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { PARAM_TONE, fmtDate, fmtQty, today, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';

// Item Planning Parameters (part 15.02, FR-03, FR-06, section 9): the lead time, minimum order, pack size and safety stock of an item, whether it is long-lead and what the supplier can supply. A change is made by planning or procurement and approved by
// the procurement manager; the parameters in force are never edited, a new set is entered from a later date.
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['proc'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function ParamForm({ t, editing, onSaved, onCancel }) {
  const [f, setF] = useState(editing ? { itemId: editing.itemId, label: `${editing.itemCode} · ${editing.itemName}`, leadTimeDays: String(editing.leadTimeDays), moq: String(editing.moq), packSize: String(editing.packSize), safetyStock: String(editing.safetyStock), longLead: editing.longLead, capacityNote: editing.capacityNote ?? '', effectiveFrom: editing.effectiveFrom } : { itemId: null, label: '', leadTimeDays: '14', moq: '0', packSize: '0', safetyStock: '0', longLead: false, capacityNote: '', effectiveFrom: today() });
  const [picking, setPicking] = useState(false); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });
  const save = async (e) => { e.preventDefault(); setError(null); setBusy(true); try { const body = { leadTimeDays: Number(f.leadTimeDays), moq: Number(f.moq), packSize: Number(f.packSize), safetyStock: Number(f.safetyStock), longLead: f.longLead, capacityNote: f.capacityNote.trim() || null, effectiveFrom: f.effectiveFrom }; const d = editing ? await pc.paramUpdate(editing.id, { ...body, rowVersion: editing.rowVersion }) : await pc.paramCreate({ itemId: f.itemId, ...body }); onSaved(d); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <form className="mdm-panel" onSubmit={save} data-testid="param-form" aria-label={t('p.paramsTitle')} noValidate><h1>{editing ? t('p.paramEdit') : t('p.paramNew')}</h1>
      <div className="form-grid">
        <Field label={t('p.item')} name="itemId" error={error}>{editing ? <strong>{f.label}</strong> : <><strong data-testid="param-item">{f.label || t('p.none')}</strong> <button type="button" className="btn" onClick={() => setPicking(true)} data-testid="param-pick">{t('p.chooseItem')}</button></>}</Field>
        <Field label={t('p.leadDays')} name="leadTimeDays" error={error}><input type="number" min="0" max="730" value={f.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value)} style={{ minHeight: 44 }} data-testid="param-lead" /></Field>
        <Field label={t('p.moq')} name="moq" error={error}><input type="number" min="0" step="0.001" value={f.moq} onChange={(e) => set('moq', e.target.value)} style={{ minHeight: 44 }} data-testid="param-moq" /></Field>
        <Field label={t('p.pack')} name="packSize" error={error}><input type="number" min="0" step="0.001" value={f.packSize} onChange={(e) => set('packSize', e.target.value)} style={{ minHeight: 44 }} data-testid="param-pack" /></Field>
        <Field label={t('p.safety')} name="safetyStock" error={error}><input type="number" min="0" step="0.001" value={f.safetyStock} onChange={(e) => set('safetyStock', e.target.value)} style={{ minHeight: 44 }} data-testid="param-safety" /></Field>
        <Field label={t('p.effectiveFrom')} name="effectiveFrom" error={error}><input type="date" value={f.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} style={{ minHeight: 44 }} data-testid="param-from" /></Field>
        <Field label={t('p.capacity')} name="capacityNote" error={error}><input value={f.capacityNote} maxLength={500} onChange={(e) => set('capacityNote', e.target.value)} style={{ minHeight: 44 }} data-testid="param-capacity" /></Field>
        <label><input type="checkbox" checked={f.longLead} onChange={(e) => set('longLead', e.target.checked)} data-testid="param-longlead" /> {t('p.longLead')}</label>
      </div>
      <ItemSelector open={picking} onClose={() => setPicking(false)} multiple={false} onPick={(items) => items[0] && setF({ ...f, itemId: items[0].id, label: `${items[0].code} · ${items[0].name}` })} title={t('p.chooseItem')} />
      {error?.form && <p className="field-error" role="alert" data-testid="param-error">{error.form}</p>}
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !f.itemId} data-testid="param-save">{t('p.saveDraft')}</button><button type="button" className="btn" style={{ minHeight: 48 }} onClick={onCancel}>{t('p.cancel')}</button></div>
    </form>
  );
}

function Param({ t, id, onGone }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['proc', 'param', id], queryFn: () => pc.param(id), retry: false }); const hq = useQuery({ queryKey: ['proc', 'param-history', id, q.data?.status], queryFn: () => pc.paramHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [comment, setComment] = useState(''); const [editing, setEditing] = useState(false);
  usePageTitle(t('p.paramsTitle'));
  if (q.error?.status === 403) return <NoPermission what={t('p.paramsTitle')} permission="proc.item_param.view" />; if (q.isPending) return <Skeleton label={t('p.paramsTitle')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const can = x.can; const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const r = await fn(); if (done) setNote(done); refresh(qc); return r; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (action, msg) => { const w = window.prompt(t('p.why')); if (w) run(() => pc.paramAct(x.id, action, { reason: w }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('p.sayWhy') }); return; } run(() => pc.decide(x.taskId, action, comment.trim() || null), t(`p.done.${action}`)); };
  if (editing) return <ParamForm t={t} editing={x} onSaved={() => { setEditing(false); refresh(qc); }} onCancel={() => setEditing(false)} />;
  return (
    <div data-testid="param-object" data-status={x.status}>
      <h1 id="param-h">{x.itemCode} · {x.itemName} <StatusBadge status={PARAM_TONE[x.status]} label={t(`p.ps.${x.status}`)} /></h1><p><Link to="/proc/item-params">{t('p.back')}</Link></p>
      <dl className="kv" data-testid="param-figures"><div><dt>{t('p.leadDays')}</dt><dd>{x.leadTimeDays}</dd></div><div><dt>{t('p.moq')}</dt><dd>{fmtQty(x.moq)} {x.uom}</dd></div><div><dt>{t('p.pack')}</dt><dd>{fmtQty(x.packSize)}</dd></div><div><dt>{t('p.safety')}</dt><dd>{fmtQty(x.safetyStock)}</dd></div><div><dt>{t('p.longLead')}</dt><dd>{x.longLead ? t('p.yes') : t('p.no')}</dd></div><div><dt>{t('p.effectiveFrom')}</dt><dd>{fmtDate(x.effectiveFrom)}</dd></div>{x.vendor && <div><dt>{t('p.supplier')}</dt><dd>{x.vendor}</dd></div>}{x.capacityNote && <div><dt>{t('p.capacity')}</dt><dd>{x.capacityNote}</dd></div>}{x.approvedBy && <div><dt>{t('p.approvedBy')}</dt><dd>{x.approvedBy}</dd></div>}</dl>
      {x.status === 'APPROVED' && <p className="muted" data-testid="param-locked">{t('p.paramLocked')}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="param-obj-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="param-note">{note}</p>}
      <div className="actions-row no-print">
        {can.edit && <button type="button" className="btn" onClick={() => setEditing(true)} data-testid="param-edit">{t('p.edit')}</button>}
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pc.paramAct(x.id, 'submit'), t('p.sent'))} data-testid="param-submit">{t('p.send')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('p.withdrawn'))}>{t('p.withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('p.cancelled'))}>{t('p.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('p.deleteAsk')) && await run(() => pc.paramDelete(x.id))) onGone(); }}>{t('p.delete')}</button>}
        {x.workflowInstanceId && <Link to={`/workflow/instance?id=${x.workflowInstanceId}`}>{t('p.approval')}</Link>}
      </div>
      {x.taskId && (
        <div className="mdm-panel no-print" data-testid="param-decide"><h2>{t('p.decide')}</h2><label>{t('p.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="param-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="param-approve">{t('p.approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('p.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('p.reject')}</button></div></div>
      )}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && <div className="table-scroll"><table className="data-table" data-testid="param-history"><caption>{t('p.history')}</caption><thead><tr><th>{t('p.when')}</th><th>{t('p.who')}</th><th>{t('p.what')}</th><th>{t('p.comment')}</th></tr></thead><tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((r, i) => <tr key={i}><td>{String(r.at ?? '').slice(0, 16).replace('T', ' ')}</td><td>{r.who}</td><td>{r.what}</td><td>{r.note ?? ''}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

export default function ItemParamsPage() {
  const t = useT('proc'); usePageTitle(t('p.paramsTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? []; const qc = useQueryClient();
  if (id) return <section aria-labelledby="param-h" data-testid="proc-params"><Param key={id} t={t} id={id} onGone={() => navigateTo('/proc/item-params')} /></section>;
  if (sp.get('new') === '1') return <section data-testid="proc-params"><ParamForm t={t} editing={null} onSaved={(d) => { refresh(qc); navigateTo(`/proc/item-params?id=${d.id}`); }} onCancel={() => navigateTo('/proc/item-params')} /></section>;
  return (
    <section aria-labelledby="params-h" data-testid="proc-params">
      <h1 id="params-h">{t('p.paramsTitle')}</h1><p className="muted">{t('p.paramsIntro')}</p>
      <div className="actions-row no-print">{perms.includes('proc.item_param.edit') && <Link to="/proc/item-params?new=1">{t('p.paramNew')}</Link>} <Link to="/proc/mrp">{t('p.mrpTitle')}</Link></div>
      <ListReport listCode="proc.item_params" endpoint="/proc/item-params" title={t('p.paramsTitle')} session={session.data} rowHref={(r) => `/proc/item-params?id=${r.id}`} onOpen={(r) => navigateTo(`/proc/item-params?id=${r.id}`)}
        cardFields={['item', 'leadDays', 'moq', 'safety', 'longLead']} statusKey="status" empty={{ title: t('p.paramsEmptyTitle'), text: t('p.paramsEmptyBody') }} />
    </section>
  );
}
