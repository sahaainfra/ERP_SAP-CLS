import { useEffect, useRef, useState } from 'react';
import Icon from '../design/Icon.jsx';
import { vibrate } from './haptics.js';
import { useT } from '../i18n/index.js';

const FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'data_matrix'];
const supported = () => typeof window !== 'undefined' && 'BarcodeDetector' in window;

/**
 * Reads a QR code or barcode (part 03.06, FR-04) and calls `onCode(text)` once per code. Four ways in, so the page always works: the camera
 * (where the browser can read codes), a photo of the code, typing it, or a scanner gun that types it and presses Enter. A code read by the
 * camera makes the phone vibrate. The same code is not reported twice in a row within `cooldownMs`.
 */
export default function CodeScanner({ onCode, busy = false, cooldownMs = 2500 }) {
  const t = useT('field');
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('');
  const [typed, setTyped] = useState('');
  const video = useRef(null);
  const stream = useRef(null);
  const photo = useRef(null);
  const last = useRef({ code: '', at: 0 });
  const frame = useRef(0);

  const report = (code) => {
    const now = Date.now();
    if (last.current.code === code && now - last.current.at < cooldownMs) return false;
    last.current = { code, at: now };
    onCode(code);
    return true;
  };
  const stop = () => {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setScanning(false);
  };
  useEffect(() => () => { cancelAnimationFrame(frame.current); stream.current?.getTracks().forEach((t) => t.stop()); }, []);

  const start = async () => {
    if (!supported()) { setMessage(t('scanner.noBarcode')); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setMessage(t('scanner.noMedia')); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch {
      setMessage(t('scanner.refused'));
      return;
    }
    setScanning(true);
    setMessage(t('scanner.point'));
    const detector = new window.BarcodeDetector({ formats: FORMATS });
    const loop = async () => {
      if (!stream.current) return;
      const el = video.current;
      if (el && el.srcObject !== stream.current) { el.srcObject = stream.current; await el.play().catch(() => {}); }
      if (el && el.readyState >= 2) {
        const codes = await detector.detect(el).catch(() => []);
        if (codes[0] && report(codes[0].rawValue)) vibrate('success');
      }
      frame.current = requestAnimationFrame(loop);
    };
    frame.current = requestAnimationFrame(loop);
  };

  const fromPhoto = async (file) => {
    if (!file) return;
    if (!supported()) { setMessage(t('scanner.noPhotoRead')); return; }
    const codes = await new window.BarcodeDetector({ formats: FORMATS }).detect(await createImageBitmap(file)).catch(() => []);
    if (codes[0]) { if (report(codes[0].rawValue)) vibrate('success'); } else setMessage(t('scanner.noCode'));
  };

  const submitTyped = (e) => {
    e.preventDefault();
    const code = typed.trim();
    if (!code) { setMessage(t('scanner.typeFirst')); return; }
    report(code);
    setTyped('');
  };

  return (
    <div className="code-scanner" data-testid="code-scanner">
      {scanning && <video ref={video} className="code-video" muted playsInline aria-label={t('scanner.videoAria')} data-testid="scan-video" />}
      <div className="code-actions">
        <button type="button" className="btn btn-primary btn-large" onClick={scanning ? stop : start} disabled={busy} data-testid="scan-camera"><Icon name="erp.action.scan" size={20} /> {scanning ? t('scanner.stop') : t('scanner.start')}</button>
        <button type="button" className="btn btn-large" onClick={() => photo.current?.click()} disabled={busy}><Icon name="erp.action.camera" size={20} /> {t('scanner.photo')}</button>
        <input ref={photo} type="file" accept="image/*" capture="environment" className="visually-hidden" tabIndex={-1} aria-label={t('scanner.photoAria')} onChange={(e) => { fromPhoto(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <form className="code-typed" onSubmit={submitTyped}>
        <label className="field"><span>{t('scanner.typed')}</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('scanner.example')} autoComplete="off" autoCapitalize="characters" inputMode="text" maxLength={200} data-testid="scan-typed" />
        </label>
        <button type="submit" className="btn btn-large" disabled={busy}>{t('scanner.lookup')}</button>
      </form>
      <p className="muted small" role="status" aria-live="polite" data-testid="scan-message">{message}</p>
    </div>
  );
}
