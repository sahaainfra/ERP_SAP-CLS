import { useRef, useState } from 'react';
import { Card } from '../../platform/design/Card.jsx';

const CONSTITUTIONS = [
  ['PROPRIETORSHIP', 'Proprietorship'], ['PARTNERSHIP', 'Partnership'], ['LLP', 'Limited liability partnership'],
  ['PRIVATE_LIMITED', 'Private limited company'], ['PUBLIC_LIMITED', 'Public limited company'], ['TRUST', 'Trust'],
  ['SOCIETY', 'Society'], ['GOVERNMENT', 'Government body'], ['HUF', 'Hindu undivided family'],
  ['INDIVIDUAL', 'Individual'], ['OTHER', 'Other'],
];

function newReceipt() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export default function VendorRegistration({ api, t }) {
  const [status, setStatus] = useState(null);
  const [receipt, setReceipt] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const request = useRef(null);

  async function run(action) {
    setError(null);
    setPending(true);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    void run(async () => {
      if (status?.status === 'RETURNED') {
        const result = await api.post('/portal/registrations/revise', { ...data, version: status.version }, {
          headers: { Authorization: `Bearer ${receipt}` },
        });
        setStatus(result.data);
        return;
      }
      const serialized = JSON.stringify(data);
      if (request.current?.serialized !== serialized) request.current = { serialized, receipt: newReceipt() };
      const current = request.current;
      const result = await api.post('/portal/registrations', data, { headers: { 'Idempotency-Key': current.receipt } });
      setReceipt(current.receipt);
      setStatus(result.data);
      request.current = null;
    });
  }

  return <Card title={t('Vendor registration')}>
    {error && <div role="alert"><p>{error.message}{error.correlationId && <> · Reference {error.correlationId}</>}</p>
      {error.details?.length > 0 && <ul>{error.details.map(({ field, message }, i) => <li key={i}>{field} {message}</li>)}</ul>}
    </div>}
    {status && <div role="status">
      <p>{status.reference} · {status.status}</p>
      <p>Keep this access receipt private. You’ll need it to check your registration.</p>
      <output className="portal-reference">{receipt}</output>
    </div>}
    {(!status || status.status === 'RETURNED') && <form className="portal-form" onSubmit={submit}>
      <label>{t('ERP company code')}<input name="companyCode" required maxLength={40} /></label>
      <label>{t('Legal business name')}<input name="legalName" required minLength={3} maxLength={160} /></label>
      <label>{t('Constitution')}<select name="constitution">{CONSTITUTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>PAN<input name="pan" maxLength={10} autoComplete="off" /></label>
      <label>CIN, if applicable<input name="cin" maxLength={21} autoComplete="off" /></label>
      <label>{t('Contact name')}<input name="contactName" required minLength={2} maxLength={80} /></label>
      <label>{t('Contact email')}<input name="email" type="email" required maxLength={120} /></label>
      <label>{t('Registered address')}<textarea name="address" required minLength={5} maxLength={300} /></label>
      <label>{t('State code')}<input name="stateCode" required minLength={2} maxLength={3} /></label>
      <button className="btn btn-primary" disabled={pending}>{t(status ? 'Resubmit registration' : 'Submit for approval')}</button>
    </form>}
    <form className="portal-form" onSubmit={(event) => {
      event.preventDefault();
      const entered = new FormData(event.currentTarget).get('receipt').trim();
      void run(async () => {
        const result = await api.post('/portal/registrations/status', { receipt: entered });
        setReceipt(entered);
        setStatus(result.data);
      });
    }}>
      <label>{t('Registration access receipt')}<input name="receipt" required maxLength={43} autoComplete="off" defaultValue={receipt} key={receipt} /></label>
      <button type="submit" className="btn" disabled={pending}>{t('Check status')}</button>
    </form>
  </Card>;
}
