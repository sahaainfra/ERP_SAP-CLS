import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { loadIdentity, onAuthChange, saveIdentity, signOut, signedInUser } from './platform/api/index.js';
import { allRoutes, defaultRoute, findRoute, routesFor } from './platform/shell/registry.js';
import { useFeatureFlag, useSession } from './modules/core/api/index.js';
import LoginPage from './modules/iam/pages/LoginPage.jsx';
import ContextSwitcher from './modules/iam/components/ContextSwitcher.jsx';
import ThemeSync from './modules/iam/components/ThemeSync.jsx';
import AcceptInvitePage from './modules/iam/pages/AcceptInvitePage.jsx';

const THEME_KEY = 'erp.theme';
const THEME_EVENT = 'erp-theme';
const THEMES = ['light', 'dark', 'high-contrast'];
const ROLES = ['SYSADM', 'ITADM', 'PM', 'ACCMGR', 'CFO', 'PCMGR', 'HRMGR', 'PD'];

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

/** The application shell for a person who is known: navigation, theme, the page. In development mode the person is a chosen identity. */
function Shell({ iam, user }) {
  const qc = useQueryClient();
  const [theme, setTheme] = useState(loadTheme);
  const [identity, setIdentity] = useState(loadIdentity);
  const [path, setPath] = useState(currentPath);
  const session = useSession();
  const firstIdentity = useRef(true);

  // The profile page and the saved profile choose the theme (part 02.03).
  useEffect(() => {
    const onTheme = (e) => THEMES.includes(e.detail) && setTheme(e.detail);
    window.addEventListener(THEME_EVENT, onTheme);
    return () => window.removeEventListener(THEME_EVENT, onTheme);
  }, []);

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
    if (iam) return;
    saveIdentity(identity);
    if (firstIdentity.current) firstIdentity.current = false;
    else qc.resetQueries();
  }, [identity, qc, iam]);

  const s = session.data;
  const devIdentity = !iam && s?.environment !== 'production';
  // A person with no approved role (restricted onboarding, part 02.03) gets a welcome page, their profile and their security pages.
  const onboarding = Boolean(iam && s && s.roles.length === 0);
  const nav = (s ? routesFor(s.permissions) : []).filter((r) => (onboarding ? r.onboarding : !r.onboardingOnly));
  const found = findRoute(path);
  const route = onboarding ? (found?.onboarding ? found : findRoute('/welcome')) : (found ?? allRoutes()[0]);

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
        {!onboarding && <FlagGate flag="ff.iam.p0202"><ContextSwitcher /></FlagGate>}
        {iam && <FlagGate flag="ff.iam.p0203"><ThemeSync /></FlagGate>}
        <label className="shell-field">
          <span>Theme</span>
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="high-contrast">High contrast</option>
          </select>
        </label>
        {iam && user && (
          <span className="shell-user">
            <span data-testid="signed-in-as">{user.displayName}</span>
            <button type="button" className="btn btn-small" onClick={() => signOut().then(() => qc.clear())}>Sign out</button>
          </span>
        )}
      </header>
      {devIdentity && (
        <div className="devbar" role="group" aria-label="Development identity">
          <span>Development identity (replaced by sign-in when AUTH_MODE=iam):</span>
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

/** Sign-in mode shows the sign-in screen until there is a session; development mode goes straight to the shell. */
export default function App({ authMode = 'dev-headers' }) {
  const user = useSyncExternalStore(onAuthChange, signedInUser);
  const wasSignedIn = useRef(false);

  // An invitation link is opened before anybody is signed in, in either mode.
  if (window.location.pathname === '/accept-invite') return <AcceptInvitePage />;
  if (authMode !== 'iam') return <Shell iam={false} user={null} />;
  if (!user) {
    const notice = wasSignedIn.current ? 'signed-out' : '';
    return <LoginPage notice={notice} />;
  }
  wasSignedIn.current = true;
  return <Shell iam user={user} />;
}
