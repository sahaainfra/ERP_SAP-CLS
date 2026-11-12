import { useEffect, useRef, useState } from 'react';
import { authHeaders } from '../../platform/api/index.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';

// Pieces the gate pages share (part 16.02): the offline notice, the flags of a delivery, photos filed with a record, the camera QR reader.
export function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => { const up = () => setOn(true); const down = () => setOn(false); window.addEventListener('online', up); window.addEventListener('offline', down); return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); }; }, []);
  return on;
}
export function OfflineNotice({ t, on }) { return on ? null : <p className="mdm-banner" role="status" data-testid="g-offline">{t('g.offline')}</p>; }
export function Flags({ t, flags, testId = 'g-flags' }) {
  if (!flags?.length) return null;
  return <div className="mdm-banner" role="alert" data-testid={testId}><strong>{t('g.notExpected')}</strong><ul>{flags.map((f) => <li key={f.code}>{f.message}</li>)}</ul></div>;
}
/** Files a photo to a record through the document service, then tells the record what it shows. */
export async function filePhoto(file, entity, entityId) {
  return uploadFile(file, { transport: browserTransport(authHeaders), entity, entityId, stripExif: false });
}
export function PhotoButton({ label, onPick, testId, done }) {
  return (
    <label className="btn" style={{ minHeight: 48, display: 'inline-flex', alignItems: 'center' }}>{done ? `✓ ${label}` : label}
      <input type="file" accept="image/*" capture="environment" className="sr-only" data-testid={testId} onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
    </label>
  );
}
/** Reads a QR code with the camera where the browser can; otherwise the code is typed. */
export function useQrScan(onCode, onProblem) {
  const video = useRef(null); const [scanning, setScanning] = useState(false);
  const scan = async () => {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) { onProblem?.(); return; }
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); video.current.srcObject = stream; await video.current.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] }); const stop = () => { stream.getTracks().forEach((x) => x.stop()); setScanning(false); };
      const tick = async () => { try { const found = await detector.detect(video.current); if (found[0]) { onCode(found[0].rawValue); stop(); return; } } catch { /* try again */ } if (video.current?.srcObject) requestAnimationFrame(tick); };
      tick();
    } catch { setScanning(false); onProblem?.(); }
  };
  return { video, scanning, scan };
}
