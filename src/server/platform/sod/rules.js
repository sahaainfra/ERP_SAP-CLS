// The standard segregation-of-duties rules of the role catalogue (section E), seeded for every company. A rule is a pair of sets that must
// not meet: of permissions (`PERMISSION`: nobody may hold one from each set at once, within overlapping scope) or of actions
// (`ACTION`: nobody may do one from each set to the same document, vendor, period or project). A `*` in a pattern stands for any run
// of letters, digits, dots and underscores. Severity: BLOCK stops it, WARN lets it through and records it, DETECT only records it.

export const SEEDED_RULES = Object.freeze([
  { code: 'SOD-01', name: 'Create and approve the same document', description: 'The person who raised or submitted a document may not approve it.', kind: 'ACTION', setA: ['*.create', '*.submit', '*.raise'], setB: ['*.approve'], scope: 'DOCUMENT', severity: 'BLOCK' },
  { code: 'SOD-02', name: 'Maintain a vendor and release payment to it', description: 'Whoever creates or edits a vendor, including its bank details, may not release a payment to that vendor.', kind: 'ACTION', setA: ['vendor.create', 'vendor.update', 'vendor.bank_change'], setB: ['payment.release'], scope: 'VENDOR', severity: 'BLOCK' },
  { code: 'SOD-03', name: 'Post a journal and approve its reversal', description: 'The person who posted a journal may not approve its reversal.', kind: 'ACTION', setA: ['journal.post'], setB: ['journal.approve_reversal'], scope: 'DOCUMENT', severity: 'BLOCK' },
  { code: 'SOD-04', name: 'Record the goods receipt and approve the vendor invoice', description: 'Whoever recorded the goods receipt for a purchase order may not approve the vendor invoice for it.', kind: 'ACTION', setA: ['grn.create'], setB: ['vendor_invoice.approve'], scope: 'DOCUMENT', severity: 'BLOCK' },
  { code: 'SOD-05', name: 'Enter attendance and approve payroll', description: 'Whoever entered attendance for a period and site may not approve the payroll of the same period.', kind: 'ACTION', setA: ['attendance.enter'], setB: ['payroll.approve'], scope: 'PERIOD', severity: 'BLOCK' },
  { code: 'SOD-06', name: 'Prepare a measurement and certify it', description: 'The person who prepared a measurement may not certify it.', kind: 'ACTION', setA: ['measurement.prepare'], setB: ['measurement.certify'], scope: 'DOCUMENT', severity: 'BLOCK' },
  { code: 'SOD-07', name: 'Raise a purchase request and approve the order', description: 'The person who raised a purchase request may not approve the purchase order that comes from it, above the configured value.', kind: 'ACTION', setA: ['pr.raise'], setB: ['po.approve'], scope: 'DOCUMENT', severity: 'WARN', conditions: { minAmountPaise: 5_000_000 } },
  { code: 'SOD-08', name: 'Maintain the approval matrix and approve what it governs', description: 'Nobody may hold both the right to maintain the approval matrix and the right to approve documents.', kind: 'PERMISSION', setA: ['workflow.matrix.*'], setB: ['*.approve'], scope: 'USER', severity: 'BLOCK' },
  { code: 'SOD-09', name: 'Count stock and approve the adjustment', description: 'Whoever counted the stock may not approve the stock adjustment that results.', kind: 'ACTION', setA: ['stock_count.perform'], setB: ['stock_adjustment.approve'], scope: 'DOCUMENT', severity: 'BLOCK' },
  { code: 'SOD-10', name: 'Assign roles and hold finance approval authority', description: 'Nobody may hold both the right to give roles and permissions and approval authority over finance documents (including closing a period).', kind: 'PERMISSION', setA: ['iam.role.manage', 'iam.assignment.manage'], setB: ['finance.*.approve', 'finance.payment.*', 'core.period.manage'], scope: 'USER', severity: 'BLOCK' },
]);

/** Does a permission key or action token match a pattern with `*` wildcards? */
const cache = new Map();
export function matches(pattern, value) {
  let re = cache.get(pattern);
  if (!re) {
    re = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9_.-]*')}$`, 'i');
    cache.set(pattern, re);
  }
  return re.test(value);
}
export const matchesAny = (patterns, value) => patterns.some((p) => matches(p, value));
