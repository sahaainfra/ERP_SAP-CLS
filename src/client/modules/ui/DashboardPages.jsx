import { useEffect } from 'react';
import DashboardView from '../../platform/dashboard/DashboardView.jsx';

// My Work and the Requests Overview (part 03.07): dashboards of the widgets the person's role allows, on the framework of platform/dashboard.
const useTitle = (t) => useEffect(() => { document.title = `${t} - ERP`; }, [t]);

/** My Work (FR-07): what waits for the person, their requests and projects, the calendar and quick actions, each from its own source. */
export function MyWorkPage() {
  useTitle('My Work');
  return (
    <DashboardView
      code="my-work" heading="My Work" crumb="My Work"
      intro="What needs you today. Each box shows only what you may see and opens the list behind it. Where a service is not in use yet, its box says so instead of showing made-up figures."
    />
  );
}

/** The register of sample material requests at a glance: counts, values, spread by project and status, the trend and what is overdue. */
export function RequestsOverviewPage() {
  useTitle('Requests Overview');
  return (
    <DashboardView
      code="requests-overview" heading="Requests Overview" crumb="Procurement &rsaquo; Requests Overview"
      intro="Sample material requests in the period and projects you choose. Click a figure, bar or slice to open the list with the same filters."
    />
  );
}
