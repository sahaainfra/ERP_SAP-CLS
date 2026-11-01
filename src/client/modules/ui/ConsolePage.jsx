import { useAbout } from '../core/api/index.js';
import { useNavigation } from '../../platform/shell/api.js';
import { consoleGroup } from '../../platform/shell/nav.js';
import { QueryState, usePageTitle } from '../core/pages/ui.jsx';
import Icon from '../../platform/design/Icon.jsx';
import { confirmLeave } from '../../platform/forms/guard.js';

const go = (to) => (e) => {
  e.preventDefault();
  if (!confirmLeave()) return;
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

/** The Technical Console (FR-09): build information, feature flags, jobs and the like for administrators, kept out of business menus (BR-03). */
export default function ConsolePage() {
  usePageTitle('Technical Console');
  const navQuery = useNavigation();
  const about = useAbout();
  const pages = (consoleGroup(navQuery.data)?.pages ?? []).filter((p) => p.route !== '/admin/console');
  return (
    <section aria-labelledby="page-title">
      <div className="page-head"><h1 id="page-title">Technical Console</h1></div>
      <p className="muted">For system and IT administrators: how the application is built and run. Nothing here belongs in a business menu, so it is kept apart.</p>
      <QueryState query={navQuery} what="the console" />
      {about.data && (
        <dl className="facts" aria-label="Build information">
          <div><dt>Version</dt><dd data-testid="console-version">{about.data.version}</dd></div>
          <div><dt>Build ID</dt><dd><code>{about.data.buildId}</code></dd></div>
          <div><dt>Environment</dt><dd>{about.data.environment}</dd></div>
        </dl>
      )}
      <ul className="lp-tiles" aria-label="Console pages">
        {pages.map((p) => (
          <li key={p.code}><a href={p.route} onClick={go(p.route)} data-testid={`console-${p.code}`}><Icon name={p.icon ?? 'erp.action.info'} size={22} /><strong>{p.label}</strong><span className="muted small">{p.keywords}</span></a></li>
        ))}
      </ul>
    </section>
  );
}
