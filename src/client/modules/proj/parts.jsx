import { useEffect, useState } from 'react';
import { useT } from '../../platform/i18n/index.js';

/** The query of the address, followed when the page moves to another record of the same route. */
export function useSearch() {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => { const on = () => setSearch(window.location.search); window.addEventListener('popstate', on); return () => window.removeEventListener('popstate', on); }, []);
  return new URLSearchParams(search);
}
/** The tabs of an object page: a tab list a keyboard walks with the arrow keys. */
export function Tabs({ tabs, active, onChange, label }) {
  const t = useT('proj');
  const move = (e, i) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length; onChange(tabs[n]); document.getElementById(`ptab-${tabs[n]}`)?.focus(); } };
  return (
    <div role="tablist" aria-label={label} className="tabs no-print" data-testid="tabs">
      {tabs.map((k, i) => <button key={k} id={`ptab-${k}`} type="button" role="tab" aria-selected={active === k} tabIndex={active === k ? 0 : -1} className={`btn${active === k ? ' btn-primary' : ''}`} onClick={() => onChange(k)} onKeyDown={(e) => move(e, i)} data-testid={`tab-${k}`}>{t(`tab.${k}`)}</button>)}
    </div>
  );
}
export const HEALTH_TONE = { GREEN: 'ACTIVE', AMBER: 'AT_RISK', RED: 'REJECTED', NONE: 'DRAFT' };
export const STATE_TONE = { SETUP: 'DRAFT', MOBILISATION: 'IN_REVIEW', EXECUTION: 'ACTIVE', SUSPENDED: 'AT_RISK', SUBSTANTIALLY_COMPLETE: 'COMPLETED', DLP: 'COMPLETED', CLOSED: 'CANCELLED', ARCHIVED: 'CANCELLED' };
export const APPROVAL_TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
