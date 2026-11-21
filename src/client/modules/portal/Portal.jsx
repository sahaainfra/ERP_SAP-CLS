import { useEffect, useRef, useState } from 'react';
import { createApiClient } from '../../platform/api/client.js';
import { Card } from '../../platform/design/Card.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { applyAppearance, deviceDefaults, LANGUAGES, THEMES } from '../../platform/design/appearance.js';
import { portalLabel } from './labels.js';
import SupplierWorkspace from './SupplierWorkspace.jsx';
import VendorRegistration from './VendorRegistration.jsx';
import './portal.css';

const api = createApiClient({ getAuthHeaders: () => ({}) });

function Field({ label, ...props }) {
  return <label>{label}<input required {...props} /></label>;
}

function ErrorNotice({ error }) {
  if (!error) return null;
  return <p role="alert">{error.message}{error.correlationId && <> · Reference {error.correlationId}</>}</p>;
}

export default function Portal({ invitationToken }) {
  const [invitation, setInvitation] = useState(null);
  const [account, setAccount] = useState('');
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [register, setRegister] = useState(false);
  const [section, setSection] = useState('home');
  const [documents, setDocuments] = useState([]);
  const [messages, setMessages] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const request = useRef(null);
  const [theme, setTheme] = useState(() => deviceDefaults().theme);
  const [language, setLanguage] = useState('en');
  const [largeText, setLargeText] = useState(false);
  const t = (label) => portalLabel(language, label);
  useEffect(() => {
    applyAppearance({ theme, language }, { remember: false });
  }, [theme, language]);

  const appearance = <div className="portal-appearance">
    <label>Language<select value={language} onChange={(event) => setLanguage(event.target.value)}>
      {LANGUAGES.map((code) => <option key={code} value={code}>{{ en: 'English', hi: 'हिन्दी', te: 'తెలుగు' }[code]}</option>)}
    </select></label>
    <label>Theme<select value={theme} onChange={(event) => setTheme(event.target.value)}>
      {THEMES.map((value) => <option key={value} value={value}>{{ light: 'Light', dark: 'Dark', 'high-contrast': 'High contrast' }[value]}</option>)}
    </select></label>
    <label>Large text<input type="checkbox" checked={largeText} onChange={(event) => setLargeText(event.target.checked)} /></label>
  </div>;

  async function run(action) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  function submit(event, action) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    void run(() => action(fields));
  }

  const authenticated = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
  const begin = () => run(async () => {
    const result = await api.post('/portal/invitation', { token: invitationToken });
    setInvitation(result.data);
  });

  function openSection(next) {
    return run(async () => {
      if (next === 'documents') setDocuments((await api.get('/portal/documents', authenticated(session))).data);
      if (next === 'messages') setMessages((await api.get('/portal/messages', authenticated(session))).data);
      setSection(next);
    });
  }

  async function download(id) {
    const { data } = await api.get(`/portal/documents/${id}/ticket`, authenticated(session));
    const response = await fetch(`/api/v1/portal/documents/${id}/content`, {
      headers: { ...authenticated(session).headers, 'X-Portal-Download': data.ticket }, cache: 'no-store',
    });
    if (!response.ok) {
      const result = await response.json();
      throw Object.assign(new Error(result.error?.message ?? 'The document could not be downloaded.'), {
        correlationId: result.error?.correlationId,
      });
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'shared-document';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (profile) return (
    <main className="portal-shell" data-portal-text={largeText ? 'large' : undefined}>
      <PageHeader title={profile.companyName} subtitle={t('Partner portal')} />
      {appearance}
      <nav aria-label="Partner portal" className="portal-nav">
        {[['home', 'Home'], ['profile', 'My company'], ['messages', 'Inbox'], ['documents', 'Documents'],
          ...(profile.supplierEnabled ? [['rfqs', 'RFQs & Quotations'], ['orders', 'Purchase Orders & ASN']] : []),
          ...(profile.supplierInvoices ? [['invoices', 'Invoices and payments']] : []),
          ...(profile.supplierVdr ? [['vendor-documents', 'Vendor document review']] : []),
          ...(profile.supplierCompliance ? [['compliance', 'Compliance documents']] : []),
          ...(profile.supplierScorecards ? [['scorecards', 'My Scorecard']] : [])].map(([key, label]) =>
          <button key={key} className="btn" type="button" aria-current={section === key ? 'page' : undefined}
            disabled={pending} onClick={() => openSection(key)}>{t(label)}</button>)}
      </nav>
      <ErrorNotice error={error} />
      {profile.supplierEnabled && ['rfqs', 'orders', 'invoices', 'vendor-documents', 'scorecards', 'compliance'].includes(section) &&
        <SupplierWorkspace key={section} kind={section} api={api} session={session} language={language} />}
      {section === 'home' && <Card title={profile.partnerName} subtitle={profile.contactName}>
        <p>Signed in as {profile.role}</p>
        <p className="portal-reference">{profile.account}</p>
      </Card>}
      {section === 'profile' && <Card title={t('My company')}>
        <dl>
          <dt>{t('Business partner')}</dt><dd>{profile.partnerName}</dd>
          <dt>{t('Partner code')}</dt><dd>{profile.partnerCode}</dd>
          <dt>{t('Contact')}</dt><dd>{profile.contactName}</dd>
        </dl>
        <h3>{t('Request a change')}</h3>
        {receipt && <p role="status" className="portal-reference">Request received · {receipt.reference}</p>}
        <form className="portal-form" onSubmit={(event) => {
          const form = event.currentTarget;
          submit(event, async (fields) => {
            const contents = JSON.stringify(fields);
            if (request.current?.contents !== contents) request.current = { contents, key: crypto.randomUUID() };
            const result = await api.post('/portal/profile/requests', fields, {
              headers: { ...authenticated(session).headers, 'Idempotency-Key': request.current.key },
            });
            setReceipt(result.data);
            request.current = null;
            form.reset();
          });
        }}>
          <Field label={t('Subject')} name="subject" minLength={3} maxLength={120} />
          <label>{t('Requested changes')}<textarea name="body" required minLength={5} maxLength={1500} /></label>
          <button className="btn btn-primary" disabled={pending}>{t('Send request')}</button>
        </form>
      </Card>}
      {section === 'messages' && <Card title={t('Inbox')}>
        {!messages.length && <p>No messages or requests yet.</p>}
        {messages.map((message) => <article key={message.id} className="portal-item">
          <h3>{message.subject}</h3><p>{message.body}</p><p>{message.status}</p>
          {message.status === 'UNREAD' && <button type="button" className="btn" disabled={pending} onClick={() => run(async () => {
            await api.post(`/portal/messages/${message.id}/read`, {}, authenticated(session));
            setMessages((current) => current.map((item) => item.id === message.id ? { ...item, status: 'READ' } : item));
          })}>{t('Mark read')}</button>}
        </article>)}
      </Card>}
      {section === 'documents' && <Card title={t('Shared documents')}>
        {!documents.length && <p>No documents have been shared with this account.</p>}
        {documents.map((document) => <article key={document.id} className="portal-item">
          <h3>{document.title}</h3><p>Revision {document.revision}</p>
          <button type="button" className="btn" disabled={pending} onClick={() => run(() => download(document.id))}>{t('Download')}</button>
        </article>)}
      </Card>}
      <button type="button" className="btn" disabled={pending} onClick={() => run(async () => {
        try {
          await api.delete('/portal/session', authenticated(session));
        } catch (err) {
          if (err.status !== 401) throw err;
        }
        setSession(null);
        setProfile(null);
        setSection('home');
        setDocuments([]);
        setMessages([]);
        setReceipt(null);
        request.current = null;
      })}>{t('Sign out')}</button>
    </main>
  );

  return (
    <main className="portal-shell" data-portal-text={largeText ? 'large' : undefined}>
      <PageHeader title={t('Partner portal')} />
      {appearance}
      {register ? <>
        <VendorRegistration api={api} t={t} />
        <button type="button" className="btn" onClick={() => setRegister(false)}>{t('Back to sign in')}</button>
      </> : invitationToken && !completed ? (
        <Card title={t('Activate your invitation')}>
          <ErrorNotice error={error} />
          {invitation ? (
            <form className="portal-form" onSubmit={(event) => submit(event, async ({ password, code }) => {
              const result = await api.post('/portal/activation', {
                token: invitationToken, password, code, termsVersion: invitation.termsVersion,
              });
              setAccount(result.data.account);
              setInvitation(null);
              setCompleted(true);
            })}>
              <p>Add a time-based account in your authenticator app with this setup key.</p>
              <code className="portal-reference">{invitation.secret}</code>
              <Field label={t('New password')} name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} />
              <Field label={t('Authenticator code')} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" />
              <label className="portal-terms"><input type="checkbox" required /> I agree to use this portal for my company’s authorised work, protect my credentials, and keep shared records confidential.</label>
              <button className="btn btn-primary" disabled={pending}>{t('Activate account')}</button>
            </form>
          ) : <button type="button" className="btn btn-primary" disabled={pending} onClick={begin}>{t('Set up account')}</button>}
        </Card>
      ) : (
        <Card title={t('Sign in')}>
          {completed && <p role="status">Account activated. Save your account reference and sign in with the next authenticator code.</p>}
          <ErrorNotice error={error} />
          <form className="portal-form" onSubmit={(event) => submit(event, async (fields) => {
            const result = await api.post('/portal/session', fields);
            const details = await api.get('/portal/profile', authenticated(result.data.token));
            setSession(result.data.token);
            setProfile(details.data);
          })}>
            <Field label={t('Portal account reference')} name="account" autoComplete="username" value={account} onChange={(event) => setAccount(event.target.value)} />
            <Field label={t('Password')} name="password" type="password" autoComplete="current-password" maxLength={128} />
            <Field label={t('Authenticator code')} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" />
            <button className="btn btn-primary" disabled={pending}>{t('Sign in')}</button>
          </form>
          <button className="btn" type="button" onClick={() => setRegister(true)}>{t('Register as a vendor')}</button>
        </Card>
      )}
    </main>
  );
}
