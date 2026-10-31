import { useEffect, useState } from 'react';
import { publicApi } from '../../../platform/api/index.js';
import { errorInfo } from '../../core/pages/ui.jsx';

/** The page an invitation link opens (no sign-in yet): confirm the link, choose a password, then go to the sign-in screen. */
export default function AcceptInvitePage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [info, setInfo] = useState(null);
  const [gone, setGone] = useState('');
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Accept your invitation - ERP';
    let live = true;
    publicApi.get(`/invitations/${encodeURIComponent(token)}`).then((r) => { if (live) setInfo(r.data); }).catch((err) => { if (live) setGone(err.status === 410 ? err.message : 'This invitation link is not valid. Check that you copied the whole link, or ask your administrator to send a new one.'); });
    return () => { live = false; };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('password') !== f.get('again')) return setError({ form: '', fields: { again: 'The two passwords are not the same.' } });
    setBusy(true);
    setError(null);
    try {
      setDone((await publicApi.post(`/invitations/${encodeURIComponent(token)}/accept`, { password: String(f.get('password')) })).data);
    } catch (err) {
      setError(errorInfo(err));
      if (err.status === 410) setGone(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page" id="main">
      <div className="login-card">
        <h1>Welcome to the ERP</h1>
        {!info && !gone && <p role="status">Checking your invitation...</p>}
        {gone && !done && <p className="field-error" role="alert" data-testid="invite-gone">{gone}</p>}
        {done && (
          <div role="status" data-testid="invite-done">
            <p>Your password is set, {info?.displayName}. Your username is <strong>{done.username}</strong>.</p>
            <p className="muted">{done.status === 'ONBOARDING' ? 'You can sign in now. Until an administrator approves a role for you, you will see only a welcome page and your profile.' : 'You can sign in now.'}</p>
            <a className="btn btn-primary" href="/">Go to sign-in</a>
          </div>
        )}
        {info && !done && !gone && (
          <form onSubmit={submit} aria-label="Choose your password">
            <p>Hello {info.displayName}. Choose a password to finish setting up your account <strong>{info.username}</strong>.</p>
            <label className="field"><span>New password</span>
              <input type="password" name="password" autoComplete="new-password" required minLength={info.minPasswordLength} aria-describedby="pw-hint" aria-invalid={Boolean(error?.fields?.password)} />
              <span id="pw-hint" className="muted small">At least {info.minPasswordLength} characters; not a common password, and not your username.</span>
              {error?.fields?.password && <span className="field-error">{error.fields.password}</span>}
            </label>
            <label className="field"><span>Type it again</span>
              <input type="password" name="again" autoComplete="new-password" required />
              {error?.fields?.again && <span className="field-error">{error.fields.again}</span>}
            </label>
            {error?.form && <p className="field-error" role="alert">{error.form}{error.correlationId && <> (<code>{error.correlationId}</code>)</>}</p>}
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Set my password'}</button>
            <p className="muted small">If your role needs a second step, you will be asked to set up an authenticator app the first time you sign in.</p>
          </form>
        )}
      </div>
    </main>
  );
}
