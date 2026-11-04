// What the template pages share (part 04.11).
export const TEMPLATE_STATUS = { DRAFT: ['draft', 'Draft'], IN_REVIEW: ['submitted', 'In approval'], ACTIVE: ['approved', 'Active'], RETIRED: ['cancelled', 'Retired'], REJECTED: ['rejected', 'Rejected'] };
export const DELIVERY_STATUS = { QUEUED: ['submitted', 'Queued'], SENT: ['info', 'Sent'], DELIVERED: ['approved', 'Delivered'], READ: ['approved', 'Read'], FAILED: ['rejected', 'Failed'], BLOCKED: ['rejected', 'Blocked'], PUBLISHED: ['approved', 'Published'], DOWNLOADED: ['info', 'Opened'] };
export const CHANNEL = { DOWNLOAD: 'Download', EMAIL: 'E-mail', WHATSAPP: 'WhatsApp', MESSAGE: 'Message', PORTAL: 'Portal' };
export const PURPOSE = { OFFICIAL: 'Official', ARCHIVAL: 'Archival (PDF/A profile)', MILESTONE: 'At approval' };
export const templateLink = (id) => `/admin/templates/editor?id=${id}`;
export const generatedLink = (id) => `/documents/generated?id=${id}`;
/** A PDF blob opened in a new tab, or saved when `save` is true. */
export function showBlob(blob, name, save = false) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener', ...(save ? { download: name } : {}) });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
