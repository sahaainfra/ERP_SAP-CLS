import { formatDateTime } from '../../../platform/format.js';

const SEVERITY = { BLOCK: ['chip-bad', 'Blocks'], WARN: ['chip-not_applicable', 'Warns'], DETECT: ['chip-never', 'Detects'] };
const STATUS = {
  OPEN: ['chip-bad', 'Open'], BLOCKED: ['chip-fail', 'Blocked'], RESOLVED: ['chip-pass', 'Resolved'], ACCEPTED: ['chip-never', 'Risk accepted'],
  REQUESTED: ['chip-not_applicable', 'Waiting for approval'], ACTIVE: ['chip-pass', 'Active'], REJECTED: ['chip-bad', 'Rejected'], CANCELLED: ['chip-never', 'Cancelled'], EXPIRED: ['chip-never', 'Ended'], REVOKED: ['chip-bad', 'Revoked'],
  CLOSED: ['chip-pass', 'Closed'], COMPLETED: ['chip-pass', 'Completed'], PENDING: ['chip-not_applicable', 'Undecided'], CERTIFY: ['chip-pass', 'Certified'], REVOKE: ['chip-bad', 'To be revoked'],
};

/** What a rule does when it is broken, as a coloured word (never colour alone). */
export const SeverityChip = ({ severity }) => <span className={`chip ${SEVERITY[severity]?.[0] ?? 'chip-never'}`}>{SEVERITY[severity]?.[1] ?? severity}</span>;
export const StatusChip = ({ status }) => <span className={`chip ${STATUS[status]?.[0] ?? 'chip-never'}`}>{STATUS[status]?.[1] ?? status}</span>;

/** The remaining time of an elevation, or when it ended. */
export function remaining(e, now = Date.now()) {
  if (e.status === 'REQUESTED') return `Asked for ${e.requestedHours} hour(s)`;
  if (!e.endsAt) return '';
  const ms = Date.parse(e.endsAt) - now;
  if (e.status !== 'ACTIVE') return `Ended ${formatDateTime(e.endsAt)}`;
  if (Date.parse(e.startsAt) > now) return `Starts ${formatDateTime(e.startsAt)}`;
  if (ms <= 0) return 'Ending now';
  const m = Math.floor(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m} min left`;
}

export const scopeWords = { COMPANY: 'The whole company', OWN: 'Own records', BRANCH: 'Branches', DEPARTMENT: 'Departments', PROJECT: 'Projects', SITE: 'Sites' };
