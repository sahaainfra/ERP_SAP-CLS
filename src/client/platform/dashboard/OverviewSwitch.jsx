import DashboardView from './DashboardView.jsx';
import { useFlag } from '../shell/api.js';
import { Skeleton } from '../feedback/states.jsx';
import { navigateTo } from '../../modules/core/pages/ui.jsx';

const detailWanted = () => new URLSearchParams(globalThis.location?.search ?? '').get('view') === 'detail';
const withView = (detail) => {
  const p = new URLSearchParams(globalThis.location?.search ?? '');
  if (detail) p.set('view', 'detail'); else p.delete('view');
  const s = p.toString();
  return `${globalThis.location?.pathname ?? '/'}${s ? `?${s}` : ''}`;
};
const go = (to) => (e) => { e.preventDefault(); navigateTo(to); };

/**
 * A module dashboard as an overview page of cards (part 166.5, FR-02) when ff.ui.p16605 is ON, else the page as it was. The cards read the same
 * service as the page (src/server/modules/ui/overviews.js), so the figures are the same. The page as it was stays one click away ("Open the
 * detailed page", `?view=detail`): its tables, exports and own filters are kept, nothing of it is lost.
 */
export default function OverviewSwitch({ code, heading, crumb, intro, Classic }) {
  const flag = useFlag('ff.ui.p16605');
  if (!flag.known) return <Skeleton label={heading} rows={4} />;
  if (!flag.on) return <Classic />;
  if (detailWanted()) {
    const back = withView(false);
    return (
      <>
        <p className="ov-switch small" data-testid="overview-back"><a href={back} onClick={go(back)}>‹ Back to the overview</a></p>
        <Classic />
      </>
    );
  }
  const detail = withView(true);
  return (
    <div data-testid={`overview-${code}`}>
      <DashboardView code={code} heading={heading} crumb={crumb} intro={intro} />
      <p className="ov-switch small"><a href={detail} onClick={go(detail)} data-testid="overview-detail">Open the detailed page ›</a> <span className="muted">its tables, exports and own filters</span></p>
    </div>
  );
}
