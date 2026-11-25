import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { RFI_PRIORITIES, DISCIPLINES, dayIST, eg, rf, uploadToRfi } from './api.js';
import { ProjectSelect } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';

// Raise RFI with photo markup (part 11.02, FR-01, mobile): big fields, a photo from the camera or the gallery with the problem circled on it with a finger, and the RFI sent to the design coordinator from the same screen.
function Markup({ onChange }) {
  const t = useT('engg');
  const canvas = useRef(null); const drawing = useRef(false); const history = useRef([]); const [has, setHas] = useState(false);
  const load = (file) => {
    if (!file) return;
    const img = new Image();
    img.onload = () => { const c = canvas.current; const scale = Math.min(1, 1280 / img.width); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale); const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height); history.current = [g.getImageData(0, 0, c.width, c.height)]; setHas(true); onChange(c); URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(file);
  };
  const pos = (e) => { const c = canvas.current; const b = c.getBoundingClientRect(); return { x: ((e.clientX - b.left) / b.width) * c.width, y: ((e.clientY - b.top) / b.height) * c.height }; };
  const down = (e) => { if (!has) return; drawing.current = true; const g = canvas.current.getContext('2d'); g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--erp-color-status-error-fg').trim() || 'red'; g.lineWidth = Math.max(4, canvas.current.width / 160); g.lineCap = 'round'; g.lineJoin = 'round'; const p = pos(e); g.beginPath(); g.moveTo(p.x, p.y); canvas.current.setPointerCapture?.(e.pointerId); };
  const move = (e) => { if (!drawing.current) return; const g = canvas.current.getContext('2d'); const p = pos(e); g.lineTo(p.x, p.y); g.stroke(); };
  const up = () => { if (!drawing.current) return; drawing.current = false; const c = canvas.current; history.current.push(c.getContext('2d').getImageData(0, 0, c.width, c.height)); onChange(c); };
  const undo = () => { if (history.current.length < 2) return; history.current.pop(); const c = canvas.current; c.getContext('2d').putImageData(history.current[history.current.length - 1], 0, 0); onChange(c); };
  return (
    <fieldset className="mdm-panel" data-testid="rfi-markup"><legend>{t('raise.photo')}</legend>
      <div className="actions-row">
        <label className="btn">{t('raise.takePhoto')}<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => load(e.target.files?.[0])} data-testid="raise-camera" /></label>
        <label className="btn">{t('raise.choosePhoto')}<input type="file" accept="image/*" className="sr-only" onChange={(e) => load(e.target.files?.[0])} data-testid="raise-photo" /></label>
        {has && <button type="button" className="btn" onClick={undo} data-testid="raise-undo">{t('raise.undo')}</button>}
      </div>
      {has && <p className="muted">{t('raise.markHint')}</p>}
      <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="raise-canvas" aria-label={t('raise.photo')} style={{ width: '100%', maxHeight: '60vh', objectFit: 'contain', touchAction: 'none', display: has ? 'block' : 'none', background: 'var(--erp-color-surface-subtle)' }} />
    </fieldset>
  );
}
export default function RfiRaisePage() {
  const t = useT('engg');
  usePageTitle(t('raise.title'));
  const qc = useQueryClient();
  const [f, setF] = useState({ projectId: '', subject: '', question: '', discipline: 'STRUCTURAL', priority: 'MEDIUM', requiredBy: dayIST(7), locationId: '', drawingId: '', activityRef: '', activityCritical: false, holdActivity: false, specRef: '', proposedSolution: '', costImpactFlag: false, timeImpactFlag: false });
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [online, setOnline] = useState(navigator.onLine); const canvasRef = useRef(null);
  useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const st = useQuery({ queryKey: ['engg', 'structure', f.projectId], queryFn: () => eg.structure(f.projectId), enabled: Boolean(f.projectId), retry: false });
  const dr = useQuery({ queryKey: ['engg', 'pick', f.projectId], queryFn: () => eg.drawings(f.projectId), enabled: Boolean(f.projectId), retry: false });
  const go = async (send) => {
    setError(null); setBusy(true);
    try {
      const r = await rf.create({ projectId: Number(f.projectId), subject: f.subject.trim(), question: f.question.trim(), discipline: f.discipline, priority: f.priority, requiredBy: f.requiredBy, locationId: f.locationId ? Number(f.locationId) : null, drawingId: f.drawingId ? Number(f.drawingId) : null, activityRef: f.activityRef.trim() || null, activityCritical: f.activityCritical, holdActivity: f.holdActivity, specRef: f.specRef.trim() || null, proposedSolution: f.proposedSolution.trim() || null, costImpactFlag: f.costImpactFlag, timeImpactFlag: f.timeImpactFlag });
      if (canvasRef.current) { const blob = await new Promise((res) => canvasRef.current.toBlob(res, 'image/png')); if (blob) await uploadToRfi(r.id, blob, `${r.rfiNo}-markup.png`); }
      if (send) await rf.act(r.id, 'submit');
      qc.invalidateQueries({ queryKey: ['engg'] }); navigateTo(`/engg/rfi?id=${r.id}`);
    } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  const ready = f.projectId && f.subject.trim().length >= 3 && f.question.trim().length >= 10;
  const sel = (k, label, opts, tk) => <Field label={label} name={k} error={error}><select value={f[k]} onChange={(e) => set(k, e.target.value)} data-testid={`raise-${k}`} style={{ minHeight: '2.75rem' }}>{opts.map((o) => <option key={o} value={o}>{t(`${tk}.${o}`)}</option>)}</select></Field>;
  const chk = (k, label) => <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minHeight: '2.75rem' }}><input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} data-testid={`raise-${k}`} style={{ width: '1.4rem', height: '1.4rem' }} /> {label}</label>;
  return (
    <section aria-labelledby="raise-h" data-testid="rfi-raise">
      <PageHeader id="raise-h" title={t('raise.title')} />
      {st.isLoading && <Skeleton label={'Loading the project structure'} rows={2} />}{st.isError && st.error?.status !== 403 && <ErrorState error={st.error} onRetry={st.refetch} />}{dr.isLoading && <Skeleton label={'Loading the drawings'} rows={2} />}{dr.isError && dr.error?.status !== 403 && <ErrorState error={dr.error} onRetry={dr.refetch} />}
      <p className={online ? 'muted' : 'mdm-banner'} role="status" data-testid="raise-online">{online ? t('raise.online') : t('raise.offline')}</p>
      <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); go(true); }} data-testid="raise-form">
        <div className="form-grid">
          <ProjectSelect value={f.projectId} onChange={(v) => set('projectId', v)} required testId="raise-project" error={error} />
          <Field label={t('rfi.subject')} name="subject" error={error}><input value={f.subject} onChange={(e) => set('subject', e.target.value)} required maxLength={200} data-testid="raise-subject" style={{ minHeight: '2.75rem' }} /></Field>
          <Field label={t('rfi.question')} name="question" error={error}><textarea value={f.question} onChange={(e) => set('question', e.target.value)} rows={4} maxLength={4000} required data-testid="raise-question" /></Field>
          {sel('discipline', t('col.discipline'), DISCIPLINES, 'disc')}{sel('priority', t('rfi.priority'), RFI_PRIORITIES, 'prio')}
          <Field label={t('rfi.requiredBy')} name="requiredBy" error={error}><input type="date" value={f.requiredBy} onChange={(e) => set('requiredBy', e.target.value)} data-testid="raise-requiredBy" style={{ minHeight: '2.75rem' }} /></Field>
          <Field label={t('f.location')} name="locationId" error={error}><select value={f.locationId} onChange={(e) => set('locationId', e.target.value)} data-testid="raise-location" style={{ minHeight: '2.75rem' }}><option value="">—</option>{(st.data?.locations ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></Field>
          <Field label={t('rfi.drawing')} name="drawingId" error={error}><select value={f.drawingId} onChange={(e) => set('drawingId', e.target.value)} data-testid="raise-drawing" style={{ minHeight: '2.75rem' }}><option value="">—</option>{(dr.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.drawingNo} · {d.title}</option>)}</select></Field>
          <Field label={t('f.activity')} name="activityRef" error={error}><input value={f.activityRef} onChange={(e) => set('activityRef', e.target.value)} maxLength={120} data-testid="raise-activity" style={{ minHeight: '2.75rem' }} /></Field>
          <Field label={t('rfi.spec')} name="specRef" error={error}><input value={f.specRef} onChange={(e) => set('specRef', e.target.value)} maxLength={200} data-testid="raise-spec" style={{ minHeight: '2.75rem' }} /></Field>
          <Field label={t('rfi.proposed')} name="proposedSolution" error={error}><textarea value={f.proposedSolution} onChange={(e) => set('proposedSolution', e.target.value)} rows={2} maxLength={2000} data-testid="raise-proposed" /></Field>
        </div>
        {chk('activityCritical', t('raise.critical'))}{chk('holdActivity', t('raise.hold'))}{chk('costImpactFlag', t('raise.costFlag'))}{chk('timeImpactFlag', t('raise.timeFlag'))}
        <Markup onChange={(c) => { canvasRef.current = c; }} />
        {error?.form && <p className="field-error" role="alert" data-testid="raise-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
        <div className="actions">
          <button type="button" className="btn" disabled={!ready || busy || !online} onClick={() => go(false)} data-testid="raise-draft" style={{ minHeight: '2.75rem' }}>{t('raise.saveDraft')}</button>
          <button type="submit" className="btn btn-primary" disabled={!ready || busy || !online} data-testid="raise-send" style={{ minHeight: '2.75rem' }}>{t('raise.send')}</button>
        </div>
      </form>
    </section>
  );
}
