import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Field, errorInfo } from '../core/pages/ui.jsx';
import { px } from './api.js';

// Pieces the expediting, inspection and shipment pages share (part 15.07).
export const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['proc'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

/** Runs a call, shows its error or note, and refreshes the lists. */
export function useRunner() {
  const qc = useQueryClient(); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  return { error, setError, note, setNote, busy, run };
}

/** The history of a document: approvals and audit by time. */
export function History({ t, data, testId }) {
  if (!data || (data.approvals ?? []).length + data.audit.length === 0) return null;
  const rows = [...data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...(data.approvals ?? []).map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at)));
  return (
    <div className="table-scroll"><table className="data-table" data-testid={testId}><caption>{t('x.history')}</caption><thead><tr><th>{t('x.when')}</th><th>{t('x.who')}</th><th>{t('x.what')}</th><th>{t('x.comment')}</th></tr></thead>
      <tbody>{rows.map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table></div>
  );
}

/** The project and the approved order a new document is made against; the lines of the order are given to the children. */
export function ProjectOrder({ t, projectId, setProjectId, orderId, setOrderId, error, prefix, children, lockOrder = false }) {
  const pq = useQuery({ queryKey: ['proc', 'projects'], queryFn: px.projects, retry: false });
  const oq = useQuery({ queryKey: ['proc', 'xpd-orders', projectId], queryFn: () => px.orders(projectId), enabled: Boolean(projectId), retry: false });
  const order = (oq.data?.orders ?? []).find((o) => String(o.id) === String(orderId)) ?? null;
  return (
    <>
      <Field label={t('x.project')} name="projectId" error={error}><select value={projectId} disabled={lockOrder} onChange={(ev) => { setProjectId(ev.target.value); setOrderId(''); }} style={{ minHeight: 44 }} data-testid={`${prefix}-project`}><option value="">{t('x.choose')}</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
      <Field label={t('x.order')} name="poId" error={error}><select value={orderId} disabled={lockOrder || !projectId} onChange={(ev) => setOrderId(ev.target.value)} style={{ minHeight: 44 }} data-testid={`${prefix}-order`}><option value="">{t('x.choose')}</option>{(oq.data?.orders ?? []).map((o) => <option key={o.id} value={o.id}>{o.docNo} · {o.vendor}</option>)}</select></Field>
      {children?.(order)}
    </>
  );
}
