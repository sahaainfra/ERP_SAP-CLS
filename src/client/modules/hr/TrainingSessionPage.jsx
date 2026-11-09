import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { api } from '../../platform/api/index.js';
import { trn } from './api.js';
import { SESSION_TONE, SessionForm } from './TrainingCalendarPage.jsx';

// Training Session (HR, part 07.10, FR-01 and FR-05): one session with its nominations and attendance. Managers nominate the people of their team; on the day the trainer shows the QR code and people sign in with their phones (or the trainer marks
// them), enters the post-test scores and closes the session: those who passed a course that carries a certificate type are given that certificate. A draft is edited, sent, deleted; an open session is cancelled, with a reason.
const ATT_TONE = { NOMINATED: 'IN_REVIEW', ATTENDED: 'COMPLETED', ABSENT: 'OVERDUE' };
export default function TrainingSessionPage() {
  const t = useT('trn');
  const qc = useQueryClient();
  const id = Number(new URLSearchParams(window.location.search).get('id')) || null;
  const q = useQuery({ queryKey: ['trn', 'session', id], queryFn: () => trn.session(id), enabled: Boolean(id), retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [editing, setEditing] = useState(false); const [qr, setQr] = useState(null);
  const [who, setWho] = useState({ kind: 'EMPLOYEE', id: '' }); const [scores, setScores] = useState({});
  const s = q.data;
  usePageTitle(s ? `${s.docNo} ${s.course}` : t('ses.title'));
  if (!id) return <ErrorState error={new Error(t('ses.noId'))} />;
  if (q.error?.status === 403) return <NoPermission what={t('ses.title')} permission="hr.session.view" />;
  if (q.isPending) return <Skeleton label={t('ses.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const refresh = () => qc.invalidateQueries({ queryKey: ['trn'] });
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); if (done) setNote(done); refresh(); } catch (e) { setError(errorInfo(e)); } };
  const ask = (label) => window.prompt(label);
  const act = (action, label, doneKey) => async () => { const body = label ? { reason: ask(label) } : {}; if (label && !body.reason) return; await run(() => trn.sessionAct(id, action, body), doneKey ? t(doneKey) : null); };
  return (
    <section aria-labelledby="ts-title" data-testid="training-session" data-status={s.status}>
      <h1 id="ts-title">{s.course} <StatusBadge status={SESSION_TONE[s.status]} label={t(`status.${s.status}`)} /></h1>
      <dl className="op-figures" data-testid="ts-facts">
        <div><dt>{t('s.session')}</dt><dd>{s.docNo}</dd></div><div><dt>{t('s.starts')}</dt><dd>{s.startAt.replace('T', ' ')}</dd></div><div><dt>{t('s.ends')}</dt><dd>{s.endAt.replace('T', ' ')}</dd></div>
        <div><dt>{t('s.venue')}</dt><dd>{s.venue ?? '—'}</dd></div><div><dt>{t('s.trainer')}</dt><dd>{s.trainer ?? '—'}</dd></div><div><dt>{t('s.seats')}</dt><dd data-testid="ts-seats">{s.seatsTaken}/{s.capacity}</dd></div>
        <div><dt>{t('s.site')}</dt><dd>{s.site ?? s.project ?? '—'}</dd></div>{s.cost > 0 && <div><dt>{t('s.fee')}</dt><dd>₹ {Number(s.cost).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</dd></div>}
      </dl>
      {error?.form && <p className="field-error" role="alert" data-testid="ts-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="ts-note">{note}</p>}
      <div className="actions-row no-print" data-testid="ts-actions">
        {s.can.edit && <button type="button" className="btn" onClick={() => setEditing(true)} data-testid="ts-edit">{t('act.edit')}</button>}
        {s.can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => trn.sessionAct(id, 'submit', {}), t('ses.sent'))} data-testid="ts-submit">{t('act.send')}</button>}
        {s.can.delete && <button type="button" className="btn" onClick={() => run(async () => { await trn.removeSession(id); navigateTo('/training', { force: true }); })} data-testid="ts-delete">{t('act.delete')}</button>}
        {s.can.withdraw && <button type="button" className="btn" onClick={act('withdraw', t('ses.why'), 'ses.withdrawn')} data-testid="ts-withdraw">{t('act.withdraw')}</button>}
        {s.can.cancel && <button type="button" className="btn" onClick={act('cancel', t('ses.why'), 'ses.cancelled')} data-testid="ts-cancel">{t('act.cancel')}</button>}
        {s.can.complete && <button type="button" className="btn btn-primary" onClick={() => run(async () => { const r = await trn.sessionAct(id, 'complete', {}); setNote(t('ses.completed', { n: r.certificatesIssued ?? 0 })); })} data-testid="ts-complete">{t('act.complete')}</button>}
        {s.can.print && <a className="btn" href={`/api/v1/hr/sessions/${id}/print`} target="_blank" rel="noreferrer" data-testid="ts-print">{t('act.sheet')}</a>}
        {s.can.qr && <button type="button" className="btn" onClick={() => run(async () => setQr(await trn.qr(id)))} data-testid="ts-qr-show">{t('act.qr')}</button>}
      </div>
      {editing && <SessionForm existing={s} close={() => { setEditing(false); refresh(); }} />}
      {qr && (
        <div className="mdm-panel trn-qr" data-testid="ts-qr"><h2>{t('ses.qrTitle')}</h2><div className="trn-qr-img" dangerouslySetInnerHTML={{ __html: qr.svg }} /><p className="small" data-testid="ts-qr-url">{qr.url}</p><p className="muted small">{t('ses.qrHint')}</p></div>
      )}
      <h2>{t('ses.people')}</h2>
      {s.can.nominate && (
        <form className="mdm-panel mdm-fields no-print" onSubmit={(e) => { e.preventDefault(); if (!who.id) return; run(async () => { await trn.nominate(id, [{ personType: who.kind, personId: Number(who.id) }]); setWho({ ...who, id: '' }); }, t('ses.nominated')); }} data-testid="ts-nominate" aria-label={t('ses.nominate')}>
          <label>{t('ses.kind')} <select value={who.kind} onChange={(e) => setWho({ kind: e.target.value, id: '' })} data-testid="ts-kind"><option value="EMPLOYEE">{t('ses.employee')}</option><option value="WORKER">{t('ses.worker')}</option></select></label>
          <LookupField id={`ts-who-${who.kind}`} label={t('ses.person')} lookup={who.kind === 'EMPLOYEE' ? 'hr/employees' : 'hr/workers'} value={who.id} onChange={(x) => setWho({ ...who, id: x })} />
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={!who.id} data-testid="ts-add">{t('ses.nominate')}</button></div>
        </form>
      )}
      {s.attendance.length === 0 ? <p className="muted" data-testid="ts-none">{t('ses.noPeople')}</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t('ses.people')}>
          <table className="grid" data-testid="ts-table"><thead><tr><th>{t('ses.person')}</th><th>{t('ses.attendance')}</th><th>{t('ses.method')}</th><th>{t('ses.score')}</th><th><span className="sr-only">{t('ses.actions')}</span></th></tr></thead>
            <tbody>{s.attendance.map((a) => (
              <tr key={a.id} data-testid="ts-row" data-code={a.code} data-attendance={a.attendance}>
                <th scope="row" data-label={t('ses.person')}>{a.name} <span className="muted small">{a.code}{a.personType === 'WORKER' ? ` · ${t('ses.worker')}` : ''}</span></th>
                <td data-label={t('ses.attendance')}><StatusBadge status={ATT_TONE[a.attendance]} label={t(`att.${a.attendance}`)} />{a.passed != null && ` · ${a.passed ? t('ses.passed') : t('ses.failed')}`}</td>
                <td data-label={t('ses.method')}>{a.method ? t(`method.${a.method}`) : '—'}</td>
                <td data-label={t('ses.score')}>{s.can.mark && a.attendance !== 'ABSENT' ? <input type="number" min="0" max="100" aria-label={`${t('ses.score')} ${a.name}`} defaultValue={a.score ?? ''} onChange={(e) => setScores({ ...scores, [a.id]: e.target.value })} data-testid="ts-score" /> : a.score ?? '—'}</td>
                <td data-label={t('ses.actions')}>
                  {s.can.mark && <>
                    <button type="button" className="btn btn-small" onClick={() => run(() => trn.mark(id, [{ attendanceId: a.id, attendance: 'ATTENDED', ...(scores[a.id] !== undefined && scores[a.id] !== '' ? { score: Number(scores[a.id]) } : {}) }]), t('ses.marked'))} data-testid="ts-present">{t('ses.present')}</button>{' '}
                    <button type="button" className="btn btn-small" onClick={() => run(() => trn.mark(id, [{ attendanceId: a.id, attendance: 'ABSENT' }]), t('ses.marked'))} data-testid="ts-absent">{t('ses.absent')}</button>{' '}
                  </>}
                  {s.status === 'APPROVED' && a.attendance === 'NOMINATED' && (s.can.nominate || s.can.mark) && <button type="button" className="btn btn-small" aria-label={`${t('ses.remove')} ${a.name}`} onClick={() => run(() => trn.unnominate(id, a.id))} data-testid="ts-remove">×</button>}
                </td>
              </tr>))}</tbody></table>
        </div>
      )}
      <History id={id} />
      <p className="small"><Link to="/training">{t('cal.title')}</Link></p>
    </section>
  );
}

function History({ id }) {
  const t = useT('trn');
  const h = useQuery({ queryKey: ['trn', 'history', id], queryFn: async () => (await api.get(`/hr/sessions/${id}/history`)).data, retry: false });
  if (!h.data) return null;
  const all = [...h.data.approvals.map((a) => ({ at: a.at, text: `${a.event} · ${a.actor}${a.comment ? `: ${a.comment}` : ''}` })), ...h.data.audit.map((a) => ({ at: a.at, text: `${a.action} · ${a.by}${a.reason ? `: ${a.reason}` : ''}` }))].sort((x, y) => String(x.at).localeCompare(String(y.at)));
  return <><h2>{t('ses.history')}</h2><ul className="mdm-list" data-testid="ts-history">{all.map((x, i) => <li key={i}><span className="muted small">{String(x.at).slice(0, 16).replace('T', ' ')}</span> {x.text}</li>)}</ul></>;
}
