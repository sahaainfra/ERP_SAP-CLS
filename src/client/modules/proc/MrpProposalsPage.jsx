import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { fmtDate, fmtQty, pc } from './api.js';
import { useSearch } from '../site/parts.jsx';

// PR Proposals (part 15.02, FR-04, FR-06, BR-01): what the runs propose to buy, oldest order-by date first, with a colour for the ones whose order-by date has passed and for long-lead items. The planner accepts the ones chosen (a DRAFT requisition of
// 15.01 is made: MRP never makes an approved one), changes a quantity, a date or takes an approved alternate in stock, or rejects with a reason.
const urgencyTone = (p) => (p.late ? 'REJECTED' : p.longLead ? 'RETURNED' : 'DRAFT');
function Modify({ t, id, onDone, onCancel }) {
  const q = useQuery({ queryKey: ['proc', 'proposal', id], queryFn: () => pc.proposalGet(id), retry: false });
  const [f, setF] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  if (q.isPending) return <Skeleton label={t('p.modify')} rows={2} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const p = q.data; const form = f ?? { qty: String(p.qty), requiredBy: p.requiredBy, substituteItemId: p.substituteItemId ? String(p.substituteItemId) : '', note: '' };
  const save = async (e) => { e.preventDefault(); setError(null); setBusy(true); try { await pc.proposalModify(id, { qty: Number(form.qty), requiredBy: form.requiredBy, substituteItemId: form.substituteItemId ? Number(form.substituteItemId) : null, note: form.note.trim() || undefined, rowVersion: p.rowVersion }); onDone(); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <form className="mdm-panel" onSubmit={save} data-testid="prop-modify" aria-label={t('p.modify')} noValidate><h2>{t('p.modifyOf', { i: p.itemCode })}</h2>
      <div className="form-grid">
        <Field label={t('p.qty')} name="qty" error={error}><input type="number" min="0" step="0.001" value={form.qty} onChange={(e) => setF({ ...form, qty: e.target.value })} style={{ minHeight: 44 }} data-testid="prop-qty" /></Field>
        <Field label={t('p.requiredBy')} name="requiredBy" error={error}><input type="date" value={form.requiredBy} onChange={(e) => setF({ ...form, requiredBy: e.target.value })} style={{ minHeight: 44 }} data-testid="prop-required" /></Field>
        <Field label={t('p.substitute')} name="substituteItemId" error={error}><select value={form.substituteItemId} onChange={(e) => setF({ ...form, substituteItemId: e.target.value })} style={{ minHeight: 44 }} data-testid="prop-sub"><option value="">{t('p.noSubstitute')}</option>{p.alternates.map((a) => <option key={a.itemId} value={a.itemId}>{a.code} · {a.name} ({t('p.freeN', { n: fmtQty(a.freeQty) })})</option>)}</select></Field>
      </div>
      {error?.form && <p className="field-error" role="alert" data-testid="prop-error">{error.form}</p>}
      <div className="actions-row"><button type="submit" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} data-testid="prop-save">{t('p.save')}</button><button type="button" className="btn" style={{ minHeight: 48 }} onClick={onCancel}>{t('p.cancel')}</button></div>
    </form>
  );
}

export default function MrpProposalsPage() {
  const t = useT('proc'); usePageTitle(t('p.proposals')); const sp = useSearch(); const qc = useQueryClient(); const runId = Number(sp.get('runId')) || null;
  const pq = useQuery({ queryKey: ['proc', 'mrp-projects'], queryFn: pc.mrpProjects, retry: false }); const [projectId, setProjectId] = useState(''); const [decision, setDecision] = useState('OPEN'); const [sel, setSel] = useState(new Set()); const [editing, setEditing] = useState(null); const [siteId, setSiteId] = useState(''); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  const projects = pq.data ?? []; const pid = projectId || (projects[0] ? String(projects[0].id) : '');
  const query = new URLSearchParams({ ...(pid ? { 'filter[projectId]': pid } : {}), ...(runId ? { 'filter[runId]': String(runId) } : {}), ...(decision ? { 'filter[decision]': decision } : {}), sort: 'orderBy', pageSize: '100' }).toString();
  const lq = useQuery({ queryKey: ['proc', 'proposals', query], queryFn: () => pc.proposals(query), enabled: Boolean(pid), retry: false });
  const oq = useQuery({ queryKey: ['proc', 'run-options', pid], queryFn: () => pc.runOptions(pid), enabled: Boolean(pid), retry: false });
  if (pq.error?.status === 403) return <NoPermission what={t('p.proposals')} permission="proc.run.view" />;
  if (pq.isPending) return <Skeleton label={t('p.proposals')} rows={4} />;
  const rows = lq.data ?? []; const canDecide = oq.data?.canDecide; const toggle = (id) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  const reload = () => { setSel(new Set()); setEditing(null); qc.invalidateQueries({ queryKey: ['proc'] }); };
  const accept = async () => { setError(null); setNote(null); setBusy(true); try { const r = await pc.accept({ ids: [...sel], siteId: siteId ? Number(siteId) : null }); reload(); navigateTo(`/proc/requisitions?id=${r.prId}`); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); } };
  const reject = async (p) => { const x = window.prompt(t('p.why')); if (!x) return; setError(null); try { await pc.proposalReject(p.id, x); setNote(t('p.rejected')); reload(); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="prop-h" data-testid="proc-proposals">
      <h1 id="prop-h">{t('p.proposals')}</h1><p className="muted">{t('p.proposalsIntro')}</p>
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('p.params')}>
        <div className="form-grid">
          <Field label={t('p.project')} name="projectId"><select value={pid} onChange={(e) => { setProjectId(e.target.value); setSel(new Set()); }} style={{ minHeight: 44 }} data-testid="prop-project">{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
          <Field label={t('p.decision')} name="decision"><select value={decision} onChange={(e) => { setDecision(e.target.value); setSel(new Set()); }} style={{ minHeight: 44 }} data-testid="prop-decision">{['OPEN', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', ''].map((x) => <option key={x} value={x}>{x ? t(`p.dec.${x}`) : t('p.all')}</option>)}</select></Field>
          {canDecide && <Field label={t('p.deliverTo')} name="siteId"><select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={{ minHeight: 44 }} data-testid="prop-site"><option value="">{t('p.none')}</option>{(oq.data?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>}
        </div>
      </form>
      {runId && <p className="muted">{t('p.ofRun')} <Link to={`/proc/mrp?id=${runId}`}>#{runId}</Link></p>}
      {error?.form && <p className="field-error" role="alert" data-testid="prop-list-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="prop-note">{note}</p>}
      {lq.isPending && pid && <Skeleton label={t('p.proposals')} rows={4} />}{lq.isError && <ErrorState error={lq.error} onRetry={lq.refetch} />}
      {lq.data && (rows.length === 0 ? <div className="mdm-panel" data-testid="prop-empty"><h2>{t('p.noProposals')}</h2><p className="muted">{t('p.noProposalsBody')}</p><Link to="/proc/mrp">{t('p.mrpTitle')}</Link></div> : (
        <div className="table-scroll"><table className="data-table" data-testid="prop-list"><caption className="sr-only">{t('p.proposals')}</caption><thead><tr><th><span className="sr-only">{t('p.choose')}</span></th><th>{t('p.item')}</th><th className="num">{t('p.qty')}</th><th>{t('p.requiredBy')}</th><th>{t('p.orderBy')}</th><th>{t('p.urgency')}</th><th>{t('p.run')}</th><th>{t('p.decision')}</th><th><span className="sr-only">{t('p.actions')}</span></th></tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id} data-testid="prop-row" data-urgency={p.urgency}><td>{p.decision === 'OPEN' && canDecide && <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label={p.item} style={{ minHeight: 24, minWidth: 24 }} data-testid="prop-check" />}</td><td>{p.item} · {p.itemName}</td><td className="num">{p.qty} {p.uom}</td><td>{fmtDate(p.requiredBy)}</td><td>{fmtDate(p.orderBy)}</td>
            <td><StatusBadge status={urgencyTone({ late: p.urgency === 'LATE', longLead: p.urgency === 'LONG_LEAD' })} label={t(`p.urg.${p.urgency}`)} /> {p.decision === 'OPEN' && <span className="muted small">{p.daysToOrder < 0 ? t('p.daysLate', { n: -p.daysToOrder }) : t('p.daysLeft', { n: p.daysToOrder })}</span>}</td><td><Link to={`/proc/mrp?id=${p.runId}`}>{p.run}</Link></td>
            <td>{p.decision === 'ACCEPTED' && p.prNo ? <>{t('p.dec.ACCEPTED')}: <Link to={`/proc/requisitions?id=${p.prId ?? ''}`}>{p.prNo}</Link></> : t(`p.dec.${p.decision}`)}</td>
            <td>{p.decision === 'OPEN' && canDecide && <><button type="button" className="btn" onClick={() => setEditing(p.id)} data-testid="prop-modify-open">{t('p.modify')}</button> <button type="button" className="btn" onClick={() => reject(p)} data-testid="prop-reject">{t('p.reject')}</button></>}</td></tr>)}</tbody></table></div>
      ))}
      {editing && <Modify key={editing} t={t} id={editing} onDone={reload} onCancel={() => setEditing(null)} />}
      {canDecide && <div className="actions-row no-print"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || sel.size === 0} onClick={accept} data-testid="prop-accept">{t('p.acceptN', { n: sel.size })}</button></div>}
    </section>
  );
}
