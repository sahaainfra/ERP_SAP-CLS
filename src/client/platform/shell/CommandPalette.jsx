import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { searchEntries, shortcutMap } from './nav.js';
import Icon from '../design/Icon.jsx';

/**
 * The go-to palette behind Ctrl/Cmd+K (FR-04, FR-07): type to jump to any page the person may open, from the navigation registry; with
 * nothing typed it offers their favourites and recent records. The global search of part 03.08 replaces the page results with a search of
 * records and documents; this stays as the way to move around by keyboard.
 */
export default function CommandPalette({ open, onClose, nav, favourites = [], recent = [], go }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef(null);
  useEffect(() => {
    if (open) { setQ(''); setActive(0); setTimeout(() => input.current?.focus(), 0); }
  }, [open]);

  const items = useMemo(() => {
    if (q.trim()) return searchEntries(nav, q).map((p) => ({ id: `p-${p.code}`, label: p.label, hint: p.groupLabel, route: p.route, icon: p.icon }));
    return [
      ...favourites.map((f) => ({ id: `f-${f.id}`, label: f.title, hint: 'Favourite', route: f.route, icon: 'erp.action.pin' })),
      ...recent.map((r) => ({ id: `r-${r.entity}-${r.entityId}`, label: r.title, hint: `Recent ${r.type.toLowerCase()}`, route: r.route, icon: 'erp.action.history' })),
    ];
  }, [q, nav, favourites, recent]);

  if (!open) return null;
  const pick = (item) => { onClose(); go(item.route); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(items.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); pick(items[active]); }
  };
  return (
    <div className="sh-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sh-palette" role="dialog" aria-modal="true" aria-label="Search or go to" data-testid="palette">
        <input
          ref={input} type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"
          aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined} aria-label="Search pages"
          placeholder="Go to a page, for example approvals or users" value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey}
        />
        <ul id="palette-list" role="listbox" aria-label="Results">
          {items.map((item, i) => (
            <li key={item.id} id={`palette-${item.id}`} role="option" aria-selected={i === active}>
              <button type="button" tabIndex={-1} onMouseEnter={() => setActive(i)} onClick={() => pick(item)}>
                <Icon name={item.icon ?? 'erp.action.search'} size={16} /> <span>{item.label}</span> <span className="muted small">{item.hint}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="muted small sh-palette-empty">{q.trim() ? `No page matches "${q}" that you can open.` : 'Type to find a page. Your favourites and recent records appear here.'}</li>}
        </ul>
        <p className="muted small">Enter opens, Esc closes. Press ? anywhere for the keyboard shortcuts.</p>
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
