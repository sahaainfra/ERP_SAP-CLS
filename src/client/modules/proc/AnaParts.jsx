import { useQuery } from '@tanstack/react-query';
import { Link } from '../core/pages/ui.jsx';
import { an } from './api.js';

// Pieces the procurement dashboard and its reports share (part 15.10).
/** Horizontal bars for labelled values: the widest is the full width; each bar is a link when the row has one. */
export function Bars({ rows, format, testId, label }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? r.count ?? 0));
  return (
    <ul className="bars" data-testid={testId} aria-label={label} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {rows.map((r) => { const v = r.value ?? r.count ?? 0; const w = Math.max(2, Math.round((v / max) * 100)); const text = <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{r.label}</span><strong>{format(v)}</strong></span>;
        return (<li key={r.key ?? r.label} data-testid={`${testId}-row`} style={{ margin: '6px 0' }}>{r.link ? <Link to={r.link}>{text}</Link> : text}
          <div role="presentation" style={{ height: 10, borderRadius: 5, background: 'var(--erp-color-status-info-bg)' }}><div style={{ width: `${w}%`, height: '100%', borderRadius: 5, background: 'var(--erp-color-status-info-solid)' }} /></div></li>); })}
    </ul>
  );
}

/** The parameter panel: project and period. */
export function ParamPanel({ t, value, onChange, children }) {
  const pq = useQuery({ queryKey: ['proc', 'an-projects'], queryFn: an.projects, retry: false }); const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="mdm-panel no-print" data-testid="an-params"><div className="form-grid">
      <label>{t('x.project')}<select value={value.projectId ?? ''} onChange={(ev) => set('projectId', ev.target.value)} style={{ minHeight: 44 }} data-testid="an-project"><option value="">{t('n.allProjects')}</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
      <label>{t('n.from')}<input type="date" value={value.from ?? ''} onChange={(ev) => set('from', ev.target.value)} style={{ minHeight: 44 }} data-testid="an-from" /></label>
      <label>{t('n.to')}<input type="date" value={value.to ?? ''} onChange={(ev) => set('to', ev.target.value)} style={{ minHeight: 44 }} data-testid="an-to" /></label>{children}</div></div>
  );
}
