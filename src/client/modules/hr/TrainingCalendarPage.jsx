import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { dayIST, trn } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Training Calendar (HR, part 07.10, FR-01): the board of training sessions of a month. A session still being planned (a draft or returned) is dragged to another day, or moved with the date field of the list below it for those who do not drag;
// the server checks the move like a save and refuses the sessions that are open or approved (they are locked). A move can be undone. "Plan session" makes a draft; an internal session opens for nomination when it is sent, an external
// one with a fee goes to the manager and the HR manager. Print and CSV honour the month shown.
export const SESSION_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'ACTIVE', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', COMPLETED: 'COMPLETED' };
const pad = (n) => String(n).padStart(2, '0');
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
export default function TrainingCalendarPage() {
  const t = useT('trn');
  usePageTitle(t('cal.title'));
  const qc = useQueryClient();
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const [month, setMonth] = useState(dayIST(0).slice(0, 7));
  const [adding, setAdding] = useState(false); const [note, setNote] = useState(null); const [error, setError] = useState(null); const [undo, setUndo] = useState(null);
  const from = `${month}-01`; const to = monthEnd(month);
  const q = useQuery({ queryKey: ['trn', 'calendar', month], queryFn: () => trn.calendar(from, to), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('cal.title')} permission="hr.session.view" />;
  const rows = q.data ?? [];
  const days = Array.from({ length: Number(to.slice(8)) }, (_, i) => `${month}-${pad(i + 1)}`);
  const firstDow = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
  const bySession = (d) => rows.filter((s) => s.startAt.slice(0, 10) === d);
  const move = async (s, day) => {
    setError(null); setNote(null);
    if (s.startAt.slice(0, 10) === day) return;
    const shift = (v) => `${day}T${v.slice(11)}`;
    try { await trn.sessionAct(s.id, 'reschedule', { startAt: shift(s.startAt), endAt: shift(s.endAt) }); setUndo({ id: s.id, startAt: s.startAt, endAt: s.endAt }); setNote(t('cal.moved', { no: s.docNo, day })); qc.invalidateQueries({ queryKey: ['trn'] }); } catch (e) { setError(errorInfo(e)); }
  };
  const doUndo = async () => { if (!undo) return; try { await trn.sessionAct(undo.id, 'reschedule', { startAt: undo.startAt, endAt: undo.endAt }); setUndo(null); setNote(t('cal.undone')); qc.invalidateQueries({ queryKey: ['trn'] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="tc-title" data-testid="training-calendar">
      <PageHeader id="tc-title" title={t('cal.title')} />
      <div className="actions-row no-print">
        <button type="button" className="btn" onClick={() => setMonth(shiftMonth(month, -1))} data-testid="tcal-prev" aria-label={t('cal.prev')}>‹</button>
        <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t('cal.month')} data-testid="tcal-month" />
        <button type="button" className="btn" onClick={() => setMonth(shiftMonth(month, 1))} data-testid="tcal-next" aria-label={t('cal.next')}>›</button>
        {perms.includes('hr.session.create') && <button type="button" className="btn btn-primary" onClick={() => setAdding(true)} data-testid="tcal-new">{t('cal.plan')}</button>}
        {perms.includes('hr.session.export') && <a className="btn" href={`/api/v1/hr/sessions/export?format=csv&filter[startAt][gte]=${from}`} data-testid="tcal-export">{t('cal.export')}</a>}
        <button type="button" className="btn" onClick={() => window.print()} data-testid="tcal-print">{t('cal.print')}</button>
      </div>
      <ul className="trn-legend" aria-label={t('cal.legend')}>{Object.keys(SESSION_TONE).map((k) => <li key={k}><StatusBadge status={SESSION_TONE[k]} label={t(`status.${k}`)} /></li>)}</ul>
      {error?.form && <p className="field-error" role="alert" data-testid="tcal-error">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="tcal-note">{note} {undo && <button type="button" className="btn btn-small" onClick={doUndo} data-testid="tcal-undo">{t('cal.undo')}</button>}</p>}
      {adding && <SessionForm close={() => setAdding(false)} />}
      {q.isPending ? <Skeleton label={t('cal.title')} rows={6} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <div className="trn-cal" role="grid" aria-label={month} data-testid="tcal-grid">
            <div role="row" className="trn-week">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="trn-dow" role="columnheader">{t(`dow.${d}`)}</div>)}</div>
            {weeks(firstDow, days).map((week, w) => <div key={`w${w}`} role="row" className="trn-week">{week.map((d, i) => d === null ? <div key={`b${w}-${i}`} className="trn-blank" role="gridcell" /> : (
              <div key={d} className={`trn-day${bySession(d).length ? ' trn-has' : ''}`} role="gridcell" data-day={d} onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const s = rows.find((x) => x.id === Number(e.dataTransfer.getData('text/plain'))); if (s) move(s, d); }}>
                <span className="trn-date">{Number(d.slice(8))}</span>
                {bySession(d).map((s) => (
                  <a key={s.id} href={`/training/session?id=${s.id}`} onClick={(e) => { e.preventDefault(); navigateTo(`/training/session?id=${s.id}`); }} className={`trn-chip trn-${SESSION_TONE[s.status].toLowerCase()}`}
                    draggable={s.can.reschedule} onDragStart={(e) => e.dataTransfer.setData('text/plain', String(s.id))} data-testid="tcal-chip" data-status={s.status} title={`${s.docNo} · ${t(`status.${s.status}`)}`}>
                    <span>{s.startAt.slice(11, 16)} {s.course}</span>
                  </a>
                ))}
              </div>
            ))}</div>)}
          </div>
          <h2>{t('cal.list')}</h2>
          {rows.length === 0 ? <p className="muted" data-testid="tcal-none">{t('cal.none')}</p> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t('cal.list')}>
              <table className="grid" data-testid="tcal-table"><thead><tr><th>{t('s.session')}</th><th>{t('s.course')}</th><th>{t('s.starts')}</th><th>{t('s.venue')}</th><th>{t('s.seats')}</th><th>{t('s.status')}</th><th><span className="sr-only">{t('cal.move')}</span></th></tr></thead>
                <tbody>{rows.map((s) => (
                  <tr key={s.id} data-testid="tcal-row" data-status={s.status}>
                    <th scope="row" data-label={t('s.session')}><Link to={`/training/session?id=${s.id}`}>{s.docNo}</Link></th><td data-label={t('s.course')}>{s.course}</td><td data-label={t('s.starts')}>{s.startAt.replace('T', ' ')}</td>
                    <td data-label={t('s.venue')}>{s.venue ?? '—'}</td><td data-label={t('s.seats')}>{s.seatsTaken}/{s.capacity}</td><td data-label={t('s.status')}><StatusBadge status={SESSION_TONE[s.status]} label={t(`status.${s.status}`)} /></td>
                    <td data-label={t('cal.move')}>{s.can.reschedule && <input type="date" aria-label={t('cal.moveTo', { no: s.docNo })} defaultValue={s.startAt.slice(0, 10)} onChange={(e) => e.target.value && move(s, e.target.value)} data-testid="tcal-move" />}</td>
                  </tr>))}</tbody></table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Part 30.07: the month grid in rows of seven (axe aria-required-children), blanks before the first day as empty cells.
const weeks = (firstDow, days) => { const cells = [...Array(firstDow).fill(null), ...days]; return Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => cells.slice(w * 7, w * 7 + 7)); };

export function SessionForm({ close, existing = null }) {
  const t = useT('trn');
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ['trn', 'courses'], queryFn: trn.courses, retry: false });
  const [v, setV] = useState(() => existing ? { courseId: String(existing.courseId), startAt: existing.startAt, endAt: existing.endAt, trainer: existing.trainer ?? '', venue: existing.venue ?? '', capacity: String(existing.capacity), cost: String(existing.cost ?? 0), projectId: existing.projectId ? String(existing.projectId) : '', siteId: existing.siteId ? String(existing.siteId) : '' } : { courseId: '', startAt: `${dayIST(1)}T09:00`, endAt: `${dayIST(1)}T17:00`, trainer: '', venue: '', capacity: '20', cost: '0', projectId: '', siteId: '' });
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  const chosen = (courses.data ?? []).find((c) => String(c.id) === v.courseId);
  const go = async (submit) => {
    setBusy(true); setError(null);
    const body = { courseId: Number(v.courseId), startAt: v.startAt, endAt: v.endAt, trainer: v.trainer.trim() || null, venue: v.venue.trim() || null, capacity: Number(v.capacity), cost: chosen?.mode === 'EXTERNAL' ? Number(v.cost || 0) : 0, projectId: v.projectId ? Number(v.projectId) : null, siteId: v.siteId ? Number(v.siteId) : null };
    try {
      const s = existing ? await trn.updateSession(existing.id, { ...body, version: existing.rowVersion }) : await trn.createSession({ ...body, submit });
      if (existing && submit) await trn.sessionAct(existing.id, 'submit', {});
      qc.invalidateQueries({ queryKey: ['trn'] }); if (existing) close(); else navigateTo(`/training/session?id=${s.id}`, { force: true });
    } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  return (
    <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); go(false); }} data-testid="session-form" aria-label={t('cal.plan')}>
      <Field label={t('s.course')} name="courseId" error={error}><select value={v.courseId} onChange={(e) => set({ courseId: e.target.value })} required data-testid="sf-course"><option value="">{t('s.pick')}</option>{(courses.data ?? []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.title} ({t(`mode.${c.mode}`)})</option>)}</select></Field>
      <Field label={t('s.starts')} name="startAt" error={error}><input type="datetime-local" value={v.startAt} onChange={(e) => set({ startAt: e.target.value })} required data-testid="sf-start" /></Field>
      <Field label={t('s.ends')} name="endAt" error={error}><input type="datetime-local" value={v.endAt} onChange={(e) => set({ endAt: e.target.value })} required data-testid="sf-end" /></Field>
      <Field label={t('s.trainer')} name="trainer" error={error}><input value={v.trainer} maxLength={100} onChange={(e) => set({ trainer: e.target.value })} data-testid="sf-trainer" /></Field>
      <Field label={t('s.venue')} name="venue" error={error}><input value={v.venue} maxLength={150} onChange={(e) => set({ venue: e.target.value })} data-testid="sf-venue" /></Field>
      <LookupField id="sf-project" label={t('s.project')} lookup="iam/projects" value={v.projectId} onChange={(x) => set({ projectId: x, siteId: '' })} />
      <LookupField id="sf-site" label={t('s.site')} lookup="iam/sites" parent={v.projectId || undefined} parentLabel="project" value={v.siteId} onChange={(x) => set({ siteId: x })} />
      <Field label={t('s.capacity')} name="capacity" error={error}><input type="number" min="1" value={v.capacity} onChange={(e) => set({ capacity: e.target.value })} required data-testid="sf-capacity" /></Field>
      {chosen?.mode === 'EXTERNAL' && <Field label={t('s.fee')} name="cost" error={error} hint={t('s.feeHint')}><input type="number" min="0" step="0.01" value={v.cost} onChange={(e) => set({ cost: e.target.value })} data-testid="sf-cost" /></Field>}
      {error?.form && <p className="field-error" role="alert" data-testid="sf-error">{error.form}</p>}
      <div className="actions"><button type="button" className="btn" onClick={close}>{t('act.close')}</button><button type="submit" className="btn" disabled={busy} data-testid="sf-save">{t('act.saveDraft')}</button>{!existing && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => go(true)} data-testid="sf-send">{t('act.saveSend')}</button>}</div>
    </form>
  );
}
