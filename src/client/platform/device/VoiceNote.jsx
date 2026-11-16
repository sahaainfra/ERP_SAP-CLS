import { useEffect, useRef, useState } from 'react';
import Icon from '../design/Icon.jsx';
import { useT } from '../i18n/index.js';

export const VOICE_MAX_SECONDS = 60;

/**
 * A voice note of at most a minute for a field form (part 166.3, FR-03): one press starts, one press stops, and recording stops by itself at 60 s.
 * The note is a WebM audio file handed to `onChange` (null when removed); the form sends it with its record, online or through the offline queue.
 * Nothing is recorded until the person presses the button, and the microphone is released as soon as the note ends.
 */
export default function VoiceNote({ value, onChange, max = VOICE_MAX_SECONDS, testid = 'voice-note' }) {
  const t = useT('field');
  const [rec, setRec] = useState(null);
  const [left, setLeft] = useState(max);
  const [error, setError] = useState(null);
  const [url, setUrl] = useState(null);
  const timer = useRef(null);
  const supported = typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => { if (!value) { setUrl(null); return undefined; } const u = URL.createObjectURL(value); setUrl(u); return () => URL.revokeObjectURL(u); }, [value]);
  useEffect(() => () => { clearInterval(timer.current); rec?.stream?.getTracks().forEach((x) => x.stop()); }, [rec]);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      const started = Date.now();
      recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      recorder.onstop = () => {
        clearInterval(timer.current);
        stream.getTracks().forEach((x) => x.stop());
        setRec(null);
        const seconds = Math.min(max, Math.max(1, Math.round((Date.now() - started) / 1000)));
        const file = new File(chunks, `voice-${started}.webm`, { type: 'audio/webm' });
        Object.defineProperty(file, 'seconds', { value: seconds });
        onChange(file);
      };
      recorder.start(1000);
      setLeft(max);
      timer.current = setInterval(() => setLeft((s) => { if (s <= 1) { if (recorder.state === 'recording') recorder.stop(); return 0; } return s - 1; }), 1000);
      setRec(recorder);
    } catch { setError(t('voice.refused')); }
  };
  const stop = () => { if (rec?.state === 'recording') rec.stop(); };

  if (!supported) return <p className="muted small" data-testid={`${testid}-unsupported`}>{t('voice.unsupported')}</p>;
  return (
    <div className="voice-note" data-testid={testid}>
      {!value && (
        <button type="button" className={`btn btn-large${rec ? ' btn-danger' : ''}`} aria-pressed={Boolean(rec)} onClick={rec ? stop : start} data-testid={`${testid}-button`}>
          <Icon name={rec ? 'erp.action.cancel' : 'erp.group.collab'} size={20} /> {rec ? t('voice.stop') : t('voice.record')}
        </button>
      )}
      {rec && <span role="timer" aria-live="off" className="muted" data-testid={`${testid}-left`}> {t('voice.left', { seconds: left })}</span>}
      {value && (
        <p className="voice-note-done">
          <span>{t('voice.done', { seconds: value.seconds ?? '?' })}</span>
          {url && <audio controls preload="none" src={url} aria-label={t('voice.done', { seconds: value.seconds ?? '?' })} />}
          <button type="button" className="btn" onClick={() => onChange(null)} data-testid={`${testid}-remove`}>{t('voice.remove')}</button>
        </p>
      )}
      {error && <p role="alert" className="field-error">{error}</p>}
    </div>
  );
}
