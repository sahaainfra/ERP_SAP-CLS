import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Field } from '../core/pages/ui.jsx';
import { useOffline } from '../../platform/offline/engine.js';
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
  const sq = useQuery({ queryKey: ['site', 'sites'], queryFn: st.sites, retry: false, staleTime: 60_000 }); const off = useOffline();
  // with no signal the sites are those the phone keeps for the daily progress report (part 14.02)
  const kept = [...new Map((off.masters?.dpr_prefill ?? []).map((r) => [r.siteId, { id: r.siteId, code: r.site, name: '', projectCode: '' }])).values()];
  const sites = sq.data ?? (sq.isError || off.online === false ? kept : []);
  useEffect(() => { if (!siteId && sites.length === 1) onSite(sites[0].id); }, [siteId, sites, onSite]);
  return (
    <div className="form-grid">
      <Field label={t('f.site')} name="siteId"><select value={siteId ?? ''} onChange={(e) => onSite(e.target.value ? Number(e.target.value) : null)} data-testid={`${testId}-site`}><option value="">{t('f.chooseSite')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{[s.projectCode, `${s.code} ${s.name}`.trim()].filter(Boolean).join(' · ')}</option>)}</select></Field>
      {onDate && <Field label={t('f.date')} name="date"><input type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} data-testid={`${testId}-date`} /></Field>}
    </div>
  );
}
