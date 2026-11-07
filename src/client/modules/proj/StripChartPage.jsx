import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { dayIST, downloadFile, gs } from './api.js';
import ProjectPicker from './ProjectPicker.jsx';
import { useSearch } from './parts.jsx';

// Chainage Progress Strip Chart (part 10.07, FR-04, FR-05): the linear schedule of a linear project: chainage along the axis, one band per activity, each segment filled to its percent complete from the latest reading; a table below carries the same figures,
// each segment opens the location. Progress is recorded here until the daily progress module (14.05) supplies it.
const color = (tone) => `var(--erp-color-status-${tone}-fg)`;
const toneOf = (p) => (p == null ? 'muted' : p < 25 ? 'danger' : p < 50 ? 'warning' : p < 75 ? 'info' : 'success');
export default function StripChartPage() {
  const t = useT('proj');
  const qc = useQueryClient();
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const projectId = Number(useSearch().get('projectId')) || null;
  const [activity, setActivity] = useState(''); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const [f, setF] = useState({ locationId: '', activity: '', pct: '', asOf: dayIST() });
  usePageTitle(t('gis.stripTitle'));
  const q = useQuery({ queryKey: ['proj', 'strip', projectId, activity], queryFn: () => gs.strip(projectId, activity), enabled: Boolean(projectId), retry: false });
  const hm = useQuery({ queryKey: ['proj', 'heat', projectId], queryFn: () => gs.heatmap(projectId), enabled: Boolean(projectId) && perms.includes('proj.gis.progress'), retry: false });
  const head = <header><h1 id="strip-h">{t('gis.stripTitle')}</h1><div className="actions-row no-print"><ProjectPicker route="/proj/strip-chart" projectId={projectId} testId="strip-project" /><Link to={projectId ? `/proj/map?projectId=${projectId}` : '/proj/map'}>{t('gis.mapTitle')}</Link></div></header>;
  if (!projectId) return <section aria-labelledby="strip-h" data-testid="strip-chart">{head}<p className="muted">{t('gis.chooseProject')}</p></section>;
  if (q.error?.status === 403) return <NoPermission what={t('gis.stripTitle')} permission="proj.gis.view" />;
  if (q.isPending) return <Skeleton label={t('gis.stripTitle')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const s = q.data; const span = Math.max(1, s.to - s.from); const W = 900; const rowH = 34; const x = (m) => 60 + ((m - s.from) / span) * (W - 80);
  const record = async (e) => { e.preventDefault(); setError(null); setNote(null); try { await gs.record({ projectId, locationId: Number(f.locationId), activity: f.activity.trim(), pct: f.pct, asOf: f.asOf }); setNote(t('gis.recorded')); qc.invalidateQueries({ queryKey: ['proj'] }); } catch (x2) { setError(errorInfo(x2)); } };
  return (
    <section aria-labelledby="strip-h" data-testid="strip-chart">
      {head}
      <div className="actions-row no-print">
        <Field label={t('gis.activity')} name="activity"><select value={activity} onChange={(e) => setActivity(e.target.value)} data-testid="strip-activity"><option value="">{t('gis.allActivities')}</option>{s.activities.map((a) => <option key={a} value={a}>{a}</option>)}</select></Field>
        {perms.includes('proj.gis.export') && ['xlsx', 'csv', 'pdf'].map((fmt) => <button key={fmt} type="button" className="btn" onClick={() => downloadFile(`/gis/strip/export?projectId=${projectId}&format=${fmt}${activity ? `&activity=${encodeURIComponent(activity)}` : ''}`, `strip-chart.${fmt}`)} data-testid={`strip-export-${fmt}`}>{fmt.toUpperCase()}</button>)}
      </div>
      {s.rows.length === 0 ? <p className="muted" data-testid="strip-empty">{t('gis.stripEmpty')}</p> : (
        <div className="mdm-panel" style={{ overflowX: 'auto' }}>
          <svg role="img" aria-label={t('gis.stripTitle')} viewBox={`0 0 ${W} ${s.rows.length * rowH + 40}`} width="100%" style={{ minWidth: 520 }} data-testid="strip-svg">
            {s.rows.map((r, i) => (
              <g key={r.activity} data-activity={r.activity}>
                <text x="4" y={i * rowH + 22} fontSize="11">{r.activity} · {r.pct}%</text>
                {r.segments.map((g) => (
                  <g key={g.locationId} data-testid={`strip-seg-${i}-${g.code}`} data-pct={g.pct ?? ''}>
                    <rect x={x(g.from)} y={i * rowH + 6} width={Math.max(1, x(g.to) - x(g.from) - 1)} height={rowH - 12} fill="none" stroke="currentColor" opacity="0.5"><title>{`${g.code}: ${g.from}–${g.to} m`}</title></rect>
                    <rect x={x(g.from)} y={i * rowH + 6} width={Math.max(0, (x(g.to) - x(g.from) - 1) * (g.pct ?? 0) / 100)} height={rowH - 12} fill={color(toneOf(g.pct))}><title>{`${g.code}: ${g.pct ?? 0}%`}</title></rect>
                  </g>
                ))}
              </g>
            ))}
            <text x="60" y={s.rows.length * rowH + 20} fontSize="11">{s.from} m</text><text x={W - 20} y={s.rows.length * rowH + 20} fontSize="11" textAnchor="end">{s.to} m</text>
          </svg>
        </div>
      )}
      <div className="mdm-panel" data-testid="strip-table"><h2>{t('gis.stripTable')}</h2>
        <table className="data-table"><thead><tr><th scope="col">{t('gis.activity')}</th><th scope="col">{t('gis.col.name')}</th><th scope="col">{t('gis.chainage')}</th><th scope="col">{t('gis.col.progress')}</th></tr></thead>
          <tbody>{s.rows.flatMap((r) => [...r.segments.map((g) => <tr key={`${r.activity}${g.locationId}`}><td>{r.activity}</td><td><Link to={`/proj/map?projectId=${projectId}`}>{g.code}</Link></td><td>{g.from}–{g.to} m</td><td>{g.pct == null ? '—' : `${g.pct}%`}</td></tr>),
            <tr key={`${r.activity}tot`}><th scope="row" colSpan={3}>{t('gis.total', { activity: r.activity })}</th><td data-testid={`strip-total-${r.activity}`}>{r.pct}% ({r.completeM} / {s.lengthM} m)</td></tr>])}</tbody></table>
      </div>
      {perms.includes('proj.gis.progress') && (
        <form className="mdm-panel" aria-label={t('gis.record')} data-testid="strip-record" onSubmit={record}><h2>{t('gis.record')}</h2>
          <div className="form-grid">
            <Field label={t('gis.location')} name="locationId" error={error}><select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })} required data-testid="rec-location"><option value="">—</option>{(hm.data?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} · {l.name}</option>)}</select></Field>
            <Field label={t('gis.activity')} name="activity" error={error}><input value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value })} required maxLength={80} data-testid="rec-activity" /></Field>
            <Field label={t('gis.pct')} name="pct" error={error}><input value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} inputMode="decimal" required data-testid="rec-pct" /></Field>
            <Field label={t('gis.asOf')} name="asOf" error={error}><input type="date" value={f.asOf} onChange={(e) => setF({ ...f, asOf: e.target.value })} data-testid="rec-asof" /></Field>
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="strip-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
          {note && <p className="mdm-banner" role="status" data-testid="strip-note">{note}</p>}
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={!f.locationId || !f.activity.trim() || f.pct === ''} data-testid="rec-save">{t('act.save')}</button></div>
        </form>
      )}
    </section>
  );
}
