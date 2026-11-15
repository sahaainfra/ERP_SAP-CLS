import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { authHeaders } from '../../platform/api/index.js';
import { enqueue, useOffline } from '../../platform/offline/engine.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { NOTE_TYPES, WEATHER_CODES, fmtQty, st, today } from './api.js';
import { SiteDay, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// DPR Entry (part 14.02, FR-01 to FR-04, on a phone): a step at a time, with large buttons. The day's work authorisations, attendance, material issues and plant logs are offered; the person confirms
// them or changes them with a reason; photos come from the camera. The report is sent through the offline engine (04.15): with a signal it goes at once, without one it waits on the phone with its photos
// and goes when the signal returns. The server checks every rule again.
const transport = browserTransport(authHeaders);
const STEPS = ['day', 'work', 'labour', 'materials', 'notes', 'photos', 'send'];
const big = { minHeight: 48, fontSize: '1rem' };
const num = (v) => (v === '' || v == null ? 0 : Number(v));
const fromPrefill = (p) => ({
  weatherCode: '', rainMm: '', summary: '', nextDay: p.nextDay ?? '',
  work: p.work.map((w) => ({ waId: w.waId, waNo: w.waNo, activity: w.activity, location: w.location, uom: w.uom, plannedQty: w.plannedQty, offerQty: w.qty, qty: String(w.qty), reason: '' })),
  labour: p.labour.map((l) => ({ category: l.category, contractorId: l.contractorId, contractor: l.contractor, trade: l.trade, offerHeadcount: l.headcount, offerManDays: l.manDays, headcount: String(l.headcount), manDays: String(l.manDays), otHours: String(l.otHours ?? 0), reason: '' })),
  materials: p.materials.map((m) => ({ itemId: m.itemId, item: m.item, uom: m.uom, waId: m.waId, issueRef: m.issueRef, offerQty: m.qty, qty: String(m.qty), reason: '' })),
  equipment: p.equipment.map((e) => ({ equipmentKey: e.equipmentKey, label: e.label, logRef: e.logRef, offerHours: e.hoursWorked, hoursWorked: String(e.hoursWorked), hoursIdle: String(e.hoursIdle ?? 0), hoursBreakdown: String(e.hoursBreakdown ?? 0), reason: '' })),
  notes: p.notes.map((n) => ({ type: n.type, text: n.text })),
});
const fromDpr = (d) => ({
  weatherCode: d.weatherCode ?? '', rainMm: d.rainMm == null ? '' : String(d.rainMm), summary: d.summary ?? '', nextDay: d.notes.find((n) => n.type === 'NEXT_DAY')?.text ?? '',
  work: d.work.map((w) => ({ waId: w.waId, waNo: w.waNo, activity: w.activity, location: w.location, uom: w.uom, plannedQty: w.plannedQty, offerQty: w.prefillQty, qty: String(w.qty), reason: w.reason ?? '' })),
  labour: d.labour.map((l) => ({ category: l.category, contractorId: l.contractorId, contractor: l.contractor, trade: l.trade, offerHeadcount: l.attHeadcount, offerManDays: l.attManDays, headcount: String(l.headcount), manDays: String(l.manDays), otHours: String(l.otHours), reason: l.reason ?? '' })),
  materials: d.materials.map((m) => ({ itemId: m.itemId, item: m.item, uom: m.uom, waId: m.waId, issueRef: m.issueRef, offerQty: m.prefillQty, qty: String(m.qty), reason: m.reason ?? '' })),
  equipment: d.equipment.map((e) => ({ equipmentKey: e.equipmentKey, label: e.label, logRef: e.logRef, offerHours: e.prefillHours, hoursWorked: String(e.hoursWorked), hoursIdle: String(e.hoursIdle), hoursBreakdown: String(e.hoursBreakdown), reason: e.reason ?? '' })),
  notes: d.notes.filter((n) => n.type !== 'NEXT_DAY').map((n) => ({ type: n.type, text: n.text })),
});
const body = (f) => ({
  weatherCode: f.weatherCode || null, rainMm: f.rainMm === '' ? null : Number(f.rainMm), summary: f.summary.trim() || null,
  work: f.work.map((w) => ({ waId: w.waId, qty: num(w.qty), reason: w.reason.trim() || null })),
  labour: f.labour.map((l) => ({ category: l.category, contractorId: l.contractorId ?? null, trade: l.trade, headcount: num(l.headcount), manDays: num(l.manDays), otHours: num(l.otHours), reason: l.reason.trim() || null })),
  materials: f.materials.map((m) => ({ itemId: m.itemId, qty: num(m.qty), waId: m.waId ?? null, issueRef: m.issueRef ?? null, reason: m.reason.trim() || null })),
  equipment: f.equipment.map((e) => ({ label: e.label, equipmentKey: e.equipmentKey ?? null, hoursWorked: num(e.hoursWorked), hoursIdle: num(e.hoursIdle), hoursBreakdown: num(e.hoursBreakdown), logRef: e.logRef ?? null, reason: e.reason.trim() || null })),
  notes: [...f.notes.filter((n) => n.text.trim()).map((n) => ({ type: n.type, text: n.text.trim() })), ...(f.nextDay.trim() ? [{ type: 'NEXT_DAY', text: f.nextDay.trim() }] : [])],
});
/** The reasons the server will ask for, found here first so that the person is told before sending (the server decides). */
const missingReasons = (f, tol) => {
  const out = []; const short = (r) => r.trim().length < 5;
  f.work.forEach((w, i) => { const over = w.plannedQty != null && num(w.qty) * 100 > w.plannedQty * (100 + tol.qtyPct); if ((over || (w.offerQty != null && num(w.qty) !== w.offerQty)) && short(w.reason)) out.push(`work.${i}`); });
  f.labour.forEach((l, i) => { if (l.offerManDays != null && l.offerManDays > 0 && (num(l.manDays) !== l.offerManDays || num(l.headcount) !== l.offerHeadcount) && short(l.reason)) out.push(`labour.${i}`); else if ((l.offerManDays ?? 0) === 0 && num(l.manDays) > 0 && short(l.reason)) out.push(`labour.${i}`); });
  f.materials.forEach((m, i) => { if (m.offerQty != null && num(m.qty) !== m.offerQty && short(m.reason)) out.push(`materials.${i}`); });
  f.equipment.forEach((e, i) => { if (e.offerHours != null && num(e.hoursWorked) !== e.offerHours && short(e.reason)) out.push(`equipment.${i}`); });
  return out;
};

export default function DprEntryPage() {
  const t = useT('site'); usePageTitle(t('dpr.entry'));
  const sp = useSearch(); const editId = Number(sp.get('id')) || null; const offline = useOffline(); const online = offline.online !== false && navigator.onLine;
  const [step, setStep] = useState(0); const [siteId, setSiteId] = useState(Number(sp.get('siteId')) || null); const [date, setDate] = useState(sp.get('date') ?? today()); const [scope, setScope] = useState('SITE');
  const [form, setForm] = useState(null); const [meta, setMeta] = useState(null); const [existing, setExisting] = useState(null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [note, setNote] = useState(null);
  const [photos, setPhotos] = useState([]); const [cmd, setCmd] = useState(null);
  const sitesQ = useQuery({ queryKey: ['site', 'dpr-sites'], queryFn: st.dprSites, retry: false, enabled: online });
  const optQ = useQuery({ queryKey: ['site', 'dpr-options', siteId], queryFn: () => st.dprOptions(siteId), enabled: Boolean(siteId) && online, retry: false });
  const eq = useQuery({ queryKey: ['site', 'dpr-edit', editId], queryFn: () => st.dpr(editId), enabled: Boolean(editId), retry: false });
  const onSite = useCallback((v) => setSiteId(v), []);
  const contractors = optQ.data?.contractors ?? offline.masters?.dpr_contractors ?? []; const items = optQ.data?.items ?? offline.masters?.dpr_items ?? [];
  useEffect(() => { if (eq.data && !form) { setForm(fromDpr(eq.data)); setMeta({ site: `${eq.data.siteCode}`, tolerance: eq.data.tolerance ? { qtyPct: eq.data.tolerance.qtyPct, labourPct: eq.data.tolerance.labourPct } : { qtyPct: 5, labourPct: 10 }, date: eq.data.dprDate, scope: eq.data.scope }); setSiteId(eq.data.siteId); setDate(eq.data.dprDate); setScope(eq.data.scope); setStep(1); } }, [eq.data, form]);
  // the command of a report sent through the engine: it leaves the queue when the server has taken it and its photos
  const queued = cmd ? offline.queue?.find((c) => c.id === cmd.id) : null;
  const sent = cmd && !queued;

  const start = async () => {
    setError(null); setBusy(true); setExisting(null);
    try {
      let p = null;
      if (online) { try { p = await st.dprPrefill(siteId, date, scope); } catch (e) { if (e?.status) throw e; } }
      if (p) { setExisting(p.existing); setMeta({ site: `${p.site.projectCode} ${p.site.code}`, tolerance: p.tolerance, cutoff: p.cutoff, date, scope }); setForm(fromPrefill(p)); if (!p.existing || !['DRAFT', 'RETURNED'].includes(p.existing.status)) setStep(1); return; }
      const row = (offline.masters?.dpr_prefill ?? []).find((r) => r.id === `${siteId}:${date}`);
      setMeta({ site: row?.site ?? String(siteId), tolerance: { qtyPct: 5, labourPct: 10 }, date, scope, cached: Boolean(row) }); setForm(fromPrefill(row ?? { work: [], labour: [], materials: [], equipment: [], notes: [], nextDay: null })); setNote(row ? t('dpr.fromPhone') : t('dpr.noCache')); setStep(1);
    } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setLine = (sec, i, patch) => setForm((f) => ({ ...f, [sec]: f[sec].map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const drop = (sec, i) => setForm((f) => ({ ...f, [sec]: f[sec].filter((_, j) => j !== i) }));
  const add = (sec, line) => setForm((f) => ({ ...f, [sec]: [...f[sec], line] }));
  const need = useMemo(() => (form && meta ? missingReasons(form, meta.tolerance) : []), [form, meta]);

  const send = async (submit) => {
    setError(null); setNote(null);
    if (submit && need.length) { setError({ form: t('dpr.needReasons', { n: need.length }) }); setStep(1); return; }
    setBusy(true);
    try {
      const b = body(form); const gps = await new Promise((res) => (navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => res({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }), () => res(null), { timeout: 4000, maximumAge: 60_000 }) : res(null)));
      if (editId) {
        await st.updateDpr(editId, { ...b, rowVersion: eq.data.rowVersion });
        for (const p of photos) { const f = await uploadFile(p.file, { transport, entity: 'site_dpr', entityId: editId }); await st.dprPhoto(editId, f.id, { caption: p.caption || null, takenAt: new Date(p.file.lastModified || Date.now()).toISOString(), ...(gps ?? {}) }).catch(() => null); }
        if (submit) await st.dprAct(editId, 'submit'); navigateTo(`/site/dprs?id=${editId}`); return;
      }
      if (offline.ready && offline.forms?.some((f) => f.code === 'dpr' && f.available !== false)) {
        const c = await enqueue({ type: 'dpr', values: { siteId, dprDate: date, scope, ...b, ...(submit ? { submit: true } : {}) }, label: `DPR ${meta.site} ${date}`, photos: photos.map((p) => p.file) }); setCmd(c); setPhotos([]); return;
      }
      const d = await st.createDpr({ siteId, dprDate: date, scope, ...b }); if (submit) await st.dprAct(d.id, 'submit'); navigateTo(`/site/dprs?id=${d.id}`);
    } catch (e) { setError(e?.errors?.length ? { form: e.message } : errorInfo(e)); } finally { setBusy(false); }
  };

  if (sitesQ.error?.status === 403) return <NoPermission what={t('dpr.entry')} permission="site.dpr.create" />;
  const reasonField = (sec, i, line) => (need.includes(`${sec}.${i}`) ? <Field label={t('dpr.reason')} name={`${sec}-${i}-reason`}><input value={line.reason} onChange={(e) => setLine(sec, i, { reason: e.target.value })} style={big} maxLength={500} data-testid={`dpr-reason-${sec}`} /></Field> : null);
  const Nav = ({ last = false }) => (
    <div className="actions-row" style={{ marginTop: 12 }}>
      <button type="button" className="btn" style={big} onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} data-testid="dpr-back">{t('dpr.back')}</button>
      {!last && <button type="button" className="btn btn-primary" style={big} onClick={() => setStep(step + 1)} data-testid="dpr-next">{t('dpr.next')}</button>}
    </div>
  );
  return (
    <section aria-labelledby="dpr-h" data-testid="site-dpr-entry" style={{ maxWidth: 720 }}>
      <PageHeader id="dpr-h" title={t('dpr.entry')} />
      <p className={`att-net${online ? '' : ' is-off'}`} role="status" data-testid="dpr-net">{online ? t('dpr.online') : t('dpr.offline')}{offline.queue?.length ? ` · ${t('dpr.waiting', { n: offline.queue.length })}` : ''} · <Link to="/field/sync">{t('dpr.syncStatus')}</Link></p>
      <ol className="steps" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', listStyle: 'none', padding: 0 }} aria-label={t('dpr.steps')}>{STEPS.map((k, i) => <li key={k}><button type="button" className={`btn${i === step ? ' btn-primary' : ''}`} style={{ minHeight: 40 }} onClick={() => form && setStep(i)} disabled={!form && i > 0} aria-current={i === step ? 'step' : undefined} data-testid={`dpr-step-${k}`}>{i + 1}. {t(`dpr.s.${k}`)}</button></li>)}</ol>
      {error?.form && <p className="field-error" role="alert" data-testid="dpr-error">{error.form}{error.fields ? ` ${Object.entries(error.fields).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="dpr-note">{note}</p>}
      {eq.isPending && editId && <Skeleton label={t('dpr.entry')} rows={4} />}
      {eq.isError && <ErrorState error={eq.error} onRetry={eq.refetch} />}

      {step === 0 && !editId && (
        <div className="mdm-panel" data-testid="dpr-day">
          <SiteDay siteId={siteId} date={date} onSite={onSite} onDate={setDate} testId="dpr" />
          <fieldset><legend>{t('dpr.scope')}</legend>{['SITE', 'SUPERVISOR'].map((k) => <label key={k} className="check" style={{ marginRight: 16, minHeight: 44 }}><input type="radio" name="scope" checked={scope === k} onChange={() => setScope(k)} data-testid={`dpr-scope-${k}`} /> {t(`dpr.scope.${k}`)}</label>)}</fieldset>
          {existing && <p className="mdm-banner" data-testid="dpr-existing">{t('dpr.existing', { n: existing.docNo })} <Link to={['DRAFT', 'RETURNED'].includes(existing.status) ? `/site/dpr-entry?id=${existing.id}` : `/site/dprs?id=${existing.id}`}>{t('dpr.open')}</Link></p>}
          <div className="actions"><button type="button" className="btn btn-primary" style={big} disabled={!siteId || busy} onClick={start} data-testid="dpr-start">{t('dpr.start')}</button></div>
          <p className="muted">{t('dpr.startHelp')}</p>
        </div>
      )}

      {form && step === 1 && (
        <div data-testid="dpr-work"><h2>{t('dpr.s.work')}</h2><p className="muted">{t('dpr.workHelp', { p: meta.tolerance.qtyPct })}</p>
          {form.work.length === 0 && <p className="muted" data-testid="dpr-work-empty">{t('dpr.noWork')}</p>}
          {form.work.map((w, i) => (
            <fieldset key={w.waId} className="mdm-panel" data-testid="dpr-work-line"><legend>{w.waNo} · {w.activity}</legend>
              <p className="muted">{w.location ?? ''} · {t('dpr.planned')} {fmtQty(w.plannedQty)} {w.uom ?? ''}{w.offerQty != null ? ` · ${t('dpr.offered')} ${fmtQty(w.offerQty)}` : ''}</p>
              <Field label={t('dpr.qtyDone', { u: w.uom ?? '' })} name={`work-${i}`}><input type="number" inputMode="decimal" min="0" step="0.001" value={w.qty} onChange={(e) => setLine('work', i, { qty: e.target.value })} style={big} data-testid="dpr-work-qty" /></Field>
              {reasonField('work', i, w)}<button type="button" className="btn" onClick={() => drop('work', i)}>{t('act.remove')}</button>
            </fieldset>
          ))}
          <Nav />
        </div>
      )}

      {form && step === 2 && (
        <div data-testid="dpr-labour"><h2>{t('dpr.s.labour')}</h2><p className="muted">{t('dpr.labourHelp', { p: meta.tolerance.labourPct })}</p>
          {form.labour.map((l, i) => (
            <fieldset key={`${l.category}-${l.contractorId}-${l.trade}-${i}`} className="mdm-panel" data-testid="dpr-labour-line"><legend>{t(`dpr.cat.${l.category}`)} · {l.trade}{l.contractor ? ` · ${l.contractor}` : ''}</legend>
              <p className="muted">{t('dpr.attendance')}: {l.offerManDays == null ? '—' : `${fmtQty(l.offerHeadcount)} / ${fmtQty(l.offerManDays)}`}</p>
              <div className="form-grid">
                <Field label={t('dpr.headcount')} name={`l-${i}-h`}><input type="number" inputMode="numeric" min="0" step="1" value={l.headcount} onChange={(e) => setLine('labour', i, { headcount: e.target.value })} style={big} data-testid="dpr-labour-head" /></Field>
                <Field label={t('dpr.manDays')} name={`l-${i}-m`}><input type="number" inputMode="decimal" min="0" step="0.5" value={l.manDays} onChange={(e) => setLine('labour', i, { manDays: e.target.value })} style={big} data-testid="dpr-labour-md" /></Field>
                <Field label={t('dpr.ot')} name={`l-${i}-o`}><input type="number" inputMode="decimal" min="0" step="0.5" value={l.otHours} onChange={(e) => setLine('labour', i, { otHours: e.target.value })} style={big} /></Field>
              </div>
              {reasonField('labour', i, l)}<button type="button" className="btn" onClick={() => drop('labour', i)}>{t('act.remove')}</button>
            </fieldset>
          ))}
          <AddLabour t={t} contractors={contractors} onAdd={(l) => add('labour', l)} />
          <Nav />
        </div>
      )}

      {form && step === 3 && (
        <div data-testid="dpr-materials"><h2>{t('dpr.s.materials')}</h2>
          {form.materials.map((m, i) => (
            <fieldset key={`${m.itemId}-${m.waId}-${i}`} className="mdm-panel" data-testid="dpr-material-line"><legend>{m.item}</legend>
              <Field label={t('dpr.qtyUsed', { u: m.uom ?? '' })} name={`m-${i}`}><input type="number" inputMode="decimal" min="0" step="0.001" value={m.qty} onChange={(e) => setLine('materials', i, { qty: e.target.value })} style={big} /></Field>
              {m.offerQty != null && <p className="muted">{t('dpr.issued')} {fmtQty(m.offerQty)}</p>}{reasonField('materials', i, m)}<button type="button" className="btn" onClick={() => drop('materials', i)}>{t('act.remove')}</button>
            </fieldset>
          ))}
          <AddMaterial t={t} items={items} onAdd={(m) => add('materials', m)} />
          <h2>{t('dpr.s.equipment')}</h2>
          {form.equipment.map((e, i) => (
            <fieldset key={`${e.equipmentKey}-${i}`} className="mdm-panel" data-testid="dpr-equipment-line"><legend>{e.label}</legend>
              <div className="form-grid">
                <Field label={t('dpr.hWorked')} name={`e-${i}-w`}><input type="number" inputMode="decimal" min="0" max="24" step="0.5" value={e.hoursWorked} onChange={(x) => setLine('equipment', i, { hoursWorked: x.target.value })} style={big} /></Field>
                <Field label={t('dpr.hIdle')} name={`e-${i}-i`}><input type="number" inputMode="decimal" min="0" max="24" step="0.5" value={e.hoursIdle} onChange={(x) => setLine('equipment', i, { hoursIdle: x.target.value })} style={big} /></Field>
                <Field label={t('dpr.hBreakdown')} name={`e-${i}-b`}><input type="number" inputMode="decimal" min="0" max="24" step="0.5" value={e.hoursBreakdown} onChange={(x) => setLine('equipment', i, { hoursBreakdown: x.target.value })} style={big} /></Field>
              </div>{reasonField('equipment', i, e)}<button type="button" className="btn" onClick={() => drop('equipment', i)}>{t('act.remove')}</button>
            </fieldset>
          ))}
          <AddEquipment t={t} onAdd={(e) => add('equipment', e)} />
          <Nav />
        </div>
      )}

      {form && step === 4 && (
        <div data-testid="dpr-notes"><h2>{t('dpr.s.notes')}</h2>
          <div className="form-grid">
            <Field label={t('dpr.weather')} name="weatherCode"><select value={form.weatherCode} onChange={(e) => set('weatherCode', e.target.value)} style={big} data-testid="dpr-weather"><option value="">—</option>{WEATHER_CODES.map((k) => <option key={k} value={k}>{t(`dpr.w.${k}`)}</option>)}</select></Field>
            <Field label={t('dpr.rain')} name="rainMm"><input type="number" inputMode="numeric" min="0" max="2000" value={form.rainMm} onChange={(e) => set('rainMm', e.target.value)} style={big} /></Field>
          </div>
          <Field label={t('dpr.summary')} name="summary"><textarea value={form.summary} onChange={(e) => set('summary', e.target.value)} rows={2} maxLength={4000} style={{ fontSize: '1rem' }} /></Field>
          {form.notes.map((n, i) => <fieldset key={i} className="mdm-panel" data-testid="dpr-note-line"><legend>{t(`dpr.n.${n.type}`)}</legend><textarea aria-label={t(`dpr.n.${n.type}`)} value={n.text} onChange={(e) => setLine('notes', i, { text: e.target.value })} rows={2} maxLength={2000} style={{ width: '100%', fontSize: '1rem' }} /><button type="button" className="btn" onClick={() => drop('notes', i)}>{t('act.remove')}</button></fieldset>)}
          <AddNote t={t} onAdd={(n) => add('notes', n)} />
          <Field label={t('dpr.n.NEXT_DAY')} name="nextDay"><textarea value={form.nextDay} onChange={(e) => set('nextDay', e.target.value)} rows={2} maxLength={2000} style={{ fontSize: '1rem' }} data-testid="dpr-nextday" /></Field>
          <Nav />
        </div>
      )}

      {form && step === 5 && (
        <div data-testid="dpr-photos"><h2>{t('dpr.s.photos')}</h2><p className="muted">{t('dpr.photosHelp')}</p>
          <label className="btn btn-primary" style={{ ...big, display: 'inline-flex', alignItems: 'center' }}>{t('dpr.takePhoto')}<input type="file" accept="image/*" capture="environment" multiple onChange={(e) => { const files = [...e.target.files]; setPhotos((p) => [...p, ...files.map((file) => ({ file, caption: '' }))]); e.target.value = ''; }} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} data-testid="dpr-photo-input" /></label>
          <ul style={{ listStyle: 'none', padding: 0 }}>{photos.map((p, i) => <li key={i} className="mdm-panel" data-testid="dpr-photo-line"><strong>{p.file.name}</strong> · {Math.round(p.file.size / 1024)} KB <input aria-label={t('dpr.caption')} placeholder={t('dpr.caption')} value={p.caption} onChange={(e) => setPhotos((l) => l.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} style={big} maxLength={300} /> <button type="button" className="btn" onClick={() => setPhotos((l) => l.filter((_, j) => j !== i))}>{t('act.remove')}</button></li>)}</ul>
          <Nav />
        </div>
      )}

      {form && step === 6 && (
        <div className="mdm-panel" data-testid="dpr-send"><h2>{t('dpr.s.send')}</h2>
          <ul data-testid="dpr-summary"><li>{t('dpr.sum.work', { n: form.work.length })}</li><li>{t('dpr.sum.labour', { n: form.labour.length, d: fmtQty(form.labour.reduce((s, l) => s + num(l.manDays), 0)) })}</li><li>{t('dpr.sum.materials', { n: form.materials.length })}</li><li>{t('dpr.sum.equipment', { n: form.equipment.length })}</li><li>{t('dpr.sum.photos', { n: photos.length })}</li></ul>
          {need.length > 0 && <p className="field-error" role="alert" data-testid="dpr-need">{t('dpr.needReasons', { n: need.length })}</p>}
          {!online && <p className="muted" data-testid="dpr-offline-help">{t('dpr.offlineHelp')}</p>}
          {cmd ? (
            <p className="mdm-banner" role="status" data-testid="dpr-queued" data-state={sent ? 'sent' : queued?.status ?? 'PENDING'}>{sent ? t('dpr.sent') : queued?.status === 'ERROR' ? `${t('dpr.refused')}: ${queued.error ?? ''}` : t('dpr.queued')} <Link to="/field/sync">{t('dpr.syncStatus')}</Link></p>
          ) : (
            <div className="actions-row"><button type="button" className="btn" style={big} disabled={busy} onClick={() => send(false)} data-testid="dpr-save">{t('dpr.saveDraft')}</button><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => send(true)} data-testid="dpr-submit">{t('dpr.sendApproval')}</button></div>
          )}
          <Nav last />
        </div>
      )}
    </section>
  );
}

function AddLabour({ t, contractors, onAdd }) {
  const [c, setC] = useState({ category: 'CONTRACT', contractorId: '', trade: '' });
  return (
    <details className="mdm-panel"><summary style={{ minHeight: 44 }}>{t('dpr.addLabour')}</summary>
      <div className="form-grid">
        <Field label={t('dpr.category')} name="category"><select value={c.category} onChange={(e) => setC({ ...c, category: e.target.value })} style={big}>{['STAFF', 'CONTRACT'].map((k) => <option key={k} value={k}>{t(`dpr.cat.${k}`)}</option>)}</select></Field>
        {c.category === 'CONTRACT' && <Field label={t('dpr.contractor')} name="contractor"><select value={c.contractorId} onChange={(e) => setC({ ...c, contractorId: e.target.value })} style={big}><option value="">—</option>{contractors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
        <Field label={t('dpr.trade')} name="trade"><input value={c.trade} onChange={(e) => setC({ ...c, trade: e.target.value })} style={big} maxLength={60} data-testid="dpr-add-trade" /></Field>
      </div>
      <button type="button" className="btn" style={big} disabled={c.trade.trim().length < 2 || (c.category === 'CONTRACT' && !c.contractorId)} onClick={() => { const k = contractors.find((x) => String(x.id) === String(c.contractorId)); onAdd({ category: c.category, contractorId: c.category === 'CONTRACT' ? Number(c.contractorId) : null, contractor: k?.name ?? null, trade: c.trade.trim(), offerHeadcount: null, offerManDays: null, headcount: '0', manDays: '0', otHours: '0', reason: '' }); setC({ ...c, trade: '' }); }} data-testid="dpr-add-labour">{t('dpr.add')}</button>
    </details>
  );
}
function AddMaterial({ t, items, onAdd }) {
  const [id, setId] = useState('');
  return (
    <details className="mdm-panel"><summary style={{ minHeight: 44 }}>{t('dpr.addMaterial')}</summary>
      <Field label={t('dpr.item')} name="item"><select value={id} onChange={(e) => setId(e.target.value)} style={big}><option value="">—</option>{items.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></Field>
      <button type="button" className="btn" style={big} disabled={!id} onClick={() => { const x = items.find((i) => String(i.id) === id); onAdd({ itemId: x.id, item: `${x.code} ${x.name}`, uom: x.uom, waId: null, issueRef: null, offerQty: null, qty: '0', reason: '' }); setId(''); }}>{t('dpr.add')}</button>
    </details>
  );
}
function AddEquipment({ t, onAdd }) {
  const [label, setLabel] = useState('');
  return (
    <details className="mdm-panel"><summary style={{ minHeight: 44 }}>{t('dpr.addEquipment')}</summary>
      <Field label={t('dpr.equipment')} name="equipment"><input value={label} onChange={(e) => setLabel(e.target.value)} style={big} maxLength={120} /></Field>
      <button type="button" className="btn" style={big} disabled={label.trim().length < 2} onClick={() => { onAdd({ equipmentKey: null, label: label.trim(), logRef: null, offerHours: null, hoursWorked: '0', hoursIdle: '0', hoursBreakdown: '0', reason: '' }); setLabel(''); }}>{t('dpr.add')}</button>
    </details>
  );
}
function AddNote({ t, onAdd }) {
  const [type, setType] = useState('HINDRANCE');
  return (
    <div className="actions-row"><label>{t('dpr.noteKind')}<select value={type} onChange={(e) => setType(e.target.value)} style={big} data-testid="dpr-note-kind">{NOTE_TYPES.filter((k) => k !== 'NEXT_DAY').map((k) => <option key={k} value={k}>{t(`dpr.n.${k}`)}</option>)}</select></label><button type="button" className="btn" style={big} onClick={() => onAdd({ type, text: '' })} data-testid="dpr-add-note">{t('dpr.addNote')}</button></div>
  );
}
