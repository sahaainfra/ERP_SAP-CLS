import { useNavigation, useLaunchpad } from '../../platform/shell/api.js';
import { flatPages } from '../../platform/shell/nav.js';
import { storedAppearance } from '../../platform/design/appearance.js';
import { useOnline } from '../../platform/device/layout.js';
import { useSyncQueue } from '../../platform/device/syncQueue.js';
import { useLowBandwidth } from '../../platform/device/lowBandwidth.js';
import { usePullToRefresh } from '../../platform/device/gestures.js';
import { EmptyState } from '../../platform/feedback/states.jsx';
import LocationNotice from '../../platform/device/LocationNotice.jsx';
import { QueryState } from '../core/pages/ui.jsx';
import Icon from '../../platform/design/Icon.jsx';
import { confirmLeave } from '../../platform/forms/guard.js';

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
  const language = storedAppearance().language;
  const pull = usePullToRefresh(async () => { await Promise.all([nav.refetch(), lp.refetch()]); });
  const tiles = flatPages(nav.data).filter((p) => p.field).sort((a, b) => a.field.order - b.field.order);
  const text = (t) => (language === 'hi' && t.field.labelHi) || t.field.label;
  const pending = lp.data?.pending;

  return (
    <section aria-labelledby="page-title" className="field-home">
      <div className="page-head"><h1 id="page-title">Field Home</h1></div>
      {(pull.offset > 0 || pull.refreshing) && <p className="pull-indicator" role="status" style={{ height: pull.offset }}>{pull.refreshing ? 'Refreshing...' : pull.ready ? 'Let go to refresh' : 'Pull down to refresh'}</p>}
      <ul className="field-status" aria-label="Status of this device">
        <li data-testid="field-online" data-online={online}><Icon name={online ? 'erp.state.sync' : 'erp.action.offline'} size={18} /> {online ? 'Online' : 'Offline: what you do waits on this device until you are back online'}</li>
        <li data-testid="sync-count" data-count={queue.length}><Icon name="erp.action.inbox" size={18} /> {queue.length === 0 ? 'Nothing is waiting to be sent' : `${queue.length} waiting to be sent`}</li>
        {low.low && <li data-testid="field-lowbw"><Icon name="erp.action.info" size={18} /> Low-bandwidth mode is on: photos are smaller</li>}
      </ul>
      <QueryState query={nav} what="the quick actions" />
      {nav.data && tiles.length === 0 && <EmptyState title="No quick actions for your role yet" message="The pages you may open are in the menu. Quick actions appear here as they are set up for your role." />}
      {tiles.length > 0 && (
        <ul className="field-tiles" aria-label="Quick actions">
          {tiles.map((t) => (
            <li key={t.field.code}>
              <a href={t.route} onClick={go(t.route)} data-testid={`field-tile-${t.field.code}`}><Icon name={t.icon ?? 'erp.action.info'} size={32} /><strong>{text(t)}</strong></a>
            </li>
          ))}
        </ul>
      )}
      {pending && (pending.approvals > 0 || pending.drafts > 0) && (
        <p className="muted" data-testid="field-pending">Waiting for you: {[pending.approvals > 0 && `${pending.approvals} approval${pending.approvals === 1 ? '' : 's'}`, pending.drafts > 0 && `${pending.drafts} draft${pending.drafts === 1 ? '' : 's'}`].filter(Boolean).join(', ')}.</p>
      )}
      <LocationNotice purpose="a punch, a daily progress report or an inspection" />
    </section>
  );
}
