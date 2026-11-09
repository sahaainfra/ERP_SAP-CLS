import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Field } from '../core/pages/ui.jsx';
import { pl } from './api.js';

/** The query of the address, followed when the page moves to another record of the same route. */
export function useSearch() {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => { const on = () => setSearch(window.location.search); window.addEventListener('popstate', on); return () => window.removeEventListener('popstate', on); }, []);
  return new URLSearchParams(search);
}
/** A project and one of its schedules; with only a schedule id in the address, its project is found from the schedule. */
export function SchedulePicker({ projectId, scheduleId, onProject, onSchedule, editableOnly = false, testId = 'pl' }) {
  const t = useT('plan');
  const pq = useQuery({ queryKey: ['plan', 'projects'], queryFn: pl.projects, retry: false });
  const oq = useQuery({ queryKey: ['plan', 'options', projectId], queryFn: () => pl.options(projectId), enabled: Boolean(projectId), retry: false });
  const schedules = (oq.data?.schedules ?? []).filter((s) => !editableOnly || ['DRAFT', 'RETURNED'].includes(s.status));
  return (
    <div className="form-grid">
      <Field label={t('f.project')} name="projectId"><select value={projectId ?? ''} onChange={(e) => onProject(e.target.value ? Number(e.target.value) : null)} data-testid={`${testId}-project`}><option value="">{t('f.chooseProject')}</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
      <Field label={t('f.schedule')} name="scheduleId"><select value={scheduleId ?? ''} onChange={(e) => onSchedule(e.target.value ? Number(e.target.value) : null)} disabled={!projectId} data-testid={`${testId}-schedule`}><option value="">{t('f.chooseSchedule')}</option>{schedules.map((s) => <option key={s.id} value={s.id}>{s.docNo} v{s.versionNo} · {t(`st.${s.status}`)}</option>)}</select></Field>
    </div>
  );
}
