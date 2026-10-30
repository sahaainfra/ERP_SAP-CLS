import { useEffect, useState } from 'react';
import { api, loadIdentity, saveIdentity } from './api.js';
import { FlagsProvider } from './useFeatureFlag.jsx';
import FlagsPage from './FlagsPage.jsx';

const THEME_KEY = 'erp.theme';
const ROLES = ['SYSADM', 'ITADM', 'PM'];
const FLAG_KEYS = ['ff.prog.p0001', 'ff.prog.p0002'];

function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) ?? 'light';
  } catch {
    return 'light';
  }
}

export default function App() {
  const [theme, setTheme] = useState(loadTheme);
  const [identity, setIdentity] = useState(loadIdentity);
  const [session, setSession] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* theme still applies for this page load */
    }
  }, [theme]);

  useEffect(() => {
    saveIdentity(identity);
    api('GET', '/core/session').then((r) => setSession(r.data)).catch(() => setSession(null));
  }, [identity]);

  const devIdentity = session?.environment !== 'production';

  return (
    <FlagsProvider keys={FLAG_KEYS} identityVersion={`${identity.user}|${identity.roles}|${identity.company}`}>
      <a href="#main" className="skip">Skip to content</a>
      <header className="shellbar">
        <strong>ERP</strong>
        <nav aria-label="Main">
          <a href="/admin/feature-flags" aria-current="page">Administration &rsaquo; Feature Flags</a>
        </nav>
        <span className="spacer" />
        <label className="shell-field">
          <span>Theme</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="high-contrast">High contrast</option>
          </select>
        </label>
      </header>
      {devIdentity && (
        <div className="devbar" role="group" aria-label="Development identity">
          <span>Development identity (replaced by sign-in in part 02.x):</span>
          <label className="shell-field"><span>User</span>
            <input value={identity.user} onChange={(e) => setIdentity({ ...identity, user: e.target.value })} />
          </label>
          <label className="shell-field"><span>Role</span>
            <select value={identity.roles} onChange={(e) => setIdentity({ ...identity, roles: e.target.value })}>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="shell-field"><span>Company</span>
            <input type="number" min="1" value={identity.company} onChange={(e) => setIdentity({ ...identity, company: e.target.value })} />
          </label>
        </div>
      )}
      <main id="main">{session && <FlagsPage session={session} />}</main>
    </FlagsProvider>
  );
}
