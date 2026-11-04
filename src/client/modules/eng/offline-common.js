// Words and tones shared by the offline pages (part 04.15).
export const CMD_STATUS = {
  PENDING: ['IN_REVIEW', 'Waiting to be sent'], DEFERRED: ['IN_REVIEW', 'Waiting for an earlier change'], APPLIED: ['COMPLETED', 'Saved; photos waiting'], ERROR: ['REJECTED', 'Refused'],
  CONFLICT: ['RETURNED', 'Needs your decision'], NEEDS_CONFIRMATION: ['IN_REVIEW', 'Waiting for a supervisor'], RESOLVED: ['COMPLETED', 'Resolved'], DECLINED: ['REJECTED', 'Declined'], REJECTED: ['REJECTED', 'Refused'],
};
export const DEVICE_STATUS = { ACTIVE: ['COMPLETED', 'Active'], REVOKED: ['REJECTED', 'Revoked'], WIPED: ['REJECTED', 'Revoked and wiped'] };
export const ago = (iso) => {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
