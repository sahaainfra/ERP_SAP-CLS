// What the task pages share (part 04.08).
export const STATUS = { OPEN: ['submitted', 'Open'], ACCEPTED: ['submitted', 'Accepted'], IN_PROGRESS: ['draft', 'In progress'], BLOCKED: ['returned', 'Blocked'], DONE: ['approved', 'Done'], VERIFIED: ['approved', 'Verified'], CLOSED: ['approved', 'Closed'], CANCELLED: ['cancelled', 'Cancelled'] };
export const PRIORITY = { LOW: ['cancelled', 'Low'], MEDIUM: ['draft', 'Medium'], HIGH: ['returned', 'High'], URGENT: ['rejected', 'Urgent'] };
export const ORIGIN = { manual: 'Made by hand', auto: 'Made by the system', instruction: 'Instruction from a senior' };
export const VIEWS = [['assigned', 'Given to me'], ['watching', 'I watch'], ['created', 'I gave'], ['team', 'My team']];
export const ACTION_LABEL = { accept: 'Accept', start: 'Start', block: 'Mark blocked', unblock: 'Unblock', complete: 'Mark done', verify: 'Verify', close: 'Close', reopen: 'Send back', cancel: 'Cancel task' };
export const NEEDS_REASON = ['block', 'reopen', 'cancel'];
export const BOARD = [['OPEN', 'Open'], ['ACCEPTED', 'Accepted'], ['IN_PROGRESS', 'In progress'], ['BLOCKED', 'Blocked'], ['DONE', 'Done'], ['CLOSED', 'Closed']];
export const taskLink = (id) => `/tasks/task?id=${id}`;
