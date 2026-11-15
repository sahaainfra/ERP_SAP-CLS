import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import { gs } from './api.js';
import ProjectPicker from './ProjectPicker.jsx';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Project Map (part 10.07, FR-01 to FR-04, FR-07, BR-01): the sites with their geofences, the location breakdown, the custom layers, the plan overlays, the points that other modules offer and the punch aggregates, with layer toggles, the progress heatmap,
// a legend and click-through to the records. The map library loads on demand; without it, without a base map or on request the same data is shown as a list (degraded list mode).
const token = (name) => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name).trim()) || 'currentColor';
const toneColor = (tone) => token(`--erp-color-status-${tone}-fg`);
function anchor(text, href) { const a = document.createElement('a'); a.href = href; a.textContent = text; return a; }
function popup(title, lines, href, linkText) { const d = document.createElement('div'); const b = document.createElement('strong'); b.textContent = title; d.append(b); for (const l of lines.filter(Boolean)) { const p = document.createElement('div'); p.textContent = l; d.append(p); } if (href) d.append(anchor(linkText, href)); return d; }
export default function ProjectMapPage() {
  const t = useT('proj');
  const projectId = Number(useSearch().get('projectId')) || null;
  usePageTitle(t('gis.mapTitle'));
  const q = useQuery({ queryKey: ['proj', 'gismap', projectId], queryFn: () => gs.map(projectId), enabled: Boolean(projectId), retry: false });
  const box = useRef(null); const mapRef = useRef(null);
  const [off, setOff] = useState({}); const [heat, setHeat] = useState(true); const [listMode, setListMode] = useState(false); const [broken, setBroken] = useState(false);
  const d = q.data; const list = listMode || broken;
  const on = (k) => !off[k]; const toggle = (k) => setOff((x) => ({ ...x, [k]: !x[k] }));
  useEffect(() => {
    if (!d || list || !box.current) return undefined;
    let cancelled = false; let map = null;
    (async () => {
      try {
        const [{ default: L }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
        if (cancelled || !box.current) return;
        map = L.map(box.current, { center: d.center, zoom: d.zoom }); mapRef.current = map;
        if (d.tile.url) L.tileLayer(d.tile.url, { attribution: d.tile.attribution, maxZoom: 19 }).addTo(map).on('tileerror', () => { /* the vector layers still work */ });
        for (const o of d.overlays) if (on(`ov${o.id}`) && o.bounds) L.imageOverlay(o.imageUrl, o.bounds, { opacity: o.opacity / 100, alt: o.name }).addTo(map);
        for (const s of d.sites) {
          if (!on('sites') || s.lat == null) continue;
          const p = [s.lat, s.lng];
          if (s.geofence.type === 'CIRCLE') L.circle(p, { radius: s.geofence.radiusM, color: token('--erp-color-border-focus'), weight: 2, fill: false }).addTo(map);
          L.circleMarker(p, { radius: 7, color: token('--erp-color-border-focus'), weight: 3 }).bindPopup(popup(`${s.code} ${s.name}`, [t('gis.geofence', { type: s.geofence.type })], null)).addTo(map);
        }
        for (const l of d.layers) {
          if (!on(`ly${l.id}`)) continue;
          L.geoJSON(l.geojson, { style: () => ({ color: l.style.color ?? token('--erp-color-border-focus'), weight: l.style.weight ?? 3, fillOpacity: l.style.fillOpacity ?? 0.15, dashArray: l.style.dashArray }), pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, color: l.style.color ?? token('--erp-color-border-focus') }),
            onEachFeature: (f, layer) => layer.bindPopup(popup(f.properties?.name ?? l.name, [l.ltypeLabel, f.properties?.description], null)) }).addTo(map);
        }
        for (const x of d.locations) {
          if (!on('locations') || x.lat == null) continue;
          const col = heat && x.pct != null ? toneColor(x.band) : token('--erp-color-text-primary');
          L.circleMarker([x.lat, x.lng], { radius: 9, color: col, fillColor: col, fillOpacity: heat ? 0.6 : 0.2, weight: 2 }).bindPopup(popup(`${x.code} ${x.name}`, [x.pct == null ? t('gis.noProgress') : t('gis.pctDone', { pct: x.pct }), ...x.activities.map((a) => `${a.activity}: ${a.pct}%`)], `/proj/locations?projectId=${projectId}`, t('gis.openLocation'))).addTo(map);
        }
        for (const p of d.points) {
          if (!on(`pt${p.code}`)) continue;
          for (const f of p.features) L.circleMarker([f.lat, f.lng], { radius: 6, color: token('--erp-color-status-warning-fg'), weight: 2 }).bindPopup(popup(f.title, [p.label, f.status, f.date], f.route, t('gis.openRecord'))).addTo(map);
        }
        if (on('punches')) for (const c of d.punches.cells) L.circle([c.lat, c.lng], { radius: 55, color: token('--erp-color-status-info-fg'), weight: 1, fillOpacity: 0.3 }).bindPopup(popup(t('gis.punchCell', { n: c.people }), [t('gis.punchPrivacy', { n: d.punches.minPeople })], null)).addTo(map);
      } catch { if (!cancelled) setBroken(true); }
    })();
    return () => { cancelled = true; mapRef.current = null; if (map) map.remove(); };
  }, [d, list, off, heat]);
  const head = (
    <header>
      <PageHeader id="gis-h" title={t('gis.mapTitle')} />
      <div className="actions-row no-print"><ProjectPicker route="/proj/map" projectId={projectId} testId="gis-project" /><Link to={projectId ? `/proj/strip-chart?projectId=${projectId}` : '/proj/strip-chart'}>{t('gis.stripTitle')}</Link><Link to={projectId ? `/proj/gis-config?projectId=${projectId}` : '/proj/gis-config'}>{t('gis.configTitle')}</Link></div>
    </header>
  );
  if (!projectId) return <section aria-labelledby="gis-h" data-testid="project-map">{head}<p className="muted">{t('gis.chooseProject')}</p></section>;
  if (q.error?.status === 403) return <NoPermission what={t('gis.mapTitle')} permission="proj.gis.view" />;
  if (q.isPending) return <Skeleton label={t('gis.mapTitle')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const groups = [
    { key: 'sites', label: t('gis.sites'), n: d.sites.length }, { key: 'locations', label: t('gis.locations'), n: d.locations.length },
    ...d.layers.map((l) => ({ key: `ly${l.id}`, label: `${l.name} (${l.ltypeLabel})`, n: l.geojson.features.length })), ...d.overlays.map((o) => ({ key: `ov${o.id}`, label: `${o.name} (${t('gis.overlay')})`, n: 1 })),
    ...d.points.map((p) => ({ key: `pt${p.code}`, label: p.live ? p.label : `${p.label} · ${t('gis.notLive', { module: p.ownerModule })}`, n: p.features.length, disabled: !p.live })), { key: 'punches', label: t('gis.punches'), n: d.punches.cells.length },
  ];
  return (
    <section aria-labelledby="gis-h" data-testid="project-map" data-mode={list ? 'list' : 'map'}>
      {head}
      <p className="muted">{d.projectCode} · {d.projectName} · {t('gis.summary', { sites: d.summary.sites, layers: d.summary.layers, located: d.summary.located, locations: d.summary.locations })}</p>
      {broken && <p className="mdm-banner" role="status" data-testid="gis-degraded">{t('gis.degraded')}</p>}
      <div className="form-grid">
        <fieldset className="mdm-panel" data-testid="gis-toggles"><legend>{t('gis.layersToggle')}</legend>
          {groups.map((g) => <label key={g.key} style={{ display: 'block' }}><input type="checkbox" checked={on(g.key) && !g.disabled} disabled={g.disabled} onChange={() => toggle(g.key)} data-testid={`gis-toggle-${g.key}`} /> {g.label} ({g.n})</label>)}
          <label style={{ display: 'block' }}><input type="checkbox" checked={heat} onChange={() => setHeat(!heat)} data-testid="gis-heat" /> {t('gis.heatmap')}</label>
          <button type="button" className="btn" onClick={() => setListMode(!listMode)} data-testid="gis-list-mode" aria-pressed={listMode}>{listMode ? t('gis.showMap') : t('gis.showList')}</button>
          <ul className="legend" aria-label={t('gis.legend')} data-testid="gis-legend">{d.legend.map((b) => <li key={b.tone}><span aria-hidden="true" style={{ display: 'inline-block', width: 14, height: 14, marginRight: 6, background: toneColor(b.tone) }} />{b.from}–{b.to}%</li>)}</ul>
        </fieldset>
        {!list && <div ref={box} role="application" aria-label={t('gis.mapTitle')} data-testid="gis-canvas" style={{ minHeight: 420, minWidth: 0, flex: 1 }} />}
      </div>
      <div className="mdm-panel" data-testid="gis-list"><h2>{t('gis.listTitle')}</h2>
        <table className="data-table"><thead><tr><th scope="col">{t('gis.col.what')}</th><th scope="col">{t('gis.col.name')}</th><th scope="col">{t('gis.col.where')}</th><th scope="col">{t('gis.col.progress')}</th></tr></thead>
          <tbody>
            {d.sites.map((s) => <tr key={`s${s.id}`}><td>{t('gis.site')}</td><td>{s.code} {s.name}</td><td>{s.lat != null ? `${s.lat}, ${s.lng}` : '—'}</td><td>—</td></tr>)}
            {d.locations.map((x) => <tr key={`l${x.id}`} data-testid={`gis-loc-${x.code}`}><td>{t('gis.location')}</td><td><Link to={`/proj/locations?projectId=${projectId}`}>{x.code}</Link> {x.name}</td><td>{x.lat != null ? `${x.lat}, ${x.lng}` : '—'}{x.chainageFrom != null ? ` · ${x.chainageFrom}–${x.chainageTo} m` : ''}</td><td>{x.pct == null ? '—' : `${x.pct}%`}</td></tr>)}
            {d.layers.map((l) => <tr key={`y${l.id}`}><td>{l.ltypeLabel}</td><td>{l.name}</td><td>{t('gis.features', { n: l.geojson.features.length })}</td><td>—</td></tr>)}
            {d.points.flatMap((p) => p.features.map((f) => <tr key={`${p.code}${f.id}`}><td>{p.label}</td><td><a href={f.route}>{f.title}</a></td><td>{f.lat}, {f.lng}</td><td>{f.status ?? '—'}</td></tr>))}
            {d.punches.cells.map((c, i) => <tr key={`p${i}`}><td>{t('gis.punches')}</td><td>{t('gis.punchCell', { n: c.people })}</td><td>{c.lat}, {c.lng}</td><td>—</td></tr>)}
          </tbody></table>
        {d.summary.sites + d.summary.layers + d.summary.locations === 0 && <p className="muted" data-testid="gis-empty">{t('gis.emptyText')} <Link to={`/proj/gis-config?projectId=${projectId}`}>{t('gis.configTitle')}</Link></p>}
      </div>
    </section>
  );
}
