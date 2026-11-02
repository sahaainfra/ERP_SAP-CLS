import { useEffect, useState } from 'react';

// Shared small things of the workflow pages (part 04.01).
export const DEF_STATUS = { DRAFT: ['draft', 'Draft'], PENDING: ['submitted', 'Waiting for approval'], ACTIVE: ['approved', 'Active'], RETIRED: ['cancelled', 'Retired'], REJECTED: ['rejected', 'Rejected'] };
export const INST_STATUS = { RUNNING: ['submitted', 'In approval'], APPROVED: ['approved', 'Approved'], REJECTED: ['rejected', 'Rejected'], RETURNED: ['returned', 'Returned'], CANCELLED: ['cancelled', 'Cancelled'], WITHDRAWN: ['cancelled', 'Withdrawn'] };
export const TASK_STATUS = { OPEN: ['submitted', 'Waiting'], DONE: ['approved', 'Decided'], SKIPPED: ['cancelled', 'Not needed'], CANCELLED: ['cancelled', 'Closed'], ADMIN_QUEUE: ['returned', 'With the administrators'] };
export const EVENT = {
  SUBMITTED: 'Submitted', STEP_STARTED: 'Step started', TASK_CREATED: 'Task made', STEP_SKIPPED: 'Step skipped', NOTIFIED: 'People told', SYSTEM_ACTION: 'System action', APPROVED: 'Approved', REJECTED: 'Rejected', RETURNED: 'Returned to the originator',
  RETURNED_TO_STEP: 'Returned to an earlier step', RESUBMITTED: 'Resubmitted', WAITING: 'Waiting for the others', CLARIFICATION_ASKED: 'Question asked', CLARIFICATION_ANSWERED: 'Question answered', DELEGATED: 'Delegated', ADMIN_QUEUE: 'No approver found: with the administrators',
  ASSIGNED: 'Assigned by an administrator', REMINDER: 'Reminder sent', ESCALATED: 'Escalated', COMPLETED: 'Completed', CANCELLED: 'Cancelled', WITHDRAWN: 'Withdrawn',
};

/** The query string of the page, re-read whenever the shell moves within the same page (a link to another record of the same page changes only the query). */
export function useSearch() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((n) => n + 1);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return new URLSearchParams(window.location.search);
}
