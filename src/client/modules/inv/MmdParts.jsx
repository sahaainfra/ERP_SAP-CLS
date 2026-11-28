import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Link } from '../core/pages/ui.jsx';
import { fmtDate, fmtQty, fmtRs, mm } from './api.js';

// Pieces the materials dashboard and the lifecycle funnel share (part 16.11): the filter panel, a record table and an export button.
export const rs = (paise) => fmtRs(paise);

/** Project, store and period. Choosing a project narrows the stores; choosing neither is the company view. */
export function FilterPanel({ value, onChange, children, testId = 'md-filters' }) {
  const t = useT('inv'); const pq = useQuery({ queryKey: ['inv', 'mm-projects'], queryFn: mm.projects, retry: false }); const sq = useQuery({ queryKey: ['inv', 'mm-stores', value.projectId ?? ''], queryFn: () => mm.stores(value.projectId), retry: false });
  const set = (k, v) => onChange({ ...value, [k]: v, ...(k === 'projectId' ? { storeId: '' } : {}) });
  return (
    <div className="mdm-panel no-print" data-testid={testId}><div className="form-grid">
      <label>{t('md.project')}<select value={value.projectId ?? ''} onChange={(ev) => set('projectId', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="md-project"><option value="">{t('md.allProjects')}</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
      {value.storeId !== undefined && <label>{t('md.store')}<select value={value.storeId ?? ''} onChange={(ev) => set('storeId', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="md-store"><option value="">{t('md.allStores')}</option>{(sq.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>}
      <label>{t('md.from')}<input type="date" value={value.from ?? ''} onChange={(ev) => set('from', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="md-from" /></label>
      <label>{t('md.to')}<input type="date" value={value.to ?? ''} onChange={(ev) => set('to', ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="md-to" /></label>{children}</div></div>
  );
}

/** The records behind a figure: one table for every kind. */
export function RecordTable({ rows, testId = 'md-drill-table', empty }) {
  const t = useT('inv');
  if (!rows?.length) return <p className="muted" data-testid={`${testId}-empty`}>{empty ?? t('md.noRecords')}</p>;
  return (
    <div className="table-scroll"><table className="data-table" data-testid={testId}><thead><tr><th>{t('md.record')}</th><th>{t('md.detail')}</th><th>{t('md.project')}</th><th>{t('md.store')}</th><th>{t('md.date')}</th><th className="num">{t('md.age')}</th><th className="num">{t('md.qty')}</th><th className="num">{t('md.value')}</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} data-testid={`${testId}-row`}><td>{r.link ? <Link to={r.link}>{r.docNo}</Link> : r.docNo}</td><td>{r.label}{r.note ? <span className="muted small"> · {r.note}</span> : null}</td><td>{r.project ?? ''}</td><td>{r.store ?? ''}</td><td>{r.date ? fmtDate(r.date.length === 10 ? r.date : r.date.slice(0, 10)) : ''}</td>
        <td className="num">{r.ageDays ?? ''}</td><td className="num">{r.qty == null ? '' : `${fmtQty(r.qty)}${r.uom ? ` ${r.uom}` : ''}`}</td><td className="num">{r.value == null ? '' : rs(r.value)}</td></tr>)}</tbody></table></div>
  );
}

/** CSV download of what is on screen: the server applies the same filters, scope and value masks. */
export function ExportButton({ query, name, label, testId = 'md-export' }) {
  const t = useT('inv');
  return <button type="button" className="btn" style={{ minHeight: 'var(--erp-target-min)' }} data-testid={testId} onClick={() => mm.exportFile(query, name).catch(() => { globalThis.alert?.(t('md.exportFailed')); })}>{label ?? t('md.export')}</button>;
}
