import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { authHeaders } from '../../platform/api/index.js';
import { enqueue, useOffline } from '../../platform/offline/engine.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { qa } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Perform Inspection (part 18.01, FR-04, on a phone): choose the checklist in force, answer large controls, take the photographs, sign, and send. Numbers show their tolerance but only the server judges the result.
// With the offline engine (04.15) the whole inspection is one command and its photographs, named by question, follow it; without a signal it waits on the phone.
const transport = browserTransport(authHeaders); const big = { minHeight: 48, fontSize: '1rem' };
const inTol = (q, v) => { if (v === '' || v == null) return null; const n = Number(v); const lo = q.min != null ? q.min : q.target != null ? q.target - (q.tolMinus ?? 0) : null; const hi = q.max != null ? q.max : q.target != null ? q.target + (q.tolPlus ?? 0) : null; return (lo == null || n >= lo) && (hi == null || n <= hi); };
export default function PerformPage() {
  const t = useT('qa'); usePageTitle(t('perf.title')); const offline = useOffline(); const online = offline.online !== false && navigator.onLine;
  const oq = useQuery({ queryKey: ['qa', 'options'], queryFn: () => qa.options({}), retry: false, enabled: online });
  const templates = oq.data?.templates ?? offline.masters?.qa_templates ?? []; const projects = oq.data?.projects ?? []; const sites = oq.data?.sites ?? [];
  const [tid, setTid] = useState(''); const [projectId, setProjectId] = useState(''); const [siteId, setSiteId] = useState(''); const [subject, setSubject] = useState(''); const [ans, setAns] = useState({}); const [photos, setPhotos] = useState({}); const [signer, setSigner] = useState(''); const [gps, setGps] = useState(null);
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [note, setNote] = useState(null); const [cmd, setCmd] = useState(null);
  const tpl = useMemo(() => templates.find((x) => String(x.id) === String(tid)), [templates, tid]); const queued = cmd ? offline.queue?.find((c) => c.id === cmd.id) : null;
  if (oq.error?.status === 403) return <NoPermission what={t('perf.title')} permission="qa.inspection.create" />; if (oq.isPending && online && !offline.masters?.qa_templates) return <Skeleton label={t('perf.title')} rows={4} />;
  const set = (code, patch) => setAns((a) => ({ ...a, [code]: { ...a[code], ...patch } })); const qs = tpl ? tpl.sections.flatMap((s) => s.questions.map((q) => ({ ...q, section: s.title }))) : [];
  const answers = () => qs.filter((q) => q.type === 'YESNO' || q.type === 'NUMERIC' || q.type === 'TEXT').map((q) => ({ questionCode: q.code, ...(q.type === 'YESNO' ? { answer: ans[q.code]?.v ?? null } : {}), ...(q.type === 'NUMERIC' ? { numValue: ans[q.code]?.v === '' || ans[q.code]?.v == null ? null : Number(ans[q.code].v) } : {}), ...(q.type === 'TEXT' ? { textValue: ans[q.code]?.v || null } : {}) })).filter((a) => a.answer != null || a.numValue != null || a.textValue != null);
  const locate = () => navigator.geolocation?.getCurrentPosition((p) => setGps({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }), () => setGps(null), { enableHighAccuracy: true, timeout: 8000 });
  const named = () => Object.entries(photos).flatMap(([code, files]) => files.map((f) => new File([f], `${code}__${f.name}`, { type: f.type })));
  const send = async (submit) => {
    setError(null); setBusy(true); setNote(null);
    try {
      const body = { templateId: Number(tid), projectId: Number(projectId), siteId: siteId ? Number(siteId) : null, subject: subject || null, ...(gps ?? {}), answers: answers(), signatures: signer ? [{ role: 'INSPECTOR', name: signer }] : [] };
      if (offline.ready && offline.forms?.some((f) => f.code === 'inspection_checklist' && f.available !== false)) { const c = await enqueue({ type: 'inspection_checklist', values: body, label: `${tpl.name} ${subject}`.trim(), photos: named() }); setCmd(c); setPhotos({}); return; }
      const d = await qa.make('/inspections', body);
      for (const [code, files] of Object.entries(photos)) for (const f of files) { const up = await uploadFile(f, { transport, entity: 'qa_inspections', entityId: d.id }); await qa.photo(d.id, { questionCode: code, fileId: up.id }); }
      if (submit) await qa.act('/inspections', d.id, 'submit'); navigateTo(`/qa/inspections?id=${d.id}`);
    } catch (e) { setError(e?.errors?.length ? { form: e.message } : errorInfo(e)); } finally { setBusy(false); }
  };
  if (cmd) return <section aria-labelledby="pf-h" data-testid="qa-perform-sent"><PageHeader id="pf-h" title={t('perf.title')} /><p className="mdm-banner" role="status" data-testid="perf-queued">{queued ? t('perf.waiting') : t('perf.sent')}</p><div className="actions-row"><Link to="/qa/inspections">{t('ins.title')}</Link><button type="button" className="btn" onClick={() => { setCmd(null); setAns({}); setSubject(''); }} data-testid="perf-another">{t('perf.another')}</button></div></section>;
  return (
    <section aria-labelledby="pf-h" data-testid="qa-perform"><PageHeader id="pf-h" title={t('perf.title')} subtitle={online ? t('perf.online') : t('perf.offline')} />
      {error?.form && <p className="field-error" role="alert" data-testid="perf-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('perf.checklist')} name="templateId" error={error}><select value={tid} onChange={(e) => { setTid(e.target.value); setAns({}); setPhotos({}); }} style={big} data-testid="perf-template"><option value="">—</option>{templates.map((x) => <option key={x.id} value={x.id}>{x.name} v{x.versionNo}</option>)}</select></Field>
        <Field label={t('project')} name="projectId" error={error}><select value={projectId} onChange={(e) => { setProjectId(e.target.value); setSiteId(''); }} style={big} data-testid="perf-project"><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
        <Field label={t('site')} name="siteId" error={error}><select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={big} data-testid="perf-site"><option value="">—</option>{sites.filter((s) => String(s.projectId) === String(projectId)).map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></Field>
        <Field label={t('perf.subject')} name="subject" error={error}><input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} style={big} data-testid="perf-subject" /></Field></div>
        <div className="actions-row"><button type="button" className="btn" style={big} onClick={locate} data-testid="perf-gps">{t('perf.gps')}</button>{gps && <span className="muted" data-testid="perf-gps-value">{gps.lat}, {gps.lng}</span>}</div></div>
      {tpl && qs.map((q) => {
        const v = ans[q.code]?.v; const tol = q.type === 'NUMERIC' ? inTol(q, v) : null;
        return (
          <div className="mdm-panel" key={q.code} data-testid="perf-question"><strong>{q.code} {q.text}</strong>{q.critical && <span className="muted"> · {t('tpl.critical')}</span>}
            {q.type === 'YESNO' && <div className="actions-row" role="group" aria-label={q.code}>{['YES', 'NO', 'NA'].map((o) => <button key={o} type="button" className={v === o ? 'btn btn-primary' : 'btn'} style={big} aria-pressed={v === o} onClick={() => set(q.code, { v: o })} data-testid={`perf-${q.code}-${o}`}>{t(o === 'YES' ? 'yes' : o === 'NO' ? 'no' : 'na')}</button>)}</div>}
            {q.type === 'NUMERIC' && <div><input type="number" inputMode="decimal" step="any" aria-label={q.code} value={v ?? ''} onChange={(e) => set(q.code, { v: e.target.value })} style={big} data-testid={`perf-${q.code}`} /> <span className="muted">{q.target != null ? `${q.target} +${q.tolPlus ?? 0}/-${q.tolMinus ?? 0}` : `${q.min ?? ''}…${q.max ?? ''}`} {q.unit ?? ''}</span>{tol === false && <p className="field-error" role="status" data-testid={`perf-${q.code}-out`}>{t('perf.outOfTolerance')}</p>}</div>}
            {q.type === 'TEXT' && <textarea aria-label={q.code} rows={2} value={v ?? ''} onChange={(e) => set(q.code, { v: e.target.value })} style={{ width: '100%' }} maxLength={2000} />}
            {(q.photoRequired || q.type === 'PHOTO') && <div><label className="btn" style={big}>{t('perf.photo')}{q.photoRequired ? ` (${t('perf.required')})` : ''}<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhotos((p) => ({ ...p, [q.code]: [...(p[q.code] ?? []), f] })); e.target.value = ''; }} data-testid={`perf-${q.code}-photo`} /></label> <span className="muted" data-testid={`perf-${q.code}-photos`}>{(photos[q.code] ?? []).length}</span></div>}
          </div>
        );
      })}
      {tpl && <div className="mdm-panel"><Field label={t('perf.signature')} name="signer" error={error}><input value={signer} onChange={(e) => setSigner(e.target.value)} maxLength={120} style={big} data-testid="perf-signer" /></Field>
        <div className="actions-row"><button type="button" className="btn" style={big} disabled={busy || !tid || !projectId} onClick={() => send(false)} data-testid="perf-save">{t('perf.saveDraft')}</button><button type="button" className="btn btn-primary" style={big} disabled={busy || !tid || !projectId} onClick={() => send(true)} data-testid="perf-send">{t('perf.send')}</button></div></div>}
    </section>
  );
}
