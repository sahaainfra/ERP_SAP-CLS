import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { loadIdentity, saveIdentity } from './platform/api/index.js';
import { allRoutes, defaultRoute, findRoute, routesFor } from './platform/shell/registry.js';
import { useFeatureFlag, useSession } from './modules/core/api/index.js';

const THEME_KEY = 'erp.theme';
const ROLES = ['SYSADM', 'ITADM', 'PM'];

const currentPath = () => (findRoute(window.location.pathname) ? window.location.pathname : defaultRoute());

function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) ?? 'light';
  } catch {
    return 'light';
  }
}

/** Shows its children only while a feature flag is ON for the signed-in user. */
function FlagGate({ flag, children }) {
  const on = useFeatureFlag(flag);
  return on ? children : null;
}

export default function App() {
  const qc = useQueryClient();
  const [theme, setTheme] = useState(loadTheme);
  const [identity, setIdentity] = useState(loadIdentity);
  const [path, setPath] = useState(currentPath);
  const session = useSession();
  const firstIdentity = useRef(true);

  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener('popstate', onPop);
    if (window.location.pathname !== path) window.history.replaceState(null, '', path);
    return () => window.removeEventListener('popstate', onPop);
  }, [path]);

  const go = (to) => (e) => {
    e.preventDefault();
    window.history.pushState(null, '', to);
    setPath(to);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* theme still applies for this page load */
    }
  }, [theme]);

  // A different (development) identity sees different data: drop everything cached for the old one.
  useEffect(() => {
    saveIdentity(identity);
    if (firstIdentity.current) firstIdentity.current = false;
    else qc.resetQueries();
  }, [identity, qc]);

  const s = session.data;
  const devIdentity = s?.environment !== 'production';
  const nav = s ? routesFor(s.permissions) : [];
  const route = findRoute(path) ?? allRoutes()[0];

  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      <header className="shellbar">
        <strong>ERP</strong>
        <nav aria-label="Main">
          {nav.map((r) => {
            const link = (
              <a key={r.path} href={r.path} onClick={go(r.path)} aria-current={r.path === path ? 'page' : undefined}>{r.label}</a>
            );
            return r.flag ? <FlagGate key={r.path} flag={r.flag}>{link}</FlagGate> : link;
          })}
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
      <main id="main">
        {s && route && <route.Page session={s} />}
        {session.isError && (
          <div className="state state-error" role="alert">
            <h2>Could not reach the server</h2>
            <p>{session.error.message}</p>
            {session.error.correlationId && <p className="muted">Correlation ID: <code>{session.error.correlationId}</code></p>}
            <button type="button" className="btn" onClick={() => session.refetch()}>Try again</button>
          </div>
        )}
      </main>
    </>
  );
}
