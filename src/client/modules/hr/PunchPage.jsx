import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { testPoint } from '../../../shared/geo.js';
import { useOffline, enqueue } from '../../platform/offline/engine.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { formatDateTime } from '../../platform/format.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { RESULT, attp, deviceId, readPosition, smallPhoto } from './api.js';

// Punch In/Out (HR, part 07.05, FR-01): the phone screen of a person's own attendance. It shows the sites the person is deployed at, reads the location only when asked (a visible notice says so; nothing is tracked in the
// background), tells whether the position is inside the fence of the site (an advisory: the server decides, BR-01), draws a small map of the fence and the position, takes a selfie where the site asks for one, and punches with one
// big button. Without a connection the punch is kept on the phone with its time and position and sent when the connection returns (the offline engine, 04.15); the same punch is never made twice. A punch at a site where the
// person is not deployed asks for the reason and becomes a visit waiting for the manager and the site project manager.
const R = 6_371_000;
/** The fence and the position in metres around the centre of the fence, for a small SVG map. */
function mapOf(fence, pos) {
  const lat0 = fence?.latitude ?? pos?.lat ?? 0; const lng0 = fence?.longitude ?? pos?.lng ?? 0;
  const xy = (lat, lng) => [((lng - lng0) * Math.PI / 180) * R * Math.cos(lat0 * Math.PI / 180), -((lat - lat0) * Math.PI / 180) * R];
  const shapes = []; let extent = 150;
  if (fence?.type === 'CIRCLE') { shapes.push({ kind: 'circle', r: fence.radiusM }); extent = Math.max(extent, fence.radiusM * 1.4); }
  if (fence?.type === 'POLYGON') { const pts = fence.polygon.map((p) => xy(p.lat ?? p[0], p.lng ?? p[1])); shapes.push({ kind: 'polygon', pts }); extent = Math.max(extent, ...pts.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))) .map((v) => v * 1.3)); }
  let dot = null;
  if (pos) { const [x, y] = xy(pos.lat, pos.lng); dot = { x, y, r: pos.accuracyM }; extent = Math.max(extent, Math.min(Math.hypot(x, y) * 1.3, 4000)); }
  return { shapes, dot, extent };
}
function MiniMap({ fence, pos, inside }) {
  const m = mapOf(fence, pos); const s = m.extent; const sc = (v) => (v / s) * 100;
  return (
    <svg viewBox="-110 -110 220 220" role="img" aria-label={pos ? (inside ? 'Your position is inside the fence' : 'Your position is outside the fence') : 'The fence of the site'} className="att-map" data-testid="pu-map">
      <rect x="-110" y="-110" width="220" height="220" className="att-map-bg" />
      {m.shapes.map((sh, i) => (sh.kind === 'circle' ? <circle key={i} cx="0" cy="0" r={sc(sh.r)} className="att-map-fence" /> : <polygon key={i} points={sh.pts.map(([x, y]) => `${sc(x)},${sc(y)}`).join(' ')} className="att-map-fence" />))}
      {m.dot && <><circle cx={sc(m.dot.x)} cy={sc(m.dot.y)} r={Math.max(2, sc(m.dot.r))} className="att-map-acc" /><circle cx={sc(m.dot.x)} cy={sc(m.dot.y)} r="3" className={inside ? 'att-map-in' : 'att-map-out'} /></>}
    </svg>
  );
}

export default function PunchPage() {
  usePageTitle('Punch In/Out');
  const qc = useQueryClient();
  const offline = useOffline();
  const ctx = useQuery({ queryKey: ['att', 'context'], queryFn: attp.context, retry: false });
  const [siteId, setSiteId] = useState('');
  const [visitSite, setVisitSite] = useState('');
  const [visit, setVisit] = useState(false);
  const [reason, setReason] = useState('');
  const [pos, setPos] = useState(null);
  const [posError, setPosError] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const attempt = useRef(null);
  useEffect(() => { if (ctx.data && !siteId && ctx.data.sites[0]) setSiteId(String(ctx.data.sites[0].id)); }, [ctx.data, siteId]);
  if (ctx.error?.status === 403) return <NoPermission what="attendance" permission="att.punch.own" />;
  if (ctx.isError) return <ErrorState error={ctx.error} onRetry={ctx.refetch} />;
  if (ctx.isPending) return <Skeleton label="Loading your attendance" rows={5} />;
  const c = ctx.data;
  const site = c.sites.find((s) => String(s.id) === String(siteId));
  const target = visit ? visitSite : siteId;
  const inside = pos && site?.geofence?.type && site.geofence.type !== 'NONE' ? testPoint(site.geofence, { lat: pos.lat, lng: pos.lng }, site.tolerance).inside : null;
  const needsSelfie = site?.selfieMode === 'REQUIRED';
  const read = async () => { setPosError(null); try { setPos(await readPosition()); } catch (e) { setPosError(e.message); } };
  const take = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setSelfie(await smallPhoto(f)); } catch (x) { setError(errorInfo(x)); } };
  const punch = async () => {
    setBusy(true); setError(null); setNote(null);
    let here = pos;
    try { here = await readPosition(); setPos(here); } catch (e) { setPosError(e.message); }
    // the same attempt keeps its key until it is answered, so a dropped connection never makes two punches
    attempt.current = attempt.current ?? globalThis.crypto.randomUUID();
    const deviceTime = new Date().toISOString();
    const body = { siteId: Number(target), punchType: c.nextType, deviceTime, lat: here?.lat ?? null, lng: here?.lng ?? null, accuracyM: here?.accuracyM ?? null, deviceId: deviceId(), selfie, reason: visit ? reason.trim() : null };
    try {
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { offline: true });
      const out = await attp.punch(body, attempt.current);
      attempt.current = null; setSelfie(null);
      setNote({ result: out.result, text: out.result === 'REJECTED' ? `Not accepted: ${out.reasonText}.` : out.result === 'PENDING' ? 'Sent for approval as a visit: your manager and the site project manager decide.' : out.result === 'FLAGGED' ? `${c.nextType === 'IN' ? 'In' : 'Out'} punch recorded with a flag for review.` : `${c.nextType === 'IN' ? 'In' : 'Out'} punch recorded.` });
      qc.invalidateQueries({ queryKey: ['att'] });
    } catch (e) {
      if (e.offline || e.status === undefined || e.message === 'Failed to fetch') {
        try { await enqueue({ type: 'attendance_punch', values: { siteId: Number(target), punchType: c.nextType, deviceTime, lat: here?.lat, lng: here?.lng, accuracyM: here?.accuracyM, deviceId: deviceId(), reason: visit ? reason.trim() : undefined, hasPhoto: false }, label: `${c.nextType === 'IN' ? 'In' : 'Out'} punch` }); attempt.current = null; setNote({ result: 'QUEUED', text: 'No connection: the punch is kept on this phone with its time and place, and is sent when you are connected again.' }); }
        catch (q) { setError({ form: q.message }); }
      } else setError(errorInfo(e));
    } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="pu-title" data-testid="punch-page" className="att-punch">
      <h1 id="pu-title">Punch In/Out</h1>
      <p className="mdm-banner" role="note" data-testid="pu-notice">{c.notice}</p>
      <p className={`att-net${offline.online === false || !navigator.onLine ? ' is-off' : ''}`} role="status" data-testid="pu-net">{navigator.onLine ? 'Online' : 'Offline'}{offline.queue?.length ? ` · ${offline.queue.length} waiting to be sent` : ''}</p>
      {c.sites.length === 0 && !visit && <p className="mdm-banner is-warning" data-testid="pu-nosite">You are not deployed at a site today. Ask your manager, or punch at another site as a visit.</p>}
      <div className="mdm-fields">
        {c.sites.length > 0 && !visit && <Field label="Site" name="siteId" error={error}><select value={siteId} onChange={(e) => { setSiteId(e.target.value); setPos(null); }} data-testid="pu-site">{c.sites.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>}
        <label className="check"><input type="checkbox" checked={visit} onChange={(e) => { setVisit(e.target.checked); setPos(null); }} data-testid="pu-visit" /> I am at a site where I am not deployed (a visit)</label>
        {visit && <LookupField id="pu-visit-site" label="Site of the visit" lookup="iam/sites" value={visitSite} onChange={setVisitSite} required />}
        {visit && <Field label="Why are you here? (required)" name="reason" error={error}><input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="pu-reason" /></Field>}
      </div>
      {!visit && site && <MiniMap fence={site.geofence} pos={pos} inside={inside} />}
      <p className="att-fence" role="status" data-testid="pu-fence">
        {pos ? <>Accuracy {pos.accuracyM} m · {inside === null ? 'this site has no fence set' : inside ? <strong className="att-in">Inside the fence</strong> : <strong className="att-out">Outside the fence</strong>}</> : 'Your location has not been read yet.'}
      </p>
      {posError && <p className="field-error" role="alert" data-testid="pu-pos-error">{posError}</p>}
      <div className="actions-row">
        <button type="button" className="btn" onClick={read} data-testid="pu-locate">Check my location</button>
        <label className="btn">{selfie ? 'Retake selfie' : needsSelfie ? 'Take a selfie (required)' : 'Take a selfie'}<input type="file" accept="image/*" capture="user" onChange={take} className="sr-only" data-testid="pu-selfie" /></label>
      </div>
      {selfie && <img src={selfie} alt="Your selfie for this punch" className="att-thumb" data-testid="pu-thumb" />}
      {error?.form && <p className="field-error" role="alert" data-testid="pu-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className={`mdm-banner${note.result === 'REJECTED' ? ' is-warning' : ''}`} role="status" data-testid="pu-note" data-result={note.result}>{note.text}</p>}
      <button type="button" className="btn btn-primary att-big" disabled={busy || !target || (visit && reason.trim().length < 5)} onClick={punch} data-testid="pu-punch">{busy ? 'Punching...' : `Punch ${c.nextType === 'IN' ? 'IN' : 'OUT'}`}</button>
      <h2>Your last punches</h2>
      {c.last.length === 0 ? <p className="muted">No punch yet.</p> : (
        <ul className="mdm-list" data-testid="pu-last">{c.last.map((p) => <li key={p.id}>{formatDateTime(p.effectiveTime)} · {p.type === 'IN' ? 'In' : 'Out'} · {RESULT[p.result] ? <StatusBadge status={RESULT[p.result][0]} label={RESULT[p.result][1]} /> : p.result}{p.reasonText ? ` · ${p.reasonText}` : ''}{p.offline ? ' · offline' : ''}</li>)}</ul>
      )}
      <p className="small"><Link to="/att/today">Today's attendance</Link></p>
    </section>
  );
}
