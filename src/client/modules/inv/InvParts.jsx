import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorInfo } from '../core/pages/ui.jsx';

// Pieces the stores and stock pages share (part 16.01).
export const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['inv'] }); qc.invalidateQueries({ queryKey: ['list'] }); };
/** Runs a call, shows its error or note, and refreshes the lists. */
export function useRunner() {
  const qc = useQueryClient(); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  return { error, setError, note, setNote, busy, run };
}
/** The history of a record: approvals and audit by time. */
export function History({ t, data, testId }) {
  if (!data || (data.approvals ?? []).length + data.audit.length === 0) return null;
  const rows = [...data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...(data.approvals ?? []).map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at)));
  return (
    <div className="table-scroll"><table className="data-table" data-testid={testId}><caption>{t('history')}</caption><thead><tr><th>{t('when')}</th><th>{t('who')}</th><th>{t('what')}</th><th>{t('comment')}</th></tr></thead>
      <tbody>{rows.map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table></div>
  );
}
