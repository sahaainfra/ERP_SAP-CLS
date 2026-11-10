import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Field } from '../core/pages/ui.jsx';
import { st } from './api.js';

/** The query of the address, followed when the page moves to another record of the same route. */
export function useSearch() {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => { const on = () => setSearch(window.location.search); window.addEventListener('popstate', on); return () => window.removeEventListener('popstate', on); }, []);
  return new URLSearchParams(search);
}
/** A site the person may see (with its project), and a day. */
export function SiteDay({ siteId, date, onSite, onDate, testId = 'st' }) {
  const t = useT('site');
  const sq = useQuery({ queryKey: ['site', 'sites'], queryFn: st.sites, retry: false, staleTime: 60_000 });
  useEffect(() => { if (!siteId && sq.data?.length === 1) onSite(sq.data[0].id); }, [siteId, sq.data, onSite]);
  return (
    <div className="form-grid">
      <Field label={t('f.site')} name="siteId"><select value={siteId ?? ''} onChange={(e) => onSite(e.target.value ? Number(e.target.value) : null)} data-testid={`${testId}-site`}><option value="">{t('f.chooseSite')}</option>{(sq.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.projectCode} · {s.code} {s.name}</option>)}</select></Field>
      {onDate && <Field label={t('f.date')} name="date"><input type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} data-testid={`${testId}-date`} /></Field>}
    </div>
  );
}
