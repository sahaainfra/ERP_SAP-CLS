import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { startOffline, unsentCount, wipeOnSignOut } from './platform/offline/engine.js';
import { loadIdentity, onAuthChange, saveIdentity, signOut, signedInUser } from './platform/api/index.js';
import { allRoutes, findRoute, routesFor } from './platform/shell/registry.js';
import { useFeatureFlag, useSession } from './modules/core/api/index.js';
import LoginPage from './modules/iam/pages/LoginPage.jsx';
import ContextSwitcher from './modules/iam/components/ContextSwitcher.jsx';
import AppearanceSync from './modules/ui/AppearanceSync.jsx';
import Icon from './platform/design/Icon.jsx';
import { APPEARANCE_EVENT, THEMES, announceAppearance, applyAppearance, storedAppearance } from './platform/design/appearance.js';
import { confirmLeave } from './platform/forms/guard.js';
import { FeedbackProvider } from './platform/feedback/Feedback.jsx';
import AppShell from './platform/shell/AppShell.jsx';
import { useFlag, useShellMode } from './platform/shell/api.js';
import { landsOnField } from '../shared/device/breakpoints.js';
import { pwa } from './platform/device/pwa.js';
import { Skeleton } from './platform/feedback/states.jsx';
import { useLegacyRedirect } from './platform/migration/redirect.js';
import RoutePage from './platform/shell/RoutePage.jsx';
import { lazyPage } from './platform/shell/lazyPage.js';
import { Suspense } from 'react';

// The pages reached by a link without signing in, and the chat dock, are fetched when they are used (part 166.4).
const ApproveLinkPage = lazyPage(() => import('./modules/eng/ApproveLinkPage.jsx'));
const VerifyPage = lazyPage(() => import('./modules/eng/VerifyPage.jsx'));
const VendorQuotePage = lazyPage(() => import('./modules/proc/VendorQuotePage.jsx'));
const VendorPoPage = lazyPage(() => import('./modules/proc/VendorPoPage.jsx'));
const ChatDock = lazyPage(() => import('./modules/msg/ChatDock.jsx'));
const OfferResponsePage = lazyPage(() => import('./modules/hr/OfferResponsePage.jsx'));
const AcceptInvitePage = lazyPage(() => import('./modules/iam/pages/AcceptInvitePage.jsx'));

/** Draws its children once the browser is idle after the first screen (part 166.4: the chat dock and its real-time client are not part of the first screen). */
function WhenIdle({ on, children }) {
  const [ready, setReady] = useState(!on);
  useEffect(() => {
    if (!on || ready) return undefined;
    if (typeof window.requestIdleCallback === 'function') { const id = window.requestIdleCallback(() => setReady(true), { timeout: 2000 }); return () => window.cancelIdleCallback?.(id); }
    const id = setTimeout(() => setReady(true), 1000);
    return () => clearTimeout(id);
  }, [on, ready]);
  return ready ? children : null;
}

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
  const nav = (s ? routesFor(s.permissions) : []).filter((r) => r.menu !== false).filter((r) => (onboarding ? r.onboarding : !r.onboardingOnly));
  const shellOn = mode === 'on';
  const found = findRoute(path.split('?')[0]);
  const field = useFlag('ff.ui.p0306', shellOn);
  const migration = useFlag('ff.ui.p0310', shellOn);
  // the offline field engine (part 04.15) starts for the signed-in person when its flag is on
  const offlineFlag = useFlag('ff.eng.p0415', Boolean(s));
  const msgFlag = useFlag('ff.msg.p0501', Boolean(s));
  const perfFlag = useFlag('ff.perf.p16604', Boolean(s));
  const offlineUser = s ? (iam && user ? user.username ?? user.id ?? null : identity.user) : null;
  useEffect(() => { if (offlineFlag.on && offlineUser) startOffline(String(offlineUser)).catch(() => {}); }, [offlineFlag.on, offlineUser]);
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
          onSignOut={iam && user ? () => { if (unsentCount() > 0 && !window.confirm(`${unsentCount()} change(s) on this device have not been sent yet and will be deleted if you sign out. Sign out anyway?`)) return Promise.resolve(); pwa.clearApiCache(); return signOut().then(() => wipeOnSignOut()).then(() => qc.clear()); } : null} identityBar={identityBar}
          extras={<><FlagGate flag="ff.ui.p0301"><AppearanceSync /></FlagGate>{msgFlag.on && !onboarding && <WhenIdle on={perfFlag.on}><Suspense fallback={null}><ChatDock session={s} /></Suspense></WhenIdle>}</>}
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
        {s && route && <RoutePage route={route} session={s} path={route.path} />}
        {s && msgFlag.on && !onboarding && <Suspense fallback={null}><ChatDock session={s} /></Suspense>}
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
  if (window.location.pathname === '/accept-invite') return <Suspense fallback={<Skeleton rows={6} />}><AcceptInvitePage /></Suspense>;
  // the offer a candidate opens from the link they were given (part 07.02)
  if (window.location.pathname === '/offer-response') return <Suspense fallback={<Skeleton rows={6} />}><OfferResponsePage /></Suspense>;
  // a secure approval link is opened before anybody is signed in (part 04.03)
  if (window.location.pathname === '/approve-link') return <Suspense fallback={<Skeleton rows={6} />}><ApproveLinkPage /></Suspense>;
  // the page a QR code on a document leads to is public (part 04.12)
  if (window.location.pathname === '/verify' || window.location.pathname.startsWith('/verify/')) return <Suspense fallback={<Skeleton rows={6} />}><VerifyPage /></Suspense>;
  // the page a vendor opens from the enquiry it was sent (part 15.03): the link is the proof
  if (window.location.pathname === '/vendor-quote') return <Suspense fallback={<Skeleton rows={6} />}><VendorQuotePage /></Suspense>;
  if (window.location.pathname === '/vendor-po') return <Suspense fallback={<Skeleton rows={6} />}><VendorPoPage /></Suspense>;
  if (authMode !== 'iam') return <Shell iam={false} user={null} />;
  if (!user) {
    const notice = wasSignedIn.current ? 'signed-out' : '';
    return <LoginPage notice={notice} />;
  }
  wasSignedIn.current = true;
  return <Shell iam user={user} />;
}
