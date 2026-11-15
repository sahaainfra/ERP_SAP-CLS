import { useFavouriteActions, useLaunchpad, useNavigation } from '../../platform/shell/api.js';
import { entryFor } from '../../platform/shell/nav.js';
import { storedAppearance } from '../../platform/design/appearance.js';
import { EmptyState } from '../../platform/feedback/states.jsx';
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

/** Home: the launchpad (FR-06): what is waiting for the person, tiles for the pages their role opens, favourites and recent records. */
export default function LaunchpadPage({ session }) {
  const lp = useLaunchpad();
  const navQuery = useNavigation();
  const { remove, order } = useFavouriteActions();
  const language = storedAppearance().language;
  const text = (t) => (language === 'hi' && t.labelHi) || t.label;
  const nav = navQuery.data;
  const pending = lp.data?.pending;
  const cards = pending ? [
    { code: 'approvals', label: 'Approvals waiting for you', n: pending.approvals, to: entryFor(nav, '/admin/approvals')?.route },
    { code: 'drafts', label: 'Drafts you have not finished', n: pending.drafts, to: entryFor(nav, '/account/drafts')?.route },
    { code: 'exports', label: 'Exports being prepared', n: pending.exports, to: entryFor(nav, '/account/exports')?.route },
  ].filter((c) => c.to) : [];
  const move = (i, d) => {
    const ids = lp.data.favourites.map((f) => f.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    order.mutate(ids);
  };

  return (
    <section aria-labelledby="page-title" className="launchpad">
      <PageHeader id="page-title" title={"Home"} subtitle={<>Welcome{session?.user ? `, ${session.user}` : ''}. Everything below follows what your role may open.</>} />
      <QueryState query={lp} what="your home page" />
      {lp.data && (
        <>
          {cards.length > 0 && (
            <ul className="lp-pending" aria-label="What is waiting for you">
              {cards.map((c) => (
                <li key={c.code} data-testid={`pending-${c.code}`} data-count={c.n}>
                  <a href={c.to} onClick={go(c.to)}><strong>{c.n}</strong><span>{c.label}</span></a>
                </li>
              ))}
            </ul>
          )}
          <h2>Your pages</h2>
          {lp.data.tiles.length === 0 ? <EmptyState compact title="No tiles for your role yet" message="Your role opens no pages that are offered as tiles. The menu on the left lists everything you can open." /> : (
            <ul className="lp-tiles" aria-label="Pages for your role">
              {lp.data.tiles.map((t) => (
                <li key={t.code}>
                  <a href={t.route} onClick={go(t.route)} data-testid={`tile-${t.code}`}><Icon name={t.icon ?? 'erp.action.info'} size={24} /><strong>{text(t)}</strong><span className="muted small">{t.group}</span></a>
                </li>
              ))}
            </ul>
          )}
          <div className="lp-columns">
            <div>
              <h2>Favourites</h2>
              {lp.data.favourites.length === 0 ? <p className="muted" data-testid="no-favourites">Nothing pinned yet. Use "Add to favourites" above any page, or on a record, to keep it here.</p> : (
                <ul className="lp-list" aria-label="Favourites">
                  {lp.data.favourites.map((f, i) => (
                    <li key={f.id}>
                      <a href={f.route} onClick={go(f.route)}>{f.title}</a>
                      <span className="lp-actions">
                        <button type="button" className="btn btn-small" aria-label={`Move ${f.title} up`} disabled={i === 0 || order.isPending} onClick={() => move(i, -1)}>Up</button>
                        <button type="button" className="btn btn-small" aria-label={`Move ${f.title} down`} disabled={i === lp.data.favourites.length - 1 || order.isPending} onClick={() => move(i, 1)}>Down</button>
                        <button type="button" className="btn btn-small" aria-label={`Remove ${f.title} from favourites`} disabled={remove.isPending} onClick={() => remove.mutate(f.id)}>Remove</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h2>Recent records</h2>
              {lp.data.recent.length === 0 ? <p className="muted" data-testid="no-recent">Records you open appear here.</p> : (
                <ul className="lp-list" aria-label="Recent records">
                  {lp.data.recent.map((r) => (
                    <li key={`${r.entity}-${r.entityId}`}><a href={r.route} onClick={go(r.route)}>{r.title}</a> <span className="muted small">{r.type}</span></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
