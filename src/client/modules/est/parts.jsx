import { useEffect, useState } from 'react';
import { useT } from '../../platform/i18n/index.js';

/** The query of the address, followed when the page moves to another record of the same route. */
export function useSearch() {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => { const on = () => setSearch(window.location.search); window.addEventListener('popstate', on); return () => window.removeEventListener('popstate', on); }, []);
  return new URLSearchParams(search);
}
/** The tabs of the estimate: a tab list a keyboard walks with the arrow keys. */
export function Tabs({ tabs, active, onChange, label }) {
  const t = useT('est');
  const move = (e, i) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length; onChange(tabs[n]); document.getElementById(`etab-${tabs[n]}`)?.focus(); } };
  return (
    <div role="tablist" aria-label={label} className="tabs no-print" data-testid="tabs">
      {tabs.map((k, i) => <button key={k} id={`etab-${k}`} type="button" role="tab" aria-selected={active === k} tabIndex={active === k ? 0 : -1} className={`btn${active === k ? ' btn-primary' : ''}`} onClick={() => onChange(k)} onKeyDown={(e) => move(e, i)} data-testid={`tab-${k}`}>{t(`tab.${k}`)}</button>)}
    </div>
  );
}
/** An estimate chosen from the list (for the reports and the import). */
export function EstimatePicker({ id, value, onChange, rows, label }) {
  return <label htmlFor={id}>{label} <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} data-testid={id}><option value="">–</option>{rows.map((r) => <option key={r.id} value={r.id}>{r.ref} · {r.title} ({r.statusLabel})</option>)}</select></label>;
}
