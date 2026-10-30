import { assertPermission } from '../../../platform/auth/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { pageResponse } from '../../../platform/pagination/index.js';

/** Approval-controlled configuration changes: period reopen and numbering-series change. The rules live in the engine. */
export function createChangeRequestService({ approvals }) {
  const guard = (actor) => {
    assertPermission(actor, 'core.requests.view');
    companyScope(actor);
  };
  return {
    list(actor, query) {
      guard(actor);
      const { rows, total } = approvals.list(actor, { type: query.filters.type, status: query.filters.status, limit: query.limit, offset: query.offset });
      return pageResponse(rows, total, query);
    },
    get(actor, id) {
      guard(actor);
      return approvals.get(actor, id);
    },
    act(actor, id, body) {
      guard(actor);
      return approvals.act(actor, id, body);
    },
    resubmit(actor, id, body) {
      guard(actor);
      return approvals.resubmit(actor, id, body);
    },
    withdraw(actor, id) {
      guard(actor);
      return approvals.withdraw(actor, id);
    },
  };
}
