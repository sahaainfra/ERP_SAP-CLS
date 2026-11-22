import NotificationBell from '../notifications/NotificationBell.jsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../design/Icon.jsx';
import { NoPermission, EmptyState, Skeleton, ErrorState } from '../feedback/states.jsx';
import PageHeader from '../design/PageHeader.jsx';
import { shellKeys, useBell, useFavourites, useFlagOn, useNavigation, useRecent } from './api.js';
import { labelIn, useT } from '../i18n/index.js';
import I18nSync from '../i18n/I18nSync.jsx';
import { landsOnField } from '../../../shared/device/breakpoints.js';
import { useLayout } from '../device/layout.js';
import { setLowBandwidthExtras, useLowBandwidth } from '../device/lowBandwidth.js';
import PwaBanners from '../device/PwaBanners.jsx';
import RoutePage from './RoutePage.jsx';
import { usePrefetchBottomBar } from './prefetch.js';
import { setSwStrategy } from '../api/identity.js';
import { API_UPDATED_EVENT, pwa } from '../device/pwa.js';
import { useQueryClient } from '@tanstack/react-query';
import DeviceMenu from '../device/DeviceMenu.jsx';
import ContextSwitcher, { OPEN_CONTEXT_EVENT, readContext } from './ContextSwitcher.jsx';
import CommandPalette, { ShortcutHelp } from './CommandPalette.jsx';
import { BottomNav, Bell, Breadcrumbs, QuickCreate, Sidebar, UserMenu, useStoredFlag } from './ShellParts.jsx';
import HelpWidget from './HelpWidget.jsx';
import { accountGroup, consoleGroup, entryFor, forOnboarding, guard, shortcutMap, sidebarGroups, titleFor } from './nav.js';

const typing = (el) => el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

/** A page whose flag is OFF: its PageHeader (the page's one level-1 heading, as UI v3 and the Page Completion Checklist ask) and its title. */
function FlagOff({ verdict, go }) {
  const t = useT('shell');
  const title = t('guard.flagTitle', { page: verdict.label ?? t('guard.page') });
  useEffect(() => { document.title = `${title} - ERP`; }, [title]);
  return (
    <div data-testid="flag-off">
      <PageHeader id="flag-off" title={title} />
      <div className="state" role="status">
        <p>{t('guard.flagBody', { flag: verdict.featureFlag })}</p>
        <a className="btn" href="/home" onClick={go('/home')}>{t('guard.home')}</a>
      </div>
    </div>
  );
}

/** What a page that cannot be drawn says (FR-08): the missing right, a flag that is OFF, a project to choose, or no such page. */
function GuardState({ verdict, path, go }) {
  const t = useT('shell');
  if (verdict.reason === 'permission') {
    return <NoPermission what={verdict.label ?? t('guard.page')} permission={verdict.permissionKey} />;
  }
  if (verdict.reason === 'flag') return <FlagOff verdict={verdict} go={go} />;
  if (verdict.reason === 'context') {
    const need = t(verdict.need === 'site' ? 'need.site' : 'need.project');
    return (
      <div className="state" role="status" data-testid="context-needed">
        <h2>{t('guard.contextTitle', { need })}</h2>
        <p>{t('guard.contextBody', { page: verdict.entry.label, need })}</p>
        <button type="button" className="btn btn-primary" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_CONTEXT_EVENT))}>{t('guard.contextAction', { need })}</button>
      </div>
    );
  }
  return (
    <EmptyState title={t('guard.missingTitle')} message={t('guard.missingBody', { path })} action={<a className="btn" href="/home" onClick={go('/home')}>{t('guard.home')}</a>} />
  );
}

/**
 * The application shell (part 03.05): header with search, working context, quick create, bell and the account menu; a sidebar built from
 * the navigation registry; breadcrumbs; route guards; keyboard shortcuts. Everything the person may open comes from the server's
 * registry, so the menu never shows what the person cannot use and no page's own list of links is needed.
 */
export default function AppShell({ path, go, route, session, onboarding, displayName, theme, setTheme, language, setLanguage, onSignOut, identityBar, extras }) {
  const t = useT('shell');
  const navQuery = useNavigation();
  const fullNav = navQuery.data;
  const nav = useMemo(() => (fullNav ? forOnboarding(fullNav, onboarding) : null), [fullNav, onboarding]);
  const favs = useFavourites(Boolean(nav));
  const recent = useRecent(Boolean(nav));
  const approvalsEntry = entryFor(nav, '/admin/approvals');
  const bell = useBell(Boolean(nav));
  const [context, setContext] = useState(readContext);
  const [menuOpen, setMenuOpen] = useState(false);
  const searchOn = useFlagOn('ff.ui.p0308'); // global search and the command palette (part 03.08)
  const device = useFlagOn('ff.ui.p0306'); // layouts, install and device capabilities (part 03.06)
  const uiV3 = useFlagOn('ff.ui.p16602'); // the UI v3 page patterns (part 166.2): src/client/ui-v3.css styles them under :root[data-ui-v3]
  useEffect(() => {
    const root = document.documentElement;
    if (uiV3) root.dataset.uiV3 = 'on'; else delete root.dataset.uiV3;
    return () => { delete root.dataset.uiV3; };
  }, [uiV3]);
  // Part 166.4: prefetch of the bottom bar's pages (FR-01), the service worker's caching of this part (FR-02), drafts saved before a reload (FR-04)
  const perf = useFlagOn('ff.perf.p16604');
  useEffect(() => { setSwStrategy(perf); pwa.configure({ saveDraftsFirst: perf }); setLowBandwidthExtras(perf); }, [perf]);
  usePrefetchBottomBar(nav, path, perf);
  const qc = useQueryClient();
  useEffect(() => {
    const onUpdated = (e) => { if (e.detail?.path === '/api/v1/ui/navigation') qc.invalidateQueries({ queryKey: shellKeys.nav }); };
    window.addEventListener(API_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(API_UPDATED_EVENT, onUpdated);
  }, [qc]);
  const layout = useLayout();
  useLowBandwidth(); // keeps the page's low-bandwidth mark (the data saver, a slow connection, or the person's choice) in step
  // the menu is a rail on a tablet unless the person chose otherwise
  const [storedCollapsed, setCollapsed] = useStoredFlag('erp.shell.collapsed', null);
  const collapsed = storedCollapsed ?? (device && layout === 'tablet');
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
      <div className="app-shell"><main id="main"><ErrorState title={t('menu.error')} error={navQuery.error} onRetry={() => navQuery.refetch()} /></main></div>
    );
  }
  if (!nav) return <div className="app-shell"><main id="main"><Skeleton label={t('menu.loading')} rows={4} /></main></div>;

  const knownRoute = Boolean(route);
  const verdict = guard(nav, path, { knownRoute, context });
  const profile = entryFor(nav, '/account/profile') ?? accountGroup(nav)?.pages.find((p) => p.code === 'profile');
  const groups = sidebarGroups(nav);
  const phone = layout === 'phone';
  const home = (landsOnField(session?.roles) && entryFor(nav, '/field')) || entryFor(nav, '/home');
  const work = nav.groups.find((g) => g.code === 'g-mywork')?.pages[0];
  const scan = entryFor(nav, '/field/scan');
  const messages = nav.groups.find((g) => g.code === 'g-messages')?.pages[0];
  const builtIn = { home: home && { key: 'home', label: t('bottom.home'), icon: 'erp.group.home', route: home.route }, work: work && { key: 'work', label: t('bottom.work'), icon: 'erp.action.inbox', route: work.route }, scan: scan && { key: 'scan', label: t('bottom.scan'), icon: 'erp.action.scan', route: scan.route }, messages: messages && { key: 'messages', label: t('bottom.messages'), icon: 'erp.group.collab', route: messages.route } };
  // Part 166.3, FR-02: with ff.field.p16603 ON the four slots come from the navigation registry for the person's role (ui_bottom_bar); My Work is "Tasks"
  const bottom = (nav.bottomBar?.length ? nav.bottomBar.map((b) => (b.item === 'page' ? { key: b.code, label: labelIn(b, language), icon: b.icon ?? 'erp.action.info', route: b.route } : b.item === 'work' && builtIn.work ? { ...builtIn.work, label: t('bottom.tasks') } : builtIn[b.item])) : [builtIn.home, builtIn.work, builtIn.scan, builtIn.messages]).filter(Boolean);
  const openMenu = () => { if (!menuOpen) window.scrollTo(0, 0); setMenuOpen((o) => !o); };

  return (
    <div className="app-shell" data-collapsed={collapsed} data-device={device ? 'on' : 'off'} data-layout={layout}>
      <I18nSync />
      <a href="#main" className="skip">{t('skip')}</a>
      <header className="sh-header">
        <button type="button" className="sh-icon sh-burger" aria-label={menuOpen ? t('menu.close') : t('menu.open')} aria-expanded={menuOpen} aria-controls="sh-nav" onClick={() => setMenuOpen((o) => !o)}>
          <Icon name="erp.action.more" size={20} />
        </button>
        <button type="button" className="sh-icon sh-collapse" aria-label={collapsed ? t('menu.expand') : t('menu.collapse')} aria-pressed={collapsed} onClick={() => setCollapsed(!collapsed)} title={collapsed ? t('menu.expand') : t('menu.collapse')}>
          <Icon name={collapsed ? 'erp.action.next' : 'erp.action.previous'} size={18} />
        </button>
        <a className="sh-brand" href="/home" onClick={goTo('/home')} aria-label={t('brand.aria')}><strong>ERP</strong></a>
        <button type="button" className="sh-search" onClick={() => setPalette(true)} aria-label={t('search.aria')} aria-keyshortcuts="Control+K" data-testid="search-trigger">
          <Icon name="erp.action.search" size={16} /><span className="sh-search-text">{t('search.button')}</span><kbd className="sh-kbd">Ctrl K</kbd>
        </button>
        <span className="spacer" />
        {extras}
        {!onboarding && <ContextSwitcher context={context} onChange={setContext} />}
        {!onboarding && <QuickCreate items={nav.quickCreate} go={goTo} />}
        {!onboarding && (bell.data?.source === 'notifications' ? <NotificationBell count={bell.data.unread} user={session?.user} go={goTo} /> : approvalsEntry && <Bell count={bell.data?.unread ?? 0} to={approvalsEntry.route} go={goTo} />)}
        <UserMenu name={displayName} theme={theme} setTheme={setTheme} language={language} setLanguage={setLanguage} profileRoute={profile?.route} go={goTo} onSignOut={onSignOut} deviceMenu={device ? <DeviceMenu /> : null} />
      </header>
      {device && <PwaBanners />}
      {identityBar}
      <div className="sh-body">
        <Sidebar groups={groups} account={accountGroup(nav)} consoleGroup={consoleGroup(nav)} path={path.split('?')[0]} go={goTo} language={language} open={menuOpen} onClose={() => setMenuOpen(false)} collapsed={collapsed && !phone} drawOnOpen={perf && phone} />
        <main id="main" tabIndex={-1} ref={mainRef}>
          <Breadcrumbs nav={nav} path={path} go={goTo} language={language} />
          {verdict.ok && route ? <RoutePage route={route} session={session} path={path} /> : <GuardState verdict={verdict.ok ? { reason: 'unknown' } : verdict} path={path} go={goTo} />}
        </main>
      </div>
      {device && phone && <BottomNav items={bottom} path={path.split('?')[0]} go={goTo} moreOpen={menuOpen} onMore={openMenu} />}
      <CommandPalette open={palette} onClose={() => setPalette(false)} nav={nav} favourites={favs.data ?? []} recent={recent.data ?? []} go={open} searchOn={searchOn} path={path} language={language} actions={{ setTheme, setLanguage, openHelp: () => setHelp(true) }} />
      <ShortcutHelp open={help} onClose={() => setHelp(false)} nav={nav} />
      {!onboarding && session && <HelpWidget path={path} />}
    </div>
  );
}
