import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Field } from '../core/pages/ui.jsx';
import { bd } from './api.js';

/** The query of the address, followed when the page moves to another record of the same route. */
export function useSearch() {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => { const on = () => setSearch(window.location.search); window.addEventListener('popstate', on); return () => window.removeEventListener('popstate', on); }, []);
  return new URLSearchParams(search);
}
/** The project chooser: the projects with a project master whose budgets the person may see. */
export function ProjectSelect({ value, onChange, testId = 'bd-project', required = false, error = null }) {
  const t = useT('bud');
  const q = useQuery({ queryKey: ['bud', 'projects'], queryFn: bd.projects, retry: false });
  return (
    <Field label={t('f.project')} name="projectId" error={error}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={required} data-testid={testId}>
        <option value="">{t('f.chooseProject')}</option>
        {(q.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
      </select>
    </Field>
  );
}
/** A horizontal bar for a share of the total, drawn with the design tokens. */
export function ShareBar({ pct, label }) {
  return <span role="img" aria-label={label} style={{ display: 'inline-block', width: '100%', height: '0.6rem', background: 'var(--erp-color-border-subtle)', borderRadius: '0.3rem', overflow: 'hidden' }}><span style={{ display: 'block', width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: 'var(--erp-color-status-info-solid)' }} /></span>;
}
