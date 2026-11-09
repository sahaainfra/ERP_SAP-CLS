import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Field, navigateTo } from '../core/pages/ui.jsx';
import { st } from './api.js';

/** The project chooser of the structure pages: the projects with a project master the person may see. */
export default function ProjectPicker({ route, projectId, testId = 'st-project' }) {
  const t = useT('proj');
  const q = useQuery({ queryKey: ['proj', 'picker'], queryFn: st.projects, retry: false });
  return (
    <Field label={t('st.project')} name="projectId">
      <select value={projectId ?? ''} onChange={(e) => navigateTo(e.target.value ? `${route}?projectId=${e.target.value}` : route)} data-testid={testId}>
        <option value="">{t('st.chooseProject')}</option>
        {(q.data ?? []).map((p) => <option key={p.projectId} value={p.projectId}>{p.code} · {p.name}</option>)}
      </select>
    </Field>
  );
}
