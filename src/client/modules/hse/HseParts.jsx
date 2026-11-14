import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Field, errorInfo } from '../core/pages/ui.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { fmtDate, hse, HSE_TONE } from './api.js';

// Pieces the HSE pages share: the runner of a call, the loader of one record, and the bar of an approval document (send, withdraw, cancel, amend, print, decide) with its history.
export function useRunner() {
  const qc = useQueryClient(); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['hse'] }); qc.invalidateQueries({ queryKey: ['list'] }); return x; } catch (e) { setError(e?.errors?.length ? { form: e.message, fields: Object.fromEntries(e.errors.map((x) => [x.field, x.message])) } : errorInfo(e)); return null; } finally { setBusy(false); } };
  return { error, setError, note, setNote, busy, run };
}
/** Loads one record; shows the states a page must show. */
export function useRecord(kind, id, what, permission) {
  const q = useQuery({ queryKey: ['hse', kind, id], queryFn: () => hse.one(kind, id), retry: false, enabled: Boolean(id) });
  const guard = q.error?.status === 403 || q.error?.status === 404 ? <NoPermission what={what} permission={permission} /> : q.isPending ? <Skeleton label={what} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : null;
  return { q, guard };
}
export function Status({ x, ns = 'st' }) { const t = useT('hse'); return <StatusBadge status={HSE_TONE[x.status]} label={t(`${ns}.${x.status}`)} />; }
export const sel = { minHeight: 44 }; export const big = { minHeight: 48, fontSize: '1rem' };
export const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export function ErrorLine({ error, id }) { return error?.form ? <p className="field-error" role="alert" data-testid={id}>{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p> : null; }
/** The actions of an approval document: what the server says the person can do, the decision panel for an approver, and the history. */
export function DocBar({ kind, x, printName, extra = null }) {
  const t = useT('hse'); const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); const can = x.can ?? {};
  const hq = useQuery({ queryKey: ['hse', kind, 'history', x.id, x.status], queryFn: () => hse.history(kind, x.id), retry: false });
  const why = (action, msg) => { const r = globalThis.prompt(t('why')); if (r) run(() => hse.act(kind, x.id, action, { reason: r }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => hse.decide(x.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  return (
    <>
      <ErrorLine error={error} id="hse-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-note">{note}</p>}
      <div className="actions-row no-print">
        {can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => hse.act(kind, x.id, 'submit'), t('submitted'))} data-testid="hse-submit">{t('sendForApproval')}</button>}
        {can.withdraw && <button type="button" className="btn" disabled={busy} onClick={() => why('withdraw', t('withdrawn'))} data-testid="hse-withdraw">{t('withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" disabled={busy} onClick={() => why('cancel', t('cancelled'))} data-testid="hse-cancel">{t('cancel')}</button>}
        {can.amend && <button type="button" className="btn" disabled={busy} onClick={() => why('amend', t('amended'))} data-testid="hse-amend">{t('amend')}</button>}
        {can.print && printName && <button type="button" className="btn" onClick={() => hse.exportFile(`${kind}/${x.id}/print`, printName).catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="hse-print">{t('print')}</button>}
        {extra}
      </div>
      {x.approve && x.taskId && (
        <div className="mdm-panel no-print" data-testid="hse-decide"><h2>{t('decision')}</h2>
          <label>{t('comment')}<textarea value={comment} onChange={(ev) => setComment(ev.target.value)} rows={2} style={{ width: '100%' }} data-testid="hse-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="hse-approve">{t('approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')} data-testid="hse-return">{t('returnIt')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')} data-testid="hse-reject">{t('reject')}</button></div>
        </div>
      )}
      {hq.data && (
        <div className="table-scroll" data-testid="hse-history"><table className="data-table"><caption>{t('approvals')}</caption><thead><tr><th>{t('when')}</th><th>{t('who')}</th><th>{t('event')}</th><th>{t('comment')}</th></tr></thead>
          <tbody>{[...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, c: a.comment })), ...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, c: a.reason }))].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((h, i) => <tr key={i}><td>{fmtDate(h.at)}</td><td>{h.who}</td><td>{h.what}</td><td>{h.c ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}
/** The project and site choosers every HSE form starts with (the sites follow the project). */
export function ProjectSite({ o, v, set, error, siteOptional = false }) {
  const t = useT('hse'); const sites = (o?.sites ?? []).filter((s) => String(s.projectId) === String(v.projectId));
  return (
    <>
      <Field label={t('project')} name="projectId" error={error}><select value={v.projectId} onChange={(e) => set({ ...v, projectId: e.target.value, siteId: '' })} style={big} data-testid="hse-project"><option value="">—</option>{(o?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
      <Field label={t('site')} name="siteId" error={error}><select value={v.siteId} onChange={(e) => set({ ...v, siteId: e.target.value })} style={big} data-testid="hse-site">{siteOptional && <option value="">—</option>}{!siteOptional && <option value="">—</option>}{sites.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></Field>
    </>
  );
}
