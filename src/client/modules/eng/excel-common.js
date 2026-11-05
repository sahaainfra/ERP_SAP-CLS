// What the Excel engine pages share (part 04.13).
export const JOB_STATUS = { UPLOADED: ['submitted', 'Waiting to be checked'], VALIDATING: ['submitted', 'Being checked'], FAILED: ['rejected', 'File refused'], PREVIEW: ['info', 'Checked: review'], COMMITTING: ['submitted', 'Being saved'], COMMITTED: ['approved', 'Imported'], PARTIAL: ['returned', 'Stopped part-way'], CANCELLED: ['cancelled', 'Cancelled'] };
export const ACTION = { CREATE: ['approved', 'Will create'], UPDATE: ['info', 'Will update'], SKIP: ['cancelled', 'Left out'], ERROR: ['rejected', 'Has errors'], DONE: ['approved', 'Saved'] };
export const ON_EXISTING = { ERROR: 'Report existing records as errors', UPDATE: 'Update existing records', SKIP: 'Leave existing records alone' };
export const jobLink = (id) => `/import/job?id=${id}`;
