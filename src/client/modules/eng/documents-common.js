// What the document pages share (part 04.10).
export const STATUS = { DRAFT: ['draft', 'Draft'], IN_REVIEW: ['submitted', 'In approval'], ISSUED: ['approved', 'Issued'], ARCHIVED: ['cancelled', 'Archived'], CANCELLED: ['cancelled', 'Cancelled'] };
export const VERSION_STATUS = { DRAFT: ['draft', 'Draft'], RETURNED: ['returned', 'Returned'], IN_REVIEW: ['submitted', 'In approval'], ISSUED: ['approved', 'Current'], SUPERSEDED: ['cancelled', 'Superseded'], REJECTED: ['rejected', 'Rejected'] };
export const LEVELS = { PUBLIC: 'Public', INTERNAL: 'Internal', CONFIDENTIAL: 'Confidential', RESTRICTED: 'Restricted' };
export const RETENTION = { permanent: 'Permanent', statutory: 'Statutory', standard: 'Standard', short: 'Short' };
export const docLink = (id) => `/documents/document?id=${id}`;
