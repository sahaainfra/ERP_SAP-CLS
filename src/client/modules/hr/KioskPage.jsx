import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { formatDateTime } from '../../platform/format.js';
import { Field, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { attp, smallPhoto } from './api.js';

// Kiosk Mode (HR, part 07.05, FR-04): a tablet at the site gate. The worker holds the ID card to the camera (the QR holds the employee code) or the code is typed, and a photo is taken; the punch is made against the
// site chosen for the tablet and the screen answers in large type for five seconds, then clears for the next person. The site stays chosen on the tablet. The QR is read with the browser's own detector where it has one.
const RESET_MS = 5000;
export default function KioskPage() {
  usePageTitle('Kiosk Mode');
  const qc = useQueryClient();
  const [siteId, setSiteId] = useState(() => { try { return localStorage.getItem('erp.att.kiosk.site') ?? ''; } catch { return ''; } });
  const [type, setType] = useState('IN');
  const [badge, setBadge] = useState('');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [scanning, setScanning] = useState(false);
  const video = useRef(null);
  const timer = useRef(null);
  const today = useQuery({ queryKey: ['att', 'today', siteId], queryFn: () => attp.today({ siteId }), enabled: Boolean(siteId), retry: false });
  useEffect(() => () => clearTimeout(timer.current), []);
  const choose = (x) => { setSiteId(x); try { localStorage.setItem('erp.att.kiosk.site', x); } catch { /* the choice is only a convenience */ } };
  const reset = () => { setBadge(''); setPhoto(null); setAnswer(null); setError(null); };
  const take = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setPhoto(await smallPhoto(f)); } catch (x) { setError(errorInfo(x)); } };
  const scan = async () => {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) { setError({ form: 'This tablet cannot read QR codes: type the code on the card.' }); return; }
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.current.srcObject = stream; await video.current.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const stop = () => { stream.getTracks().forEach((t) => t.stop()); setScanning(false); };
      const tick = async () => { try { const found = await detector.detect(video.current); if (found[0]) { setBadge(found[0].rawValue); stop(); return; } } catch { /* try again */ } if (video.current?.srcObject) requestAnimationFrame(tick); };
      tick();
    } catch { setScanning(false); setError({ form: 'The camera could not be opened: type the code on the card.' }); }
  };
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const out = await attp.kiosk({ siteId: Number(siteId), badge: badge.trim(), punchType: type, deviceTime: new Date().toISOString(), selfie: photo }, globalThis.crypto.randomUUID());
      setAnswer(out); qc.invalidateQueries({ queryKey: ['att', 'today'] });
      timer.current = setTimeout(reset, RESET_MS);
    } catch (x) { setError(errorInfo(x)); timer.current = setTimeout(reset, RESET_MS); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="ki-title" data-testid="kiosk" className="att-punch att-kiosk">
      <h1 id="ki-title">Kiosk Mode</h1>
      {answer ? (
        <div className={`att-answer ${answer.result === 'REJECTED' ? 'is-bad' : 'is-good'}`} role="status" aria-live="assertive" data-testid="ki-answer"><p className="att-answer-big">{answer.result === 'REJECTED' ? 'Not accepted' : answer.type === 'IN' ? 'Welcome' : 'Goodbye'}</p><p>{answer.person ?? ''} {answer.result === 'REJECTED' ? answer.reasonText : `${answer.type === 'IN' ? 'In' : 'Out'} at ${formatDateTime(answer.effectiveTime)}`}</p><button type="button" className="btn" onClick={reset} data-testid="ki-next">Next person</button></div>
      ) : (
        <form className="mdm-fields" onSubmit={go} aria-label="Punch with a badge">
          <LookupField id="ki-site" label="Site of this tablet" lookup="iam/sites" value={siteId} onChange={choose} required />
          <div role="group" aria-label="In or out" className="att-toggle"><button type="button" className={`btn${type === 'IN' ? ' btn-primary' : ''}`} aria-pressed={type === 'IN'} onClick={() => setType('IN')} data-testid="ki-in">IN</button><button type="button" className={`btn${type === 'OUT' ? ' btn-primary' : ''}`} aria-pressed={type === 'OUT'} onClick={() => setType('OUT')} data-testid="ki-out">OUT</button></div>
          <Field label="Code on the card" name="badge" error={error}><input value={badge} onChange={(e) => setBadge(e.target.value)} autoComplete="off" autoFocus data-testid="ki-badge" /></Field>
          <div className="actions-row"><button type="button" className="btn" onClick={scan} data-testid="ki-scan">Scan the QR</button><label className="btn">{photo ? 'Retake photo' : 'Take a photo'}<input type="file" accept="image/*" capture="user" onChange={take} className="sr-only" data-testid="ki-photo" /></label></div>
          {scanning && <video ref={video} className="att-video" playsInline muted aria-label="Camera for the QR code" />}
          {photo && <img src={photo} alt="Photo of the worker" className="att-thumb" data-testid="ki-thumb" />}
          {error?.form && <p className="field-error" role="alert" data-testid="ki-error">{error.form}</p>}
          <button type="submit" className="btn btn-primary att-big" disabled={busy || !siteId || !badge.trim()} data-testid="ki-go">{busy ? 'Punching...' : `Punch ${type}`}</button>
        </form>
      )}
      {siteId && today.data?.length > 0 && <><h2>Just now at this site</h2><ul className="mdm-list" data-testid="ki-recent">{today.data.slice(0, 8).map((p) => <li key={p.id}>{p.person} · {p.type === 'IN' ? 'In' : 'Out'} · {formatDateTime(p.effectiveTime)} · {p.result === 'REJECTED' ? 'rejected' : 'ok'}</li>)}</ul></>}
    </section>
  );
}
