import { useNavigation, useLaunchpad } from '../../platform/shell/api.js';
import { flatPages } from '../../platform/shell/nav.js';
import { useLang, useT } from '../../platform/i18n/index.js';
import { useOnline } from '../../platform/device/layout.js';
import { useSyncQueue } from '../../platform/device/syncQueue.js';
import { useLowBandwidth } from '../../platform/device/lowBandwidth.js';
import { usePullToRefresh } from '../../platform/device/gestures.js';
import { EmptyState } from '../../platform/feedback/states.jsx';
import LocationNotice from '../../platform/device/LocationNotice.jsx';
import { QueryState } from '../core/pages/ui.jsx';
import Icon from '../../platform/design/Icon.jsx';
import { confirmLeave } from '../../platform/forms/guard.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

const go = (to) => (e) => {
  e.preventDefault();
  if (!confirmLeave()) return;
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

/**
 * Field Home (Mobile, part 03.06 FR-07): the quick actions of a site person, large enough for a thumb, with whether the device is online and
 * how many things are waiting to be sent. A tile is there when its page exists and the person may open it; Punch, DPR, Inspections and
 * Messages appear as their parts register a page for them.
 */
export default function FieldHomePage() {
  const nav = useNavigation();
  const lp = useLaunchpad();
  const online = useOnline();
  const queue = useSyncQueue();
  const low = useLowBandwidth();
  const language = useLang();
  const t = useT('field');
  const pull = usePullToRefresh(async () => { await Promise.all([nav.refetch(), lp.refetch()]); });
  const tiles = flatPages(nav.data).filter((p) => p.field).sort((a, b) => a.field.order - b.field.order);
  const text = (tile) => (language === 'hi' && tile.field.labelHi) || tile.field.label;
  const pending = lp.data?.pending;

  return (
    <section aria-labelledby="page-title" className="field-home">
      <PageHeader id="page-title" title={t('title')} />
      {(pull.offset > 0 || pull.refreshing) && <p className="pull-indicator" role="status" style={{ height: pull.offset }}>{pull.refreshing ? t('pull.refreshing') : pull.ready ? t('pull.ready') : t('pull.pull')}</p>}
      <ul className="field-status" aria-label={t('status.aria')}>
        <li data-testid="field-online" data-online={online}><Icon name={online ? 'erp.state.sync' : 'erp.action.offline'} size={18} /> {online ? t('online') : t('offline')}</li>
        <li data-testid="sync-count" data-count={queue.length}><Icon name="erp.action.inbox" size={18} /> {queue.length === 0 ? t('sync.none') : t('sync.some', { count: queue.length })}</li>
        {low.low && <li data-testid="field-lowbw"><Icon name="erp.action.info" size={18} /> {t('lowbw')}</li>}
      </ul>
      <QueryState query={nav} what={t('tiles.what')} />
      {nav.data && tiles.length === 0 && <EmptyState title={t('empty.title')} message={t('empty.body')} />}
      {tiles.length > 0 && (
        <ul className="field-tiles" aria-label={t('tiles.aria')}>
          {tiles.map((t) => (
            <li key={t.field.code}>
              <a href={t.route} onClick={go(t.route)} data-testid={`field-tile-${t.field.code}`}><Icon name={t.icon ?? 'erp.action.info'} size={32} /><strong>{text(t)}</strong></a>
            </li>
          ))}
        </ul>
      )}
      {pending && (pending.approvals > 0 || pending.drafts > 0) && (
        <p className="muted" data-testid="field-pending">{t('pending.line', { items: [pending.approvals > 0 && t('pending.approvals', { count: pending.approvals }), pending.drafts > 0 && t('pending.drafts', { count: pending.drafts })].filter(Boolean).join(', ') })}</p>
      )}
      <LocationNotice purpose={t('location.purpose')} />
    </section>
  );
}
