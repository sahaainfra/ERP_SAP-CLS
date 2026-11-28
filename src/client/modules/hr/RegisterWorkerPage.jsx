import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { IdField } from '../../platform/forms/IdField.jsx';
import { useFeatureFlag } from '../core/api/index.js';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { SKILL_LABELS, dayIST, lab } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Register Worker (HR, part 07.08, FR-02): for the supervisor or the subcontractor coordinator, on a phone or a computer: name, date of birth (nobody under 18 is registered: the page says so as soon as the date is typed), ID number
// (only its last four digits are kept), mobile, contractor, trade and skill, home state, and the numbers of the statutory registrations. It is sent for approval: supervisor, then the HR manager (KYC). A draft or returned
// registration opened with ?id= is corrected here; the photo is added on the worker page.
const blank = () => ({ name: '', dob: '', gender: 'MALE', aadhaar: '', mobile: '', homeState: '', tradeCode: 'HELPER', skillCategory: 'UNSKILLED', contractorId: '', bankAccount: '', ifsc: '', uan: '', esicIp: '', bocwNo: '', emergencyName: '', emergencyMobile: '' });
const ageOf = (dob) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null; const t = dayIST(0); let a = Number(t.slice(0, 4)) - Number(dob.slice(0, 4)); if (t.slice(5) < dob.slice(5)) a -= 1; return a; };
export default function RegisterWorkerPage() {
  const editId = Number(new URLSearchParams(window.location.search).get('id')) || null;
  usePageTitle(editId ? 'Worker (correct)' : 'Register Worker');
  const existing = useQuery({ queryKey: ['lab', 'worker', editId], queryFn: () => lab.workers.get(editId), enabled: Boolean(editId), retry: false });
  const trades = useQuery({ queryKey: ['lab', 'trades'], queryFn: lab.trades, retry: false });
  const ids = useFeatureFlag('ff.forms.pack09'); // PACK-09: the shared Indian identifier fields (same checks as the server)
  const [v, setV] = useState(blank);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  useEffect(() => { const w = existing.data; if (!w) return; setV({ ...blank(), name: w.name, dob: w.dob ?? '', gender: w.gender, mobile: '', homeState: w.homeState ?? '', tradeCode: w.tradeCode, skillCategory: w.skillCategory, contractorId: w.contractorId, bocwNo: w.bocwNo ?? '' }); }, [existing.data]);
  if (editId && existing.isPending) return <Skeleton label="Loading the worker" rows={4} />;
  if (editId && existing.isError) return <ErrorState error={existing.error} onRetry={existing.refetch} />;
  const age = ageOf(v.dob); const under = age != null && age < 18;
  const text = (k) => v[k].trim() || null;
  const body = () => ({ name: v.name.trim(), photoFileId: existing.data?.photoFileId ?? null, aadhaar: text('aadhaar'), mobile: text('mobile'), dob: v.dob, gender: v.gender, homeState: text('homeState'), tradeCode: v.tradeCode, skillCategory: v.skillCategory, contractorId: Number(v.contractorId) || null, bankAccount: text('bankAccount'), ifsc: text('ifsc'), uan: text('uan'), esicIp: text('esicIp'), bocwNo: text('bocwNo'), emergencyName: text('emergencyName'), emergencyMobile: text('emergencyMobile') });
  const save = async (submit) => {
    setBusy(true); setError(null);
    try {
      const out = editId ? await lab.workers.update(editId, { ...body(), version: existing.data.rowVersion }) : await lab.workers.create({ ...body(), submit });
      if (editId && submit) await lab.workers.submit(editId);
      navigateTo(`/labour/workers/worker?id=${out.id}${submit ? '&sent=1' : ''}`, { force: true });
    } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  const fe = (k) => error?.fields?.[k];
  return (
    <section aria-labelledby="rw-title" data-testid="register-worker">
      <p><Link to="/labour/workers">← Workers Register</Link></p>
      <PageHeader id="rw-title" title={editId ? `Worker ${existing.data?.workerCode}` : 'Register Worker'} />
      {error?.form && <p className="field-error" role="alert" data-testid="rw-error">{error.form}{error.fields ? ` ${Object.entries(error.fields).map(([k, x]) => `${k}: ${x}`).join('; ')}` : ''}</p>}
      <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <Field label="Name" name="name" error={error}><input value={v.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} data-testid="rw-name" autoComplete="off" /></Field>
        <Field label="Date of birth" name="dob" error={error}><input type="date" value={v.dob} max={dayIST(0)} onChange={(e) => set({ dob: e.target.value })} data-testid="rw-dob" /></Field>
        {age != null && <p className={under ? 'field-error' : 'muted'} role={under ? 'alert' : 'status'} data-testid="rw-age">{under ? `${age} years: nobody under 18 is registered (child labour is prohibited).` : `${age} years`}</p>}
        <Field label="Gender" name="gender" error={error}><select value={v.gender} onChange={(e) => set({ gender: e.target.value })} data-testid="rw-gender"><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></select></Field>
        {ids ? <IdField id="rw-aadhaar" kind="aadhaar" label={editId ? 'ID number (Aadhaar), only if it changes' : 'ID number (Aadhaar)'} value={v.aadhaar} onChange={(x) => set({ aadhaar: x })} error={fe('aadhaar')} />
          : <Field label={editId ? 'ID number (Aadhaar), only if it changes' : 'ID number (Aadhaar)'} name="aadhaar" error={error}><input inputMode="numeric" maxLength={12} value={v.aadhaar} onChange={(e) => set({ aadhaar: e.target.value.replace(/\D/g, '') })} data-testid="rw-aadhaar" autoComplete="off" /></Field>}
        {ids ? <IdField id="rw-mobile" kind="mobile" label={'Mobile'} value={v.mobile} onChange={(x) => set({ mobile: x })} error={fe('mobile')} />
          : <Field label="Mobile" name="mobile" error={error}><input inputMode="numeric" maxLength={10} value={v.mobile} onChange={(e) => set({ mobile: e.target.value.replace(/\D/g, '') })} data-testid="rw-mobile" /></Field>}
        <LookupField id="rw-contractor" label="Labour contractor" lookup="mdm/labour-contractors" value={v.contractorId} onChange={(x) => set({ contractorId: x })} error={fe('contractorId')} required />
        <Field label="Trade" name="tradeCode" error={error}><select value={v.tradeCode} onChange={(e) => set({ tradeCode: e.target.value })} data-testid="rw-trade">{(trades.data ?? [v.tradeCode]).map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</option>)}</select></Field>
        <Field label="Skill" name="skillCategory" error={error}><select value={v.skillCategory} onChange={(e) => set({ skillCategory: e.target.value })} data-testid="rw-skill">{Object.entries(SKILL_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Home state" name="homeState" error={error}><input value={v.homeState} maxLength={40} onChange={(e) => set({ homeState: e.target.value })} data-testid="rw-state" /></Field>
        <Field label="BOCW registration number" name="bocwNo" error={error}><input value={v.bocwNo} maxLength={40} onChange={(e) => set({ bocwNo: e.target.value })} /></Field>
        {ids ? <IdField id="rw-uan" kind="uan" label={'UAN (if any)'} value={v.uan} onChange={(x) => set({ uan: x })} error={fe('uan')} />
          : <Field label="UAN (if any)" name="uan" error={error}><input inputMode="numeric" maxLength={12} value={v.uan} onChange={(e) => set({ uan: e.target.value.replace(/\D/g, '') })} /></Field>}
        <Field label="ESIC number (if any)" name="esicIp" error={error}><input inputMode="numeric" maxLength={17} value={v.esicIp} onChange={(e) => set({ esicIp: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Bank account (optional)" name="bankAccount" error={error}><input inputMode="numeric" maxLength={18} value={v.bankAccount} onChange={(e) => set({ bankAccount: e.target.value.replace(/\D/g, '') })} autoComplete="off" /></Field>
        {ids ? <IdField id="rw-ifsc" kind="ifsc" label={'IFSC (with the account)'} value={v.ifsc} onChange={(x) => set({ ifsc: x })} error={fe('ifsc')} />
          : <Field label="IFSC (with the account)" name="ifsc" error={error}><input value={v.ifsc} maxLength={11} onChange={(e) => set({ ifsc: e.target.value.toUpperCase() })} /></Field>}
        <Field label="Emergency contact" name="emergencyName" error={error}><input value={v.emergencyName} maxLength={100} onChange={(e) => set({ emergencyName: e.target.value })} /></Field>
        {ids ? <IdField id="rw-emergencyMobile" kind="mobile" label={'Emergency mobile'} value={v.emergencyMobile} onChange={(x) => set({ emergencyMobile: x })} error={fe('emergencyMobile')} />
          : <Field label="Emergency mobile" name="emergencyMobile" error={error}><input inputMode="numeric" maxLength={10} value={v.emergencyMobile} onChange={(e) => set({ emergencyMobile: e.target.value.replace(/\D/g, '') })} /></Field>}
      </form>
      <div className="actions">
        <button type="button" className="btn" onClick={() => navigateTo('/labour/workers')}>Cancel</button>
        <button type="button" className="btn" disabled={busy || under} onClick={() => save(false)} data-testid="rw-save">Save draft</button>
        <button type="button" className="btn btn-primary" disabled={busy || under} onClick={() => save(true)} data-testid="rw-send">{busy ? 'Saving...' : 'Send for approval'}</button>
      </div>
    </section>
  );
}
