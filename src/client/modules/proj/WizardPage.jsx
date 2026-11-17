import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { CONTRACT_TYPES, PROJECT_TYPES, SECTORS, SITE_TYPES, inr, proj } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Project Setup Wizard (part 10.01, FR-01, T-01): seven steps with validation at each: basics (code, name, type, sector, place, client, consultant, funding agency), the contract summary, sites and their geofences, the team, the numbering series
// and document folders from templates, the settings and key dates, and the review with the activation checklist. The server makes the project, its sites, series, folders and key dates in one transaction (nothing is made when any part is refused);
// "Save as draft" keeps the project in setup, "Make and send for activation" also sends it to the project director and the director. The draft of the form is kept in this browser while it is open.
const STEPS = ['basics', 'contract', 'sites', 'team', 'setup', 'planning', 'review'];
const blankSite = (n) => ({ code: '', name: '', siteType: 'SITE', address: '', latitude: '', longitude: '', geofenceType: n === 0 ? 'CIRCLE' : 'NONE', geofenceRadiusM: '300' });
const blank = () => ({
  basics: { code: '', name: '', type: 'BUILDING', sector: '', location: '', clientPartnerId: null, consultantPartnerId: null, funderPartnerId: null },
  contract: { contractType: 'ITEM_RATE', contractNo: '', contractValue: '', startDate: '', scheduledCompletion: '', dlpMonths: '12', retentionPct: '5', mobAdvancePct: '10', ldSummary: '' },
  sites: [blankSite(0)], team: { pmUser: '', directorUser: '' }, numbering: null, folderTemplate: undefined, settings: null, milestones: [], ticked: [],
});
const DRAFT_KEY = 'erp.proj.wizard';
const num = (v) => (v === '' || v == null ? null : Number(v));

export default function WizardPage() {
  const t = useT('proj');
  usePageTitle(t('wiz.title'));
  const tenderId = Number(useSearch().get('tenderId')) || null;
  const [f, setF] = useState(() => { try { const d = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? 'null'); return d && !tenderId ? d : blank(); } catch { return blank(); } });
  const [step, setStep] = useState(0); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [touched, setTouched] = useState(false);
  const oq = useQuery({ queryKey: ['proj', 'options'], queryFn: proj.options, retry: false });
  const pq = useQuery({ queryKey: ['proj', 'prefill', tenderId], queryFn: () => proj.prefill(tenderId), enabled: Boolean(tenderId), retry: false });
  const o = oq.data;
  useEffect(() => { if (o && f.numbering === null) setF((x) => ({ ...x, numbering: o.numbering.map((n) => n.code), folderTemplate: o.folderDefault, settings: x.settings ?? o.settingsDefaults })); }, [o]);
  useEffect(() => { if (pq.data) setF((x) => ({ ...x, basics: { ...x.basics, name: pq.data.name, location: pq.data.location ?? '', clientPartnerId: pq.data.clientPartnerId }, contract: { ...x.contract, contractNo: pq.data.contractNo ?? '', contractValue: pq.data.contractValue ?? '', contractType: pq.data.contractType } })); }, [pq.data]);
  useEffect(() => { if (touched) try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(f)); } catch { /* the draft is a convenience only */ } }, [f, touched]);
  if (oq.isPending) return <Skeleton label={t('wiz.title')} rows={5} />;
  if (oq.isError) return <ErrorState error={oq.error} onRetry={oq.refetch} />;
  const set = (part, k, v) => { setTouched(true); setF((x) => ({ ...x, [part]: { ...x[part], [k]: v } })); };
  const setSite = (i, k, v) => { setTouched(true); setF((x) => ({ ...x, sites: x.sites.map((s, j) => (j === i ? { ...s, [k]: v } : s)) })); };
  const setMs = (i, k, v) => { setTouched(true); setF((x) => ({ ...x, milestones: x.milestones.map((s, j) => (j === i ? { ...s, [k]: v } : s)) })); };
  /** The checks of each step, as the server makes them (the server decides). */
  const problems = (k) => {
    const p = [];
    if (k === 'basics') { if (f.basics.code.trim().length < 2) p.push(t('v.code')); if (f.basics.name.trim().length < 3) p.push(t('v.name')); if (!f.basics.clientPartnerId) p.push(t('v.client')); }
    if (k === 'contract') { const c = f.contract; if (c.contractValue === '' && c.contractType !== 'COST_PLUS') p.push(t('v.value')); if (!c.startDate || !c.scheduledCompletion) p.push(t('v.dates')); else if (c.scheduledCompletion < c.startDate) p.push(t('v.datesOrder')); if (Number(c.retentionPct) > 100 || Number(c.mobAdvancePct) > 100) p.push(t('v.pct')); }
    if (k === 'sites') { if (!f.sites.length) p.push(t('v.sites')); f.sites.forEach((s, i) => { if (!s.code.trim() || !s.name.trim()) p.push(t('v.siteNameCode', { n: i + 1 })); if (s.geofenceType === 'CIRCLE' && (s.latitude === '' || s.longitude === '' || !s.geofenceRadiusM)) p.push(t('v.siteCircle', { n: i + 1 })); }); }
    if (k === 'team') { if (!f.team.pmUser) p.push(t('v.pm')); if (!f.team.directorUser) p.push(t('v.director')); }
    if (k === 'planning') f.milestones.forEach((m, i) => { if (!m.code.trim() || !m.name.trim() || !m.plannedDate) p.push(t('v.milestone', { n: i + 1 })); });
    return p;
  };
  const here = problems(STEPS[step]); const all = STEPS.slice(0, 6).flatMap(problems);
  const body = (submit) => ({
    ...(tenderId ? { tenderId } : {}),
    basics: { code: f.basics.code.trim(), name: f.basics.name.trim(), type: f.basics.type, sector: f.basics.sector || null, location: f.basics.location.trim() || null },
    contract: { clientPartnerId: f.basics.clientPartnerId, consultantPartnerId: f.basics.consultantPartnerId, funderPartnerId: f.basics.funderPartnerId, contractType: f.contract.contractType, contractNo: f.contract.contractNo.trim() || null, contractValue: String(f.contract.contractValue || '0'), startDate: f.contract.startDate || null, scheduledCompletion: f.contract.scheduledCompletion || null, dlpMonths: Number(f.contract.dlpMonths || 0), retentionPct: String(f.contract.retentionPct || '0'), mobAdvancePct: String(f.contract.mobAdvancePct || '0'), ldSummary: f.contract.ldSummary.trim() || null },
    sites: f.sites.map((s) => ({ code: s.code.trim(), name: s.name.trim(), siteType: s.siteType, address: s.address.trim() || null, latitude: num(s.latitude), longitude: num(s.longitude), geofenceType: s.geofenceType, geofenceRadiusM: s.geofenceType === 'CIRCLE' ? num(s.geofenceRadiusM) : null })),
    team: { pmUser: f.team.pmUser || null, directorUser: f.team.directorUser || null }, setup: { numbering: f.numbering ?? [], folderTemplate: f.folderTemplate || null, settings: f.settings ?? undefined },
    milestones: f.milestones.map((m) => ({ code: m.code.trim(), name: m.name.trim(), plannedDate: m.plannedDate, contractual: Boolean(m.contractual), paymentLinked: Boolean(m.paymentLinked) })), submit, ticked: submit ? f.ticked : [],
  });
  const make = async (submit) => {
    setBusy(true); setError(null);
    try { const r = await proj.create(body(submit)); try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } navigateTo(`/proj/project?id=${r.id}`, { force: true }); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  const errBox = error?.form && <p className="field-error" role="alert" data-testid="wiz-error">{error.form}{error.fields ? ` ${Object.entries(error.fields).slice(0, 8).map(([k, m]) => `${k}: ${m}`).join('; ')}` : ''}</p>;
  const checklist = o.checklists.ACTIVATE;
  const tickAll = f.ticked.length === checklist.length;
  return (
    <section aria-labelledby="wiz-h" data-testid="wizard">
      <PageHeader id="wiz-h" title={t('wiz.title')} />
      {tenderId && pq.data && <p className="mdm-banner" data-testid="wiz-prefill">{t('wiz.prefilled', { tender: pq.data.tenderNo })}</p>}
      <ol className="steps" aria-label={t('wiz.steps')} data-testid="wiz-steps" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', padding: 0 }}>
        {STEPS.map((k, i) => <li key={k}><button type="button" className={`btn btn-small${i === step ? ' btn-primary' : ''}`} aria-current={i === step ? 'step' : undefined} onClick={() => { if (i <= step || STEPS.slice(0, i).every((x) => !problems(x).length)) setStep(i); }} data-testid={`wiz-step-${k}`}>{i + 1}. {t(`step.${k}`)}</button></li>)}
      </ol>
      {errBox}
      <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); if (!here.length && step < STEPS.length - 1) setStep(step + 1); }} aria-label={t(`step.${STEPS[step]}`)} data-testid={`wiz-form-${STEPS[step]}`}>
        <h2>{t(`step.${STEPS[step]}`)}</h2>
        {step === 0 && (<>
          <Field label={t('f.code')} name="code" error={error}><input value={f.basics.code} maxLength={30} onChange={(e) => set('basics', 'code', e.target.value)} required data-testid="wz-code" /></Field>
          <Field label={t('f.name')} name="name" error={error}><input value={f.basics.name} maxLength={160} onChange={(e) => set('basics', 'name', e.target.value)} required data-testid="wz-name" /></Field>
          <Field label={t('f.type')} name="type" error={error}><select value={f.basics.type} onChange={(e) => set('basics', 'type', e.target.value)} data-testid="wz-type">{PROJECT_TYPES.map((k) => <option key={k} value={k}>{t(`ptype.${k}`)}</option>)}</select></Field>
          <Field label={t('f.sector')} name="sector" error={error}><select value={f.basics.sector} onChange={(e) => set('basics', 'sector', e.target.value)} data-testid="wz-sector"><option value="">–</option>{SECTORS.map((k) => <option key={k} value={k}>{t(`sector.${k}`)}</option>)}</select></Field>
          <Field label={t('f.location')} name="location" error={error}><input value={f.basics.location} onChange={(e) => set('basics', 'location', e.target.value)} data-testid="wz-location" /></Field>
          <LookupField id="wz-client" label={t('f.client')} lookup="proj/clients" value={f.basics.clientPartnerId} onChange={(v) => set('basics', 'clientPartnerId', v)} required error={error?.fields?.clientPartnerId} />
          <LookupField id="wz-consultant" label={t('f.consultant')} lookup="proj/consultants" value={f.basics.consultantPartnerId} onChange={(v) => set('basics', 'consultantPartnerId', v)} />
          <LookupField id="wz-funder" label={t('f.funder')} lookup="proj/funders" value={f.basics.funderPartnerId} onChange={(v) => set('basics', 'funderPartnerId', v)} />
        </>)}
        {step === 1 && (<>
          <Field label={t('f.contractType')} name="contractType" error={error}><select value={f.contract.contractType} onChange={(e) => set('contract', 'contractType', e.target.value)} data-testid="wz-ctype">{CONTRACT_TYPES.map((k) => <option key={k} value={k}>{t(`ctype.${k}`)}</option>)}</select></Field>
          <Field label={t('f.contractNo')} name="contractNo" error={error}><input value={f.contract.contractNo} onChange={(e) => set('contract', 'contractNo', e.target.value)} data-testid="wz-cno" /></Field>
          <Field label={t('f.contractValue')} name="contractValue" error={error}><input type="number" min="0" step="0.01" value={f.contract.contractValue} onChange={(e) => set('contract', 'contractValue', e.target.value)} data-testid="wz-cvalue" /></Field>
          <Field label={t('f.startDate')} name="startDate" error={error}><input type="date" value={f.contract.startDate} onChange={(e) => set('contract', 'startDate', e.target.value)} data-testid="wz-start" /></Field>
          <Field label={t('f.scheduledCompletion')} name="scheduledCompletion" error={error}><input type="date" value={f.contract.scheduledCompletion} min={f.contract.startDate || undefined} onChange={(e) => set('contract', 'scheduledCompletion', e.target.value)} data-testid="wz-end" /></Field>
          <Field label={t('f.dlpMonths')} name="dlpMonths" error={error}><input type="number" min="0" max="120" value={f.contract.dlpMonths} onChange={(e) => set('contract', 'dlpMonths', e.target.value)} data-testid="wz-dlp" /></Field>
          <Field label={t('f.retention')} name="retentionPct" error={error}><input type="number" min="0" max="100" step="0.01" value={f.contract.retentionPct} onChange={(e) => set('contract', 'retentionPct', e.target.value)} data-testid="wz-retention" /></Field>
          <Field label={t('f.mobAdvance')} name="mobAdvancePct" error={error}><input type="number" min="0" max="100" step="0.01" value={f.contract.mobAdvancePct} onChange={(e) => set('contract', 'mobAdvancePct', e.target.value)} data-testid="wz-mob" /></Field>
          <Field label={t('f.ld')} name="ldSummary" error={error}><textarea rows={2} value={f.contract.ldSummary} onChange={(e) => set('contract', 'ldSummary', e.target.value)} data-testid="wz-ld" /></Field>
        </>)}
        {step === 2 && (<>
          <p className="small muted">{t('wiz.sitesHelp')}</p>
          {f.sites.map((s, i) => (
            <div key={i} className="mdm-panel mdm-fields" data-testid={`wz-site-${i}`}>
              <Field label={t('site.code')} name={`s${i}c`}><input value={s.code} onChange={(e) => setSite(i, 'code', e.target.value)} data-testid={`wz-site-code-${i}`} /></Field>
              <Field label={t('site.name')} name={`s${i}n`}><input value={s.name} onChange={(e) => setSite(i, 'name', e.target.value)} data-testid={`wz-site-name-${i}`} /></Field>
              <Field label={t('site.type')} name={`s${i}t`}><select value={s.siteType} onChange={(e) => setSite(i, 'siteType', e.target.value)}>{SITE_TYPES.map((k) => <option key={k} value={k}>{t(`stype.${k}`)}</option>)}</select></Field>
              <Field label={t('site.address')} name={`s${i}a`}><input value={s.address} onChange={(e) => setSite(i, 'address', e.target.value)} /></Field>
              <Field label={t('site.geofence')} name={`s${i}g`}><select value={s.geofenceType} onChange={(e) => setSite(i, 'geofenceType', e.target.value)} data-testid={`wz-site-geo-${i}`}><option value="NONE">{t('geo.NONE')}</option><option value="CIRCLE">{t('geo.CIRCLE')}</option></select></Field>
              {s.geofenceType === 'CIRCLE' && (<>
                <Field label={t('site.lat')} name={`s${i}la`}><input type="number" step="0.000001" min="-90" max="90" value={s.latitude} onChange={(e) => setSite(i, 'latitude', e.target.value)} data-testid={`wz-site-lat-${i}`} /></Field>
                <Field label={t('site.lng')} name={`s${i}lo`}><input type="number" step="0.000001" min="-180" max="180" value={s.longitude} onChange={(e) => setSite(i, 'longitude', e.target.value)} data-testid={`wz-site-lng-${i}`} /></Field>
                <Field label={t('site.radius')} name={`s${i}r`}><input type="number" min="10" max="50000" value={s.geofenceRadiusM} onChange={(e) => setSite(i, 'geofenceRadiusM', e.target.value)} data-testid={`wz-site-radius-${i}`} /></Field>
              </>)}
              {f.sites.length > 1 && <button type="button" className="btn btn-small" onClick={() => setF({ ...f, sites: f.sites.filter((_, j) => j !== i) })} aria-label={t('act.remove')}>✕</button>}
            </div>))}
          <button type="button" className="btn" onClick={() => setF({ ...f, sites: [...f.sites, blankSite(f.sites.length)] })} data-testid="wz-site-add">{t('wiz.addSite')}</button>
        </>)}
        {step === 3 && (<>
          <p className="small muted">{t('wiz.teamHelp')}</p>
          <LookupField id="wz-pm" label={t('f.pm')} lookup="proj/people" valueKey="code" value={f.team.pmUser} onChange={(v) => set('team', 'pmUser', v)} required />
          <LookupField id="wz-director" label={t('f.director')} lookup="proj/people" valueKey="code" value={f.team.directorUser} onChange={(v) => set('team', 'directorUser', v)} required />
        </>)}
        {step === 4 && (<>
          <fieldset><legend>{t('wiz.numbering')}</legend>
            {o.numbering.length === 0 && <p className="muted">{t('wiz.noTemplates')}</p>}
            {o.numbering.map((n) => <label key={n.code} className="check" style={{ display: 'block' }}><input type="checkbox" checked={(f.numbering ?? []).includes(n.code)} onChange={(e) => { setTouched(true); setF({ ...f, numbering: e.target.checked ? [...(f.numbering ?? []), n.code] : (f.numbering ?? []).filter((c) => c !== n.code) }); }} data-testid={`wz-num-${n.code}`} /> {n.name} <span className="muted small">({n.docType}, {n.format})</span></label>)}
          </fieldset>
          <Field label={t('wiz.folders')} name="folderTemplate" error={error}><select value={f.folderTemplate ?? ''} onChange={(e) => { setTouched(true); setF({ ...f, folderTemplate: e.target.value || null }); }} data-testid="wz-folders"><option value="">{t('wiz.noFolders')}</option>{o.folderTemplates.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
        </>)}
        {step === 5 && (<>
          <h3>{t('wiz.settings')}</h3>
          {f.settings && (<>
            <Field label={t('set.calendar')} name="calendar"><select value={f.settings.calendar} onChange={(e) => { setTouched(true); setF({ ...f, settings: { ...f.settings, calendar: e.target.value, workingDays: e.target.value === 'FIVE_DAY' ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6] } }); }} data-testid="wz-calendar"><option value="STANDARD_6DAY">{t('cal.STANDARD_6DAY')}</option><option value="FIVE_DAY">{t('cal.FIVE_DAY')}</option></select></Field>
            <Field label={t('set.units')} name="units"><select value={f.settings.units} onChange={(e) => { setTouched(true); setF({ ...f, settings: { ...f.settings, units: e.target.value } }); }}><option value="METRIC">{t('units.METRIC')}</option><option value="IMPERIAL">{t('units.IMPERIAL')}</option></select></Field>
            <label className="check"><input type="checkbox" checked={Boolean(f.settings.budgetRequired)} onChange={(e) => { setTouched(true); setF({ ...f, settings: { ...f.settings, budgetRequired: e.target.checked } }); }} data-testid="wz-budget" /> {t('set.budgetRequired')}</label>{' '}
            <label className="check"><input type="checkbox" checked={Boolean(f.settings.planningRequired)} onChange={(e) => { setTouched(true); setF({ ...f, settings: { ...f.settings, planningRequired: e.target.checked } }); }} /> {t('set.planningRequired')}</label>
          </>)}
          <h3>{t('wiz.milestones')}</h3>
          {f.milestones.map((m, i) => (
            <div key={i} className="mdm-panel mdm-fields" data-testid={`wz-ms-${i}`}>
              <Field label={t('ms.code')} name={`m${i}c`}><input value={m.code} onChange={(e) => setMs(i, 'code', e.target.value)} data-testid={`wz-ms-code-${i}`} /></Field>
              <Field label={t('ms.name')} name={`m${i}n`}><input value={m.name} onChange={(e) => setMs(i, 'name', e.target.value)} data-testid={`wz-ms-name-${i}`} /></Field>
              <Field label={t('ms.planned')} name={`m${i}d`}><input type="date" value={m.plannedDate} onChange={(e) => setMs(i, 'plannedDate', e.target.value)} data-testid={`wz-ms-date-${i}`} /></Field>
              <label className="check"><input type="checkbox" checked={Boolean(m.contractual)} onChange={(e) => setMs(i, 'contractual', e.target.checked)} data-testid={`wz-ms-contractual-${i}`} /> {t('ms.contractual')}</label>{' '}
              <label className="check"><input type="checkbox" checked={Boolean(m.paymentLinked)} onChange={(e) => setMs(i, 'paymentLinked', e.target.checked)} /> {t('ms.paymentLinked')}</label>
              <button type="button" className="btn btn-small" onClick={() => setF({ ...f, milestones: f.milestones.filter((_, j) => j !== i) })} aria-label={t('act.remove')}>✕</button>
            </div>))}
          <button type="button" className="btn" onClick={() => setF({ ...f, milestones: [...f.milestones, { code: '', name: '', plannedDate: '', contractual: false, paymentLinked: false }] })} data-testid="wz-ms-add">{t('wiz.addMilestone')}</button>
        </>)}
        {step === 6 && (<>
          <dl className="op-figures" data-testid="wiz-review">
            <div><dt>{t('f.code')}</dt><dd>{f.basics.code} · {f.basics.name}</dd></div><div><dt>{t('f.contractValue')}</dt><dd>{inr(f.contract.contractValue || 0)}</dd></div>
            <div><dt>{t('wiz.period')}</dt><dd>{f.contract.startDate || '–'} → {f.contract.scheduledCompletion || '–'}</dd></div><div><dt>{t('tab.sites')}</dt><dd>{f.sites.map((s) => s.code).join(', ')}</dd></div>
            <div><dt>{t('f.pm')}</dt><dd>{f.team.pmUser || '–'}</dd></div><div><dt>{t('f.director')}</dt><dd>{f.team.directorUser || '–'}</dd></div>
            <div><dt>{t('wiz.numbering')}</dt><dd>{(f.numbering ?? []).length}</dd></div><div><dt>{t('tab.milestones')}</dt><dd>{f.milestones.length}</dd></div>
          </dl>
          {all.length > 0 && <ul className="field-error" data-testid="wiz-problems">{all.map((x) => <li key={x}>{x}</li>)}</ul>}
          <fieldset><legend>{t('wiz.activateChecklist')}</legend>
            {checklist.map((c, i) => <label key={c} className="check" style={{ display: 'block' }}><input type="checkbox" checked={f.ticked.includes(i)} onChange={(e) => setF({ ...f, ticked: e.target.checked ? [...f.ticked, i] : f.ticked.filter((x) => x !== i) })} data-testid={`wz-tick-${i}`} /> {c}</label>)}
          </fieldset>
        </>)}
        {here.length > 0 && touched && <ul className="field-error small" data-testid="wiz-step-problems">{here.map((x) => <li key={x}>{x}</li>)}</ul>}
        <div className="actions">
          <button type="button" className="btn" onClick={() => (step === 0 ? navigateTo('/proj/projects') : setStep(step - 1))} data-testid="wiz-back">{step === 0 ? t('act.close') : t('wiz.back')}</button>
          {step < STEPS.length - 1 && <button type="submit" className="btn btn-primary" disabled={here.length > 0} data-testid="wiz-next">{t('wiz.next')}</button>}
          {step === STEPS.length - 1 && <button type="button" className="btn" disabled={busy || all.length > 0} onClick={() => make(false)} data-testid="wiz-draft">{t('wiz.saveDraft')}</button>}
          {step === STEPS.length - 1 && <button type="button" className="btn btn-primary" disabled={busy || all.length > 0 || !tickAll} onClick={() => make(true)} data-testid="wiz-send">{t('wiz.makeAndSend')}</button>}
        </div>
      </form>
      <p className="small"><Link to="/proj/projects">{t('list.title')}</Link></p>
    </section>
  );
}
