import { DIRECTOR_APPROVED_ROLES } from '../../../platform/authz/index.js';

/**
 * Who must approve giving a person roles (part 02.04, section 9). An ordinary role: the system administrator. A privileged role (one
 * that policy puts behind a second step, or a custom role holding a sensitive permission): then the IT administrator or the director.
 * A finance approver or the break-glass Super Admin: then the director. A system administrator who asks cannot approve their own
 * request, so for them the chain starts with the IT administrator. A step written 'A|B' is decided by either role.
 */
export function assignmentChain({ codes, privilegedCodes = [], sensitive = false, bySysadm }) {
  const director = codes.some((c) => DIRECTOR_APPROVED_ROLES.includes(c));
  const privileged = sensitive || codes.some((c) => privilegedCodes.includes(c));
  if (bySysadm) return director || privileged ? ['ITADM', 'DIR'] : ['ITADM'];
  if (director) return ['SYSADM', 'DIR'];
  return privileged ? ['SYSADM', 'ITADM|DIR'] : ['SYSADM'];
}

/** Who must approve a change to what a role grants: the IT administrator checks the system administrator's change; a privileged role also needs the director. */
export const roleChangeChain = ({ privileged }) => (privileged ? ['ITADM', 'DIR'] : ['ITADM']);
