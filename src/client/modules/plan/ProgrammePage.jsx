import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { download, fmtDate, pl, programmeSvg, svgToPng } from './api.js';
import { SchedulePicker, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Printable Programme (part 13.02, FR-04, FR-05): the Gantt on A3 or A1 as a PDF, or as an image (SVG or PNG), drawn by the server from its own dates; the parameters choose the time scale, the filter, a
// WBS branch and the window. Below, the programme by WBS node with totals, each node a link to the Gantt; the preview is the image itself, so what is shown is what is printed.
export default function ProgrammePage() {
  const t = useT('plan');
  usePageTitle(t('pr.title'));
  const sp = useSearch();
  const [projectId, setProjectId] = useState(null); const [scheduleId, setScheduleId] = useState(Number(sp.get('scheduleId')) || null);
  const [p, setP] = useState({ paper: 'A3', scale: 'week', filter: 'all', wbsId: '', from: '', to: '', links: 'true' }); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const sq = useQuery({ queryKey: ['plan', 'schedule', scheduleId], queryFn: () => pl.schedule(scheduleId), enabled: Boolean(scheduleId), retry: false });
  const gq = useQuery({ queryKey: ['plan', 'gantt', scheduleId], queryFn: () => pl.gantt(scheduleId), enabled: Boolean(scheduleId), retry: false });
  const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v)).toString();
  const can = gq.data?.can; const allowed = Boolean(can && (can.print || can.export));
  const vq = useQuery({ queryKey: ['plan', 'programme-svg', scheduleId, qs], queryFn: () => programmeSvg(scheduleId, qs), enabled: Boolean(scheduleId && allowed), retry: false });
  const [url, setUrl] = useState(null);
  useEffect(() => { if (!vq.data) { setUrl(null); return undefined; } const u = URL.createObjectURL(new Blob([vq.data], { type: 'image/svg+xml' })); setUrl(u); return () => URL.revokeObjectURL(u); }, [vq.data]);
  // the programme by WBS node: activities, critical, milestones, done, span; with the totals
  const table = useMemo(() => {
    const d = gq.data; if (!d) return null; const byId = new Map(d.wbs.map((w) => [w.id, w]));
    const top = (id) => { let w = byId.get(id); while (w?.parentId && byId.get(w.parentId)) w = byId.get(w.parentId); return w; };
    const rows = new Map(); const add = (k, label, a) => { const x = rows.get(k) ?? { key: k, label, n: 0, critical: 0, milestones: 0, done: 0, start: null, finish: null, wbsId: k || null }; x.n += 1; if (a.critical) x.critical += 1; if (a.type === 'MILESTONE') x.milestones += 1; if (a.actualFinish) x.done += 1; if (a.es && (!x.start || a.es < x.start)) x.start = a.es; if (a.ef && (!x.finish || a.ef > x.finish)) x.finish = a.ef; rows.set(k, x); };
    for (const a of d.activities) { const w = a.wbsId ? top(a.wbsId) : null; add(w?.id ?? 0, w ? `${w.code} ${w.name}` : t('act.noWbs'), a); }
    const list = [...rows.values()].sort((a, b) => a.label.localeCompare(b.label)); const tot = { n: 0, critical: 0, milestones: 0, done: 0 }; for (const x of list) for (const k of Object.keys(tot)) tot[k] += x[k];
    return { list, tot };
  }, [gq.data, t]);
  if (gq.error?.status === 403) return <NoPermission what={t('pr.title')} permission="plan.schedule.print" />;
  const d = gq.data; const s = d?.schedule; const pid = projectId ?? sq.data?.projectId ?? null;
  const go = async (fn) => { setError(null); setBusy(true); try { await fn(); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <section aria-labelledby="pr-h" data-testid="plan-programme">
      <PageHeader id="pr-h" title={t('pr.title')} />
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('pr.params')}>
        <SchedulePicker projectId={pid} scheduleId={scheduleId} onProject={(v) => { setProjectId(v); setScheduleId(null); }} onSchedule={setScheduleId} testId="pr" />
        <div className="form-grid">
          <Field label={t('pr.paper')} name="paper"><select value={p.paper} onChange={(e) => setP({ ...p, paper: e.target.value })} data-testid="pr-paper"><option value="A3">A3</option><option value="A1">A1</option></select></Field>
          <Field label={t('g.zoom')} name="scale"><select value={p.scale} onChange={(e) => setP({ ...p, scale: e.target.value })} data-testid="pr-scale">{['day', 'week', 'month', 'quarter'].map((z) => <option key={z} value={z}>{t(`g.zoom.${z}`)}</option>)}</select></Field>
          <Field label={t('g.filter')} name="filter"><select value={p.filter} onChange={(e) => setP({ ...p, filter: e.target.value })} data-testid="pr-filter">{['all', 'critical', 'open'].map((x) => <option key={x} value={x}>{t(`g.filter.${x}`)}</option>)}</select></Field>
          <Field label={t('f.wbs')} name="wbsId"><select value={p.wbsId} onChange={(e) => setP({ ...p, wbsId: e.target.value })} data-testid="pr-wbs"><option value="">{t('act.allWbs')}</option>{(d?.wbs ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</select></Field>
          <Field label={t('h.from')} name="from"><input type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} data-testid="pr-from" /></Field>
          <Field label={t('h.to')} name="to"><input type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} data-testid="pr-to" /></Field>
          <label className="check"><input type="checkbox" checked={p.links === 'true'} onChange={(e) => setP({ ...p, links: e.target.checked ? 'true' : 'false' })} data-testid="pr-links" /> {t('g.links')}</label>
        </div>
        {d && (
          <div className="actions">
            {can.print && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => go(() => download(`/schedules/${scheduleId}/programme?format=pdf&${qs}`, `programme-${s.docNo.replace(/[^A-Za-z0-9_-]+/g, '-')}-${p.paper}.pdf`))} data-testid="pr-pdf">{t('pr.pdf', { p: p.paper })}</button>}
            {allowed && <button type="button" className="btn" disabled={busy || !vq.data} onClick={() => go(async () => { const a = document.createElement('a'); a.href = url; a.download = `programme-${s.docNo.replace(/[^A-Za-z0-9_-]+/g, '-')}.svg`; a.click(); })} data-testid="pr-svg">{t('pr.svg')}</button>}
            {allowed && <button type="button" className="btn" disabled={busy || !vq.data} onClick={() => go(() => svgToPng(vq.data, `programme-${s.docNo.replace(/[^A-Za-z0-9_-]+/g, '-')}.png`))} data-testid="pr-png">{t('pr.png')}</button>}
            <Link to={`/plan/gantt?scheduleId=${scheduleId}`}>{t('g.title')}</Link>
          </div>
        )}
      </form>
      {!scheduleId && <p className="muted" data-testid="pr-choose">{t('pr.choose')}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="pr-error">{error.form}</p>}
      {scheduleId && gq.isPending && <Skeleton label={t('pr.title')} rows={4} />}
      {gq.isError && gq.error?.status !== 403 && <ErrorState error={gq.error} onRetry={gq.refetch} />}
      {d && !allowed && <NoPermission what={t('pr.title')} permission="plan.schedule.print" />}
      {d && allowed && (
        <>
          {s.needsCalc && <p className="mdm-banner" role="status" data-testid="pr-stale">{t('act.needsCalc')}</p>}
          <dl className="kv" data-testid="pr-summary"><div><dt>{t('f.schedule')}</dt><dd>{s.docNo} · v{s.versionNo}</dd></div><div><dt>{t('f.start')}</dt><dd>{fmtDate(s.start)}</dd></div><div><dt>{t('f.finish')}</dt><dd>{fmtDate(s.finish)}</dd></div><div><dt>{t('f.dataDate')}</dt><dd>{fmtDate(s.dataDate)}</dd></div><div><dt>{t('f.activities')}</dt><dd>{d.activities.length}</dd></div></dl>
          {table && table.list.length > 0 && (
            <div className="table-scroll"><table className="data-table" data-testid="pr-table"><caption>{t('pr.byWbs')}</caption>
              <thead><tr><th>{t('f.wbs')}</th><th className="num">{t('f.activities')}</th><th className="num">{t('f.critical')}</th><th className="num">{t('pr.milestones')}</th><th className="num">{t('pr.done')}</th><th>{t('f.start')}</th><th>{t('f.finish')}</th></tr></thead>
              <tbody>{table.list.map((x) => <tr key={x.key} data-testid="pr-row"><td>{x.wbsId ? <Link to={`/plan/activities?scheduleId=${scheduleId}&wbsId=${x.wbsId}`}>{x.label}</Link> : x.label}</td><td className="num">{x.n}</td><td className="num">{x.critical}</td><td className="num">{x.milestones}</td><td className="num">{x.done}</td><td>{fmtDate(x.start)}</td><td>{fmtDate(x.finish)}</td></tr>)}</tbody>
              <tfoot><tr><th>{t('f.total')}</th><td className="num">{table.tot.n}</td><td className="num">{table.tot.critical}</td><td className="num">{table.tot.milestones}</td><td className="num">{table.tot.done}</td><td>{fmtDate(s.start)}</td><td>{fmtDate(s.finish)}</td></tr></tfoot>
            </table></div>
          )}
          <h2>{t('pr.preview')}</h2>
          {vq.isPending ? <Skeleton label={t('pr.preview')} rows={4} /> : vq.isError ? <ErrorState error={vq.error} onRetry={vq.refetch} /> : url && (
            <div className="table-scroll" style={{ border: '1px solid var(--erp-color-border-subtle)', background: 'var(--erp-color-bg-surface)' }} data-testid="pr-preview"><img src={url} alt={t('pr.previewAlt', { s: s.docNo })} style={{ display: 'block', maxWidth: 'none', width: '100%', minWidth: 720 }} /></div>
          )}
        </>
      )}
    </section>
  );
}
