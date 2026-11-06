// The default approval matrix (part 04.02, FR-04): the authority bands of docs/erp/07_APPROVAL_WORKFLOW_REFERENCE.md section B, as data. A company gets
// them the first time its matrix is read or used; after that the company owns them and changes them through the maker-checker flow. Amounts are rupees.
// Each document type has rules in priority order (first full match wins) and each rule a chain of roles; a role written MANAGER is the originator's reporting
// manager; `A|B` is either role. The last step of a chain carries the final authority (the authority limits of the role are checked against it).
export const L = 100_000; // lakh
export const CR = 10_000_000; // crore

const amount = (op, value) => ({ field: 'amount', op, value });
const rule = (name, when, roles) => ({ name, when, roles });
/** Bands on `amount`: [upTo, roles] pairs in rising order and the roles above the last bound. */
const bands = (list, above) => [
  ...list.map(([upTo, roles], i) => rule(`${i === 0 ? 'Up to' : 'Up to'} ${fmt(upTo)}`, [amount('lte', upTo)], roles)),
  rule(`Above ${fmt(list[list.length - 1][0])}`, [], above),
];
const fmt = (n) => (n >= CR ? `₹${n / CR} Cr` : n >= L ? `₹${n / L} L` : `₹${n / 1000} k`);

export const DEFAULT_MATRICES = [
  { docType: 'ACC_RACI', label: 'RACI change of a live project', owner: 'PD', financial: false, rules: [rule('Any change', [], ['PM', 'PD'])] },
  { docType: 'MDM_ITEM', label: 'New item or item version', owner: 'PROCMGR', financial: false, rules: [rule('Materials and services', [{ field: 'stewardRole', op: 'eq', value: 'PROCMGR' }], ['PROCMGR']), rule('Consumables, spares and tools', [{ field: 'stewardRole', op: 'eq', value: 'STOREMGR' }], ['STOREMGR']), rule('Labour and work items', [{ field: 'stewardRole', op: 'eq', value: 'EST' }], ['EST']), rule('Equipment classes', [], ['PLANTMGR'])] },
  { docType: 'HR_REQUISITION', label: 'Manpower requisition', owner: 'HRMGR', financial: false, rules: [rule('Beyond the headcount plan', [{ field: 'band', op: 'eq', value: 'BEYOND_PLAN' }], ['PM|PD', 'HRMGR', 'DIR']), rule('Within the plan', [], ['PM|PD', 'HRMGR'])] },
  { docType: 'HR_OFFER', label: 'Offer of employment', owner: 'HRMGR', financial: true, rules: [rule('Above the requisition range or a senior grade', [{ field: 'band', op: 'eq', value: 'DIR' }], ['HRMGR', 'DIR']), rule('Within the range', [], ['HRMGR'])] },
  { docType: 'HR_ATT_ANOMALY', label: 'Outside-fence punch accepted as present (repeated)', owner: 'HRMGR', financial: false, rules: [rule('Repeated', [{ field: 'band', op: 'eq', value: 'REPEATED' }], ['WSUP|PM', 'HRMGR']), rule('Any other', [], ['WSUP|PM'])] },
  { docType: 'HR_ATT_POLICY', label: 'Attendance policy change', owner: 'HRMGR', financial: false, rules: [rule('A change that touches pay', [{ field: 'band', op: 'eq', value: 'PAY_IMPACTING' }], ['HRMGR', 'DIR']), rule('A change that does not touch pay', [], ['HRMGR'])] },
  { docType: 'HR_ROSTER_CHANGE', label: 'Roster change or shift swap', owner: 'HRMGR', financial: false, rules: [rule('Raised by the supervisor', [{ field: 'band', op: 'eq', value: 'RAISED_BY_WSUP' }], ['PM']), rule('Raised by anyone else', [], ['WSUP', 'PM'])] },
  { docType: 'HR_REGULARISATION', label: 'Attendance regularisation', owner: 'HRMGR', financial: false, rules: [rule('The fourth or later in a month', [{ field: 'band', op: 'eq', value: 'REPEATED' }], ['WSUP|PM', 'HRMGR']), rule('Any other', [], ['WSUP|PM'])] },
  { docType: 'HR_OVERTIME_REQUEST', label: 'Overtime request', owner: 'HRMGR', financial: false, rules: [rule('A policy exception', [{ field: 'band', op: 'eq', value: 'POLICY_EXCEPTION' }], ['WSUP', 'PM', 'HRMGR']), rule('More than 4 hours a day or 50 hours a month', [{ field: 'band', op: 'eq', value: 'PM_LEVEL' }], ['WSUP', 'PM']), rule('Any other', [], ['WSUP|PM'])] },
  { docType: 'HR_ATT_MANUAL', label: 'Manual attendance entry', owner: 'HRMGR', financial: false, rules: [rule('Any manual entry', [], ['HRMGR'])] },
  { docType: 'HR_ATT_REOPEN', label: 'Reopening of a locked attendance period', owner: 'HRMGR', financial: false, rules: [rule('Any reopening', [], ['HRMGR', 'CFO'])] },
  { docType: 'HR_DEPLOYMENT', label: 'Deployment to a project or site', owner: 'HRMGR', financial: false, rules: [rule('Outside the site plan or beyond its headcount', [{ field: 'band', op: 'eq', value: 'OUTSIDE_PLAN' }], ['PM|HRMGR', 'PD']), rule('Within the site plan', [], ['PM|HRMGR'])] },
  { docType: 'HR_EMPLOYEE', label: 'New employee activation', owner: 'HRMGR', financial: false, rules: [rule('Any new employee', [], ['HRMGR'])] },
  { docType: 'HR_EMP_PROFILE', label: 'Change of personal details of an employee', owner: 'HRMGR', financial: false, rules: [rule('Any change', [], ['HRMGR'])] },
  { docType: 'HR_EMP_STATUTORY', label: 'Change of statutory details of an employee', owner: 'HRMGR', financial: false, rules: [rule('Any change', [], ['HRMGR'])] },
  { docType: 'HR_EMP_BANK', label: 'Change of the bank account of an employee', owner: 'HRMGR', financial: true, rules: [rule('Any bank change', [], ['HRMGR', 'PAY'])] },
  { docType: 'HR_EMP_EMPLOYMENT', label: 'Designation, grade or manager change of an employee', owner: 'HRMGR', financial: false, rules: [rule('Senior grades', [{ field: 'band', op: 'eq', value: 'SENIOR' }], ['HRMGR', 'DIR']), rule('Other grades', [], ['HRMGR'])] },
  { docType: 'HR_EMP_SEPARATION', label: 'Separation, notice or absconding of an employee', owner: 'HRMGR', financial: false, rules: [rule('Any status change', [], ['HRMGR'])] },
  { docType: 'MDM_PARTNER', label: 'New business partner activation', owner: 'PROCMGR', financial: true, rules: [rule('Vendors, service providers, transporters', [{ field: 'stewardRole', op: 'eq', value: 'PROCMGR' }], ['PROCMGR', 'ACCMGR']), rule('Subcontractors, clients, consultants', [], ['COMMGR', 'ACCMGR'])] },
  { docType: 'MDM_PARTNER_BANK', label: 'Bank account change of a partner', owner: 'ACCMGR', financial: true, rules: [rule('Any bank change', [], ['ACCMGR', 'CFO'])] },
  { docType: 'FIN_MASTER_CHANGE', label: 'Chart of accounts or cost code change', owner: 'CFO', financial: true, rules: [rule('Proposed by project controls', [{ field: 'makerRole', op: 'eq', value: 'PCMGR' }], ['ACCMGR', 'CFO']), rule('Proposed by the accounts manager', [], ['CFO'])] },
  { docType: 'MDM_RATE_ANALYSIS', label: 'Rate analysis release', owner: 'EST', financial: true, rules: [rule('Project-specific analysis', [{ field: 'scope', op: 'eq', value: 'PROJECT' }], ['PM']), rule('Variation rate', [{ field: 'scope', op: 'eq', value: 'VARIATION' }], ['COMMGR']), rule('Standard library', [], ['DIR'])] },
  { docType: 'MDM_PARTNER_STATUS', label: 'Blacklisting of a partner or its removal', owner: 'PROCMGR', financial: false, rules: [rule('Any blacklisting', [], ['DIR'])] },
  { docType: 'MDM_TAX_CHANGE', label: 'Tax rate or TDS section change', owner: 'ACCMGR', financial: true, rules: [rule('Any statutory change', [], ['ACCMGR', 'CFO'])] },
  { docType: 'POL_VERSION', label: 'Company policy version', owner: 'DIR', financial: false, rules: [rule('Any policy', [], ['HRMGR|CFO|QCMGR|PROCMGR|ACCMGR|COMMGR|PCMGR|HSEE', 'DIR'])] },
  { docType: 'PCS_EXCEPTION', label: 'Control exception', owner: 'SYSADM', financial: false, rules: [
    rule('Level 3 control', [{ field: 'level', op: 'eq', value: 3 }], ['DIR']),
    rule('Level 2 control, ₹10 L or more at risk', [{ field: 'level', op: 'eq', value: 2 }, { field: 'amount', op: 'gte', value: 10 * L }], ['PD', 'DIR']),
    rule('Level 2 control', [{ field: 'level', op: 'eq', value: 2 }], ['PD']),
    rule('Level 1 control, ₹10 L or more at risk', [{ field: 'amount', op: 'gte', value: 10 * L }], ['PM', 'DIR']),
    rule('Level 1 control', [], ['PM']),
  ] },
  { docType: 'PR', label: 'Purchase requisition', owner: 'PROCMGR', financial: true, rules: [rule('Up to ₹5 L', [amount('lte', 5 * L)], ['PM']), rule('Up to ₹25 L', [amount('lte', 25 * L)], ['PD']), rule('Above ₹25 L', [], ['PROCMGR'])] },
  { docType: 'PO', label: 'Purchase order', owner: 'PROCMGR', financial: true, rules: bands([[5 * L, ['PROCMGR']], [25 * L, ['PROCMGR', 'PM']], [CR, ['PROCMGR', 'PM', 'PD']]], ['PROCMGR', 'PM', 'PD', 'DIR']) },
  { docType: 'SO', label: 'Service order', owner: 'PROCMGR', financial: true, rules: bands([[5 * L, ['PROCMGR']], [25 * L, ['PROCMGR', 'PM']], [CR, ['PROCMGR', 'PM', 'PD']]], ['PROCMGR', 'PM', 'PD', 'DIR']) },
  { docType: 'CS', label: 'Comparative statement (non-L1 selection)', owner: 'PROCMGR', financial: true, rules: bands([[5 * L, ['PROCMGR', 'PM']], [25 * L, ['PROCMGR', 'PM', 'PD']], [CR, ['PROCMGR', 'PM', 'PD', 'DIR']]], ['PROCMGR', 'PM', 'PD', 'DIR']) },
  { docType: 'SWO', label: 'Subcontract work order', owner: 'COMMGR', financial: true, rules: bands([[10 * L, ['COMMGR']], [50 * L, ['COMMGR', 'PD']]], ['COMMGR', 'PD', 'DIR']) },
  { docType: 'RABILL', label: 'Client RA bill', owner: 'COMMGR', financial: true, rules: [rule('Any amount', [], ['PM', 'COMMGR'])] },
  { docType: 'VBILL', label: 'Subcontractor or vendor bill', owner: 'ACCMGR', financial: true, rules: bands([[10 * L, ['QS', 'PM']], [50 * L, ['QS', 'PM', 'COMMGR']]], ['QS', 'PM', 'COMMGR', 'CFO']) },
  { docType: 'PAY', label: 'Payment release', owner: 'ACCMGR', financial: true, rules: bands([[10 * L, ['ACCMGR']], [CR, ['ACCMGR', 'CFO']]], ['ACCMGR', 'CFO', 'DIR']) },
  { docType: 'ADV', label: 'Advance to vendor or subcontractor', owner: 'ACCMGR', financial: true, rules: bands([[25 * L, ['PM', 'COMMGR', 'CFO']]], ['PM', 'COMMGR', 'CFO', 'DIR']) },
  { docType: 'BUDGET', label: 'Budget (original)', owner: 'PCMGR', financial: true, rules: [rule('Any amount', [], ['PCMGR', 'PD', 'DIR'])] },
  { docType: 'BUDREV', label: 'Budget revision or transfer', owner: 'PCMGR', financial: true, rules: [rule('Up to 2 % of the budget', [{ field: 'changePct', op: 'lte', value: 2 }], ['PCMGR']), rule('Up to 5 % of the budget', [{ field: 'changePct', op: 'lte', value: 5 }], ['PCMGR', 'PD']), rule('Above 5 % of the budget', [], ['PCMGR', 'PD', 'DIR'])] },
  { docType: 'VO', label: 'Variation order', owner: 'COMMGR', financial: true, rules: bands([[10 * L, ['QS', 'COMMGR']], [50 * L, ['QS', 'COMMGR', 'PD']]], ['QS', 'COMMGR', 'PD', 'DIR']) },
  { docType: 'JV', label: 'Journal voucher (manual)', owner: 'ACCMGR', financial: true, rules: bands([[5 * L, ['ACCMGR']]], ['ACCMGR', 'CFO']) },
  { docType: 'STKADJ', label: 'Stock adjustment or write-off', owner: 'STOREMGR', financial: true, rules: bands([[50_000, ['STOREMGR']], [5 * L, ['STOREMGR', 'PROCMGR']]], ['STOREMGR', 'PROCMGR', 'CFO']) },
  { docType: 'LEAVE', label: 'Leave', owner: 'HRMGR', financial: false, rules: [rule('More than 10 days or a special type', [{ field: 'days', op: 'gt', value: 10 }], ['MANAGER', 'HRMGR']), rule('Up to 10 days', [], ['MANAGER'])] },
  { docType: 'ATT', label: 'Attendance regularisation or overtime', owner: 'HRMGR', financial: false, rules: [rule('Policy exception', [{ field: 'policyException', op: 'eq', value: true }], ['MANAGER', 'PM', 'HRMGR']), rule('More than 4 h overtime a day', [{ field: 'otHours', op: 'gt', value: 4 }], ['MANAGER', 'PM']), rule('Within policy', [], ['MANAGER'])] },
  { docType: 'EXP', label: 'Expense claim or imprest', owner: 'ACCMGR', financial: true, rules: bands([[25_000, ['MANAGER']], [L, ['MANAGER', 'ACCMGR']]], ['MANAGER', 'ACCMGR', 'CFO']) },
  { docType: 'HIRE', label: 'New employee or offer', owner: 'HRMGR', financial: false, rules: [rule('Senior grade', [{ field: 'seniorGrade', op: 'eq', value: true }], ['MANAGER', 'HRMGR', 'DIR']), rule('Other grades', [], ['MANAGER', 'HRMGR'])] },
  { docType: 'PARTY', label: 'Vendor or client master (new or bank change)', owner: 'ACCMGR', financial: true, rules: [rule('Client', [{ field: 'partyType', op: 'eq', value: 'client' }], ['COMMGR', 'ACCMGR']), rule('Vendor', [], ['PROCMGR', 'ACCMGR'])] },
  { docType: 'WA', label: 'Work authorisation', owner: 'PM', financial: false, rules: [rule('Outside the plan', [{ field: 'outsidePlan', op: 'eq', value: true }], ['CM', 'PM']), rule('Within the plan', [], ['CM'])] },
  { docType: 'DPR', label: 'Daily progress report', owner: 'PM', financial: false, rules: [rule('Any', [], ['CM'])] },
  { docType: 'IR', label: 'Inspection request', owner: 'QCMGR', financial: false, rules: [rule('Any', [], ['QCE'])] },
  { docType: 'NCR', label: 'Non-conformance report closure', owner: 'QCMGR', financial: false, rules: [rule('Critical', [{ field: 'severity', op: 'eq', value: 'critical' }], ['QCE', 'QCMGR', 'PD']), rule('Major', [{ field: 'severity', op: 'eq', value: 'major' }], ['QCE', 'QCMGR']), rule('Minor', [], ['QCE'])] },
  { docType: 'PTW', label: 'Permit to work', owner: 'HSEE', financial: false, rules: [rule('High-risk permit', [{ field: 'highRisk', op: 'eq', value: true }], ['HSEE', 'CM']), rule('Other permits', [], ['HSEE'])] },
  { docType: 'EQH', label: 'Equipment hire or mobilisation', owner: 'PLANTMGR', financial: true, rules: [rule('More than ₹5 L a month', [{ field: 'monthlyAmount', op: 'gt', value: 5 * L }], ['PMSUP', 'PM', 'PLANTMGR']), rule('Up to ₹5 L a month', [], ['PMSUP', 'PM'])] },
  { docType: 'FA', label: 'Fixed asset capitalisation or disposal', owner: 'ACCMGR', financial: true, rules: [rule('Disposal above ₹10 L', [{ field: 'action', op: 'eq', value: 'disposal' }, amount('gt', 10 * L)], ['ACCMGR', 'CFO', 'DIR']), rule('Other', [], ['ACCMGR', 'CFO'])] },
  { docType: 'PAYROLL', label: 'Payroll run', owner: 'HRMGR', financial: true, rules: [rule('Any', [], ['HRMGR', 'CFO'])] },
  { docType: 'BID', label: 'Tender bid or no-bid and bid submission', owner: 'EST', financial: false, rules: [rule('Any', [], ['DIR'])] },
  { docType: 'ESTIMATE', label: 'Estimate approval', owner: 'EST', financial: false, rules: [rule('Any', [], ['DIR'])] },
  { docType: 'CLAIM', label: 'Contract, claim or EOT submission', owner: 'COMMGR', financial: false, rules: [rule('Any', [], ['COMMGR', 'PD', 'DIR'])] },
  { docType: 'ROLECHG', label: 'Role or permission change', owner: 'SYSADM', financial: false, rules: [rule('Any', [], ['ITADM|DIR'])] },
  // the engine's own documents: the matrix and delegations are changed through the same engine
  { docType: 'ENG_SAMPLE_DOC', label: 'Sample document', owner: 'PROCMGR', financial: false, sample: true, rules: [rule('Any amount', [], ['PM', 'ACCMGR', 'CFO'])], stepWhen: { 2: amount('gte', 1_000_000) } },
];

/** The authority limits that follow from the bands: the role that ends a chain may approve up to the top of its band (rupees; null = no limit). */
export const DEFAULT_LIMITS = (() => {
  const out = new Map();
  for (const m of DEFAULT_MATRICES) {
    if (m.sample) continue;
    for (const r of m.rules) {
      const last = r.roles[r.roles.length - 1];
      if (last === 'MANAGER' || last.includes('|')) continue;
      const top = r.when.find((c) => c.field === 'amount' && c.op === 'lte')?.value ?? null;
      const key = `${last}|${m.docType}`;
      const prev = out.get(key);
      if (!prev || top === null || (prev.max !== null && top > prev.max)) out.set(key, { role: last, docType: m.docType, max: top === null ? (prev && prev.max !== null && prev.max !== undefined ? null : null) : top });
    }
  }
  return [...out.values()].map((l) => ({ ...l }));
})();
