import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { CONSTITUTIONS, PARTNER_ROLES, mdm, partners } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Partner Registration (Administration, part 06.04): a wizard. 1 Identity and roles (legal and trade name, constitution, PAN, MSME, CIN), with the partners that look like it found as it is typed (FR-07);
// 2 GST registrations per state and addresses; 3 contacts (a bank change is later confirmed with them); 4 bank account (IFSC checked, the bank found in the 06.02 list) and TDS; 5 review. "Save as prospect"
// keeps it to finish later; "Send for approval" goes to the steward of its roles and then the accounts manager. A prospect opened with ?id= is edited and sent from here. The draft is kept in this browser.
const STEPS = ['Identity and roles', 'GST and addresses', 'Contacts', 'Bank and TDS', 'Review'];
const DRAFT = 'erp.mdm.partner-draft';
const blank = () => ({ legalName: '', tradeName: '', constitution: '', pan: '', msmeNo: '', msmeCategory: '', cin: '', roles: [], categories: '', regions: '', gstins: [], addresses: [{ addressType: 'REGISTERED', address: '', city: '', stateCode: '', pin: '' }], contacts: [{ name: '', designation: '', email: '', mobile: '', isPrimary: true }], bank: { accountNo: '', ifsc: '', accountName: '' }, tds: [] });
export default function PartnerRegistrationPage() {
  const editId = Number(new URLSearchParams(window.location.search).get('id')) || null;
  usePageTitle(editId ? 'Partner Registration (edit)' : 'Partner Registration');
  const states = useQuery({ queryKey: ['mdm', 'common', 'states', 'all'], queryFn: () => mdm.common('states', { limit: 100, offset: 0 }), retry: false, staleTime: 300_000 });
  const sections = useQuery({ queryKey: ['mdm', 'common', 'tds', 'all'], queryFn: () => mdm.common('tds-sections', { limit: 100, offset: 0 }), retry: false, staleTime: 300_000 });
  const existing = useQuery({ queryKey: ['mdm', 'partner', editId], queryFn: () => partners.get(editId), enabled: Boolean(editId), retry: false });
  const [step, setStep] = useState(0);
  const [v, setV] = useState(() => { if (editId) return blank(); try { return JSON.parse(localStorage.getItem(DRAFT) ?? 'null') ?? blank(); } catch { return blank(); } });
  const [dups, setDups] = useState([]);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!editId) try { localStorage.setItem(DRAFT, JSON.stringify(v)); } catch { /* storage off */ } }, [v, editId]);
  useEffect(() => {
    const p = existing.data; if (!p) return;
    setV({ legalName: p.legalName, tradeName: p.tradeName ?? '', constitution: p.constitution, pan: p.pan ?? '', msmeNo: p.msmeNo ?? '', msmeCategory: p.msmeCategory ?? '', cin: p.cin ?? '', roles: p.roles, categories: p.categories.join(', '), regions: p.regions.join(', '),
      gstins: p.gstins.map((g) => ({ stateCode: g.stateCode, gstin: g.gstin })), addresses: p.addresses.map((a) => ({ addressType: a.type, address: a.address, city: a.city ?? '', stateCode: a.stateCode, pin: a.pin ?? '' })), contacts: p.contacts.map((c) => ({ name: c.name, designation: c.designation ?? '', email: c.email ?? '', mobile: c.mobile ?? '', isPrimary: c.isPrimary })),
      bank: { accountNo: '', ifsc: '', accountName: '' }, tds: p.tds.map((t) => ({ section: t.section, ldcNo: t.ldcNo ?? '', ldcRate: t.ldcRate ?? '', ldcLimit: t.ldcLimit ?? '', validFrom: t.validFrom ?? '', validUntil: t.validUntil ?? '' })) });
  }, [existing.data]);
  const body = () => ({
    legalName: v.legalName, tradeName: v.tradeName || null, constitution: v.constitution, pan: v.pan || null, msmeNo: v.msmeNo || null, msmeCategory: v.msmeCategory || null, cin: v.cin || null, roles: v.roles,
    categories: v.categories.split(',').map((x) => x.trim()).filter(Boolean), regions: v.regions.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean),
    gstins: v.gstins.filter((g) => g.gstin), addresses: v.addresses.filter((a) => a.address).map((a) => ({ ...a, city: a.city || null, pin: a.pin || null })), contacts: v.contacts.filter((c) => c.name).map((c) => ({ ...c, designation: c.designation || null, email: c.email || null, mobile: c.mobile || null })),
    bank: v.bank.accountNo ? v.bank : null, tds: v.tds.filter((t) => t.section).map((t) => ({ section: t.section, ldcNo: t.ldcNo || null, ldcRate: t.ldcRate || null, ldcLimit: t.ldcLimit || null, validFrom: t.validFrom || null, validUntil: t.validUntil || null })),
  });
  // the duplicate check as the identity is typed
  useEffect(() => { if (!v.legalName && !v.pan) return undefined; const t = setTimeout(async () => { try { const c = await partners.check({ legalName: v.legalName, pan: v.pan || null, roles: v.roles, constitution: v.constitution || 'OTHER', gstins: v.gstins.filter((g) => g.gstin), contacts: v.contacts.filter((c) => c.mobile).map((c) => ({ name: c.name || 'x x', mobile: c.mobile })), ...(v.bank.accountNo ? { bank: v.bank } : {}), ...(editId ? { partnerId: editId } : {}) }); setDups(c.duplicates); } catch { /* checked again on save */ } }, 400); return () => clearTimeout(t); }, [v.legalName, v.pan, v.gstins, v.contacts, v.bank, v.roles, v.constitution, editId]);
  if (editId && existing.isPending) return <Skeleton label="Loading the partner" rows={4} />;
  if (editId && existing.isError) return <ErrorState error={existing.error} onRetry={existing.refetch} />;
  const set = (p) => setV((cur) => ({ ...cur, ...p }));
  const setIn = (list, i, p) => set({ [list]: v[list].map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const fe = (k) => error?.fields?.[k];
  const next = () => {
    setError(null);
    if (step === 0) { const f = {}; if (!v.legalName.trim()) f.legalName = 'required'; if (!v.constitution) f.constitution = 'required'; if (!v.roles.length) f.roles = 'required'; if (Object.keys(f).length) { setError({ form: 'Fill in the legal name, constitution and at least one role.', fields: f }); return; } }
    if (step === 1 && !v.addresses.some((a) => a.addressType === 'REGISTERED' && a.address && a.stateCode)) { setError({ form: 'Give the registered address and its state.', fields: { addresses: 'required' } }); return; }
    if (step === 2 && !v.contacts.some((c) => c.name)) { setError({ form: 'Give at least one contact: a bank change is confirmed with them.', fields: { contacts: 'required' } }); return; }
    setStep(step + 1);
  };
  const save = async (submit) => {
    setBusy(true); setError(null);
    try {
      const out = editId ? await partners.update(editId, { ...body(), version: existing.data.rowVersion, ...(submit ? {} : {}) }) : await partners.create({ ...body(), acknowledgeDuplicates: ack, submit });
      if (editId && submit && existing.data.status === 'PROSPECT') await partners.submit(editId);
      try { localStorage.removeItem(DRAFT); } catch { /* storage off */ }
      navigateTo(`/admin/partners/partner?id=${out.id}${submit ? '&sent=1' : '&saved=1'}`, { force: true });
    } catch (e) { setError(e.code?.startsWith('DUPLICATE') ? { ...errorInfo(e), form: e.message } : errorInfo(e)); } finally { setBusy(false); }
  };
  const stateOpts = (states.data?.rows ?? []).map((s) => <option key={s.id} value={s.code}>{s.name} ({s.gstCode})</option>);
  return (
    <section aria-labelledby="pr-title" data-testid="partner-registration">
      <PageHeader id="pr-title" title={editId ? `Partner Registration: ${existing.data?.code}` : 'Partner Registration'} />
      <ol className="wizard-steps" aria-label="Steps">{STEPS.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={i === step ? 'is-current' : i < step ? 'is-done' : ''}><button type="button" className="btn btn-small" onClick={() => setStep(i)} disabled={i > step}>{i + 1}. {s}</button></li>)}</ol>
      {dups.length > 0 && <div className="mdm-check" role="status" data-testid="pr-duplicates"><p><strong>{dups.some((d) => d.block) ? 'Already registered:' : 'This looks like:'}</strong></p><ul>{dups.map((d) => <li key={`${d.id}${d.rule}`} className={d.block ? 'field-error' : ''}><a href={`/admin/partners/partner?id=${d.id}`} onClick={(e) => { e.preventDefault(); navigateTo(`/admin/partners/partner?id=${d.id}`); }}>{d.code} {d.name}</a> · {d.rule}</li>)}</ul></div>}
      {error?.form && <p className="field-error" role="alert" data-testid="pr-error">{error.form}{error.fields && Object.values(error.fields).some((x) => x && x !== 'required') ? ` ${Object.entries(error.fields).filter(([, x]) => x && x !== 'required').map(([k, x]) => `${k}: ${x}`).join('; ')}` : ''}</p>}
      {step === 0 && (
        <fieldset className="mdm-fields"><legend>Identity and roles</legend>
          <Field label="Legal name (required)" name="legalName" error={error}><input value={v.legalName} maxLength={160} onChange={(e) => set({ legalName: e.target.value })} aria-invalid={Boolean(fe('legalName'))} data-testid="pr-legal" /></Field>
          <Field label="Trade name" name="tradeName" error={error}><input value={v.tradeName} maxLength={160} onChange={(e) => set({ tradeName: e.target.value })} /></Field>
          <Field label="Constitution (required)" name="constitution" error={error}><select value={v.constitution} onChange={(e) => set({ constitution: e.target.value })} data-testid="pr-constitution"><option value="">Choose</option>{CONSTITUTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="PAN (required unless a government body)" name="pan" error={error} hint="Five letters, four digits, a letter"><input value={v.pan} maxLength={10} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} autoComplete="off" data-testid="pr-pan" /></Field>
          <Field label="Udyam number" name="msmeNo" error={error} hint="UDYAM-MH-26-0012345"><input value={v.msmeNo} maxLength={19} onChange={(e) => set({ msmeNo: e.target.value.toUpperCase() })} /></Field>
          <Field label="MSME category" name="msmeCategory" error={error}><select value={v.msmeCategory} onChange={(e) => set({ msmeCategory: e.target.value })}><option value="">Not MSME</option><option value="MICRO">Micro</option><option value="SMALL">Small</option><option value="MEDIUM">Medium</option></select></Field>
          {['PRIVATE_LIMITED', 'PUBLIC_LIMITED'].includes(v.constitution) && <Field label="CIN" name="cin" error={error}><input value={v.cin} maxLength={21} onChange={(e) => set({ cin: e.target.value.toUpperCase() })} /></Field>}
          <fieldset><legend>Roles (required)</legend><div className="actions-row">{PARTNER_ROLES.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={v.roles.includes(k)} onChange={(e) => set({ roles: e.target.checked ? [...v.roles, k] : v.roles.filter((x) => x !== k) })} data-testid={`pr-role-${k}`} /> {l}</label>)}</div></fieldset>
          <Field label="Categories supplied (codes, comma separated)" name="categories" error={error} hint="Item categories or trades, for example STEEL, CEMENT, MASON"><input value={v.categories} onChange={(e) => set({ categories: e.target.value })} /></Field>
          <Field label="Regions served (state codes)" name="regions" error={error} hint="For example MH, GJ"><input value={v.regions} onChange={(e) => set({ regions: e.target.value })} /></Field>
        </fieldset>
      )}
      {step === 1 && (
        <fieldset><legend>GST registrations and addresses</legend>
          {v.gstins.map((g, i) => <div key={i} className="actions-row" data-testid="pr-gstin-row"><Field label="State" name={`gstins.${i}.stateCode`} error={error}><select value={g.stateCode} onChange={(e) => setIn('gstins', i, { stateCode: e.target.value })} data-testid="pr-gst-state"><option value="">Choose</option>{stateOpts}</select></Field><Field label="GSTIN" name={`gstins.${i}.gstin`} error={error}><input value={g.gstin} maxLength={15} onChange={(e) => setIn('gstins', i, { gstin: e.target.value.toUpperCase() })} data-testid="pr-gstin" /></Field><button type="button" className="btn btn-small" onClick={() => set({ gstins: v.gstins.filter((_, j) => j !== i) })}>Remove</button></div>)}
          <button type="button" className="btn btn-small" onClick={() => set({ gstins: [...v.gstins, { stateCode: '', gstin: '' }] })} data-testid="pr-add-gstin">Add a GST registration</button>
          {v.addresses.map((a, i) => <div key={i} className="mdm-fields mdm-card" data-testid="pr-address"><Field label="Kind" name={`addresses.${i}.addressType`} error={error}><select value={a.addressType} onChange={(e) => setIn('addresses', i, { addressType: e.target.value })}>{['REGISTERED', 'BILLING', 'SHIPPING', 'SITE', 'OTHER'].map((k) => <option key={k} value={k}>{k.toLowerCase()}</option>)}</select></Field>
            <Field label="Address" name={`addresses.${i}.address`} error={error}><input value={a.address} maxLength={300} onChange={(e) => setIn('addresses', i, { address: e.target.value })} data-testid="pr-addr" /></Field><Field label="City" name={`addresses.${i}.city`} error={error}><input value={a.city} onChange={(e) => setIn('addresses', i, { city: e.target.value })} /></Field>
            <Field label="State" name={`addresses.${i}.stateCode`} error={error}><select value={a.stateCode} onChange={(e) => setIn('addresses', i, { stateCode: e.target.value })} data-testid="pr-addr-state"><option value="">Choose</option>{stateOpts}</select></Field><Field label="PIN code" name={`addresses.${i}.pin`} error={error}><input inputMode="numeric" value={a.pin} maxLength={6} onChange={(e) => setIn('addresses', i, { pin: e.target.value })} /></Field>
            {i > 0 && <button type="button" className="btn btn-small" onClick={() => set({ addresses: v.addresses.filter((_, j) => j !== i) })}>Remove</button>}</div>)}
          <button type="button" className="btn btn-small" onClick={() => set({ addresses: [...v.addresses, { addressType: 'BILLING', address: '', city: '', stateCode: '', pin: '' }] })}>Add an address</button>
        </fieldset>
      )}
      {step === 2 && (
        <fieldset><legend>Contacts</legend>
          {v.contacts.map((c, i) => <div key={i} className="mdm-fields mdm-card" data-testid="pr-contact"><Field label="Name" name={`contacts.${i}.name`} error={error}><input value={c.name} onChange={(e) => setIn('contacts', i, { name: e.target.value })} data-testid="pr-contact-name" /></Field><Field label="Designation" name={`contacts.${i}.designation`} error={error}><input value={c.designation} onChange={(e) => setIn('contacts', i, { designation: e.target.value })} /></Field>
            <Field label="Mobile" name={`contacts.${i}.mobile`} error={error}><input inputMode="tel" value={c.mobile} onChange={(e) => setIn('contacts', i, { mobile: e.target.value })} data-testid="pr-contact-mobile" /></Field><Field label="E-mail" name={`contacts.${i}.email`} error={error}><input type="email" value={c.email} onChange={(e) => setIn('contacts', i, { email: e.target.value })} /></Field>
            <label className="check"><input type="radio" name="primary" checked={c.isPrimary} onChange={() => set({ contacts: v.contacts.map((x, j) => ({ ...x, isPrimary: j === i })) })} /> Primary (receives the bank confirmation code)</label></div>)}
          <button type="button" className="btn btn-small" onClick={() => set({ contacts: [...v.contacts, { name: '', designation: '', email: '', mobile: '', isPrimary: false }] })}>Add a contact</button>
        </fieldset>
      )}
      {step === 3 && (
        <fieldset><legend>Bank account and TDS</legend>
          {editId ? <p className="muted">The bank account of a registered partner changes through a bank change request on its Partner 360 page.</p> : <div className="mdm-fields">
            <Field label="Account number" name="bank.accountNo" error={error}><input inputMode="numeric" value={v.bank.accountNo} autoComplete="off" onChange={(e) => set({ bank: { ...v.bank, accountNo: e.target.value } })} data-testid="pr-acct" /></Field>
            <Field label="IFSC" name="bank.ifsc" error={error} hint="Four letters, a zero and six letters or digits"><input value={v.bank.ifsc} maxLength={11} onChange={(e) => set({ bank: { ...v.bank, ifsc: e.target.value.toUpperCase() } })} data-testid="pr-ifsc" /></Field>
            <Field label="Name on the account" name="bank.accountName" error={error}><input value={v.bank.accountName} onChange={(e) => set({ bank: { ...v.bank, accountName: e.target.value } })} data-testid="pr-acct-name" /></Field></div>}
          {v.tds.map((t, i) => <div key={i} className="actions-row"><Field label="TDS section" name={`tds.${i}.section`} error={error}><select value={t.section} onChange={(e) => setIn('tds', i, { section: e.target.value })} data-testid="pr-tds"><option value="">Choose</option>{(sections.data?.rows ?? []).map((s) => <option key={s.id} value={s.section}>{s.section} {s.description}</option>)}</select></Field><button type="button" className="btn btn-small" onClick={() => set({ tds: v.tds.filter((_, j) => j !== i) })}>Remove</button></div>)}
          <button type="button" className="btn btn-small" onClick={() => set({ tds: [...v.tds, { section: '' }] })} data-testid="pr-add-tds">Add a TDS section</button>
          <p className="muted small">Lower-deduction certificates and compliance documents are added on the Partner 360 page after saving.</p>
        </fieldset>
      )}
      {step === 4 && (
        <div data-testid="pr-review"><dl className="kv-list">{[['Legal name', v.legalName], ['Trade name', v.tradeName], ['Constitution', CONSTITUTIONS.find(([k]) => k === v.constitution)?.[1]], ['PAN', v.pan], ['Roles', v.roles.map((r) => PARTNER_ROLES.find(([k]) => k === r)?.[1]).join(', ')], ['GSTINs', v.gstins.map((g) => `${g.stateCode} ${g.gstin}`).join(', ')], ['Registered address', v.addresses[0]?.address], ['Contacts', v.contacts.map((c) => c.name).join(', ')], ['Bank', v.bank.accountNo ? `account ending ${v.bank.accountNo.slice(-4)}, ${v.bank.ifsc}` : '—'], ['TDS', v.tds.map((t) => t.section).join(', ')]].map(([k, x]) => <div className="kv" key={k}><dt>{k}</dt><dd>{x || '—'}</dd></div>)}</dl>
          {!editId && dups.some((d) => !d.block) && <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="pr-ack" /> I checked: this is a different partner</label>}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={() => { if (window.confirm('Leave the registration? A new one is kept as a draft in this browser.')) navigateTo('/admin/partners'); }}>Cancel</button>
        {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 4 ? <button type="button" className="btn btn-primary" onClick={next} data-testid="pr-next">Next</button> : <>
          <button type="button" className="btn" disabled={busy} onClick={() => save(false)} data-testid="pr-save">Save as prospect</button>
          <button type="button" className="btn btn-primary" disabled={busy || dups.some((d) => d.block)} onClick={() => save(true)} data-testid="pr-send">{busy ? 'Saving...' : 'Send for approval'}</button></>}
      </div>
    </section>
  );
}
