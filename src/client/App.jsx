import ApproveLinkPage from './modules/eng/ApproveLinkPage.jsx';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { loadIdentity, onAuthChange, saveIdentity, signOut, signedInUser } from './platform/api/index.js';
import { allRoutes, findRoute, routesFor } from './platform/shell/registry.js';
import { useFeatureFlag, useSession } from './modules/core/api/index.js';
import LoginPage from './modules/iam/pages/LoginPage.jsx';
import ContextSwitcher from './modules/iam/components/ContextSwitcher.jsx';
import AppearanceSync from './modules/ui/AppearanceSync.jsx';
import Icon from './platform/design/Icon.jsx';
import { APPEARANCE_EVENT, THEMES, announceAppearance, applyAppearance, storedAppearance } from './platform/design/appearance.js';
import AcceptInvitePage from './modules/iam/pages/AcceptInvitePage.jsx';
import { confirmLeave } from './platform/forms/guard.js';
import { FeedbackProvider } from './platform/feedback/Feedback.jsx';
import AppShell from './platform/shell/AppShell.jsx';
import { useFlag, useShellMode } from './platform/shell/api.js';
import { landsOnField } from '../shared/device/breakpoints.js';
import { pwa } from './platform/device/pwa.js';
import { Skeleton } from './platform/feedback/states.jsx';
import { useLegacyRedirect } from './platform/migration/redirect.js';

const ROLES = ['SYSADM', 'ITADM', 'PM', 'ACCMGR', 'CFO', 'PCMGR', 'HRMGR', 'PD'];

// An address that is no page of the application is '/': the old top bar sends it to its first page, the shell (part 03.05) to Home.
const currentPath = () => (findRoute(window.location.pathname.split('?')[0]) ? window.location.pathname : '/');

/** Shows its children only while a feature flag is ON for the signed-in user. */
function FlagGate({ flag, children }) {
  const on = useFeatureFlag(flag);
  return on ? children : null;
}

/** The application shell for a person who is known: navigation, theme, the page. In development mode the person is a chosen identity. */
function Shell({ iam, user }) {
  const qc = useQueryClient();
  const [look, setLook] = useState(storedAppearance);
  const theme = look.theme;
  const [identity, setIdentity] = useState(loadIdentity);
  const [path, setPath] = useState(currentPath);
  const session = useSession();
  const firstIdentity = useRef(true);
  const lastWho = useRef(null);

  // Theme, density and language (part 03.01): applied to <html> so every component follows at once; the saved preferences, the
  // Appearance panel and the theme menu below all announce a change, and the shell keeps its copy in step.
  useEffect(() => {
    applyAppearance(look);
    const onChange = (e) => setLook((cur) => ({ ...cur, ...Object.fromEntries(Object.entries(e.detail ?? {}).filter(([k]) => ['theme', 'density', 'language'].includes(k))) }));
    window.addEventListener(APPEARANCE_EVENT, onChange);
    return () => window.removeEventListener(APPEARANCE_EVENT, onChange);
  }, []);
  const setTheme = (next) => {
    if (!THEMES.includes(next)) return;
    applyAppearance({ theme: next });
    announceAppearance({ theme: next });
  };

  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener('popstate', onPop);
    if (window.location.pathname !== path) window.history.replaceState(null, '', path);
    return () => window.removeEventListener('popstate', onPop);
  }, [path]);

  const go = (to) => (e) => {
    e?.preventDefault?.();
    if (!confirmLeave()) return; // a form with unsaved changes asks first (part 03.02)
    window.history.pushState(null, '', to);
    setPath(to);
    // pages that keep their own view of the address (a record open, a form new) listen for popstate and follow it
    window.dispatchEvent(new PopStateEvent('popstate'));
  };


  // A different (development) identity sees different data: drop everything cached for the old one.
  useEffect(() => {
    if (iam) return;
    saveIdentity(identity);
    if (firstIdentity.current) firstIdentity.current = false;
    else qc.resetQueries();
    // another person's data is not kept for the new one (only when the identity really changed, not each time the page starts)
    const who = `${identity.user}|${identity.roles}|${identity.company}`;
    if (lastWho.current !== null && lastWho.current !== who) pwa.clearApiCache();
    lastWho.current = who;
  }, [identity, qc, iam]);

  const s = session.data;
  const mode = useShellMode(Boolean(s));
  const devIdentity = !iam && s?.environment !== 'production';
  // A person with no approved role (restricted onboarding, part 02.03) gets a welcome page, their profile and their security pages.
  const onboarding = Boolean(iam && s?.onboarding === true);
  const nav = (s ? routesFor(s.permissions) : []).filter((r) => (onboarding ? r.onboarding : !r.onboardingOnly));
  const shellOn = mode === 'on';
  const found = findRoute(path.split('?')[0]);
  const field = useFlag('ff.ui.p0306', shellOn);
  const migration = useFlag('ff.ui.p0310', shellOn);
  const toNewAddress = useCallback((to) => { window.history.replaceState(null, '', to); setPath(to); }, []);
  useLegacyRedirect({ ready: shellOn && migration.on, go: toNewAddress }); // an old address leads to the page that replaced it (part 03.10)
  const fallback = shellOn ? findRoute(onboarding ? '/welcome' : field.on && landsOnField(s?.roles) ? '/field' : '/home') : allRoutes()[0];
  const route = onboarding ? (found?.onboarding ? found : findRoute('/welcome')) : (found ?? fallback);
  // the address the person is really on: '/' and, for a person still being onboarded, a page they cannot use are shown as their landing page
  const shown = path === '/' || (found?.onboardingOnly && !onboarding) ? fallback?.path ?? path : onboarding && !found?.onboarding ? '/welcome' : path;
  const landing = shellOn && path === '/' && !onboarding && !field.known; // the landing page depends on a flag that is still being asked
  useEffect(() => {
    if (s && mode !== 'loading' && !landing && shown !== path) {
      window.history.replaceState(null, '', shown);
      setPath(shown);
    }
  }, [s, mode, landing, shown, path]);

  const identityBar = devIdentity ? (
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
  ) : null;
  const unreachable = session.isError && (
    <div className="state state-error" role="alert">
      <h2>Could not reach the server</h2>
      <p>{session.error.message}</p>
      {session.error.correlationId && <p className="muted">Correlation ID: <code>{session.error.correlationId}</code></p>}
      <button type="button" className="btn" onClick={() => session.refetch()}>Try again</button>
    </div>
  );

  if (s && (mode === 'loading' || landing)) return <FeedbackProvider><main id="main"><Skeleton label="Loading" rows={3} /></main></FeedbackProvider>;
  if (s && shellOn) {
    return (
      <FeedbackProvider>
        <AppShell
          path={shown} go={go} route={route} session={s} onboarding={onboarding} displayName={iam && user ? user.displayName : identity.user}
          theme={theme} setTheme={setTheme} language={look.language} setLanguage={(language) => { applyAppearance({ language }); announceAppearance({ language }); }}
          onSignOut={iam && user ? () => { pwa.clearApiCache(); return signOut().then(() => qc.clear()); } : null} identityBar={identityBar}
          extras={<FlagGate flag="ff.ui.p0301"><AppearanceSync /></FlagGate>}
        />
      </FeedbackProvider>
    );
  }

  return (
    <FeedbackProvider>
      <a href="#main" className="skip">Skip to content</a>
      <header className="shellbar">
        <strong>ERP</strong>
        <nav aria-label="Main">
          {nav.map((r) => {
            const link = (
              <a key={r.path} href={r.path} onClick={go(r.path)} aria-current={r.path === path ? 'page' : undefined}>{r.icon && <Icon name={r.icon} size={16} />}{r.label}</a>
            );
            return r.flag ? <FlagGate key={r.path} flag={r.flag}>{link}</FlagGate> : link;
          })}
        </nav>
        <span className="spacer" />
        {!onboarding && <FlagGate flag="ff.iam.p0202"><ContextSwitcher /></FlagGate>}
        {s && <FlagGate flag="ff.ui.p0301"><AppearanceSync /></FlagGate>}
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
      {identityBar}
      <main id="main">
        {s && route && <route.Page session={s} />}
        {unreachable}
      </main>
    </FeedbackProvider>
  );
}

/** Sign-in mode shows the sign-in screen until there is a session; development mode goes straight to the shell. */
export default function App({ authMode = 'dev-headers' }) {
  const user = useSyncExternalStore(onAuthChange, signedInUser);
  const wasSignedIn = useRef(false);

  // An invitation link is opened before anybody is signed in, in either mode.
  if (window.location.pathname === '/accept-invite') return <AcceptInvitePage />;
  // a secure approval link is opened before anybody is signed in (part 04.03)
  if (window.location.pathname === '/approve-link') return <ApproveLinkPage />;
  if (authMode !== 'iam') return <Shell iam={false} user={null} />;
  if (!user) {
    const notice = wasSignedIn.current ? 'signed-out' : '';
    return <LoginPage notice={notice} />;
  }
  wasSignedIn.current = true;
  return <Shell iam user={user} />;
}
