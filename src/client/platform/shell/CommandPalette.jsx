import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { searchEntries, shortcutMap } from './nav.js';
import Icon from '../design/Icon.jsx';
import { clickResult, useCommands, useSearch } from '../search/api.js';
import { OPEN_CONTEXT_EVENT } from './ContextSwitcher.jsx';

/**
 * The command palette behind Ctrl/Cmd+K (part 03.08, FR-03): type to search the records the person may see (grouped by kind, from the search
 * service), the pages of the navigation registry and the actions they may run; with nothing typed it offers the actions that fit the page they
 * are on, then their favourites and recent records. Start with ">" for actions only. Everything is reached from the keyboard. With the search
 * flag off it is the go-to-a-page palette of part 03.05.
 */
const useDebounced = (value, ms) => {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
};

/** The text with the typed words in bold. */
function Mark({ text, q }) {
  const terms = [...new Set(String(q ?? '').toLowerCase().split(/\s+/).filter((t) => t.length >= 2))];
  if (!text || terms.length === 0) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return String(text).split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>));
}

const norm = (t) => String(t ?? '').toLowerCase();
const matchesCommand = (c, needle) => {
  const hay = `${norm(c.label)} ${norm(c.labelHi)} ${norm(c.keywords)} ${norm(c.group)}`;
  return needle.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

export default function CommandPalette({ open, onClose, nav, favourites = [], recent = [], go, searchOn = false, path = '/', language = 'en', actions = {} }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const list = useRef(null);
  const client = useQueryClient();
  useEffect(() => {
    if (open) { setQ(''); setActive(0); setTimeout(() => input.current?.focus(), 0); }
  }, [open]);

  // Escape closes it wherever the focus is (it may not have reached the field yet)
  useEffect(() => {
    if (!open) return undefined;
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  const commandMode = q.trimStart().startsWith('>');
  const text = (commandMode ? q.trimStart().slice(1) : q).trim();
  const debounced = useDebounced(text, 160);
  const here = path.split('?')[0];
  const cmds = useCommands(here, open && searchOn);
  const search = useSearch({ q: debounced, source: 'palette' }, { enabled: open && searchOn && !commandMode && debounced.length > 0 });
  const label = (x) => (language === 'hi' && x.labelHi ? x.labelHi : x.label);

  const { items, sections } = useMemo(() => {
    const out = [];
    const heads = [];
    const add = (heading, list) => { if (list.length) { heads.push({ at: out.length, heading }); out.push(...list); } };
    const commands = (cmds.data ?? []).map((c) => ({ id: `c-${c.code}`, kind: 'command', label: label(c), hint: c.group, icon: c.icon, route: c.route, clientAction: c.clientAction, here: c.here, command: c }));
    // the "create" shortcuts of the navigation registry are actions too (one per route)
    const known = new Set(commands.map((c) => c.route).filter(Boolean));
    for (const qc of nav?.quickCreate ?? []) if (!known.has(qc.route)) commands.push({ id: `qc-${qc.code}`, kind: 'command', label: qc.label, hint: 'Create', icon: qc.icon ?? 'erp.action.create', route: qc.route, command: { label: qc.label, keywords: 'new create add', group: 'Create' } });
    if (!text) {
      add('Actions', commands.filter((c) => c.here || c.hint === 'Create' || (c.hint === 'Actions' && c.route)).sort((a, b) => Number(Boolean(b.here)) - Number(Boolean(a.here))).slice(0, 6));
      add('Favourites', favourites.map((f) => ({ id: `f-${f.id}`, kind: 'page', label: f.title, hint: f.kind === 'record' ? 'Favourite record' : 'Favourite page', route: f.route, icon: 'erp.action.pin', entity: f.entity, entityId: f.entityId })));
      add('Recent', recent.map((r) => ({ id: `r-${r.entity}-${r.entityId}`, kind: 'page', label: r.title, hint: r.type, route: r.route, icon: 'erp.action.history', entity: r.entity, entityId: r.entityId })));
      return { items: out, sections: heads };
    }
    const needle = norm(text);
    const matched = commands.filter((c) => matchesCommand(c.command, needle)).sort((a, b) => Number(Boolean(b.here)) - Number(Boolean(a.here)));
    if (commandMode) { add('Actions', matched.slice(0, 12)); return { items: out, sections: heads }; }
    // an action whose name holds the words comes first; one that matched only by a keyword follows the pages
    const named = matched.filter((c) => norm(c.label).includes(needle) || norm(c.command.labelHi).includes(needle));
    add('Actions', named.slice(0, 4));
    add('Pages', searchEntries(nav, text, 5).map((p) => ({ id: `p-${p.code}`, kind: 'page', label: label(p), hint: p.groupLabel, route: p.route, icon: p.icon })));
    add('Actions by keyword', matched.filter((c) => !named.includes(c)).slice(0, 3));
    if (searchOn) {
      for (const g of search.data?.groups ?? []) {
        add(`${label(g)} (${g.total})`, g.items.map((it, n) => ({ id: `s-${it.id}`, kind: 'record', label: it.title, sub: [it.code && it.code !== it.title ? it.code : null, it.subtitle].filter(Boolean).join(' · '), hint: it.status ? it.status.replace(/_/g, ' ').toLowerCase() : '', icon: g.icon, route: it.route, entity: it.entity, entityId: it.entityId, position: n })));
      }
      out.push({ id: 'all', kind: 'all', label: `Show all results for "${text}"`, hint: 'Advanced search', icon: 'erp.action.search', route: `/search?q=${encodeURIComponent(text)}` });
      heads.push({ at: out.length - 1, heading: '' });
    }
    return { items: out, sections: heads };
  }, [text, commandMode, cmds.data, search.data, nav, favourites, recent, language]);

  useEffect(() => { setActive(0); }, [text, commandMode]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [active, items]);

  if (!open) return null;
  const pick = (item) => {
    if (!item) return;
    if (item.clientAction) {
      onClose();
      const [kind, value] = item.clientAction.split(':');
      if (kind === 'theme') actions.setTheme?.(value);
      else if (kind === 'language') actions.setLanguage?.(value);
      else if (kind === 'help') actions.openHelp?.();
      else if (kind === 'context') window.dispatchEvent(new CustomEvent(OPEN_CONTEXT_EVENT));
      return;
    }
    if (item.kind === 'record') clickResult({ entity: item.entity, entityId: item.entityId, position: item.position ?? 0, q: text }, client);
    onClose();
    go(item.route);
  };
  const move = (to) => setActive(Math.max(0, Math.min(to, items.length - 1)));
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(active - 1); }
    else if (e.key === 'PageDown') { e.preventDefault(); move(active + 5); }
    else if (e.key === 'PageUp') { e.preventDefault(); move(active - 5); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Tab') { e.preventDefault(); move(active + (e.shiftKey ? -1 : 1)); }
  };
  const busy = searchOn && !commandMode && debounced.length > 0 && (search.isFetching || debounced !== text);
  const realCount = items.filter((i) => i.kind !== 'all').length;
  const failed = searchOn && !commandMode && search.isError;
  return (
    <div className="sh-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sh-palette" role="dialog" aria-modal="true" aria-label="Search or go to" data-testid="palette">
        <input
          ref={input} type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" autoComplete="off" spellCheck="false"
          aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined} aria-label={searchOn ? 'Search records, pages and actions' : 'Search pages'}
          placeholder={searchOn ? 'Search records, pages and actions. Start with > for actions' : 'Go to a page, for example approvals or users'} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
        />
        <ul id="palette-list" role="listbox" aria-label="Results" ref={list}>
          {items.map((item, i) => (
            <Fragment key={item.id}>
              {sections.filter((s) => s.at === i && s.heading).map((s) => <li key={s.heading} role="presentation" className="sh-palette-group">{s.heading}</li>)}
              <li id={`palette-${item.id}`} role="option" aria-selected={i === active}>
                <button type="button" tabIndex={-1} onMouseEnter={() => setActive(i)} onClick={() => pick(item)}>
                  <Icon name={item.icon ?? 'erp.action.search'} size={16} />
                  <span className="sh-palette-main"><span className="sh-palette-title"><Mark text={item.label} q={text} /></span>{item.sub && <span className="muted small sh-palette-sub"><Mark text={item.sub} q={text} /></span>}</span>
                  <span className="muted small">{item.hint}</span>
                </button>
              </li>
            </Fragment>
          ))}
          {busy && realCount === 0 && <li className="muted small sh-palette-empty" role="status">Searching…</li>}
          {failed && <li className="sh-palette-empty" role="alert">The search could not be completed. {search.error?.message}{search.error?.correlationId && <> Correlation ID: <code>{search.error.correlationId}</code></>}</li>}
          {!busy && !failed && realCount === 0 && <li className="muted small sh-palette-empty">{text ? `Nothing matches "${text}" that you can open. Try fewer letters, or another spelling.` : 'Type to find a record, a page or an action. Your favourites and recent records appear here.'}</li>}
        </ul>
        <p className="muted small" aria-live="polite">{busy ? 'Searching…' : 'Enter opens, arrows move, Esc closes. Start with > for actions. Press ? anywhere for the keyboard shortcuts.'}</p>
      </div>
    </div>
  );
}

/** The list of keyboard shortcuts (opened with ?). */
export function ShortcutHelp({ open, onClose, nav }) {
  const map = shortcutMap(nav);
  if (!open) return null;
  return (
    <div className="sh-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="sh-palette" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-testid="shortcut-help">
        <h2>Keyboard shortcuts</h2>
        <dl className="sh-keys">
          <dt><kbd>Ctrl</kbd> + <kbd>K</kbd></dt><dd>Search or go to a page</dd>
          <dt><kbd>?</kbd></dt><dd>This list</dd>
          {Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([k, p]) => (
            <Fragment key={k}><dt><kbd>g</kbd> then <kbd>{k}</kbd></dt><dd>{p.label}</dd></Fragment>
          ))}
        </dl>
        <button type="button" className="btn" autoFocus onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
