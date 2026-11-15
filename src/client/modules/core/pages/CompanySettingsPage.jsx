import { useEffect, useState } from 'react';
import { useCompanySettings, useSaveCompanySettings } from '../api/index.js';
import { GST_STATES } from '../../../../shared/gst.js';
import { Field, QueryState, can, errorInfo, usePageTitle } from './ui.jsx';
import PageHeader from '../../../platform/design/PageHeader.jsx';

const DATE_FORMATS = ['DD-MMM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function CompanySettingsPage({ session }) {
  usePageTitle('Company Settings');
  const query = useCompanySettings();
  const save = useSaveCompanySettings();
  const editable = can(session, 'core.settings.configure');
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (query.data) setForm({ ...query.data, address: { ...query.data.address }, gstins: query.data.gstins.map((g) => ({ ...g })), reason: '' });
  }, [query.data]);

  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));
  const setAddress = (name) => (e) => setForm((f) => ({ ...f, address: { ...f.address, [name]: e.target.value } }));
  const setGstin = (i, name) => (e) => setForm((f) => ({ ...f, gstins: f.gstins.map((g, j) => (j === i ? { ...g, [name]: e.target.value } : g)) }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice('');
    const body = {
      legalName: form.legalName,
      tradeName: form.tradeName || null,
      address: form.address,
      pan: form.pan || null,
      cin: form.cin || null,
      gstins: form.gstins.filter((g) => g.gstin || g.stateCode),
      currency: form.currency,
      timezone: form.timezone,
      dateFormat: form.dateFormat,
      numberFormat: form.numberFormat,
      fyStartMonth: Number(form.fyStartMonth),
      reason: form.reason,
      ...(query.data.persisted ? { version: query.data.version } : {}),
    };
    try {
      await save.mutateAsync(body);
      setNotice('Saved. The change is in the audit trail.');
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Configuration &rsaquo; Company Settings</nav>
      <PageHeader id="page-title" title={"Company Settings"} subtitle={"Legal identity, tax registrations and display formats for this company. Only the System Administrator can change them; every change needs a reason and is audited."} />
      <QueryState query={query} what="company settings" permission="core.settings.view" />
      {form && (
        <form onSubmit={submit} className="form-grid" aria-label="Company settings">
          <fieldset disabled={!editable}>
            <legend>Identity</legend>
            <Field label="Legal name" name="legalName" error={error}><input value={form.legalName} onChange={set('legalName')} required minLength={2} /></Field>
            <Field label="Trade name" name="tradeName" error={error}><input value={form.tradeName ?? ''} onChange={set('tradeName')} /></Field>
            <Field label="PAN" name="pan" error={error} hint="10 characters, for example AAPCS1234F"><input value={form.pan ?? ''} onChange={set('pan')} maxLength={10} autoCapitalize="characters" /></Field>
            <Field label="CIN" name="cin" error={error} hint="21 characters, for example U45200MH2010PTC123456"><input value={form.cin ?? ''} onChange={set('cin')} maxLength={21} autoCapitalize="characters" /></Field>
          </fieldset>

          <fieldset disabled={!editable}>
            <legend>Registered address</legend>
            <Field label="Address line 1" name="address.line1" error={error}><input value={form.address.line1 ?? ''} onChange={setAddress('line1')} /></Field>
            <Field label="Address line 2" name="address.line2" error={error}><input value={form.address.line2 ?? ''} onChange={setAddress('line2')} /></Field>
            <Field label="City" name="address.city" error={error}><input value={form.address.city ?? ''} onChange={setAddress('city')} /></Field>
            <Field label="State" name="address.stateCode" error={error}>
              <select value={form.address.stateCode ?? ''} onChange={setAddress('stateCode')}>
                <option value="">Select a state</option>
                {GST_STATES.map((s) => <option key={s.code} value={s.code}>{s.code} - {s.name}</option>)}
              </select>
            </Field>
            <Field label="PIN code" name="address.pincode" error={error}><input value={form.address.pincode ?? ''} onChange={setAddress('pincode')} inputMode="numeric" maxLength={6} /></Field>
          </fieldset>

          <fieldset disabled={!editable}>
            <legend>GST registrations</legend>
            {form.gstins.length === 0 && <p className="muted">No GSTIN added yet.</p>}
            {form.gstins.map((g, i) => (
              <div className="row" key={i}>
                <Field label={`State of GSTIN ${i + 1}`} name={`gstins.${i}.stateCode`} error={error}>
                  <select value={g.stateCode} onChange={setGstin(i, 'stateCode')}>
                    <option value="">Select</option>
                    {GST_STATES.map((s) => <option key={s.code} value={s.code}>{s.code} - {s.name}</option>)}
                  </select>
                </Field>
                <Field label={`GSTIN ${i + 1}`} name={`gstins.${i}.gstin`} error={error}>
                  <input value={g.gstin} onChange={setGstin(i, 'gstin')} maxLength={15} autoCapitalize="characters" />
                </Field>
                <button type="button" className="btn" onClick={() => setForm((f) => ({ ...f, gstins: f.gstins.filter((_, j) => j !== i) }))}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn" onClick={() => setForm((f) => ({ ...f, gstins: [...f.gstins, { stateCode: '', gstin: '' }] }))}>Add GSTIN</button>
          </fieldset>

          <fieldset disabled={!editable}>
            <legend>Formats</legend>
            <Field label="Currency" name="currency" error={error}><input value={form.currency} onChange={set('currency')} maxLength={3} /></Field>
            <Field label="Time zone" name="timezone" error={error}><input value={form.timezone} onChange={set('timezone')} /></Field>
            <Field label="Date format" name="dateFormat" error={error}>
              <select value={form.dateFormat} onChange={set('dateFormat')}>{DATE_FORMATS.map((f) => <option key={f}>{f}</option>)}</select>
            </Field>
            <Field label="Number format" name="numberFormat" error={error}>
              <select value={form.numberFormat} onChange={set('numberFormat')}>
                <option value="indian">Indian (12,34,567.00)</option>
                <option value="international">International (1,234,567.00)</option>
              </select>
            </Field>
            <Field label="Financial year starts in" name="fyStartMonth" error={error}>
              <select value={form.fyStartMonth} onChange={set('fyStartMonth')}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            </Field>
          </fieldset>

          {editable && (
            <>
              <Field label="Reason for this change (required, min 5 characters)" name="reason" error={error}>
                <textarea value={form.reason} onChange={set('reason')} rows="2" required minLength={5} maxLength={500} />
              </Field>
              {error?.form && (
                <p className="field-error" role="alert">
                  {error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}
                </p>
              )}
              <div className="actions"><button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving...' : 'Save settings'}</button></div>
            </>
          )}
          {!editable && <p className="muted">Your role can read these settings but not change them.</p>}
          <p role="status" className="notice">{notice}</p>
        </form>
      )}
    </section>
  );
}
