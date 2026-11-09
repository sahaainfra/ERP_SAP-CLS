import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { pl } from './api.js';

// Schedules (part 13.01, FR-01): the schedule versions of the projects; a new schedule starts on a calendar in force. A row opens the activities.
function NewSchedule({ t, onDone }) {
  const pq = useQuery({ queryKey: ['plan', 'projects'], queryFn: pl.projects, retry: false });
  const [f, setF] = useState({ projectId: '', name: '', calendarId: '', startDate: '' }); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const oq = useQuery({ queryKey: ['plan', 'options', f.projectId], queryFn: () => pl.options(f.projectId), enabled: Boolean(f.projectId), retry: false });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => { e.preventDefault(); setError(null); setBusy(true); try { onDone(await pl.createSchedule({ projectId: Number(f.projectId), name: f.name.trim(), calendarId: Number(f.calendarId), startDate: f.startDate })); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <form className="mdm-panel" onSubmit={save} data-testid="ps-form" aria-label={t('sch.new')}>
      <h2>{t('sch.new')}</h2>
      <div className="form-grid">
        <Field label={t('f.project')} name="projectId" error={error}><select value={f.projectId} onChange={(e) => set('projectId', e.target.value)} required data-testid="ps-project"><option value="">{t('f.chooseProject')}</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
        <Field label={t('f.name')} name="name" error={error}><input value={f.name} onChange={(e) => set('name', e.target.value)} required minLength={3} maxLength={200} data-testid="ps-name" /></Field>
        <Field label={t('f.calendar')} name="calendarId" error={error}><select value={f.calendarId} onChange={(e) => set('calendarId', e.target.value)} required data-testid="ps-calendar"><option value="">—</option>{(oq.data?.calendars ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
        <Field label={t('f.start')} name="startDate" error={error}><input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} required data-testid="ps-start" /></Field>
      </div>
      {f.projectId && oq.data && oq.data.calendars.length === 0 && <p className="field-error" role="alert">{t('sch.noCalendar')}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="ps-error">{error.form}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy} data-testid="ps-save">{t('sch.create')}</button></div>
    </form>
  );
}
export default function SchedulesPage() {
  const t = useT('plan');
  usePageTitle(t('sch.title'));
  const qc = useQueryClient(); const session = useSession(); const perms = session.data?.permissions ?? []; const [adding, setAdding] = useState(false);
  return (
    <section aria-labelledby="ps-h" data-testid="plan-schedules">
      <h1 id="ps-h" className="sr-only">{t('sch.title')}</h1>
      <div className="actions-row no-print">
        {perms.includes('plan.schedule.create') && <button type="button" className="btn btn-primary" onClick={() => setAdding(!adding)} data-testid="ps-new">{t('sch.new')}</button>}
        <button type="button" className="btn" onClick={() => navigateTo('/plan/calendars')} data-testid="ps-calendars">{t('cal.title')}</button>
      </div>
      {adding && <NewSchedule t={t} onDone={(s) => { qc.invalidateQueries({ queryKey: ['plan'] }); navigateTo(`/plan/activities?scheduleId=${s.id}`); }} />}
      <ListReport listCode="plan.schedules" endpoint="/plan/schedules" title={t('sch.title')} session={session.data} rowHref={(r) => `/plan/activities?scheduleId=${r.id}`} onOpen={(r) => navigateTo(`/plan/activities?scheduleId=${r.id}`)}
        cardFields={[{ key: 'project', label: t('f.project') }, { key: 'status', label: t('f.status') }, { key: 'finishDate', label: t('f.finish') }, { key: 'critical', label: t('f.critical') }]} statusKey="status"
        empty={{ title: t('sch.emptyTitle'), text: t('sch.emptyBody') }} />
    </section>
  );
}
