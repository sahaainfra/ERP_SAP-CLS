import { useMemo, useRef, useState } from 'react';
import { MAX_RADIUS_M, MIN_RADIUS_M, geofenceProblems, polygonProblems } from '../../../../shared/geo.js';
import { testShape } from '../api/org.js';

// A map-style canvas to draw and test a site geofence (part 02.02): a metric grid around the site on which a circle is placed or a
// polygon is drawn point by point, and a coordinate can be tested against the shape. Everything can also be typed in as numbers,
// so the editor works from the keyboard. There is no base map yet: the grid is in metres around the coordinates (defect D-070).
const W = 640;
const H = 400;
const M_LAT = 111_195;
const rad = (d) => (d * Math.PI) / 180;
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const INDIA = { lat: 20.5937, lng: 78.9629, mpp: 6000 };

const niceStep = (mpp) => {
  const target = mpp * 70;
  const pow = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= target) ?? pow * 10;
};
const fmtM = (m) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

function startView(value) {
  if (value?.type === 'CIRCLE' && value.latitude != null) return { lat: value.latitude, lng: value.longitude, mpp: Math.max(0.2, (value.radiusM * 2.6) / H) };
  if (value?.type === 'POLYGON' && value.polygon?.length > 3) {
    const lats = value.polygon.map((p) => p[0]);
    const lngs = value.polygon.map((p) => p[1]);
    const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const span = Math.max((Math.max(...lats) - Math.min(...lats)) * M_LAT, (Math.max(...lngs) - Math.min(...lngs)) * M_LAT * Math.cos(rad(lat)));
    return { lat, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2, mpp: Math.max(0.2, (span * 1.5) / H) };
  }
  if (value?.latitude != null && value?.longitude != null) return { lat: value.latitude, lng: value.longitude, mpp: 0.5 };
  return INDIA;
}

export default function GeofenceEditor({ value, onChange, readOnly = false }) {
  const [mode, setMode] = useState(readOnly ? 'test' : value?.type === 'POLYGON' ? 'polygon' : 'circle');
  const [view, setView] = useState(() => startView(value));
  const [pts, setPts] = useState(() => (value?.type === 'POLYGON' && value.polygon ? value.polygon.slice(0, -1) : []));
  const [closed, setClosed] = useState(value?.type === 'POLYGON' && Boolean(value.polygon));
  const [test, setTest] = useState({ lat: '', lng: '', tolerance: 10, result: null, error: null });
  const drag = useRef(null);
  const svg = useRef(null);

  const cos = Math.cos(rad(view.lat));
  const toXY = (lat, lng) => ({ x: W / 2 + ((lng - view.lng) * M_LAT * cos) / view.mpp, y: H / 2 - ((lat - view.lat) * M_LAT) / view.mpp });
  const fromXY = (x, y) => ({ lat: round6(view.lat - ((y - H / 2) * view.mpp) / M_LAT), lng: round6(view.lng + ((x - W / 2) * view.mpp) / (M_LAT * cos)) });

  const problems = useMemo(() => {
    if (mode === 'polygon' && !closed) return pts.length >= 3 ? polygonProblems([...pts, pts[0]]).filter((p) => !/not closed/.test(p)) : [];
    return geofenceProblems(value);
  }, [mode, closed, pts, value]);

  const run = async (lat, lng) => {
    setTest((t) => ({ ...t, lat: String(lat), lng: String(lng), result: null, error: null }));
    if (!value || value.type === 'NONE' || geofenceProblems(value).length) return setTest((t) => ({ ...t, error: 'Draw a valid geofence first.' }));
    try {
      const result = await testShape({ geofence: { type: value.type, latitude: value.latitude ?? null, longitude: value.longitude ?? null, radiusM: value.radiusM ?? null, polygon: value.polygon ?? null }, latitude: lat, longitude: lng, toleranceM: Number(test.tolerance) });
      setTest((t) => ({ ...t, lat: String(lat), lng: String(lng), result, error: null }));
    } catch (err) {
      setTest((t) => ({ ...t, error: err.message }));
    }
  };

  const clickAt = (x, y) => {
    const p = fromXY(x, y);
    if (mode === 'test') return run(p.lat, p.lng);
    if (readOnly) return undefined;
    if (mode === 'circle') return onChange({ type: 'CIRCLE', latitude: p.lat, longitude: p.lng, radiusM: value?.type === 'CIRCLE' && value.radiusM ? value.radiusM : 100, polygon: null });
    if (closed) return undefined;
    return setPts((list) => [...list, [p.lat, p.lng]]);
  };

  const toCanvas = (e) => {
    const r = svg.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  };
  const down = (e) => { svg.current.setPointerCapture?.(e.pointerId); drag.current = { start: toCanvas(e), view, moved: false }; };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const now = toCanvas(e);
    if (!d.moved && Math.hypot(now.x - d.start.x, now.y - d.start.y) < 5) return;
    d.moved = true;
    const c = Math.cos(rad(d.view.lat));
    setView({ ...d.view, lat: d.view.lat + ((now.y - d.start.y) * d.view.mpp) / M_LAT, lng: d.view.lng - ((now.x - d.start.x) * d.view.mpp) / (M_LAT * c) });
  };
  const up = (e) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) clickAt(d.start.x, d.start.y);
    svg.current.releasePointerCapture?.(e.pointerId);
  };

  const zoom = (f) => setView((v) => ({ ...v, mpp: Math.min(8000, Math.max(0.1, v.mpp * f)) }));
  const jump = (lat, lng) => setView({ lat, lng, mpp: view.mpp > 100 ? 2 : view.mpp });
  const here = () => navigator.geolocation?.getCurrentPosition((p) => jump(round6(p.coords.latitude), round6(p.coords.longitude)), () => setTest((t) => ({ ...t, error: 'Your location could not be read. Type the coordinates instead.' })));

  const closeShape = () => { if (pts.length >= 3) { setClosed(true); onChange({ type: 'POLYGON', polygon: [...pts, pts[0]], latitude: null, longitude: null, radiusM: null }); } };
  const setPoint = (i, k, v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    const next = pts.map((p, j) => (j === i ? (k === 0 ? [n, p[1]] : [p[0], n]) : p));
    setPts(next);
    if (closed) onChange({ type: 'POLYGON', polygon: [...next, next[0]], latitude: null, longitude: null, radiusM: null });
  };
  const removePoint = (i) => {
    const next = pts.filter((_, j) => j !== i);
    setPts(next);
    if (closed) { if (next.length >= 3) onChange({ type: 'POLYGON', polygon: [...next, next[0]], latitude: null, longitude: null, radiusM: null }); else { setClosed(false); onChange({ type: 'NONE' }); } }
  };
  const clear = () => { setPts([]); setClosed(false); onChange({ type: 'NONE' }); };
  const reopen = () => { setClosed(false); onChange({ type: 'NONE' }); };

  const step = niceStep(view.mpp);
  const lines = [];
  const x0 = ((-W / 2) * view.mpp) / (M_LAT * cos);
  const first = Math.ceil(((view.lng + x0) * M_LAT * cos) / step) * step;
  for (let m = first; toXY(view.lat, m / (M_LAT * cos)).x < W; m += step) lines.push({ v: true, p: toXY(view.lat, m / (M_LAT * cos)).x, m });
  const firstY = Math.ceil((view.lat * M_LAT - (H / 2) * view.mpp) / step) * step;
  for (let m = firstY; toXY(m / M_LAT, view.lng).y > 0; m += step) lines.push({ v: false, p: toXY(m / M_LAT, view.lng).y, m });

  const shape = [];
  if (mode !== 'polygon' && value?.type === 'CIRCLE' && value.latitude != null) {
    const c = toXY(value.latitude, value.longitude);
    shape.push(<circle key="c" cx={c.x} cy={c.y} r={value.radiusM / view.mpp} className="gf-shape" />, <circle key="d" cx={c.x} cy={c.y} r="4" className="gf-dot" />);
  } else if (value?.type === 'CIRCLE' && mode === 'polygon' && pts.length === 0) {
    const c = toXY(value.latitude, value.longitude);
    shape.push(<circle key="c" cx={c.x} cy={c.y} r={value.radiusM / view.mpp} className="gf-shape gf-faint" />);
  }
  if (mode === 'polygon' || value?.type === 'POLYGON') {
    const xy = pts.map((p) => toXY(p[0], p[1]));
    const d = xy.map((p) => `${p.x},${p.y}`).join(' ');
    if (closed) shape.push(<polygon key="g" points={d} className="gf-shape" />);
    else if (xy.length > 1) shape.push(<polyline key="l" points={d} className="gf-line" />);
    xy.forEach((p, i) => shape.push(<circle key={`v${i}`} cx={p.x} cy={p.y} r="5" className="gf-vertex" />, <text key={`t${i}`} x={p.x + 8} y={p.y - 6} className="gf-label">{i + 1}</text>));
  }
  const tp = test.result && test.lat !== '' ? toXY(Number(test.lat), Number(test.lng)) : null;

  return (
    <div className="geofence" data-testid="geofence-editor">
      <div className="toolbar" role="group" aria-label="Geofence tools">
        {!readOnly && <button type="button" className={`btn${mode === 'circle' ? ' btn-primary' : ''}`} aria-pressed={mode === 'circle'} onClick={() => setMode('circle')}>Circle</button>}
        {!readOnly && <button type="button" className={`btn${mode === 'polygon' ? ' btn-primary' : ''}`} aria-pressed={mode === 'polygon'} onClick={() => setMode('polygon')}>Polygon</button>}
        <button type="button" className={`btn${mode === 'test' ? ' btn-primary' : ''}`} aria-pressed={mode === 'test'} onClick={() => setMode('test')}>Test a point</button>
        <button type="button" className="btn" onClick={() => zoom(1 / 1.5)} aria-label="Zoom in">+</button>
        <button type="button" className="btn" onClick={() => zoom(1.5)} aria-label="Zoom out">&minus;</button>
        {!readOnly && <button type="button" className="btn" onClick={clear}>Clear</button>}
      </div>
      <p className="muted small" id="gf-help">
        {mode === 'circle' && 'Click the map to place the centre of the circle, then set its radius. Drag the map to move around.'}
        {mode === 'polygon' && (closed ? 'The polygon is closed. Edit a corner below, or Reopen it to add corners.' : 'Click the map to add each corner in order, then choose Close shape (at least three corners).')}
        {mode === 'test' && 'Click the map, or type a coordinate below, to see whether it is inside the fence.'}
      </p>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="gf-canvas" role="img" aria-label="Geofence canvas: a grid in metres around the site" aria-describedby="gf-help" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <rect width={W} height={H} className="gf-bg" />
        {lines.map((l, i) => (l.v
          ? <g key={`v${i}`}><line x1={l.p} y1="0" x2={l.p} y2={H} className="gf-grid" /><text x={l.p + 3} y={H - 4} className="gf-axis">{fmtM(Math.round(l.m))}</text></g>
          : <line key={`h${i}`} x1="0" y1={l.p} x2={W} y2={l.p} className="gf-grid" />))}
        {shape}
        {tp && <circle cx={tp.x} cy={tp.y} r="7" className={test.result.inside ? 'gf-test-in' : 'gf-test-out'} data-testid="gf-test-marker" />}
        <line x1="16" y1={H - 18} x2={16 + step / view.mpp} y2={H - 18} className="gf-scale" />
        <text x="16" y={H - 24} className="gf-axis">{fmtM(step)}</text>
      </svg>

      <div className="form-grid">
        <label className="field"><span>Go to latitude</span><input type="number" step="any" aria-label="Go to latitude" value={round6(view.lat)} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setView({ ...view, lat: e.target.valueAsNumber, mpp: view.mpp > 100 ? 2 : view.mpp })} /></label>
        <label className="field"><span>Go to longitude</span><input type="number" step="any" aria-label="Go to longitude" value={round6(view.lng)} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setView({ ...view, lng: e.target.valueAsNumber, mpp: view.mpp > 100 ? 2 : view.mpp })} /></label>
        <div className="field"><span>&nbsp;</span><button type="button" className="btn" onClick={here}>Use my location</button></div>
      </div>

      {mode === 'circle' && (
        <div className="form-grid">
          <label className="field"><span>Centre latitude</span><input type="number" step="any" readOnly={readOnly} value={value?.type === 'CIRCLE' ? value.latitude ?? '' : ''} onChange={(e) => onChange({ type: 'CIRCLE', latitude: e.target.valueAsNumber, longitude: value?.longitude ?? view.lng, radiusM: value?.radiusM ?? 100, polygon: null })} /></label>
          <label className="field"><span>Centre longitude</span><input type="number" step="any" readOnly={readOnly} value={value?.type === 'CIRCLE' ? value.longitude ?? '' : ''} onChange={(e) => onChange({ type: 'CIRCLE', longitude: e.target.valueAsNumber, latitude: value?.latitude ?? view.lat, radiusM: value?.radiusM ?? 100, polygon: null })} /></label>
          <label className="field"><span>Radius (metres, {MIN_RADIUS_M} to {MAX_RADIUS_M})</span>
            <input type="number" min={MIN_RADIUS_M} max={MAX_RADIUS_M} readOnly={readOnly} value={value?.type === 'CIRCLE' ? value.radiusM ?? '' : ''} onChange={(e) => value?.type === 'CIRCLE' && onChange({ ...value, radiusM: e.target.valueAsNumber })} />
          </label>
          {!readOnly && <label className="field"><span>Radius slider</span><input type="range" min={MIN_RADIUS_M} max="1000" disabled={value?.type !== 'CIRCLE'} value={Math.min(value?.radiusM ?? 100, 1000)} onChange={(e) => onChange({ ...value, radiusM: Number(e.target.value) })} /></label>}
        </div>
      )}

      {mode === 'polygon' && (
        <>
          {!readOnly && (
            <div className="actions">
              <button type="button" className="btn btn-primary" disabled={closed || pts.length < 3} onClick={closeShape}>Close shape</button>
              <button type="button" className="btn" disabled={closed || pts.length === 0} onClick={() => setPts(pts.slice(0, -1))}>Undo last point</button>
              <button type="button" className="btn" disabled={!closed} onClick={reopen}>Reopen</button>
            </div>
          )}
          {pts.length > 0 && (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Polygon corners</caption>
                <thead><tr><th>#</th><th>Latitude</th><th>Longitude</th><th><span className="sr-only">Remove</span></th></tr></thead>
                <tbody>
                  {pts.map((p, i) => (
                    <tr key={i}>
                      <td data-label="#">{i + 1}</td>
                      <td data-label="Latitude"><input type="number" step="any" aria-label={`Corner ${i + 1} latitude`} readOnly={readOnly} value={p[0]} onChange={(e) => setPoint(i, 0, e.target.value)} /></td>
                      <td data-label="Longitude"><input type="number" step="any" aria-label={`Corner ${i + 1} longitude`} readOnly={readOnly} value={p[1]} onChange={(e) => setPoint(i, 1, e.target.value)} /></td>
                      <td>{!readOnly && <button type="button" className="btn btn-small" onClick={() => removePoint(i)} aria-label={`Remove corner ${i + 1}`}>Remove</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {problems.length > 0 && <ul className="field-error" role="alert" data-testid="gf-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}

      <fieldset className="gf-test">
        <legend>Test a coordinate</legend>
        <div className="form-grid">
          <label className="field"><span>Latitude</span><input type="number" step="any" value={test.lat} onChange={(e) => setTest({ ...test, lat: e.target.value, result: null })} /></label>
          <label className="field"><span>Longitude</span><input type="number" step="any" value={test.lng} onChange={(e) => setTest({ ...test, lng: e.target.value, result: null })} /></label>
          <label className="field"><span>Edge tolerance (m)</span><input type="number" min="0" max="100" value={test.tolerance} onChange={(e) => setTest({ ...test, tolerance: e.target.value, result: null })} /></label>
          <div className="field"><span>&nbsp;</span><button type="button" className="btn" disabled={test.lat === '' || test.lng === ''} onClick={() => run(Number(test.lat), Number(test.lng))}>Test this coordinate</button></div>
        </div>
        <div role="status" data-testid="gf-test-result">
          {test.error && <span className="field-error">{test.error}</span>}
          {test.result && (
            <span className={`chip ${test.result.inside ? 'chip-pass' : 'chip-fail'}`}>
              {test.result.inside ? (test.result.strictlyInside ? 'Inside the fence' : 'Inside, within the edge tolerance') : 'Outside the fence'}
              {test.result.edgeDistanceM != null && ` (${Math.abs(test.result.edgeDistanceM)} m ${test.result.edgeDistanceM <= 0 ? 'inside' : 'outside'} the edge)`}
            </span>
          )}
        </div>
      </fieldset>
    </div>
  );
}
