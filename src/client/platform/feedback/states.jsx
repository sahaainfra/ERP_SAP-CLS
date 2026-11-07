import { isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../design/Icon.jsx';
import { useT } from '../i18n/index.js';

// The standard states of every page (part 03.04, FR-08): loading skeleton, empty (illustration, message, primary action), error (message,
// correlation ID, retry) and no permission (what is missing, whom to ask). One look everywhere; QueryState and the Object Page use them.

/** Placeholder rows while data loads. */
export function Skeleton({ label, rows = 3 }) {
  const t = useT('common');
  return (
    <div className="skeleton" role="status" aria-busy="true" aria-label={label ?? t('loading')} data-testid="skeleton">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton-row" />)}
    </div>
  );
}

/** A small drawing for an empty page: a tray with a sheet, drawn with the theme's colours. */
function Illustration() {
  const t = useT('common');
  return (
    <svg className="fb-illustration" viewBox="0 0 120 80" width="120" height="80" role="img" aria-label={t('empty.alt')} focusable="false">
      <rect x="18" y="52" width="84" height="16" rx="3" fill="var(--erp-color-bg-surface-sunken)" stroke="var(--erp-color-border-strong)" strokeWidth="2" />
      <path d="M28 52 L36 28 H84 L92 52" fill="var(--erp-color-bg-surface)" stroke="var(--erp-color-border-strong)" strokeWidth="2" strokeLinejoin="round" />
      <rect x="44" y="12" width="32" height="28" rx="2" fill="var(--erp-color-bg-surface)" stroke="var(--erp-color-brand-primary)" strokeWidth="2" />
      <path d="M50 20 H70 M50 26 H70 M50 32 H62" stroke="var(--erp-color-brand-primary)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Nothing to show yet: an illustration, what it means and what to do next. */
export function EmptyState({ title, message, action = null, compact = false }) {
  return (
    <div className={`state fb-empty${compact ? ' is-compact' : ''}`} data-testid="empty-state">
      {!compact && <Illustration />}
      <h2>{title}</h2>
      {message && <p>{message}</p>}
      {/* the action is { label, onClick }, or an element the page made itself (a button or a link) */}
      {action && (isValidElement(action) ? action : <button type="button" className="btn btn-primary" onClick={action.onClick}>{action.label}</button>)}
    </div>
  );
}

/** Something failed: the message, the correlation ID to quote to support, and a way to try again. */
export function ErrorState({ title, error, onRetry }) {
  const t = useT('common');
  return (
    <div className="state state-error fb-error" role="alert" data-testid="error-state">
      <h2><Icon name="erp.state.exception" size={20} /> {title ?? t('error.title')}</h2>
      <p>{error?.message ?? t('error.body')}</p>
      {error?.correlationId && <p className="muted">{t('error.correlation', { id: '' })}<code data-testid="correlation-id">{error.correlationId}</code></p>}
      {onRetry && <button type="button" className="btn" onClick={onRetry}>{t('tryAgain')}</button>}
    </div>
  );
}

/** The person lacks a permission: what it is, and whom to ask (a system administrator, or the people who hold it). */
export function NoPermission({ what, permission, ask }) {
  const t = useT('common');
  const box = useRef(null);
  // A page that is only this message still needs its one level-1 heading and a title (part 03.10 checklist); one that has a heading of its own keeps this as a subheading.
  const [lead, setLead] = useState(false);
  useLayoutEffect(() => {
    const others = [...document.querySelectorAll('main h1, #main h1')].filter((h) => !box.current?.contains(h));
    setLead(others.length === 0);
  }, []);
  useEffect(() => { if (lead && what) document.title = `${what} - ERP`; }, [lead, what]);
  const Heading = lead ? 'h1' : 'h2';
  return (
    <div className="state fb-noperm" role="alert" data-testid="no-permission" ref={box}>
      <Heading><Icon name="erp.state.locked" size={20} /> {t('noPermission.title', { what })}</Heading>
      <p>{t('noPermission.body', { need: /^an? /.test(String(permission)) ? permission : t('noPermission.need', { permission }), ask: ask ?? t('ask.admin') })}</p>
    </div>
  );
}

/** The right state for a failed query: no permission for a 403, an error with its correlation ID for anything else. */
export function QueryError({ error, what, permission, onRetry }) {
  const t = useT('common');
  if (error?.status === 403) return <NoPermission what={what} permission={permission} />;
  if (error?.status === 404) return <ErrorState title={t('query.notFound', { what })} error={error} onRetry={onRetry} />;
  return <ErrorState title={t('query.loadFailed', { what })} error={error} onRetry={onRetry} />;
}
