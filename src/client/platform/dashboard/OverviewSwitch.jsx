import { useEffect, useState } from 'react';
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

/**
 * A module dashboard as an overview page of cards (part 166.5, FR-02) when ff.ui.p16605 is ON, else the page as it was. The cards read the same
 * service as the page (src/server/modules/ui/overviews.js), so the figures are the same. The page as it was stays one click away ("Open the
 * detailed page", `?view=detail`): its tables, exports and own filters are kept, nothing of it is lost.
 */
export default function OverviewSwitch({ code, heading, crumb, intro, Classic }) {
  const flag = useFlag('ff.ui.p16605');
  // the view follows the address: a change of its query alone does not draw the page again, so the switch keeps it too (and Back / Forward)
  const [detail, setDetail] = useState(detailWanted);
  useEffect(() => { const on = () => setDetail(detailWanted()); globalThis.addEventListener('popstate', on); return () => globalThis.removeEventListener('popstate', on); }, []);
  const go = (to, d) => (e) => { e.preventDefault(); navigateTo(to); setDetail(d); };
  if (!flag.known) return <Skeleton label={heading} rows={4} />;
  if (!flag.on) return <Classic />;
  if (detail) {
    const back = withView(false);
    return (
      <>
        <p className="ov-switch small" data-testid="overview-back"><a href={back} onClick={go(back, false)}>‹ Back to the overview</a></p>
        <Classic />
      </>
    );
  }
  const detailUrl = withView(true);
  return (
    <div data-testid={`overview-${code}`}>
      <DashboardView code={code} heading={heading} crumb={crumb} intro={intro} />
      <p className="ov-switch small"><a href={detailUrl} onClick={go(detailUrl, true)} data-testid="overview-detail">Open the detailed page ›</a> <span className="muted">its tables, exports and own filters</span></p>
    </div>
  );
}
