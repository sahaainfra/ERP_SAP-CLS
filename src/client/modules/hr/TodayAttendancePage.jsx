import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { formatDateTime } from '../../platform/format.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { attp, dayIST } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Today's Attendance by Site (HR, part 07.05): for each site the people deployed, those expected today (not on a weekly off or a holiday by their shift and calendar, 07.04), present, absent, late, punches outside the fence,
// rejected, waiting for a visit approval, with a bar of present against absent. A count opens the punches behind it. Export gives the table as CSV. HR sets, per site, whether a selfie is asked and the accuracy and fence
// tolerance used (the fence itself is drawn on the site, 02.02).
const BUCKETS = { present: ['ACCEPTED,FLAGGED', 'Present'], rejected: ['REJECTED', 'Rejected'], pending: ['PENDING', 'Waiting for a visit approval'], flagged: ['FLAGGED', 'Flagged'] };
export default function TodayAttendancePage() {
  usePageTitle("Today's Attendance");
  const qc = useQueryClient();
  const [date, setDate] = useState(dayIST(0));
  const [projectId, setProjectId] = useState('');
  const [drill, setDrill] = useState(null);
  const q = useQuery({ queryKey: ['att', 'report', date, projectId], queryFn: () => attp.report({ date, projectId: projectId || undefined }), retry: false });
  if (q.error?.status === 403) return <NoPermission what="the attendance report" permission="att.punch.view" />;
  const d = q.data;
  const qs = new URLSearchParams(Object.entries({ date, projectId }).filter(([, v]) => v)).toString();
  return (
    <section aria-labelledby="td-title" data-testid="today">
      <PageHeader id="td-title" title={"Today's Attendance"} />
      <form className="srch-form" aria-label="Parameters" onSubmit={(e) => e.preventDefault()}>
        <Field label="Day" name="date" error={null}><input type="date" value={date} onChange={(e) => { setDate(e.target.value); setDrill(null); }} data-testid="td-date" /></Field>
        <LookupField id="td-project" label="Project" lookup="iam/projects" value={projectId} onChange={(x) => { setProjectId(x); setDrill(null); }} />
        <a className="btn" href={`/api/v1/att/report/today/export?${qs}`} data-testid="td-export">Export CSV</a>
        <button type="button" className="btn" onClick={() => window.print()}>Print</button>
      </form>
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label="Loading the report" rows={4} /> : d.rows.length === 0 ? <EmptyState title="No site to show" message="Sites appear here once people are deployed to them (Deployments) and you may see them." /> : (
        <>
          <dl className="op-figures" data-testid="td-totals"><div><dt>Expected</dt><dd>{d.totals.expected}</dd></div><div><dt>Present</dt><dd data-testid="td-present">{d.totals.present}</dd></div><div><dt>Absent</dt><dd>{d.totals.absent}</dd></div><div><dt>Late</dt><dd>{d.totals.late}</dd></div><div><dt>Outside the fence</dt><dd>{d.totals.outsideFence}</dd></div><div><dt>Open anomalies</dt><dd>{d.totals.openAnomalies}</dd></div></dl>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="By site">
            <table className="grid" data-testid="td-table"><thead><tr><th>Site</th><th className="num">Deployed</th><th className="num">Expected</th><th className="num">Present</th><th className="num">Absent</th><th className="num">Late</th><th className="num">Outside fence</th><th className="num">Rejected</th><th className="num">Waiting</th><th>Present of expected</th></tr></thead>
              <tbody>{d.rows.map((r) => {
                const pct = r.expected ? Math.min(100, Math.round((r.present / r.expected) * 100)) : 0;
                const open = (bucket, extra = {}) => setDrill({ site: r.site, siteId: r.siteId, bucket, extra });
                return (
                  <tr key={r.siteId} data-testid="td-row"><th scope="row" data-label="Site">{r.project} / {r.site}</th><td className="num" data-label="Deployed">{r.deployed}</td><td className="num" data-label="Expected">{r.expected}</td>
                    <td className="num" data-label="Present"><button type="button" className="btn-link" onClick={() => open('present')} data-testid="td-open-present">{r.present}</button></td><td className="num" data-label="Absent">{r.absent}</td><td className="num" data-label="Late">{r.late}</td>
                    <td className="num" data-label="Outside fence"><button type="button" className="btn-link" onClick={() => open('rejected')} data-testid="td-open-outside">{r.outsideFence}</button></td><td className="num" data-label="Rejected"><button type="button" className="btn-link" onClick={() => open('rejected')}>{r.rejected}</button></td>
                    <td className="num" data-label="Waiting"><button type="button" className="btn-link" onClick={() => open('pending')}>{r.pending}</button></td>
                    <td data-label="Present of expected"><span className="att-bar" role="img" aria-label={`${pct} percent present`}><span className="att-bar-fill" style={{ inlineSize: `${pct}%` }} /></span> {pct}%</td></tr>
                );
              })}</tbody></table>
          </div>
        </>
      )}
      {drill && <Drill drill={drill} date={date} close={() => setDrill(null)} />}
      <Settings sites={d?.rows ?? []} refresh={() => qc.invalidateQueries({ queryKey: ['att'] })} />
      <p className="small"><Link to="/att/anomalies">Attendance Anomalies</Link> · <Link to="/hr/deployment-board">Deployment Board</Link></p>
    </section>
  );
}

function Drill({ drill, date, close }) {
  const [result] = BUCKETS[drill.bucket];
  const q = useQuery({ queryKey: ['att', 'drill', drill.siteId, date, drill.bucket], queryFn: async () => { const out = []; for (const r of result.split(',')) out.push(...(await attp.list({ siteId: drill.siteId, date, result: r, limit: 200 })).data); return out.sort((a, b) => b.effectiveTime.localeCompare(a.effectiveTime)); }, retry: false });
  return (
    <section className="mdm-panel" aria-labelledby="dr-title" data-testid="td-drill">
      <h2 id="dr-title">{BUCKETS[drill.bucket][1]} at {drill.site}</h2>
      {q.isPending ? <Skeleton label="Loading the punches" rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data.length === 0 ? <p className="muted">No punch.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Punches"><table className="grid"><thead><tr><th>Person</th><th>Punch</th><th>Time</th><th>Method</th><th>Result</th></tr></thead>
          <tbody>{q.data.map((p) => <tr key={p.id} data-testid="td-drill-row"><td data-label="Person">{p.person} <span className="muted small">{p.code}</span></td><td data-label="Punch">{p.type === 'IN' ? 'In' : 'Out'}</td><td data-label="Time">{formatDateTime(p.effectiveTime)}</td><td data-label="Method">{p.method.toLowerCase()}{p.offline ? ', offline' : ''}</td><td data-label="Result">{p.result.toLowerCase()}{p.reasonText ? `: ${p.reasonText}` : ''}{p.flags.length ? ` (${p.flags.join(', ').toLowerCase().replace(/_/g, ' ')})` : ''}</td></tr>)}</tbody></table></div>
      )}
      <div className="actions"><button type="button" className="btn" onClick={close}>Close</button></div>
    </section>
  );
}

function Settings({ sites, refresh }) {
  const [siteId, setSiteId] = useState('');
  const q = useQuery({ queryKey: ['att', 'settings', siteId], queryFn: () => attp.settings(siteId), enabled: Boolean(siteId), retry: false });
  const [v, setV] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const s = q.data;
  const f = v ?? (s ? { selfieMode: s.selfieMode, flagAccuracyM: s.flagAccuracy, rejectAccuracyM: s.rejectAccuracy, toleranceM: s.tolerance, kioskEnabled: s.kioskEnabled } : null);
  const set = (p) => setV({ ...f, ...p });
  const save = async (e) => {
    e.preventDefault(); setError(null); setNote(null);
    try { await attp.setSettings(siteId, { selfieMode: f.selfieMode, flagAccuracyM: Number(f.flagAccuracyM), rejectAccuracyM: Number(f.rejectAccuracyM), toleranceM: Number(f.toleranceM), kioskEnabled: f.kioskEnabled, version: s.rowVersion }); setNote('Saved.'); setV(null); q.refetch(); refresh(); } catch (x) { setError(errorInfo(x)); }
  };
  if (!sites.length) return null;
  return (
    <section className="mdm-panel" aria-labelledby="st-title" data-testid="td-settings">
      <h2 id="st-title">Punch settings of a site</h2>
      <Field label="Site" name="site" error={null}><select value={siteId} onChange={(e) => { setSiteId(e.target.value); setV(null); }} data-testid="st-site"><option value="">Choose a site</option>{sites.map((r) => <option key={r.siteId} value={r.siteId}>{r.site}</option>)}</select></Field>
      {s && f && (
        <form className="mdm-fields" onSubmit={save} aria-label="Punch settings">
          <Field label="Selfie" name="selfieMode" error={error}><select value={f.selfieMode} disabled={!s.can.edit} onChange={(e) => set({ selfieMode: e.target.value })} data-testid="st-selfie"><option value="NONE">Not asked</option><option value="OPTIONAL">Optional</option><option value="REQUIRED">Required</option></select></Field>
          <Field label="Flag a punch when accuracy is worse than (metres)" name="flagAccuracyM" error={error}><input type="number" min="5" max="1000" value={f.flagAccuracyM} disabled={!s.can.edit} onChange={(e) => set({ flagAccuracyM: e.target.value })} data-testid="st-flag" /></Field>
          <Field label="Reject a punch when accuracy is worse than (metres)" name="rejectAccuracyM" error={error}><input type="number" min="10" max="5000" value={f.rejectAccuracyM} disabled={!s.can.edit} onChange={(e) => set({ rejectAccuracyM: e.target.value })} data-testid="st-reject" /></Field>
          <Field label="Fence tolerance at the edge (metres)" name="toleranceM" error={error}><input type="number" min="0" max="100" value={f.toleranceM} disabled={!s.can.edit} onChange={(e) => set({ toleranceM: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={f.kioskEnabled} disabled={!s.can.edit} onChange={(e) => set({ kioskEnabled: e.target.checked })} /> The kiosk may be used at this site</label>
          {error?.form && <p className="field-error" role="alert">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
          {s.can.edit ? <div className="actions"><button type="submit" className="btn btn-primary" data-testid="st-save">Save</button></div> : <p className="muted">Only HR changes these settings.</p>}
        </form>
      )}
      {note && <p role="status" className="mdm-banner" data-testid="st-note">{note}</p>}
    </section>
  );
}
