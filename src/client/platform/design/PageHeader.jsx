import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// The page header of every page (part 166.2, U-01; UI v3 standard §3): the one level-1 heading, a subtitle, an optional breadcrumb, a status
// badge, the key facts of a record (status, amount, dates, owner), the primary and secondary actions and a "…" menu for the rest. Every
// registered page renders it (lint rule erp/page-header-required, e2e/ui-v3.spec.js), so the header looks and behaves the same everywhere and a
// later part changes it in one place. The heading keeps the id the page gave it, so aria-labelledby and the tests that name it still work.

/** The "…" menu: a button and a list of { label, onClick, disabled, testid } items, closed by Escape or a click outside. */
function MoreMenu({ items, label = 'More actions' }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="ph-more" ref={box}>
      <button type="button" className="btn ph-more-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)} data-testid="ph-more">
        <Icon name="erp.action.more" size={20} />
      </button>
      {open && (
        <ul className="ph-more-list" role="menu">
          {items.filter(Boolean).map((it) => (
            <li key={it.label} role="none">
              <button type="button" role="menuitem" disabled={it.disabled} data-testid={it.testid} onClick={() => { setOpen(false); it.onClick?.(); }}>{it.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * `<PageHeader id="x-h" title={t('x.title')} subtitle={t('x.intro')} actions={<button …/>} />`.
 *
 * - `id`, `titleProps`: the heading's id and any other attribute of the <h1> (data-testid, tabIndex, ref, className).
 * - `crumb`: a breadcrumb node shown above the title.
 * - `status`: a StatusBadge (or any node) next to the title.
 * - `subtitle`: the one-line intro; `meta`: the link row under it (back to the list, document number, project).
 * - `facts`: [{ label, value, testid }] — the key facts of a record, shown as a definition list.
 * - `actions` (primary, right-aligned), `secondary` (before them), `menu`: [{ label, onClick }] for the "…" menu.
 * - `srOnly`: the page draws its title in its own layout (a kiosk, a phone screen); the header is there for the heading and is visually hidden.
 * - `children`: anything else that belongs to the header (a tab row, a filter summary).
 */
export default function PageHeader({ id, title, titleProps, crumb, status, subtitle, meta, facts, actions, secondary, menu, srOnly = false, testid, className = '', children }) {
  const hasActions = Boolean(actions || secondary || menu?.length);
  return (
    <header className={`ph${srOnly ? ' ph-sr-only' : ''}${className ? ` ${className}` : ''}`} data-page-header="" data-testid={testid}>
      {crumb && <nav aria-label="Breadcrumb" className="breadcrumb ph-crumb">{crumb}</nav>}
      <div className="ph-row">
        <div className="ph-title">
          <h1 id={id} {...titleProps}>{title}</h1>
          {status && <span className="ph-status">{status}</span>}
        </div>
        {hasActions && (
          <div className="ph-actions">
            {secondary}
            {actions}
            {menu?.length ? <MoreMenu items={menu} /> : null}
          </div>
        )}
      </div>
      {subtitle && <p className="muted ph-subtitle">{subtitle}</p>}
      {meta && <p className="ph-meta">{meta}</p>}
      {facts?.length ? (
        <dl className="ph-facts" aria-label="Key facts">
          {facts.filter(Boolean).map((f) => <div key={f.label} className="ph-fact"><dt>{f.label}</dt><dd data-testid={f.testid}>{f.value}</dd></div>)}
        </dl>
      ) : null}
      {children}
    </header>
  );
}
