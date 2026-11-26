import { useNavigation, useLaunchpad, useFieldToday, useFlagOn } from '../../platform/shell/api.js';
import { flatPages } from '../../platform/shell/nav.js';
import { useFormat, useLang, useT, labelIn } from '../../platform/i18n/index.js';
import { useOnline } from '../../platform/device/layout.js';
import { useSyncQueue } from '../../platform/device/syncQueue.js';
import { useLowBandwidth } from '../../platform/device/lowBandwidth.js';
import { usePullToRefresh } from '../../platform/device/gestures.js';
import { useOffline } from '../../platform/offline/engine.js';
import { EmptyState } from '../../platform/feedback/states.jsx';
import LocationNotice from '../../platform/device/LocationNotice.jsx';
import { QueryState } from '../core/pages/ui.jsx';
import Icon from '../../platform/design/Icon.jsx';
import { confirmLeave } from '../../platform/forms/guard.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { todayIst } from '../../platform/forms/dates.js';

const go = (to) => (e) => {
  e.preventDefault();
  if (!confirmLeave()) return;
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

// the icon of each of today's task cards (part 166.3)
const TASK_ICON = { approvals: 'erp.action.inbox', dpr: 'erp.group.projects', dprDraft: 'erp.action.edit', inspections: 'erp.kpi.quality', ncrs: 'erp.kpi.risk', observations: 'erp.kpi.safety', permits: 'erp.kpi.safety', gate: 'erp.group.supply' };
/** The greeting of the hour in India: morning to noon, afternoon to five, then evening. */
const greeting = (t, name, now = new Date()) => {
  const h = (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) % 24;
  return h < 12 ? t('greet.morning', { name }) : h < 17 ? t('greet.afternoon', { name }) : t('greet.evening', { name });
};
/** The label of each of today's task cards, written out so that the catalogue check sees every key. */
const taskLabel = (t, code) => ({
  approvals: t('today.approvals'), dpr: t('today.dpr'), dprDraft: t('today.dprDraft'), attendance: t('today.attendance'), inspections: t('today.inspections'),
  ncrs: t('today.ncrs'), observations: t('today.observations'), permits: t('today.permits'), gate: t('today.gate'), equipment: t('today.equipment'),
})[code] ?? code;

/**
 * Field Home (Mobile, part 03.06 FR-07; part 166.3 FR-01): a site person's home on the phone. With ff.field.p16603 ON it opens with a greeting
 * band, today's tasks as cards with counts from the records (each opens its list, so the daily task is one tap away), the quick actions of the
 * person's role as large coloured tiles, and whether the phone is online, how many things are not sent yet and when it last sent. A tile is
 * there when its page exists and the person may open it.
 */
export default function FieldHomePage({ session }) {
  const nav = useNavigation();
  const lp = useLaunchpad();
  const online = useOnline();
  const queue = useSyncQueue();
  const low = useLowBandwidth();
  const language = useLang();
  const t = useT('field');
  const f = useFormat();
  const v3 = useFlagOn('ff.field.p16603');
  const today = useFieldToday(v3);
  const off = useOffline();
  // part 166.4 (CLS): the tiles and the location notice are drawn once today's cards have arrived (or failed), so the cards do not push them down
  const holdTiles = useFlagOn('ff.perf.p16604') && v3 && today.isPending && today.fetchStatus === 'fetching'; // never while offline (a paused query)
  const pull = usePullToRefresh(async () => { await Promise.all([nav.refetch(), lp.refetch(), v3 ? today.refetch() : null]); });
  const tiles = flatPages(nav.data).filter((p) => p.field).sort((a, b) => a.field.order - b.field.order);
  const text = (tile) => labelIn(tile.field, language);
  const pending = lp.data?.pending;
  const name = session?.displayName ?? session?.name ?? session?.user ?? '';

  return (
    <section aria-labelledby="page-title" className={`field-home${v3 ? ' field-home-v3' : ''}`}>
      {v3 ? (
        <PageHeader className="fh-band" testid="field-band" id="page-title" title={greeting(t, name)} meta={<span className="fh-eyebrow" data-testid="field-title">{t('title')}</span>} subtitle={t('greet.date', { date: f.date(today.data?.date ?? todayIst()) })}>
          <ul className="fh-status" aria-label={t('status.aria')}>
            <li data-testid="field-online" data-online={online}><Icon name={online ? 'erp.state.sync' : 'erp.action.offline'} size={18} /> {online ? t('online') : t('offline')}</li>
            <li data-testid="sync-count" data-count={queue.length}><Icon name="erp.action.inbox" size={18} /> <a href="/field/sync" title={t('sync.open')} onClick={go('/field/sync')}>{queue.length === 0 ? t('sync.none') : t('sync.notSent', { count: queue.length })}</a></li>
            <li data-testid="last-sync"><Icon name="erp.action.history" size={18} /> {off.lastSync ? t('sync.last', { time: f.dateTime(off.lastSync) }) : t('sync.never')}</li>
            {low.low && <li data-testid="field-lowbw"><Icon name="erp.action.info" size={18} /> {t('lowbw')}</li>}
          </ul>
        </PageHeader>
      ) : (
        <>
          <PageHeader id="page-title" title={t('title')} />
          <ul className="field-status" aria-label={t('status.aria')}>
            <li data-testid="field-online" data-online={online}><Icon name={online ? 'erp.state.sync' : 'erp.action.offline'} size={18} /> {online ? t('online') : t('offline')}</li>
            <li data-testid="sync-count" data-count={queue.length}><Icon name="erp.action.inbox" size={18} /> {queue.length === 0 ? t('sync.none') : t('sync.some', { count: queue.length })}</li>
            {low.low && <li data-testid="field-lowbw"><Icon name="erp.action.info" size={18} /> {t('lowbw')}</li>}
          </ul>
        </>
      )}
      {(pull.offset > 0 || pull.refreshing) && <p className="pull-indicator" role="status" style={{ height: pull.offset }}>{pull.refreshing ? t('pull.refreshing') : pull.ready ? t('pull.ready') : t('pull.pull')}</p>}

      {v3 && (
        <section aria-labelledby="fh-today" className="fh-today">
          <h2 id="fh-today">{t('today.title')}</h2>
          <QueryState query={today} what={t('today.what')} />
          {today.data && today.data.cards.every((c) => c.count === 0) && <p className="muted" data-testid="field-today-none">{t('today.none')}</p>}
          {today.data && (
            <ul className="fh-cards" aria-label={t('today.aria')}>
              {today.data.cards.filter((c) => c.count > 0).map((c) => (
                <li key={c.code}>
                  <a href={c.route} onClick={go(c.route)} className="fh-card" data-testid={`field-today-${c.code}`} data-count={c.count}>
                    <Icon name={TASK_ICON[c.code] ?? 'erp.action.info'} size={24} />
                    <span className="fh-card-label">{taskLabel(t, c.code)}</span>
                    <strong className="fh-card-count">{f.number(c.count, { decimals: 0 })}</strong>
                    <Icon name="erp.action.next" size={18} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <QueryState query={nav} what={t('tiles.what')} />
      {nav.data && tiles.length === 0 && <EmptyState title={t('empty.title')} message={t('empty.body')} />}
      {tiles.length > 0 && !holdTiles && (
        <>
          {v3 && <h2>{t('actions.title')}</h2>}
          <ul className="field-tiles" aria-label={t('tiles.aria')}>
            {tiles.map((tile) => (
              <li key={tile.field.code}>
                <a href={tile.route} onClick={go(tile.route)} data-testid={`field-tile-${tile.field.code}`} data-tone={v3 ? tile.field.tone ?? 'navy' : undefined}><Icon name={tile.icon ?? 'erp.action.info'} size={32} /><strong>{text(tile)}</strong></a>
              </li>
            ))}
          </ul>
        </>
      )}
      {!v3 && pending && (pending.approvals > 0 || pending.drafts > 0) && (
        <p className="muted" data-testid="field-pending">{t('pending.line', { items: [pending.approvals > 0 && t('pending.approvals', { count: pending.approvals }), pending.drafts > 0 && t('pending.drafts', { count: pending.drafts })].filter(Boolean).join(', ') })}</p>
      )}
      {!holdTiles && <LocationNotice purpose={t('location.purpose')} />}
    </section>
  );
}
