import DashboardView from './DashboardView.jsx';
import { useFlag } from '../shell/api.js';
import { Skeleton } from '../feedback/states.jsx';

/**
 * A module dashboard as an overview page of cards (part 166.5, FR-02) when ff.ui.p16605 is ON, else the page as it was. The cards read the same
 * service as the page (src/server/modules/ui/overviews.js), so the figures are the same; the page itself is kept for the flag OFF.
 */
export default function OverviewSwitch({ code, heading, crumb, intro, Classic }) {
  const flag = useFlag('ff.ui.p16605');
  if (!flag.known) return <Skeleton label={heading} rows={4} />;
  if (!flag.on) return <Classic />;
  return <div data-testid={`overview-${code}`}><DashboardView code={code} heading={heading} crumb={crumb} intro={intro} /></div>;
}
