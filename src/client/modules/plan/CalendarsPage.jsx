import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { CAL_TONE, DAYS, pl } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Work Calendars (part 13.01, FR-05): the working week, the hours of a day, a holiday calendar of 01.03 and site exceptions (a Sunday pour, a stoppage). A calendar is drafted by one person and put in force by another (maker-checker);
// the days of a month show what the server will count as working.
const blank = () => ({ code: '', name: '', week: [true, true, true, true, true, true, false], hoursPerDay: '8', holidayCalendarId: '', exceptions: [], reason: '' });
const monthOf = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
function Days({ cal, t }) {
  const [month, setMonth] = useState(monthOf()); const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const q = useQuery({ queryKey: ['plan', 'cal-days', cal.id, month], queryFn: () => pl.calendarDays(cal.id, `${month}-01`, `${month}-${String(last).padStart(2, '0')}`), retry: false });
  return (
    <div className="mdm-panel" data-testid="pcal-days">
      <h2>{cal.code} · {t('cal.days')}</h2>
      <Field label={t('cal.month')} name="month"><input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} data-testid="pcal-month" /></Field>
      {q.isPending ? <Skeleton label={t('cal.days')} rows={2} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <p data-testid="pcal-working">{t('cal.workingCount', { n: q.data.working, of: q.data.days.length })}</p>
          <ul className="chips" aria-label={t('cal.days')} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', listStyle: 'none', padding: 0 }}>{q.data.days.map((d) => <li key={d.date} className={`chip${d.working ? ' chip-on' : ''}`} title={d.holiday ? t('cal.holiday') : ''} data-testid="pcal-day" data-working={d.working ? '1' : '0'}>{d.date.slice(8)}{d.holiday ? '*' : ''}</li>)}</ul>
        </>
      )}
    </div>
  );
}
export default function CalendarsPage() {
  const t = useT('plan');
  usePageTitle(t('cal.title'));
  const qc = useQueryClient(); const session = useSession(); const perms = session.data?.permissions ?? [];
  const q = useQuery({ queryKey: ['plan', 'calendars'], queryFn: pl.calendars, retry: false });
  const [f, setF] = useState(blank()); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [show, setShow] = useState(null);
  if (q.error?.status === 403) return <NoPermission what={t('cal.title')} permission="plan.calendar.view" />;
  if (q.isPending) return <Skeleton label={t('cal.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); qc.invalidateQueries({ queryKey: ['plan'] }); return true; } catch (x) { setError(errorInfo(x)); return false; } };
  const save = async (e) => { e.preventDefault(); if (await run(() => pl.createCalendar({ code: f.code.trim(), name: f.name.trim(), workWeek: f.week.map((x) => (x ? '1' : '0')).join(''), hoursPerDay: Number(f.hoursPerDay), holidayCalendarId: f.holidayCalendarId ? Number(f.holidayCalendarId) : null, exceptions: f.exceptions.filter((x) => x.date).map((x) => ({ date: x.date, working: x.working, note: x.note || null })), reason: f.reason.trim() }), t('cal.drafted'))) setF(blank()); };
  return (
    <section aria-labelledby="pcal-h" data-testid="plan-calendars">
      <PageHeader id="pcal-h" title={t('cal.title')} subtitle={<>{t('cal.intro')} <span data-testid="pcal-inforce">{t('cal.inForce', { n: d.inForce })}</span></>} />
      {note && <p className="mdm-banner" role="status" data-testid="pcal-note">{note}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="pcal-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      {perms.includes('plan.calendar.manage') && (
        <form className="mdm-panel" onSubmit={save} data-testid="pcal-form" aria-label={t('cal.draft')}>
          <h2>{t('cal.draft')}</h2>
          <div className="form-grid">
            <Field label={t('f.code')} name="code" error={error}><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required maxLength={30} data-testid="pcal-code" /></Field>
            <Field label={t('f.name')} name="name" error={error}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={3} maxLength={120} data-testid="pcal-name" /></Field>
            <Field label={t('cal.hours')} name="hoursPerDay" error={error}><input type="number" min="1" max="24" value={f.hoursPerDay} onChange={(e) => setF({ ...f, hoursPerDay: e.target.value })} data-testid="pcal-hours" /></Field>
            <Field label={t('cal.holidays')} name="holidayCalendarId" error={error}><select value={f.holidayCalendarId} onChange={(e) => setF({ ...f, holidayCalendarId: e.target.value })} data-testid="pcal-hc"><option value="">—</option>{d.holidayCalendars.map((h) => <option key={h.id} value={h.id}>{h.code} {h.name}</option>)}</select></Field>
            <Field label={t('f.reason')} name="reason" error={error}><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={5} maxLength={1000} data-testid="pcal-reason" /></Field>
          </div>
          <fieldset><legend>{t('cal.week')}</legend>{DAYS.map((x, i) => <label key={x} className="check"><input type="checkbox" checked={f.week[i]} onChange={(e) => setF({ ...f, week: f.week.map((w, k) => (k === i ? e.target.checked : w)) })} data-testid={`pcal-day-${x}`} /> {t(`day.${x}`)}</label>)}</fieldset>
          <fieldset><legend>{t('cal.exceptions')}</legend>
            {f.exceptions.map((x, i) => (
              <div className="form-grid" key={i} data-testid="pcal-exc">
                <Field label={t('cal.date')} name={`ex${i}`}><input type="date" value={x.date} onChange={(e) => setF({ ...f, exceptions: f.exceptions.map((y, k) => (k === i ? { ...y, date: e.target.value } : y)) })} data-testid="pcal-exc-date" /></Field>
                <Field label={t('cal.works')} name={`exw${i}`}><select value={x.working ? '1' : '0'} onChange={(e) => setF({ ...f, exceptions: f.exceptions.map((y, k) => (k === i ? { ...y, working: e.target.value === '1' } : y)) })} data-testid="pcal-exc-working"><option value="1">{t('cal.workDay')}</option><option value="0">{t('cal.offDay')}</option></select></Field>
                <Field label={t('cal.note')} name={`exn${i}`}><input value={x.note} onChange={(e) => setF({ ...f, exceptions: f.exceptions.map((y, k) => (k === i ? { ...y, note: e.target.value } : y)) })} maxLength={120} /></Field>
                <button type="button" className="btn" onClick={() => setF({ ...f, exceptions: f.exceptions.filter((_, k) => k !== i) })}>{t('act.remove')}</button>
              </div>))}
            <button type="button" className="btn" onClick={() => setF({ ...f, exceptions: [...f.exceptions, { date: '', working: true, note: '' }] })} data-testid="pcal-exc-add">{t('cal.addException')}</button>
          </fieldset>
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={!f.code.trim() || f.name.trim().length < 3 || f.reason.trim().length < 5 || !f.week.some(Boolean)} data-testid="pcal-save">{t('cal.saveDraft')}</button></div>
        </form>
      )}
      {d.rows.length === 0 ? <p className="muted" data-testid="pcal-empty">{t('cal.empty')}</p> : (
        <div className="table-scroll"><table className="data-table" data-testid="pcal-table"><caption className="sr-only">{t('cal.title')}</caption>
          <thead><tr><th>{t('f.code')}</th><th>{t('f.name')}</th><th>{t('f.project')}</th><th>{t('cal.week')}</th><th>{t('cal.holidays')}</th><th>{t('f.status')}</th><th>{t('cal.by')}</th><th /></tr></thead>
          <tbody>{d.rows.map((c) => (
            <tr key={c.id} data-testid="pcal-row" data-status={c.status}>
              <td>{c.code}</td><td>{c.name}</td><td>{c.project ?? t('cal.company')}</td><td>{DAYS.filter((_, i) => c.workWeek[i] === '1').map((x) => t(`day.${x}`).slice(0, 3)).join(' ')}</td><td>{c.holidayCalendar ? `${c.holidayCalendar} (${c.holidays})` : '—'}{c.exceptions.length ? ` · ${t('cal.exceptionCount', { n: c.exceptions.length })}` : ''}</td>
              <td><StatusBadge status={CAL_TONE[c.status]} label={t(`cst.${c.status}`)} /></td><td>{c.requestedBy}{c.approvedBy ? ` → ${c.approvedBy}` : ''}</td>
              <td>
                <button type="button" className="btn" onClick={() => setShow(show?.id === c.id ? null : c)} data-testid="pcal-show">{t('cal.days')}</button>
                {c.can.activate && <button type="button" className="btn btn-primary" onClick={() => run(() => pl.calendarAct(c.id, 'activate'), t('cal.activated'))} data-testid="pcal-activate">{t('cal.activate')}</button>}
                {c.can.cancel && <button type="button" className="btn" onClick={() => { const x = window.prompt(t('act.why')); if (x) run(() => pl.calendarAct(c.id, 'cancel', { reason: x }), t('cal.cancelled')); }} data-testid="pcal-cancel">{t('act.cancel')}</button>}
              </td>
            </tr>))}</tbody></table></div>
      )}
      {show && <Days cal={show} t={t} />}
    </section>
  );
}
