import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Field } from '../core/pages/ui.jsx';
import { st } from './api.js';

/** The project (and the day) a progress page is about: the projects the person may see, the first chosen when there is one. */
export function useProjects() { return useQuery({ queryKey: ['site', 'prg-projects'], queryFn: st.prgProjects, retry: false, staleTime: 60_000 }); }
export function ProjectDay({ projectId, asOf, onProject, onAsOf, max, testId = 'prg' }) {
  const t = useT('site'); const q = useProjects(); const list = q.data ?? [];
  useEffect(() => { if (!projectId && list.length) onProject(list[0].id); }, [projectId, list, onProject]);
  return (
    <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('cnd.prg.params')}>
      <div className="form-grid">
        <Field label={t('cnd.prg.project')} name="projectId"><select value={projectId ?? ''} onChange={(e) => onProject(e.target.value ? Number(e.target.value) : null)} data-testid={`${testId}-project`}>{list.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
        {onAsOf && <Field label={t('cnd.prg.asOf')} name="asOf"><input type="date" value={asOf} max={max} onChange={(e) => e.target.value && onAsOf(e.target.value)} data-testid={`${testId}-asof`} /></Field>}
      </div>
    </form>
  );
}
