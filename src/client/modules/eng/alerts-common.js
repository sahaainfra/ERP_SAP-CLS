// What the alert pages share (part 04.09).
export const SEVERITY = { INFO: ['draft', 'Information'], WARNING: ['returned', 'Warning'], CRITICAL: ['rejected', 'Critical'] };
export const ALERT_STATUS = { OPEN: ['submitted', 'Open'], ACKNOWLEDGED: ['draft', 'Acknowledged'], RESOLVED: ['approved', 'Resolved'] };
export const OP_LABEL = { eq: 'is', ne: 'is not', gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most', in: 'is one of', nin: 'is none of', contains: 'contains', empty: 'is empty', notEmpty: 'is not empty' };
export const ACTION_LABEL = { notify: 'Tell people', task: 'Make a task', escalate: 'Escalate to a role', webhook: 'Call a webhook', flag: 'Set a flag' };
export const OUTCOME = { NEW: 'New alert', REPEAT: 'Repeats an open alert', THROTTLED: 'Held back by the window' };
export const scheduleText = (s) => (s === 'HOURLY' ? 'every hour' : s?.startsWith('DAILY@') ? `daily at ${s.slice(6)}:00` : s?.startsWith('WEEKLY@') ? `weekly on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][Number(s.slice(7))]}` : s);
export const TOKENS = [['owner', 'The owner of the record'], ['assignee', 'Whoever it is given to'], ['assigner', 'Whoever gave it'], ['role', 'The role named on the record']];
