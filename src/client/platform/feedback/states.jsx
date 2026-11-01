import Icon from '../design/Icon.jsx';

// The standard states of every page (part 03.04, FR-08): loading skeleton, empty (illustration, message, primary action), error (message,
// correlation ID, retry) and no permission (what is missing, whom to ask). One look everywhere; QueryState and the Object Page use them.

/** Placeholder rows while data loads. */
export function Skeleton({ label = 'Loading', rows = 3 }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label={label} data-testid="skeleton">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton-row" />)}
    </div>
  );
}

/** A small drawing for an empty page: a tray with a sheet, drawn with the theme's colours. */
function Illustration() {
  return (
    <svg className="fb-illustration" viewBox="0 0 120 80" width="120" height="80" role="img" aria-label="Nothing here yet" focusable="false">
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
      {action && <button type="button" className="btn btn-primary" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

/** Something failed: the message, the correlation ID to quote to support, and a way to try again. */
export function ErrorState({ title = 'Something went wrong', error, onRetry }) {
  return (
    <div className="state state-error fb-error" role="alert" data-testid="error-state">
      <h2><Icon name="erp.state.exception" size={20} /> {title}</h2>
      <p>{error?.message ?? 'The request failed. Try again.'}</p>
      {error?.correlationId && <p className="muted">Correlation ID: <code data-testid="correlation-id">{error.correlationId}</code></p>}
      {onRetry && <button type="button" className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** The person lacks a permission: what it is, and whom to ask (a system administrator, or the people who hold it). */
export function NoPermission({ what, permission, ask = 'a system administrator' }) {
  return (
    <div className="state fb-noperm" role="alert" data-testid="no-permission">
      <h2><Icon name="erp.state.locked" size={20} /> You do not have access to {what}</h2>
      <p>This needs {/^an? /.test(String(permission)) ? permission : `the ${permission} permission`}. Ask {ask} to grant it.</p>
    </div>
  );
}

/** The right state for a failed query: no permission for a 403, an error with its correlation ID for anything else. */
export function QueryError({ error, what, permission, onRetry }) {
  if (error?.status === 403) return <NoPermission what={what} permission={permission} />;
  if (error?.status === 404) return <ErrorState title={`Could not find ${what}`} error={error} onRetry={onRetry} />;
  return <ErrorState title={`Could not load ${what}`} error={error} onRetry={onRetry} />;
}
