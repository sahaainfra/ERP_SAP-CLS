import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { deviceInfo, publicApi, rememberDevice, rememberedDevice, setSession } from '../../../platform/api/index.js';
import { errorInfo } from '../../core/pages/ui.jsx';
import { STRINGS } from '../strings.js';

const LANG_KEY = 'erp.lang';
const loadLang = () => {
  try {
    return localStorage.getItem(LANG_KEY) === 'hi' ? 'hi' : 'en';
  } catch {
    return 'en';
  }
};

function Problem({ error }) {
  if (!error?.form) return null;
  return (
    <p className="field-error" role="alert" data-testid="login-error">
      {error.form}
      {error.correlationId && <> (<code>{error.correlationId}</code>)</>}
    </p>
  );
}

/**
 * The sign-in screen (FR-01, FR-02, FR-04, FR-05, FR-10): password, the second step, authenticator set-up, a forced password change,
 * forgotten password, and PIN unlock on a remembered device. English or Hindi. It never says which part of a sign-in was wrong.
 */
export default function LoginPage({ notice = '' }) {
  const qc = useQueryClient();
  const [lang, setLang] = useState(loadLang);
  const t = STRINGS[lang];
  const remembered = rememberedDevice();
  const [step, setStep] = useState(remembered.token ? 'pin' : 'credentials');
  const [username, setUsername] = useState(remembered.user ?? '');
  const [challenge, setChallenge] = useState(null); // { token, factors }
  const [enrol, setEnrol] = useState(null); // { secret, qr }
  const [method, setMethod] = useState('totp');
  const [captcha, setCaptcha] = useState(null);
  const [done, setDone] = useState(null); // a finished sign-in held back while the backup codes are shown
  const [error, setError] = useState(null);
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const chooseLang = (l) => {
    setLang(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* the choice lasts for this page load */
    }
  };

  /** Nothing cached for the last person may reach the next one, so the cache is emptied before the new session is announced. */
  const start = (result) => {
    qc.clear();
    setSession(result);
  };

  const finish = (result, who) => {
    if (result.deviceToken) rememberDevice(result.deviceToken, who);
    if (result.backupCodes?.length) {
      setDone(result);
      setStep('backup');
    } else {
      start(result);
    }
  };

  async function advance(result, who) {
    setError(null);
    if (result.status === 'ok') return finish(result, who);
    if (result.status === 'mfa_required') {
      setChallenge({ token: result.challengeToken, factors: result.factors });
      setMethod(result.factors.some((f) => f.type === 'totp') ? 'totp' : result.factors[0]?.type === 'backup' ? 'backup' : result.factors[0]?.type ?? 'totp');
      return setStep('mfa');
    }
    if (result.status === 'mfa_enrolment_required') {
      const begin = await publicApi.post('/auth/mfa/enrol/begin', { challengeToken: result.challengeToken });
      setChallenge({ token: result.challengeToken, factors: [] });
      setEnrol(begin.data);
      return setStep('enrol');
    }
    setChallenge({ token: result.challengeToken, factors: [] });
    setInfo(result.message ?? '');
    return setStep('password');
  }

  const run = (fn) => async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await fn(f);
    } catch (err) {
      setError(errorInfo(err));
      if (step === 'credentials' || step === 'pin') {
        try {
          const c = await publicApi.post('/auth/captcha', { username: String(f.get('username') ?? username) });
          setCaptcha(c.data.required ? c.data.challenge : null);
        } catch {
          setCaptcha(null);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const signIn = run(async (f) => {
    const who = String(f.get('username')).trim();
    setUsername(who);
    const out = await publicApi.post('/auth/login', {
      username: who, password: String(f.get('password')), rememberDevice: f.get('remember') === 'on', ...deviceInfo(),
      ...(captcha ? { captchaToken: captcha.token, captchaAnswer: String(f.get('captcha')) } : {}),
    });
    setCaptcha(null);
    await advance(out.data, who);
  });
  const verify = run(async (f) => {
    const out = await publicApi.post('/auth/mfa/verify', { challengeToken: challenge.token, method, code: String(f.get('code')), ...(method === 'sms' || method === 'whatsapp' ? { factorId: challenge.factors.find((x) => x.type === method)?.id } : {}), rememberDevice: f.get('remember') === 'on', ...deviceInfo() });
    await advance(out.data, username);
  });
  const sendCode = async () => {
    setError(null);
    try {
      const factor = challenge.factors.find((x) => x.type === method);
      const out = await publicApi.post('/auth/mfa/send', { challengeToken: challenge.token, factorId: factor.id });
      setInfo(out.data.sent ? t.codeSent : out.data.message);
    } catch (err) {
      setError(errorInfo(err));
    }
  };
  const confirmEnrol = run(async (f) => {
    const out = await publicApi.post('/auth/mfa/enrol/confirm', { challengeToken: challenge.token, code: String(f.get('code')), rememberDevice: f.get('remember') === 'on', ...deviceInfo() });
    finish(out.data, username);
  });
  const newPassword = run(async (f) => {
    const out = await publicApi.post('/auth/password/required-change', { challengeToken: challenge.token, newPassword: String(f.get('newPassword')), ...deviceInfo() });
    await advance(out.data, username);
  });
  const forgot = run(async (f) => {
    setUsername(String(f.get('identifier')));
    await publicApi.post('/auth/password/forgot', { identifier: String(f.get('identifier')).trim() });
    setInfo(t.resetSent);
    setStep('reset');
  });
  const reset = run(async (f) => {
    await publicApi.post('/auth/password/reset', { identifier: username, code: String(f.get('code')), newPassword: String(f.get('newPassword')) });
    setInfo('');
    setStep('credentials');
    setInfo(lang === 'hi' ? 'पासवर्ड बदल गया। अब साइन इन करें।' : 'Password changed. Sign in with the new one.');
  });
  const unlock = run(async (f) => {
    const out = await publicApi.post('/auth/pin-unlock', { deviceToken: remembered.token, pin: String(f.get('pin')), ...deviceInfo() });
    finish(out.data, remembered.user);
  });

  const submit = (label) => <button type="submit" className="btn btn-primary" disabled={busy}>{label}</button>;
  const backBtn = (to = 'credentials') => <button type="button" className="btn" onClick={() => { setStep(to); setError(null); setInfo(''); }}>{t.back}</button>;

  return (
    <main className="login-page" id="main">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-lang" role="group" aria-label={t.language}>
          <button type="button" className={`link${lang === 'en' ? ' is-on' : ''}`} aria-pressed={lang === 'en'} onClick={() => chooseLang('en')}>English</button>
          <button type="button" className={`link${lang === 'hi' ? ' is-on' : ''}`} aria-pressed={lang === 'hi'} onClick={() => chooseLang('hi')} lang="hi">हिन्दी</button>
        </div>
        <p className="muted">{t.subtitle}</p>
        {notice && <p role="status" className="notice">{notice === 'signed-out' ? t.signedOut : notice}</p>}
        {info && <p role="status" className="notice" data-testid="login-info">{info}</p>}

        {step === 'credentials' && (
          <form onSubmit={signIn} aria-labelledby="login-title" className="form-grid">
            <h1 id="login-title">{t.title}</h1>
            <label className="field"><span>{t.username}</span><input name="username" autoComplete="username" defaultValue={username} required autoFocus /></label>
            <label className="field"><span>{t.password}</span><input name="password" type="password" autoComplete="current-password" required /></label>
            {captcha && <label className="field"><span>{captcha.question} ({t.captcha})</span><input name="captcha" inputMode="numeric" required /></label>}
            <label className="check"><input name="remember" type="checkbox" /> {t.remember}</label>
            <Problem error={error} />
            <div className="actions">{submit(t.signIn)}</div>
            <p><button type="button" className="link" onClick={() => { setStep('forgot'); setError(null); setInfo(''); }}>{t.forgot}</button></p>
          </form>
        )}

        {step === 'mfa' && challenge && (
          <form onSubmit={verify} aria-labelledby="login-title" className="form-grid">
            <h1 id="login-title">{t.mfaTitle}</h1>
            <p className="muted">{method === 'backup' ? t.backupCode : t.mfaHelp}</p>
            <label className="field"><span>{method === 'backup' ? t.backupCode : t.code}</span><input name="code" inputMode={method === 'backup' ? 'text' : 'numeric'} autoComplete="one-time-code" required autoFocus /></label>
            <label className="check"><input name="remember" type="checkbox" /> {t.remember}</label>
            <Problem error={error} />
            <div className="actions">{backBtn()}{submit(t.verify)}</div>
            <p>
              {challenge.factors.some((f) => f.type === 'backup') && method !== 'backup' && <button type="button" className="link" onClick={() => setMethod('backup')}>{t.useBackup}</button>}
              {method !== 'totp' && challenge.factors.some((f) => f.type === 'totp') && <button type="button" className="link" onClick={() => setMethod('totp')}>{t.useApp}</button>}
              {['sms', 'whatsapp'].filter((m) => challenge.factors.some((f) => f.type === m)).map((m) => (
                <button type="button" className="link" key={m} onClick={() => { setMethod(m); void sendCode(); }}>{t.sendCode} ({m === 'sms' ? 'SMS' : 'WhatsApp'})</button>
              ))}
            </p>
          </form>
        )}

        {step === 'enrol' && enrol && (
          <form onSubmit={confirmEnrol} aria-labelledby="login-title" className="form-grid">
            <h1 id="login-title">{t.enrolTitle}</h1>
            <p className="muted">{t.enrolHelp}</p>
            <img src={enrol.qr} alt="QR code for the authenticator app" width="200" height="200" className="qr" />
            <p>{t.manualKey}: <code data-testid="totp-secret">{enrol.secret}</code></p>
            <label className="field"><span>{t.code}</span><input name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus /></label>
            <label className="check"><input name="remember" type="checkbox" /> {t.remember}</label>
            <Problem error={error} />
            <div className="actions">{backBtn()}{submit(t.verify)}</div>
          </form>
        )}

        {step === 'backup' && done && (
          <div className="form-grid" aria-labelledby="login-title">
            <h1 id="login-title">{t.backupTitle}</h1>
            <p className="muted">{t.backupHelp}</p>
            <ul className="plain codes" data-testid="backup-codes">{done.backupCodes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
            <div className="actions"><button type="button" className="btn btn-primary" onClick={() => start(done)}>{t.savedCodes}</button></div>
          </div>
        )}

        {step === 'password' && challenge && (
          <form onSubmit={newPassword} aria-labelledby="login-title" className="form-grid">
            <h1 id="login-title">{t.passwordTitle}</h1>
            <label className="field"><span>{t.newPassword}</span><input name="newPassword" type="password" autoComplete="new-password" required minLength={10} autoFocus /></label>
            <Problem error={error} />
            <div className="actions">{backBtn()}{submit(t.setPassword)}</div>
          </form>
        )}

        {step === 'forgot' && (
          <form onSubmit={forgot} aria-labelledby="login-title" className="form-grid">
            <h1 id="login-title">{t.resetTitle}</h1>
            <label className="field"><span>{t.username}</span><input name="identifier" required autoFocus /></label>
            <Problem error={error} />
            <div className="actions">{backBtn()}{submit(t.sendReset)}</div>
          </form>
        )}

        {step === 'reset' && (
          <form onSubmit={reset} aria-labelledby="login-title" className="form-grid">
            <h1 id="login-title">{t.resetTitle}</h1>
            <label className="field"><span>{t.resetCode}</span><input name="code" autoComplete="one-time-code" required autoFocus /></label>
            <label className="field"><span>{t.newPassword}</span><input name="newPassword" type="password" autoComplete="new-password" required minLength={10} /></label>
            <Problem error={error} />
            <div className="actions">{backBtn()}{submit(t.reset)}</div>
          </form>
        )}

        {step === 'pin' && (
          <form onSubmit={unlock} aria-labelledby="login-title" className="form-grid">
            <h1 id="login-title">{t.pinTitle}</h1>
            <p className="muted">{remembered.user}</p>
            <label className="field"><span>{t.pin}</span><input name="pin" type="password" inputMode="numeric" pattern="\d{4,8}" autoComplete="off" required autoFocus /></label>
            <Problem error={error} />
            <div className="actions">{submit(t.unlock)}</div>
            <p><button type="button" className="link" onClick={() => { setStep('credentials'); setError(null); }}>{t.usePassword}</button></p>
          </form>
        )}
      </section>
    </main>
  );
}
