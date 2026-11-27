import { Component, Fragment, Suspense } from 'react';
import Icon from '../design/Icon.jsx';
import PageHeader from '../design/PageHeader.jsx';
import { Skeleton } from '../feedback/states.jsx';
import { useT } from '../i18n/index.js';
import { pwa } from '../device/pwa.js';
import { isChunkError } from './lazyPage.js';

// Draws the page of a route (part 166.4, FR-01). A page's code arrives with its first opening: until then a skeleton holds the page's place (one
// status region, no layout jump), and a fetch that fails, offline or after a release removed the old file, says so and offers to reload: the
// browser remembers a failed script for the life of the page, so only a reload fetches it again (into the current version, open drafts saved
// first with the flag, FR-04). Any other error of the page (a page drawing data that did not arrive) shows a page-level error with Try again:
// the shell, its menu and the other pages keep working, and the error is still reported (window.reportError reaches the client reporter).

function PageLoadFailed({ offline, onRetry }) {
  const t = useT('shell');
  return (
    <div data-testid="page-load-failed">
      <PageHeader id="page-load-failed" title={t('page.loadFailedTitle')} />
      <div className="state state-error fb-error" role="alert">
        <p><Icon name="erp.state.exception" size={20} /> {offline ? t('page.loadFailedOffline') : t('page.loadFailedBody')}</p>
        <div className="actions-row">
          <button type="button" className="btn btn-primary" onClick={onRetry}>{t('page.reload')}</button>
        </div>
      </div>
    </div>
  );
}

function PageCrashed({ onRetry }) {
  const t = useT('shell');
  return (
    <div data-testid="page-crashed">
      <PageHeader id="page-crashed" title={t('page.crashTitle')} />
      <div className="state state-error fb-error" role="alert" data-testid="error-state">
        <p><Icon name="erp.state.exception" size={20} /> {t('page.crashBody')}</p>
        <div className="actions-row">
          <button type="button" className="btn btn-primary" onClick={onRetry}>{t('page.tryAgain')}</button>
          <a className="btn" href="/home">{t('page.home')}</a>
        </div>
      </div>
    </div>
  );
}

class ChunkBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false, other: null, attempt: 0 }; }
  static getDerivedStateFromError(error) { return isChunkError(error) ? { failed: true } : { other: error }; }
  componentDidCatch(error) { if (!isChunkError(error)) globalThis.reportError?.(error); }
  componentDidUpdate(prev) { if (prev.path !== this.props.path && (this.state.failed || this.state.other)) this.setState({ failed: false, other: null }); }
  render() {
    if (this.state.other) return <PageCrashed onRetry={() => this.setState((s) => ({ other: null, attempt: s.attempt + 1 }))} />;
    if (this.state.failed) return <PageLoadFailed offline={typeof navigator !== 'undefined' && navigator.onLine === false} onRetry={() => pwa.applyUpdate()} />;
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
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
