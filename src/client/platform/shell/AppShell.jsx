import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../design/Icon.jsx';
import { NoPermission, EmptyState, Skeleton, ErrorState } from '../feedback/states.jsx';
import { useBell, useFavourites, useNavigation, useRecent } from './api.js';
import ContextSwitcher, { OPEN_CONTEXT_EVENT, readContext } from './ContextSwitcher.jsx';
import CommandPalette, { ShortcutHelp } from './CommandPalette.jsx';
import { Bell, Breadcrumbs, QuickCreate, Sidebar, UserMenu, useStoredFlag } from './ShellParts.jsx';
import { accountGroup, consoleGroup, entryFor, forOnboarding, guard, shortcutMap, sidebarGroups, titleFor } from './nav.js';

const typing = (el) => el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

/** What a page that cannot be drawn says (FR-08): the missing right, a flag that is OFF, a project to choose, or no such page. */
function GuardState({ verdict, path, go }) {
  if (verdict.reason === 'permission') {
    return <NoPermission what={verdict.label ?? 'This page'} permission={verdict.permissionKey} />;
  }
  if (verdict.reason === 'flag') {
    return (
      <div className="state" role="status" data-testid="flag-off">
        <h2>{verdict.label ?? 'This page'} is not switched on yet</h2>
        <p>It is released step by step and is not available for your company yet (feature flag <code>{verdict.featureFlag}</code> is OFF). Ask a system administrator when it will be.</p>
        <a className="btn" href="/home" onClick={go('/home')}>Go to Home</a>
      </div>
    );
  }
  if (verdict.reason === 'context') {
    const need = verdict.need === 'site' ? 'site' : 'project';
    return (
      <div className="state" role="status" data-testid="context-needed">
        <h2>Choose a {need} first</h2>
        <p>{verdict.entry.label} works on one {need} at a time. Pick one in the working context at the top of the page.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_CONTEXT_EVENT))}>Choose a {need}</button>
      </div>
    );
  }
  return (
    <EmptyState title="That page does not exist" message={`There is nothing at ${path}. It may have been renamed.`} action={<a className="btn" href="/home" onClick={go('/home')}>Go to Home</a>} />
  );
}

/**
 * The application shell (part 03.05): header with search, working context, quick create, bell and the account menu; a sidebar built from
 * the navigation registry; breadcrumbs; route guards; keyboard shortcuts. Everything the person may open comes from the server's
 * registry, so the menu never shows what the person cannot use and no page's own list of links is needed.
 */
export default function AppShell({ path, go, route, session, onboarding, displayName, theme, setTheme, language, setLanguage, onSignOut, identityBar, extras }) {
  const navQuery = useNavigation();
  const fullNav = navQuery.data;
  const nav = useMemo(() => (fullNav ? forOnboarding(fullNav, onboarding) : null), [fullNav, onboarding]);
  const favs = useFavourites(Boolean(nav));
  const recent = useRecent(Boolean(nav));
  const approvalsEntry = entryFor(nav, '/admin/approvals');
  const bell = useBell(Boolean(approvalsEntry));
  const [context, setContext] = useState(readContext);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useStoredFlag('erp.shell.collapsed', false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const mainRef = useRef(null);
  const pending = useRef(null);

  const goTo = useCallback((to) => (e) => {
    e?.preventDefault?.();
    go(to)(e);
    setMenuOpen(false);
  }, [go]);
  const open = useCallback((to) => goTo(to)(), [goTo]);

  useLayoutEffect(() => { if (nav) document.title = titleFor(nav, path); }, [nav, path]);
  useEffect(() => { setMenuOpen(false); }, [path]);

  // keyboard: Ctrl/Cmd+K, ? for help, "g" then a letter to go to a page
  useEffect(() => {
    const map = shortcutMap(nav);
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(document.activeElement)) return;
      if (pending.current) {
        clearTimeout(pending.current);
        pending.current = null;
        const hit = map[e.key.toLowerCase()];
        if (hit) { e.preventDefault(); open(hit.route); }
        return;
      }
      if (e.key === '?') { e.preventDefault(); setHelp(true); }
      else if (e.key === 'g') pending.current = setTimeout(() => { pending.current = null; }, 1500);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, open]);

  if (navQuery.isError) {
    return (
      <div className="app-shell"><main id="main"><ErrorState title="The menu could not be loaded" error={navQuery.error} onRetry={() => navQuery.refetch()} /></main></div>
    );
  }
  if (!nav) return <div className="app-shell"><main id="main"><Skeleton label="Loading the menu" rows={4} /></main></div>;

  const knownRoute = Boolean(route);
  const verdict = guard(nav, path, { knownRoute, context });
  const profile = entryFor(nav, '/account/profile') ?? accountGroup(nav)?.pages.find((p) => p.code === 'profile');
  const groups = sidebarGroups(nav);
  const phone = isPhone();

  return (
    <div className="app-shell" data-collapsed={collapsed}>
      <a href="#main" className="skip">Skip to content</a>
      <header className="sh-header">
        <button type="button" className="sh-icon sh-burger" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="sh-nav" onClick={() => setMenuOpen((o) => !o)}>
          <Icon name="erp.action.more" size={20} />
        </button>
        <button type="button" className="sh-icon sh-collapse" aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} aria-pressed={collapsed} onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expand menu' : 'Collapse menu'}>
          <Icon name={collapsed ? 'erp.action.next' : 'erp.action.previous'} size={18} />
        </button>
        <a className="sh-brand" href="/home" onClick={goTo('/home')} aria-label="ERP home"><strong>ERP</strong></a>
        <button type="button" className="sh-search" onClick={() => setPalette(true)} aria-label="Search or go to" aria-keyshortcuts="Control+K" data-testid="search-trigger">
          <Icon name="erp.action.search" size={16} /><span className="sh-search-text">Search or go to…</span><kbd className="sh-kbd">Ctrl K</kbd>
        </button>
        <span className="spacer" />
        {extras}
        {!onboarding && <ContextSwitcher context={context} onChange={setContext} />}
        {!onboarding && <QuickCreate items={nav.quickCreate} go={goTo} />}
        {!onboarding && <Bell count={bell.data?.unread ?? 0} to={approvalsEntry?.route} go={goTo} />}
        <UserMenu name={displayName} theme={theme} setTheme={setTheme} language={language} setLanguage={setLanguage} profileRoute={profile?.route} go={goTo} onSignOut={onSignOut} />
      </header>
      {identityBar}
      <div className="sh-body">
        <Sidebar groups={groups} account={accountGroup(nav)} consoleGroup={consoleGroup(nav)} path={path.split('?')[0]} go={goTo} language={language} open={menuOpen} onClose={() => setMenuOpen(false)} collapsed={collapsed && !phone} />
        <main id="main" tabIndex={-1} ref={mainRef}>
          <Breadcrumbs nav={nav} path={path} go={goTo} />
          {verdict.ok && route ? <route.Page session={session} /> : <GuardState verdict={verdict.ok ? { reason: 'unknown' } : verdict} path={path} go={goTo} />}
        </main>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} nav={nav} favourites={favs.data ?? []} recent={recent.data ?? []} go={open} />
      <ShortcutHelp open={help} onClose={() => setHelp(false)} nav={nav} />
    </div>
  );
}
