import { createApiClient } from './client.js';
import { authHeaders } from './identity.js';
import { failureEvent, installReporter, isReportableFailure } from '../observability/reporter.js';

export { ApiError } from './client.js';
export { authHeaders, loadIdentity, saveIdentity } from './identity.js';

/** Browser error and performance reports (FR-04). Null outside a browser. */
export const reporter = installReporter({ authHeaders });

/** The application's API client: auth headers from the identity adapter, everything else per client.js. */
export const api = createApiClient({
  getAuthHeaders: authHeaders,
  onFailure: (err, path) => {
    if (reporter && isReportableFailure(err) && !path.startsWith('/core/ops/client-events')) reporter.report(failureEvent(err, `/api/v1${path}`));
  },
});
