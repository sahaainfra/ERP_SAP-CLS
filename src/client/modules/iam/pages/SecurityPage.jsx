import { useState } from 'react';
import { formatDateTime } from '../../../platform/format.js';
import { Field, QueryState, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { useChangePassword, useMe, usePhoneBegin, usePhoneConfirm, useRegenerateBackup, useRemoveFactor, useTotpBegin, useTotpConfirm } from '../api/index.js';
import PageHeader from '../../../platform/design/PageHeader.jsx';

function BackupCodes({ codes }) {
  return (
    <div className="card" data-testid="backup-codes">
      <h3>Save your backup codes</h3>
      <p className="muted small">Each works once if you lose your phone. They are shown only now.</p>
      <ul className="plain codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
    </div>
  );
}

function Authenticator({ me }) {
  const begin = useTotpBegin();
  const confirm = useTotpConfirm();
  const regenerate = useRegenerateBackup();
  const remove = useRemoveFactor();
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState(null);
  const totp = me.mfa.factors.find((f) => f.type === 'totp');
  const act = async (fn) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  return (
    <section aria-labelledby="totp-title" className="card">
      <h2 id="totp-title">Authenticator app</h2>
      {totp ? (
        <>
          <p><span className="chip chip-pass">Set up</span> Confirmed {formatDateTime(totp.verifiedAt)}{totp.lastUsedAt ? `, last used ${formatDateTime(totp.lastUsedAt)}` : ''}. Backup codes left: <strong data-testid="backup-left">{me.mfa.backupCodesLeft}</strong>.</p>
          <div className="actions">
            <button type="button" className="btn" disabled={regenerate.isPending} onClick={() => act(async () => setCodes((await regenerate.mutateAsync()).backupCodes))}>New backup codes</button>
            <button type="button" className="btn" disabled={remove.isPending} onClick={() => act(() => remove.mutateAsync(totp.id))}>Remove</button>
          </div>
        </>
      ) : !setup ? (
        <>
          <p className="muted">{me.mfaRequired ? 'Your role needs a second step to sign in.' : 'Adds a second step when you sign in. Recommended.'}</p>
          <button type="button" className="btn btn-primary" disabled={begin.isPending} onClick={() => act(async () => setSetup(await begin.mutateAsync()))}>Set up an authenticator app</button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const code = String(new FormData(e.currentTarget).get('code'));
            void act(async () => {
              setCodes((await confirm.mutateAsync(code)).backupCodes);
              setSetup(null);
            });
          }}
          className="form-grid"
        >
          <p className="muted">Scan the picture with an authenticator app, or type the key. Then enter the 6-digit code it shows.</p>
          <img src={setup.qr} alt="QR code for the authenticator app" width="200" height="200" className="qr" />
          <p>Key to type by hand: <code data-testid="totp-secret">{setup.secret}</code></p>
          <Field label="Code from the app" name="code" error={error}><input name="code" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={8} /></Field>
          <div className="actions">
            <button type="button" className="btn" onClick={() => setSetup(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={confirm.isPending}>Confirm</button>
          </div>
        </form>
      )}
      {error?.form && <p className="field-error" role="alert">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
      {codes && <BackupCodes codes={codes} />}
    </section>
  );
}

function PhoneCode({ me }) {
  const begin = usePhoneBegin();
  const confirm = usePhoneConfirm();
  const remove = useRemoveFactor();
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const phones = me.mfa.factors.filter((f) => f.type !== 'totp');
  const act = async (fn) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  return (
    <section aria-labelledby="phone-title" className="card">
      <h2 id="phone-title">Text message or WhatsApp code</h2>
      <p className="muted small">A code is sent to your phone when you sign in. Sending needs the SMS or WhatsApp connector, set up by an administrator.</p>
      <ul className="plain">
        {phones.map((f) => (
          <li key={f.id} data-testid={`phone-${f.type}`}>
            {f.type === 'sms' ? 'Text message' : 'WhatsApp'} to <code>{f.phone}</code>
            <button type="button" className="link" disabled={remove.isPending} onClick={() => act(() => remove.mutateAsync(f.id))}>Remove</button>
          </li>
        ))}
      </ul>
      {!pending ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act(async () => {
              await begin.mutateAsync({ phone: String(f.get('phone')).trim(), channel: String(f.get('channel')) });
              setPending({ channel: String(f.get('channel')) });
              setNotice('A code was sent. Enter it below.');
            });
          }}
          className="row"
        >
          <Field label="Send codes by" name="channel" error={error}><select name="channel"><option value="sms">Text message</option><option value="whatsapp">WhatsApp</option></select></Field>
          <Field label="Mobile number with country code" name="phone" error={error}><input name="phone" inputMode="tel" placeholder="+919876543210" required /></Field>
          <button type="submit" className="btn" disabled={begin.isPending}>Send a code</button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const code = String(new FormData(e.currentTarget).get('code'));
            void act(async () => {
              await confirm.mutateAsync({ channel: pending.channel, code });
              setPending(null);
              setNotice('Phone verified.');
            });
          }}
          className="row"
        >
          <Field label="Code you received" name="code" error={error}><input name="code" inputMode="numeric" required minLength={6} maxLength={8} /></Field>
          <button type="button" className="btn" onClick={() => setPending(null)}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={confirm.isPending}>Verify</button>
        </form>
      )}
      <p role="status" className="notice">{notice}</p>
      {error?.form && <p className="field-error" role="alert">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
    </section>
  );
}

function Password({ me }) {
  const change = useChangePassword();
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null);
    setNotice('');
    try {
      const out = await change.mutateAsync({ currentPassword: String(f.get('currentPassword')), newPassword: String(f.get('newPassword')) });
      form.reset();
      setNotice(`Password changed.${out.otherSessionsEnded ? ` ${out.otherSessionsEnded} other session(s) were signed out.` : ''}`);
    } catch (err) {
      setError(errorInfo(err));
    }
  };
  return (
    <section aria-labelledby="password-title" className="card">
      <h2 id="password-title">Password</h2>
      <p className="muted small">At least {me.policy.minPasswordLength} characters, not a common password, not your username, and not one of your last 5. {me.passwordExpiresAt ? `It expires on ${formatDateTime(me.passwordExpiresAt)}.` : ''}</p>
      <form onSubmit={submit} className="form-grid" aria-label="Change password">
        <Field label="Current password" name="currentPassword" error={error}><input name="currentPassword" type="password" autoComplete="current-password" required /></Field>
        <Field label="New password" name="newPassword" error={error}><input name="newPassword" type="password" autoComplete="new-password" required minLength={me.policy.minPasswordLength} /></Field>
        {error?.form && <p className="field-error" role="alert">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
        <div className="actions"><button type="submit" className="btn btn-primary" disabled={change.isPending}>Change password</button></div>
      </form>
      <p role="status" className="notice" data-testid="password-notice">{notice}</p>
    </section>
  );
}

export default function SecurityPage() {
  usePageTitle('Security & MFA');
  const me = useMe();
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Account &rsaquo; Security &amp; MFA</nav>
      <PageHeader id="page-title" title={"Security & MFA"} />
      <QueryState query={me} what="your security settings" permission="a signed-in account" />
      {me.data && (
        <>
          {me.data.mfaRequired && me.data.mfa.factors.length === 0 && <p className="state state-warn" role="alert">Your role needs a second step. Set up an authenticator app below.</p>}
          <Authenticator me={me.data} />
          <PhoneCode me={me.data} />
          <Password me={me.data} />
        </>
      )}
    </section>
  );
}
