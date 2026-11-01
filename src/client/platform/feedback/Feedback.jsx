import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../design/Icon.jsx';

// Toasts, the banner and the offline banner (part 03.04, FR-07, FR-08). A toast is a short message that goes by itself after a few seconds
// (errors stay until closed, so they are not missed); both announce themselves to screen readers (aria-live). The provider wraps the shell.
const ToastContext = createContext(null);
const ICON = { success: 'erp.state.approved', error: 'erp.state.rejected', info: 'erp.action.info', warning: 'erp.state.returned' };
const TIMEOUT = { success: 5000, info: 6000, warning: 9000, error: 0 };

export function useToast() {
  const ctx = useContext(ToastContext);
  // outside a provider (a test, an isolated page) the call is harmless
  return ctx ?? { show: () => 0, success: () => 0, error: () => 0, info: () => 0, warning: () => 0, dismiss: () => {} };
}

/** A banner inside a page: info, success, warning or error, with an optional action and close. */
export function Banner({ tone = 'info', title, children, action = null, onClose = null, testId }) {
  const role = tone === 'error' || tone === 'warning' ? 'alert' : 'status';
  return (
    <div className={`fb-banner fb-banner-${tone}`} role={role} data-testid={testId}>
      <Icon name={ICON[tone]} size={18} />
      <div className="fb-banner-body">{title && <strong>{title} </strong>}{children}</div>
      {action && <button type="button" className="btn btn-small" onClick={action.onClick}>{action.label}</button>}
      {onClose && <button type="button" className="btn btn-small" onClick={onClose} aria-label="Dismiss">×</button>}
    </div>
  );
}

/** "You are offline": shown at the top of the page while the browser has no connection, and gone when it returns. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (online) return null;
  return <div className="fb-offline" role="alert" data-testid="offline-banner"><Icon name="erp.action.offline" size={18} /> You are offline. What you type stays on this page, and drafts are saved again when the connection returns.</div>;
}

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback((tone, message, { title = '', action = null } = {}) => {
    seq.current += 1;
    const id = seq.current;
    setToasts((t) => [...t.slice(-3), { id, tone, message, title, action }]);
    if (TIMEOUT[tone]) setTimeout(() => dismiss(id), TIMEOUT[tone]);
    return id;
  }, [dismiss]);
  const api = useMemo(() => ({ show, dismiss, success: (m, o) => show('success', m, o), error: (m, o) => show('error', m, o), info: (m, o) => show('info', m, o), warning: (m, o) => show('warning', m, o) }), [show, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      <OfflineBanner />
      {children}
      <div className="fb-toasts" aria-live="polite" aria-atomic="false" data-testid="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`fb-toast fb-toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'} data-testid={`toast-${t.tone}`}>
            <Icon name={ICON[t.tone]} size={18} />
            <div className="fb-toast-body">{t.title && <strong>{t.title}</strong>}<span>{t.message}</span></div>
            {t.action && <button type="button" className="btn btn-small" onClick={() => { t.action.onClick(); dismiss(t.id); }}>{t.action.label}</button>}
            <button type="button" className="fb-toast-close" aria-label="Dismiss this message" onClick={() => dismiss(t.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
