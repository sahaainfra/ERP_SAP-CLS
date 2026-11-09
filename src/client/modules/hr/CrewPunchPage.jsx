import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { attp, deploy, deviceId, readPosition, smallPhoto } from './api.js';

// Crew Punch (HR, part 07.05, FR-03): the supervisor marks the crew members who are on site (tick all, then untick), takes one group photo and sends. The supervisor's own position is read at that moment; every member's punch
// names the supervisor as the recorder. The same group sent twice is the same punches. Only the supervisor of the crew punches for it.
export default function CrewPunchPage() {
  usePageTitle('Crew Punch');
  const qc = useQueryClient();
  const [crewId, setCrewId] = useState('');
  const [type, setType] = useState('IN');
  const [ticked, setTicked] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [out, setOut] = useState(null);
  const group = useRef(null);
  const crew = useQuery({ queryKey: ['att', 'crew', crewId], queryFn: () => deploy.crews.get(crewId), enabled: Boolean(crewId), retry: false });
  const members = (crew.data?.members ?? []).filter((m) => m.current && m.personType === 'EMPLOYEE');
  const all = members.length > 0 && ticked.length === members.length;
  const toggle = (id) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const take = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setPhoto(await smallPhoto(f)); } catch (x) { setError(errorInfo(x)); } };
  const send = async () => {
    setBusy(true); setError(null); setOut(null);
    try {
      let pos = null; try { pos = await readPosition(); } catch { pos = null; }
      group.current = group.current ?? globalThis.crypto.randomUUID();
      const r = await attp.crew({ crewId: Number(crewId), punchType: type, deviceTime: new Date().toISOString(), personIds: ticked, photo, groupUuid: group.current, lat: pos?.lat ?? null, lng: pos?.lng ?? null, accuracyM: pos?.accuracyM ?? null, deviceId: deviceId() });
      group.current = null; setOut(r); setTicked([]); setPhoto(null); qc.invalidateQueries({ queryKey: ['att'] });
    } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="cp-title" data-testid="crew-punch" className="att-punch">
      <h1 id="cp-title">Crew Punch</h1>
      <div className="mdm-fields">
        <LookupField id="cp-crew" label="Crew" lookup="hr/crews" value={crewId} onChange={(x) => { setCrewId(x); setTicked([]); }} required />
        <Field label="In or out" name="punchType" error={error}><select value={type} onChange={(e) => setType(e.target.value)} data-testid="cp-type"><option value="IN">In</option><option value="OUT">Out</option></select></Field>
      </div>
      {!crewId ? <p className="muted">Choose your crew to see its members.</p> : crew.isPending ? <Skeleton label="Loading the crew" rows={3} /> : crew.isError ? <ErrorState error={crew.error} onRetry={crew.refetch} /> : members.length === 0 ? <p className="muted">This crew has no member today.</p> : (
        <>
          <label className="check att-all"><input type="checkbox" checked={all} onChange={(e) => setTicked(e.target.checked ? members.map((m) => m.personId) : [])} data-testid="cp-all" /> Tick all ({members.length})</label>
          <ul className="att-members" data-testid="cp-members">{members.map((m) => <li key={m.id}><label className="check att-member"><input type="checkbox" checked={ticked.includes(m.personId)} onChange={() => toggle(m.personId)} data-testid="cp-member" /> {m.name} <span className="muted small">{m.code ?? ''}</span></label></li>)}</ul>
          <div className="actions-row"><label className="btn">{photo ? 'Retake group photo' : 'Take the group photo (required)'}<input type="file" accept="image/*" capture="environment" onChange={take} className="sr-only" data-testid="cp-photo" /></label></div>
          {photo && <img src={photo} alt="Group photo of the crew" className="att-thumb" data-testid="cp-thumb" />}
          {error?.form && <p className="field-error" role="alert" data-testid="cp-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
          <button type="button" className="btn btn-primary att-big" disabled={busy || !ticked.length || !photo} onClick={send} data-testid="cp-send">{busy ? 'Sending...' : `Punch ${type} for ${ticked.length}`}</button>
        </>
      )}
      {out && <p className="mdm-banner" role="status" data-testid="cp-result">{out.accepted} of {out.count} recorded{out.rejected ? `, ${out.rejected} rejected` : ''}{out.replayed ? ` (${out.replayed} were already recorded)` : ''}. Each punch names you as the recorder.</p>}
      <p className="small"><Link to="/hr/crews">Crews &amp; Gangs</Link> · <Link to="/att/today">Today's attendance</Link></p>
    </section>
  );
}
