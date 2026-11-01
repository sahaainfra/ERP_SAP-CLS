import { useEffect, useRef, useState } from 'react';
import Icon from '../design/Icon.jsx';
import { LANGUAGES, THEMES } from '../design/appearance.js';
import { breadcrumbs, entryFor, groupHolds } from './nav.js';
import { useFavouriteActions, useFavourites } from './api.js';
import { useToast } from '../feedback/Feedback.jsx';

const THEME_LABEL = { light: 'Light', dark: 'Dark', 'high-contrast': 'High contrast' };
const LANGUAGE_LABEL = { en: 'English', hi: 'हिन्दी' };
const labelOf = (item, language) => (language === 'hi' && item.labelHi) || item.label;

/** Open a popover; it closes on Escape, on a click outside it, and returns focus to its button. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const button = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return { open, setOpen, box, button };
}

const useStored = (key, initial) => {
  const [value, setValue] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? initial; } catch { return initial; }
  });
  const set = (next) => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* kept for this page view only */ }
  };
  return [value, set];
};
export const useStoredFlag = (key, initial) => useStored(key, initial);

function NavLink({ item, path, go, language }) {
  const text = labelOf(item, language);
  return (
    <a href={item.route} onClick={go(item.route)} aria-current={item.route.split('?')[0] === path ? 'page' : undefined} title={text}>
      <Icon name={item.icon ?? 'erp.action.info'} size={18} /><span className="sh-label">{text}</span>
    </a>
  );
}

function Section({ group, path, go, language, name, closedGroups, setClosedGroups }) {
  const closed = closedGroups.includes(group.code) && !groupHolds(group, path);
  const toggle = (e) => {
    e.preventDefault();
    setClosedGroups(closed ? closedGroups.filter((c) => c !== group.code) : [...closedGroups, group.code]);
  };
  return (
    <section className="sh-group" data-group={group.code} aria-label={name ?? labelOf(group, language)}>
      <h2>
        <button type="button" aria-expanded={!closed} onClick={toggle} title={labelOf(group, language)}>
          <Icon name={group.icon ?? 'erp.group.admin'} size={18} /><span className="sh-label">{name ?? labelOf(group, language)}</span>
          <span className="sh-caret" aria-hidden="true">{closed ? '▸' : '▾'}</span>
        </button>
      </h2>
      <ul hidden={closed}>
        {group.pages.map((p) => <li key={p.code}><NavLink item={p} path={path} go={go} language={language} /></li>)}
      </ul>
    </section>
  );
}

/** The sidebar: the registry's groups the person may see, then the account pages and the technical console (FR-01, FR-02, FR-09). */
export function Sidebar({ groups, account, consoleGroup, path, go, language, open, onClose, collapsed }) {
  const [closedGroups, setClosedGroups] = useStored('erp.shell.closed-groups', []);
  const wrapped = (to) => (e) => { go(to)(e); onClose(); };
  return (
    <nav id="sh-nav" className="sh-nav" aria-label="Main" data-open={open} data-collapsed={collapsed}>
      {groups.map((g) => <Section key={g.code} group={g} path={path} go={wrapped} language={language} closedGroups={closedGroups} setClosedGroups={setClosedGroups} />)}
      {account && <Section group={account} path={path} go={wrapped} language={language} name="Account" closedGroups={closedGroups} setClosedGroups={setClosedGroups} />}
      {consoleGroup && <Section group={consoleGroup} path={path} go={wrapped} language={language} name="Technical Console" closedGroups={closedGroups} setClosedGroups={setClosedGroups} />}
    </nav>
  );
}

export function QuickCreate({ items, go }) {
  const { open, setOpen, box, button } = usePopover();
  if (items.length === 0) return null;
  return (
    <span className="sh-menu" ref={box}>
      <button type="button" ref={button} className="sh-icon sh-create" aria-haspopup="menu" aria-expanded={open} aria-label="Quick create" title="Create" onClick={() => setOpen(!open)} data-testid="quick-create"><Icon name="erp.action.create" size={20} /></button>
      {open && (
        <ul className="sh-pop" role="menu" aria-label="Create">
          {items.map((q) => (
            <li key={q.code} role="none"><a role="menuitem" href={q.route} onClick={(e) => { setOpen(false); go(q.route)(e); }}>{q.label}</a></li>
          ))}
        </ul>
      )}
    </span>
  );
}

/** The bell: until the notification service (04.06) exists it counts the requests waiting for this person and opens them. */
export function Bell({ count, to, go }) {
  if (!to) return null;
  return (
    <a className="sh-icon sh-bell" href={to} onClick={go(to)} aria-label={count > 0 ? `${count} approval${count === 1 ? '' : 's'} waiting for you` : 'No approvals waiting for you'} title="Approvals waiting for you" data-testid="bell">
      <Icon name="erp.action.notify" size={20} />
      {count > 0 && <span className="sh-badge" data-testid="bell-count">{count > 99 ? '99+' : count}</span>}
    </a>
  );
}

export function UserMenu({ name, theme, setTheme, language, setLanguage, profileRoute, go, onSignOut, deviceMenu = null }) {
  const { open, setOpen, box, button } = usePopover();
  return (
    <span className="sh-menu" ref={box}>
      <button type="button" ref={button} className="sh-user" aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${name}`} onClick={() => setOpen(!open)} data-testid="user-menu">
        <Icon name="erp.admin.iam" size={18} /><span className="sh-user-name" data-testid="signed-in-as">{name}</span>
      </button>
      {open && (
        <div className="sh-pop sh-user-pop" role="menu" aria-label="Account">
          {profileRoute && <a role="menuitem" href={profileRoute} onClick={(e) => { setOpen(false); go(profileRoute)(e); }}>My profile and preferences</a>}
          <label className="shell-field"><span>Language</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGUAGES.map((l) => <option key={l} value={l}>{LANGUAGE_LABEL[l] ?? l}</option>)}</select>
          </label>
          <label className="shell-field"><span>Theme</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>{THEMES.map((t) => <option key={t} value={t}>{THEME_LABEL[t] ?? t}</option>)}</select>
          </label>
          {deviceMenu}
          {onSignOut && <button type="button" role="menuitem" className="btn btn-small" onClick={() => { setOpen(false); onSignOut(); }}>Sign out</button>}
        </div>
      )}
    </span>
  );
}

/**
 * The bottom navigation of a phone (part 03.06, FR-01): Home, My Work, Scan, Messages and More, each a thumb-sized target. An item is there only
 * when its page exists for the person (Messages appears once the Messages part registers a page). More opens the whole menu.
 */
export function BottomNav({ items, path, go, moreOpen, onMore }) {
  return (
    <nav className="sh-bottom" aria-label="Quick destinations" data-testid="bottom-nav">
      {items.map((i) => (
        <a key={i.key} href={i.route} onClick={go(i.route)} aria-current={i.route.split('?')[0] === path ? 'page' : undefined} data-testid={`bottom-${i.key}`}>
          <Icon name={i.icon} size={22} /><span>{i.label}</span>
        </a>
      ))}
      <button type="button" aria-label={moreOpen ? 'Close menu' : 'Open menu'} aria-expanded={moreOpen} aria-controls="sh-nav" onClick={onMore} data-testid="bottom-more">
        <Icon name="erp.action.more" size={22} /><span>More</span>
      </button>
    </nav>
  );
}

/** Add the current page to the person's favourites, or take it out again. */
function FavouriteToggle({ nav, path }) {
  const favs = useFavourites();
  const { add, remove } = useFavouriteActions();
  const toast = useToast();
  const entry = entryFor(nav, path);
  if (!entry || entry.code === 'home' || !favs.data) return null;
  const mine = favs.data.find((f) => f.kind === 'page' && f.navCode === entry.code);
  const busy = add.isPending || remove.isPending;
  const toggle = () => {
    if (mine) remove.mutate(mine.id, { onSuccess: () => toast.info(`${entry.label} removed from your favourites.`) });
    else add.mutate({ navCode: entry.code }, { onSuccess: () => toast.success(`${entry.label} added to your favourites.`), onError: (e) => toast.error(e.message) });
  };
  return (
    <button type="button" className="btn btn-small sh-fav" aria-pressed={Boolean(mine)} disabled={busy} onClick={toggle} data-testid="favourite-toggle">
      <Icon name="erp.action.pin" size={14} /> {mine ? 'Remove from favourites' : 'Add to favourites'}
    </button>
  );
}

/** Home › group › page, from the registry (FR-05), and the favourite toggle of the page. */
export function Breadcrumbs({ nav, path, go }) {
  const crumbs = breadcrumbs(nav, path);
  if (crumbs.length === 0) return null;
  return (
    <div className="sh-crumbs">
      <nav aria-label="You are here">
        <ol>
          {crumbs.map((c, i) => (
            <li key={`${c.label}-${i}`} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
              {c.to ? <a href={c.to} onClick={go(c.to)}>{c.label}</a> : c.label}
            </li>
          ))}
        </ol>
      </nav>
      <FavouriteToggle nav={nav} path={path} />
    </div>
  );
}
