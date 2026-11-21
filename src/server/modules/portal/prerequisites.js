import { gatesOf } from '../hr/gates.js';

const PORTAL_FLAG = 'ff.portal.p2501';

/** Check launch eligibility for the company obtained from trusted server context. */
export function portalPrerequisitesMet({ db, flags, companyId }) {
  if (!Number.isSafeInteger(companyId) || companyId < 1) return false;
  if (!flags.isOn({ companyId }, PORTAL_FLAG)) return false;

  const service = gatesOf(db);
  return service?.hasPassed(companyId, 'G1') === true && service.hasPassed(companyId, 'G2');
}
