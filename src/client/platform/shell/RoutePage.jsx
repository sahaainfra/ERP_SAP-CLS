import { Component, Suspense } from 'react';
import Icon from '../design/Icon.jsx';
import PageHeader from '../design/PageHeader.jsx';
import { Skeleton } from '../feedback/states.jsx';
import { useT } from '../i18n/index.js';
import { pwa } from '../device/pwa.js';
import { isChunkError } from './lazyPage.js';

// Draws the page of a route (part 166.4, FR-01). A page's code arrives with its first opening: until then a skeleton holds the page's place (one
// status region, no layout jump), and a fetch that fails, offline or after a release removed the old file, says so and offers to try again or to
// reload into the current version; open drafts are saved first (FR-04). Any other error of the page is not caught here.

function PageLoadFailed({ offline, onRetry }) {
  const t = useT('shell');
  return (
    <div data-testid="page-load-failed">
      <PageHeader id="page-load-failed" title={t('page.loadFailedTitle')} />
      <div className="state state-error fb-error" role="alert">
        <p><Icon name="erp.state.exception" size={20} /> {offline ? t('page.loadFailedOffline') : t('page.loadFailedBody')}</p>
        <div className="actions-row">
          <button type="button" className="btn" onClick={onRetry}>{t('page.retry')}</button>
          <button type="button" className="btn btn-primary" onClick={() => pwa.applyUpdate()}>{t('page.reload')}</button>
        </div>
      </div>
    </div>
  );
}

class ChunkBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false, other: null }; }
  static getDerivedStateFromError(error) { return isChunkError(error) ? { failed: true } : { other: error }; }
  componentDidUpdate(prev) { if (prev.path !== this.props.path && (this.state.failed || this.state.other)) this.setState({ failed: false, other: null }); }
  render() {
    if (this.state.other) throw this.state.other; // not a missing script: handled as before, above this boundary
    if (this.state.failed) return <PageLoadFailed offline={typeof navigator !== 'undefined' && navigator.onLine === false} onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}

function PageSkeleton() {
  const t = useT('shell');
  return <div className="page-skeleton" data-testid="page-loading"><Skeleton label={t('page.loading')} rows={6} /></div>;
}

/** <RoutePage route={route} session={session} path={path} />: the route's page inside its loading and load-failure states. */
export default function RoutePage({ route, session, path }) {
  const Page = route.Page;
  return (
    <ChunkBoundary path={path}>
      <Suspense fallback={<PageSkeleton />}>
        <Page session={session} />
      </Suspense>
    </ChunkBoundary>
  );
}
