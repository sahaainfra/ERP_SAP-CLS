import { useEffect, useRef, useState } from 'react';
import { FileUploader, AttachmentList } from '../../modules/core/components/Attachments.jsx';
import Icon from '../design/Icon.jsx';
import { FieldShell } from './fields.jsx';
import { positionProblem, readPosition } from '../device/location.js';
import LocationNotice from '../device/LocationNotice.jsx';
import { compressImage, describePhoto, limitsFor } from '../device/camera.js';
import { useDeviceSettings } from '../device/api.js';
import { useLowBandwidth } from '../device/lowBandwidth.js';

// Capture fields of the data-entry framework (part 03.02, FR-01): signature, GPS position, photo, QR or barcode, and files through the
// file service (01.05). They use the device's own capabilities and say plainly when the device or the browser cannot do something.

/** A signature drawn with a finger, a stylus or the mouse. The value is a PNG data URL (empty when cleared). */
export function SignaturePad({ id, label, value, onChange, error, hint, required, disabled, readOnly }) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(!value);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = getComputedStyle(c).color;
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = value;
    }
  }, [readOnly]); // the saved value is drawn once; later strokes are the person's
  const point = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.current.width / r.width), (e.clientY - r.top) * (canvas.current.height / r.height)];
  };
  const down = (e) => {
    if (disabled) return;
    drawing.current = true;
    canvas.current.setPointerCapture?.(e.pointerId);
    const ctx = canvas.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(...point(e));
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvas.current.getContext('2d');
    ctx.lineTo(...point(e));
    ctx.stroke();
    setEmpty(false);
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvas.current.toDataURL('image/png'));
  };
  const clear = () => {
    canvas.current.getContext('2d').clearRect(0, 0, canvas.current.width, canvas.current.height);
    setEmpty(true);
    onChange('');
  };
  if (readOnly) return <FieldShell id={id} label={label} readOnly text={value ? <img className="ff-signature-img" src={value} alt={`Signature for ${label}`} /> : ''} />;
  return (
    <FieldShell id={id} label={label} required={required} hint={hint ?? 'Sign inside the box with a finger, a stylus or the mouse.'} error={error} group>
      {(aria) => (
        <div className="ff-signature">
          <canvas id={id} ref={canvas} width={480} height={160} className={`ff-signature-pad${disabled ? ' is-disabled' : ''}`} role="img" aria-label={empty ? `${label}: not signed yet` : `${label}: signed`} {...aria}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
          <div className="ff-multi-actions">
            <button type="button" className="btn btn-small" onClick={clear} disabled={disabled || empty}>Clear</button>
            <span className="muted small">{empty ? 'Not signed' : 'Signed'}</span>
          </div>
        </div>
      )}
    </FieldShell>
  );
}

/** The device's position. The value is { lat, lng, accuracy } (strings with 6 decimals), or null. Can be typed when there is no GPS. */
export function GpsField({ id, label, value, onChange, error, hint, required, disabled, readOnly }) {
  const [state, setState] = useState({ busy: false, message: '', hints: [] });
  const v = value ?? null;
  const text = v?.lat ? `${v.lat}, ${v.lng}${v.accuracy ? ` (within ${v.accuracy} m)` : ''}` : '';
  // read once, on this button (part 03.06, BR-01): never followed in the background
  const capture = async () => {
    setState({ busy: true, message: 'Finding your position...', hints: [] });
    try {
      const p = await readPosition();
      onChange({ lat: p.lat.toFixed(6), lng: p.lng.toFixed(6), accuracy: String(Math.round(p.accuracy ?? 0)), capturedAt: p.capturedAt, hints: p.hints.map((h) => h.code) });
      setState({ busy: false, message: `Position captured. ${p.rating.text}`, hints: p.hints });
    } catch (err) {
      setState({ busy: false, message: positionProblem(err.reason), hints: [] });
    }
  };
  if (readOnly) return <FieldShell id={id} label={label} readOnly text={text} />;
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} error={error} group>
      {(aria) => (
        <div className="ff-gps" id={id} {...aria}>
          <div className="ff-gps-row">
            <label className="ff-mini">Latitude<input className="ff-input" inputMode="decimal" value={v?.lat ?? ''} disabled={disabled} onChange={(e) => onChange({ ...(v ?? {}), lat: e.target.value, accuracy: '' })} /></label>
            <label className="ff-mini">Longitude<input className="ff-input" inputMode="decimal" value={v?.lng ?? ''} disabled={disabled} onChange={(e) => onChange({ ...(v ?? {}), lng: e.target.value, accuracy: '' })} /></label>
          </div>
          <div className="ff-multi-actions">
            <button type="button" className="btn btn-small" onClick={capture} disabled={disabled || state.busy}><Icon name="erp.action.location" size={16} />{state.busy ? 'Locating...' : 'Use my position'}</button>
            {v?.lat && <button type="button" className="btn btn-small" onClick={() => onChange(null)} disabled={disabled}>Clear</button>}
            <span className="muted small" aria-live="polite">{state.message || (v?.accuracy ? `Within ${v.accuracy} m` : '')}</span>
          </div>
          {state.hints.length > 0 && <ul className="loc-hints small" role="status" data-testid="gps-hints">{state.hints.map((h) => <li key={h.code}>{h.message}</li>)}</ul>}
          <LocationNotice purpose="this record" />
        </div>
      )}
    </FieldShell>
  );
}

/**
 * A photo from the camera (on a phone the camera opens directly) or from the gallery. Before the record exists the photo is held and
 * previewed (value: { name, size, type, preview }); once saved it is uploaded to the record through the file service.
 */
export function PhotoField({ id, label, value, onChange, error, hint, required, disabled, readOnly, entity, entityId }) {
  const input = useRef(null);
  const settings = useDeviceSettings();
  const low = useLowBandwidth();
  if (entity && entityId) {
    return (
      <FieldShell id={id} label={label} hint={hint} error={error} group>
        {() => (<div id={id}><FileUploader entity={entity} entityId={entityId} disabled={disabled || readOnly} stripExif={false} /><AttachmentList entity={entity} entityId={entityId} canEdit={!readOnly} /></div>)}
      </FieldShell>
    );
  }
  // made smaller before it goes anywhere, with the time and position the camera wrote into it kept as evidence (part 03.06, BR-02)
  const pickFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { onChange({ error: 'Choose a photo (JPEG, PNG or WebP).' }); return; }
    try {
      const p = await compressImage(file, limitsFor(settings.data, low.low));
      const reader = new FileReader();
      reader.onload = () => onChange({ name: p.name, size: p.bytes, originalSize: p.originalBytes, type: 'image/jpeg', preview: reader.result, width: p.width, height: p.height, takenAt: p.takenAt, gps: p.gps, summary: describePhoto(p) });
      reader.readAsDataURL(p.blob);
    } catch (err) {
      onChange({ error: err.message || 'The photo could not be prepared. Try again.' });
    }
  };
  const shown = value?.preview ? <img className="ff-photo-img" src={value.preview} alt={`Photo for ${label}: ${value.name}`} /> : '';
  if (readOnly) return <FieldShell id={id} label={label} readOnly text={shown} />;
  return (
    <FieldShell id={id} label={label} required={required} hint={hint ?? 'Taken with the camera or chosen from the gallery. It is uploaded when the record is saved.'} error={error ?? value?.error} group>
      {(aria) => (
        <div className="ff-photo" {...aria}>
          <input ref={input} id={id} type="file" accept="image/*" capture="environment" className="visually-hidden" disabled={disabled} onChange={(e) => pickFile(e.target.files?.[0])} />
          {shown}
          <div className="ff-multi-actions">
            <button type="button" className="btn btn-small" onClick={() => input.current?.click()} disabled={disabled}><Icon name="erp.action.camera" size={16} />{value?.preview ? 'Retake' : 'Take or choose a photo'}</button>
            {value?.preview && <button type="button" className="btn btn-small" onClick={() => onChange(null)} disabled={disabled}>Remove</button>}
            {value?.size ? <span className="muted small" data-testid="photo-summary">{value.name}: {value.summary ?? `${Math.ceil(value.size / 1024)} KB`}</span> : null}
          </div>
        </div>
      )}
    </FieldShell>
  );
}

/**
 * A QR code or barcode: scanned with the camera where the browser can read codes (BarcodeDetector, on Android and ChromeOS), read
 * from a photo of the code, or typed (always possible, so a scanner gun that types works too).
 */
export function QrScanField({ id, label, value, onChange, onBlur, error, hint, required, disabled, readOnly }) {
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('');
  const video = useRef(null);
  const stream = useRef(null);
  const photo = useRef(null);
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setScanning(false); };
  useEffect(() => () => stop(), []);
  const detector = () => new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'data_matrix'] });
  const scan = async () => {
    if (!supported) { setMessage('This browser cannot read codes from the camera. Type the code, use a scanner, or read it from a photo on a phone.'); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setScanning(true);
      setMessage('Point the camera at the code.');
      requestAnimationFrame(async function loop() {
        if (!stream.current || !video.current) return;
        if (video.current.srcObject !== stream.current) { video.current.srcObject = stream.current; await video.current.play().catch(() => {}); }
        const codes = await detector().detect(video.current).catch(() => []);
        if (codes[0]) { onChange(codes[0].rawValue); setMessage(`Read a ${codes[0].format.replace('_', ' ')}.`); stop(); return; }
        requestAnimationFrame(loop);
      });
    } catch {
      setMessage('The camera could not be opened (permission refused or no camera). Type the code instead.');
      stop();
    }
  };
  const fromPhoto = async (file) => {
    if (!file) return;
    if (!supported) { setMessage('This browser cannot read codes from a photo. Type the code instead.'); return; }
    const codes = await detector().detect(await createImageBitmap(file)).catch(() => []);
    if (codes[0]) { onChange(codes[0].rawValue); setMessage(`Read a ${codes[0].format.replace('_', ' ')} from the photo.`); } else setMessage('No code was found in that photo.');
  };
  return (
    <FieldShell id={id} label={label} required={required} hint={hint ?? 'Scan with the camera, read from a photo, or type it.'} error={error} readOnly={readOnly} text={value}>
      {(aria) => (
        <div className="ff-scan">
          <input id={id} name={id} className="ff-input ff-mono" value={value ?? ''} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} disabled={disabled} required={required} autoComplete="off" {...aria} />
          {scanning && <video ref={video} className="ff-scan-video" muted playsInline aria-label="Camera view for scanning" />}
          <div className="ff-multi-actions">
            <button type="button" className="btn btn-small" onClick={scanning ? stop : scan} disabled={disabled}><Icon name="erp.action.scan" size={16} />{scanning ? 'Stop' : 'Scan with camera'}</button>
            <button type="button" className="btn btn-small" onClick={() => photo.current?.click()} disabled={disabled}>Read from a photo</button>
            <input ref={photo} type="file" accept="image/*" className="visually-hidden" tabIndex={-1} onChange={(e) => fromPhoto(e.target.files?.[0])} />
            <span className="muted small" aria-live="polite">{message}</span>
          </div>
        </div>
      )}
    </FieldShell>
  );
}

/** Files on a record through the file service (type allow-list, size limit, virus scan, signed links). Needs a saved record. */
export function FileField({ id, label, entity, entityId, error, hint, disabled, readOnly }) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} group>
      {() => (entity && entityId
        ? <div id={id}><FileUploader entity={entity} entityId={entityId} disabled={disabled || readOnly} /><AttachmentList entity={entity} entityId={entityId} canEdit={!readOnly && !disabled} /></div>
        : <p className="muted small" id={id}>Files are attached to a saved record. Save the draft first, then attach drawings, photos or documents here.</p>)}
    </FieldShell>
  );
}
