import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, deploy } from './api.js';

// Deployment Board (HR, part 07.03): per site, the people in force on the chosen day grouped by crew, and the count of each designation against the plan (a gap is a post to fill, a surplus is shown too).
// A person moves to another crew of the site by drag and drop, or by their "Move to crew" list (keyboard): that is an amendment of the deployment sent for approval at once, and the person stays in the old crew until it is
// approved; Undo withdraws it. The server decides whether the move is allowed and says why not. Legend, zoom, filters, Print (PDF through the browser) and Export are on the page.
export default function DeploymentBoardPage() {
  usePageTitle('Deployment Board');
  const qc = useQueryClient();
  const sp = new URLSearchParams(window.location.search);
  const [date, setDate] = useState(sp.get('date') || dayIST(0));
  const [projectId, setProjectId] = useState(sp.get('projectId') ?? '');
  const [siteId, setSiteId] = useState(sp.get('siteId') ?? '');
  const [zoom, setZoom] = useState(100);
  const [error, setError] = useState(null);
  const [undo, setUndo] = useState(null);
  const [drag, setDrag] = useState(null);
  const filters = { date, projectId: projectId || undefined, siteId: siteId || undefined };
  const q = useQuery({ queryKey: ['hr', 'board', 'deploy', date, projectId, siteId], queryFn: () => deploy.board(filters), retry: false });
  if (q.error?.status === 403) return <NoPermission what="the deployment board" permission="hr.deployment.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const b = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['hr'] });
  const move = async (p, crewId, crewName) => {
    setError(null);
    try {
      const out = await deploy.move(p.deploymentId, crewId, `Reassigned to ${crewName} on the deployment board`);
      setUndo({ id: out.id, name: p.name, crew: crewName });
      refresh();
    } catch (e) { setError(errorInfo(e)); }
  };
  const undoIt = async () => { try { await deploy.cancel(undo.id, 'Undone from the deployment board'); setUndo(null); refresh(); } catch (e) { setError(errorInfo(e)); } };
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  return (
    <section aria-labelledby="db-title" data-testid="deployment-board">
      <h1 id="db-title">Deployment Board</h1>
      <form className="srch-form" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <Field label="As on" name="date" error={null}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="db-date" /></Field>
        <LookupField id="db-project" label="Project" lookup="iam/projects" value={projectId} onChange={(x) => { setProjectId(x); setSiteId(''); }} />
        <LookupField id="db-site" label="Site" lookup="iam/sites" parent={projectId || undefined} parentLabel="project" value={siteId} onChange={setSiteId} />
        <label className="field"><span>Zoom {zoom}%</span><input type="range" min="80" max="140" step="10" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" data-testid="db-zoom" /></label>
        <a className="btn" href={`/api/v1/hr/deployment-board/print?${qs}`} target="_blank" rel="noreferrer" data-testid="db-print">Print</a>
        <a className="btn" href="/api/v1/hr/deployments/export?format=csv" data-testid="db-export">Export</a>
      </form>
      <p className="muted small" data-testid="db-legend"><span className="hr-chip is-primary">Primary</span> primary posting · <span className="hr-chip">Secondary</span> secondary posting · <span className="hr-chip is-pending">Change waiting</span> an amendment is waiting for approval · a negative gap means more people than planned.</p>
      {error?.form && <p className="field-error" role="alert" data-testid="db-error">{error.form}</p>}
      {undo && <p className="mdm-banner" role="status" data-testid="db-undo">{undo.name} sent to {undo.crew} for approval. <button type="button" className="btn btn-small" onClick={undoIt} data-testid="db-undo-go">Undo</button></p>}
      {q.isPending ? <Skeleton label="Loading the board" rows={4} /> : b.sites.length === 0 ? <EmptyState title="No site to show" message="Sites appear here when you have deployments to see; deploy the first person from Deployments." /> : (
        <div style={{ fontSize: `${zoom}%` }} data-testid="db-sites">
          {b.sites.map((s) => (
            <section key={s.id} className="hr-site" aria-label={`${s.name}, ${s.deployed} deployed of ${s.planned} planned`} data-testid="db-site">
              <h2>{s.project} / {s.name} <span className="num" data-testid="db-site-count">{s.deployed}</span> of <span className="num">{s.planned}</span> planned{s.waiting > 0 && <span className="hr-chip is-pending"> {s.waiting} waiting</span>}</h2>
              {s.counts.length > 0 && (
                <div className="table-wrap" tabIndex={0} role="region" aria-label={`${s.name} against the plan`}>
                  <table className="grid" data-testid="db-counts"><thead><tr><th>Designation</th><th className="num">Planned</th><th className="num">Deployed</th><th className="num">Gap</th></tr></thead>
                    <tbody>{s.counts.map((c) => <tr key={c.designationId ?? 'none'}><td data-label="Designation">{c.designation}</td><td className="num" data-label="Planned">{c.planned}</td><td className="num" data-label="Deployed">{c.deployed}</td><td className={`num${c.gap < 0 ? ' is-over' : c.gap > 0 ? ' is-short' : ''}`} data-label="Gap">{c.gap}</td></tr>)}</tbody></table>
                </div>
              )}
              <div className="hr-board" role="list" aria-label={`Crews of ${s.name}`}>
                {s.groups.length === 0 && <p className="muted">Nobody is deployed here on this day.</p>}
                {(s.groups.some((g) => g.crewId == null) ? s.groups : [...s.groups]).map((g) => (
                  <section key={g.crewId ?? 'none'} role="listitem" className="hr-col" aria-label={`${g.crew}, ${g.people.length}`} data-testid="db-crew"
                    onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag && b.canMove && drag.siteId === s.id && (drag.crewId ?? null) !== (g.crewId ?? null)) move(drag, g.crewId, g.crew); setDrag(null); }}>
                    <h3>{g.crew} <span className="num">{g.people.length}</span></h3>
                    {g.supervisor && <p className="muted small">Supervisor: {g.supervisor}{g.trade ? ` · ${g.trade}` : ''}</p>}
                    {g.people.map((p) => (
                      <article key={p.deploymentId} className="hr-card" draggable={b.canMove && !p.pendingChange} onDragStart={() => setDrag({ ...p, siteId: s.id, crewId: g.crewId })} data-testid="db-person">
                        <h4><Link to={`/hr/deployments/deployment?id=${p.deploymentId}`}>{p.name}</Link></h4>
                        <p className="muted small">{p.designation ?? '—'}{p.siteRole ? ` · ${p.siteRole}` : ''}</p>
                        <p className="small"><span className={`hr-chip${p.isPrimary ? ' is-primary' : ''}`}>{p.isPrimary ? 'Primary' : 'Secondary'}</span>{p.pendingChange && <span className="hr-chip is-pending"> Change waiting</span>}</p>
                        {b.canMove && !p.pendingChange && s.crews.length > 0 && (
                          <label className="small">Move to crew <select aria-label={`Move ${p.name} to a crew`} value="" onChange={(e) => { const v = e.target.value; if (v === '') return; if (v === 'none') move({ ...p }, null, 'No crew'); else { const cr = s.crews.find((x) => String(x.id) === v); move({ ...p }, cr.id, cr.name); } }} data-testid="db-move">
                            <option value="">…</option>{g.crewId != null && <option value="none">No crew</option>}{s.crews.filter((x) => x.id !== g.crewId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                        )}
                      </article>
                    ))}
                  </section>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <p className="small"><Link to="/hr/deployments">Deployments</Link> · <Link to="/hr/crews">Crews &amp; Gangs</Link> · <Link to="/hr/transfers">Transfers</Link></p>
    </section>
  );
}
