import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Link, errorInfo } from '../core/pages/ui.jsx';
import { fmtDate, pl } from './api.js';

// Pieces the plant pages share (part 17.01): the runner of a call, the project and site filter, a record table and the export button.
export function useRunner() {
  const qc = useQueryClient(); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['plant'] }); qc.invalidateQueries({ queryKey: ['list'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  return { error, setError, note, setNote, busy, run };
}
export function FilterPanel({ value, onChange }) {
  const t = useT('plant'); const oq = useQuery({ queryKey: ['plant', 'options'], queryFn: pl.options, retry: false }); const o = oq.data; const set = (k, v) => onChange({ ...value, [k]: v, ...(k === 'projectId' ? { siteId: '' } : {}) });
  const sites = (o?.sites ?? []).filter((s) => !value.projectId || String(s.projectId) === String(value.projectId));
  return (
    <div className="mdm-panel no-print" data-testid="pd-filters"><div className="form-grid">
      <label>{t('project')}<select value={value.projectId ?? ''} onChange={(ev) => set('projectId', ev.target.value)} style={{ minHeight: 44 }} data-testid="pd-project"><option value="">{t('allProjects')}</option>{(o?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
      <label>{t('site')}<select value={value.siteId ?? ''} onChange={(ev) => set('siteId', ev.target.value)} style={{ minHeight: 44 }} data-testid="pd-site"><option value="">{t('allSites')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label></div></div>
  );
}
export function RecordTable({ rows, testId = 'pd-drill-table' }) {
  const t = useT('plant'); if (!rows?.length) return <p className="muted" data-testid={`${testId}-empty`}>{t('noRecords')}</p>;
  return (
    <div className="table-scroll"><table className="data-table" data-testid={testId}><thead><tr><th>{t('assetCode')}</th><th>{t('detail')}</th><th>{t('project')}</th><th>{t('where')}</th><th>{t('date')}</th><th className="num">{t('daysLeft')}</th><th>{t('note')}</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={`${r.id}-${i}`} data-testid={`${testId}-row`}><td><Link to={r.link}>{r.docNo}</Link></td><td>{r.label}</td><td>{r.project}{r.site ? `/${r.site}` : ''}</td><td>{r.status}</td><td>{r.date ? fmtDate(r.date.slice(0, 10)) : ''}</td><td className="num">{r.ageDays ?? ''}</td><td>{r.note ?? ''}</td></tr>)}</tbody></table></div>
  );
}
export function ExportButton({ query, name, label, path, testId = 'pd-export' }) {
  const t = useT('plant'); return <button type="button" className="btn" style={{ minHeight: 44 }} data-testid={testId} onClick={() => pl.exportFile(query, name, path).catch(() => globalThis.alert?.(t('exportFailed')))}>{label ?? t('export')}</button>;
}
