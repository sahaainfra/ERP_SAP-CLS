import { useEffect, useRef, useState } from 'react';
import Icon from '../design/Icon.jsx';
import { useT } from '../i18n/index.js';
import { shellKeys } from '../shell/api.js';
import { useLiveRefresh } from '../realtime/socket.js';
import { NTF, useMark, useNotifications, useReadAll } from './api.js';

/**
 * The bell of the notification centre (part 04.06, FR-04): the number of unread notifications, a drawer with the latest, and a way to the whole list. It follows the person's own room,
 * so a notification appears the moment the server makes it.
 */
export default function NotificationBell({ count, user, go }) {
  const t = useT('shell');
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  const panel = useRef(null);
  useLiveRefresh(user ? [`user:${user}`] : [], [NTF, shellKeys.bell]);
  const list = useNotifications({ state: 'inbox', limit: 8 });
  const mark = useMark();
  const readAll = useReadAll();
  useEffect(() => {
    if (!open) return undefined;
    panel.current?.focus();
    const away = (e) => { if (!panel.current?.contains(e.target) && !button.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  const open1 = (n) => { if (!n.read) mark.mutate({ id: n.id, action: 'read' }); setOpen(false); if (n.link) go(n.link)({ preventDefault() {} }); };
  return (
    <span className="ntf-bell">
      <button type="button" ref={button} className="sh-icon sh-bell" aria-haspopup="dialog" aria-expanded={open} aria-label={count > 0 ? t('bell.unread', { count }) : t('bell.none2')} title={t('bell.notifications')} data-testid="bell" onClick={() => setOpen(!open)}>
        <Icon name="erp.action.notify" size={20} />
        {count > 0 && <span className="sh-badge" data-testid="bell-count">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="ntf-panel" role="dialog" aria-label={t('bell.notifications')} tabIndex={-1} ref={panel} data-testid="bell-drawer">
          <div className="ntf-panel-head">
            <h2>{t('bell.notifications')}</h2>
            <button type="button" className="btn btn-small" disabled={count === 0 || readAll.isPending} onClick={() => readAll.mutate({})}>{t('bell.readAll')}</button>
          </div>
          {list.isPending && <p className="muted" role="status">{t('bell.loading')}</p>}
          {list.isError && <p className="error" role="alert">{t('bell.error')}</p>}
          {list.data && list.data.rows.length === 0 && <p className="muted" data-testid="bell-empty">{t('bell.empty')}</p>}
          {list.data && list.data.rows.length > 0 && (
            <ul className="ntf-list" data-testid="bell-list">
              {list.data.rows.map((n) => (
                <li key={n.id} className={n.read ? 'ntf-item' : 'ntf-item ntf-unread'}>
                  <button type="button" className="ntf-open" onClick={() => open1(n)}>
                    <strong>{n.title}</strong>
                    <span className="small">{n.body}</span>
                    <span className="muted small">{new Date(n.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="ntf-panel-foot"><a href="/notifications" onClick={(e) => { setOpen(false); go('/notifications')(e); }}>{t('bell.all')}</a> · <a href="/notifications/preferences" onClick={(e) => { setOpen(false); go('/notifications/preferences')(e); }}>{t('bell.prefs')}</a></p>
        </div>
      )}
    </span>
  );
}
