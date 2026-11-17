import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { FORMATS, masterLabels } from '../../platform/mdm/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { Decimal, dec } from '../../../shared/decimal.js';
import { fromUnits, toUnits } from '../../../shared/money.js';
import { todayIST } from '../../../shared/dates.js';

// The common reference masters (part 06.02): units of measure, GST rates, HSN/SAC codes, TDS/TCS sections, states and districts, currencies and exchange rates, banks and IFSC, payment and delivery terms,
// and the lookup lists. One engine over a table per master, each described below. A row with no company is the system row every company sees; a company changes it by having its own row with the same key,
// which replaces the system row for that company only (for a dated master: from its own date). The statutory masters (GST rates, HSN/SAC, TDS sections) keep every rate with the date it applies from (BR-01)
// and change only through a change request approved by an accounts manager and then the CFO (workflow MDM_TAX_CHANGE, rows of the 06.01 change requests table); the others are kept by their stewards' roles
// directly, audited. Units are converted through their base unit as exact fractions, so a conversion and its reverse give back the quantity (BR-02).
export const TAX_DOC = 'MDM_TAX_CHANGE';
const nowIso = () => new Date().toISOString();
const dayBefore = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const trimNum = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
const pct = (u) => (u == null ? null : trimNum(fromUnits(u, 'percent').toFixed()));
const rupees = (u) => (u == null ? null : trimNum(fromUnits(u, 'money').toFixed()));
const rate4 = (u) => (u == null ? null : trimNum(fromUnits(u, 'rate').toFixed()));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// field types: text, upper (capitals), int, percent (stored x10000), money (paise), rate (x10000), decimal (exact text), bool, enum, date, ref (a code of another master), json
const f = (key, col, label, type, extra = {}) => ({ key, col, label, type, ...extra });
export const P16608 = 'ff.mdm.p16608';
export const NATURES = [['CONTRACTOR', 'Payment to a contractor'], ['PROFESSIONAL', 'Professional or technical fees'], ['PURCHASE_GOODS', 'Purchase of goods'], ['RENT_PLANT', 'Rent of plant or machinery'], ['RENT_LAND', 'Rent of land or building'], ['COMMISSION', 'Commission or brokerage'], ['SALE_GOODS', 'Sale of goods (TCS)'], ['OTHER', 'Other']];
const ACTS = [['IT1961', 'Income-tax Act, 1961'], ['IT2025', 'Income-tax Act, 2025']];
export const FORM_PURPOSES = [['SALARY_CERT', 'Certificate, salary'], ['NON_SALARY_CERT', 'Certificate, other payments'], ['SALARY_RETURN', 'Quarterly statement, salary'], ['NON_SALARY_RETURN', 'Quarterly statement, other payments']];
const LABOUR_CODES = [['WAGES', 'Code on Wages, 2019'], ['SOCIAL_SECURITY', 'Code on Social Security, 2020'], ['INDUSTRIAL_RELATIONS', 'Industrial Relations Code, 2020'], ['OSH', 'Occupational Safety, Health and Working Conditions Code, 2020']];
export const WAGE_CLASSES = [['WAGES', 'Wages'], ['EXCLUDED', 'Excluded (counted for the 50 % rule)'], ['NOT_REMUNERATION', 'Not remuneration']];
/** @type {Record<string, any>} */
export const COMMON = {
  uom: {
    table: 'mdm_uoms', label: 'Units of measure', labelHi: 'माप की इकाइयाँ', masterType: 'UOM', edit: 'mdm.uom.edit', key: ['code'], order: 'category, factor_to_base + 0, code',
    fields: [f('code', 'code', 'Code', 'upper', { required: true, max: 10, pattern: /^[A-Z][A-Z0-9_]{0,9}$/ }), f('name', 'name', 'Name', 'text', { required: true, max: 60 }), f('nameHi', 'name_hi', 'Name (Hindi)', 'text', { max: 60 }),
      f('category', 'category', 'Category', 'enum', { required: true, options: [['LENGTH', 'Length'], ['AREA', 'Area'], ['VOLUME', 'Volume'], ['WEIGHT', 'Weight'], ['COUNT', 'Count'], ['TIME', 'Time']] }),
      f('baseUom', 'base_uom', 'Base unit', 'upper', { required: true, max: 10, hint: 'The unit of the category every factor is to (its own code for the base unit)' }),
      f('factorToBase', 'factor_to_base', 'Factor to base', 'decimal', { required: true, hint: '1 of this unit = factor of the base unit, for example 1 MT = 1000 KG' }), f('decimals', 'decimals', 'Decimals', 'int', { required: true, min: 0, max: 6 })],
    filters: ['category'],
  },
  'gst-rates': {
    table: 'mdm_gst_rates', label: 'GST rates', labelHi: 'जीएसटी दरें', masterType: 'GST_RATE', edit: 'mdm.tax.edit', key: ['code'], dated: true, approval: true, order: 'igst_pct, code, effective_from',
    fields: [f('code', 'code', 'Code', 'upper', { required: true, max: 12, pattern: /^[A-Z][A-Z0-9_]{1,11}$/ }), f('description', 'description', 'Description', 'text', { required: true, max: 120 }),
      f('igstPct', 'igst_pct', 'IGST %', 'percent', { required: true, max100: true }), f('cgstPct', 'cgst_pct', 'CGST %', 'percent', { required: true, max100: true }), f('sgstPct', 'sgst_pct', 'SGST/UTGST %', 'percent', { required: true, max100: true }), f('cessPct', 'cess_pct', 'Cess %', 'percent', { max100: true })],
  },
  'hsn-sac': {
    table: 'mdm_hsn_sac', label: 'HSN/SAC codes', labelHi: 'एचएसएन/एसएसी कोड', masterType: 'HSN_SAC', edit: 'mdm.tax.edit', key: ['code'], dated: true, approval: true, order: 'code_type, code, effective_from',
    fields: [f('code', 'code', 'Code', 'text', { required: true, max: 8, pattern: /^[0-9]{4,8}$/ }), f('codeType', 'code_type', 'Type', 'enum', { required: true, options: [['HSN', 'HSN (goods)'], ['SAC', 'SAC (services)']] }),
      f('description', 'description', 'Description', 'text', { required: true, max: 200 }), f('defaultGstRate', 'default_gst_code', 'Default GST rate', 'ref', { required: true, ref: 'gst-rates' }), f('reverseCharge', 'reverse_charge', 'Reverse charge', 'bool')],
    filters: ['codeType'],
  },
  'tds-sections': {
    table: 'mdm_tds_sections', label: 'TDS/TCS sections', labelHi: 'टीडीएस/टीसीएस धाराएँ', masterType: 'TDS_SECTION', edit: 'mdm.tax.edit', key: ['natureCode', 'section'], dated: true, approval: true, order: 'tax_kind DESC, section, effective_from',
    fields: [f('section', 'section', 'Section', 'text', { required: true, max: 12, pattern: /^[0-9]{3}[A-Z0-9()]{0,8}$/ }), f('taxKind', 'tax_kind', 'Kind', 'enum', { required: true, options: [['TDS', 'TDS'], ['TCS', 'TCS']] }),
      f('description', 'description', 'Description', 'text', { required: true, max: 200 }), f('rateIndividual', 'rate_individual', 'Rate, individual or HUF %', 'percent', { required: true, max100: true }), f('rateCompany', 'rate_company', 'Rate, others %', 'percent', { required: true, max100: true }),
      f('thresholdSingle', 'threshold_single', 'Threshold, one payment (₹)', 'money'), f('thresholdAnnual', 'threshold_annual', 'Threshold, in a year (₹)', 'money'),
      // part 166.8 (S-02, S-03): the nature of the payment (the key with the section, so 393(1) of the 2025 Act has a row per nature), the Act, the legal reference and the TRACES payment codes
      f('natureCode', 'nature_code', 'Nature of payment', 'enum', { options: NATURES, flag: P16608, hint: 'Without it, the nature of the system row of the same section' }), f('actCode', 'act_code', 'Act', 'enum', { options: ACTS, flag: P16608 }),
      f('legalRef', 'legal_ref', 'Legal reference', 'text', { max: 120, flag: P16608 }), f('paymentCode', 'payment_code', 'Payment code, individual or HUF', 'upper', { max: 8, flag: P16608 }), f('paymentCodeOther', 'payment_code_other', 'Payment code, others', 'upper', { max: 8, flag: P16608 })],
    filters: ['taxKind'],
  },
  // part 166.8: the certificate and return forms by date (16 → 130, 16A → 131, 24Q → 138, 26Q → 140 from 01-04-2026)
  'tds-forms': {
    table: 'mdm_tds_forms', label: 'TDS forms', labelHi: 'टीडीएस फ़ॉर्म', masterType: 'TDS_FORM', edit: 'mdm.tax.edit', key: ['purpose'], dated: true, approval: true, flag: P16608, order: 'purpose, effective_from',
    fields: [f('purpose', 'purpose', 'Purpose', 'enum', { required: true, options: FORM_PURPOSES }), f('formCode', 'form_code', 'Form', 'upper', { required: true, max: 8, pattern: /^[0-9]{2,3}[A-Z]?$/ }),
      f('actCode', 'act_code', 'Act', 'enum', { required: true, options: ACTS }), f('replaces', 'replaces', 'Replaces form', 'upper', { max: 8 }), f('legalRef', 'legal_ref', 'Legal reference', 'text', { max: 120 }), f('description', 'description', 'Description', 'text', { required: true, max: 160 })],
    filters: ['purpose'],
  },
  // part 166.8 (FR-03): when each statutory return or deposit is due, by period; the daily job raises an alert ahead of each due date
  'statutory-calendar': {
    table: 'mdm_statutory_calendar', label: 'Statutory calendar', labelHi: 'वैधानिक कैलेंडर', masterType: 'STATUTORY_DUE', edit: 'mdm.tax.edit', key: ['code'], dated: true, approval: true, flag: P16608, order: 'period_kind, code, effective_from',
    fields: [f('code', 'code', 'Code', 'upper', { required: true, max: 20, pattern: /^[A-Z][A-Z0-9_]{1,19}$/ }), f('obligation', 'obligation', 'Obligation', 'text', { required: true, max: 160 }),
      f('purpose', 'purpose', 'Form', 'enum', { options: [...FORM_PURPOSES, ['TDS_DEPOSIT', 'Deposit of tax deducted']] }), f('periodKind', 'period_kind', 'Period', 'enum', { required: true, options: [['MONTH', 'Month'], ['QUARTER', 'Quarter of the financial year'], ['YEAR', 'Financial year']] }),
      f('periodNo', 'period_no', 'Which period (0 = every)', 'int', { min: 0, max: 12, hint: 'A month (1-12), a quarter (1-4), or 0 for every period' }), f('dueMonthsAfter', 'due_months_after', 'Due, months after the period', 'int', { required: true, min: 0, max: 12 }),
      f('dueDay', 'due_day', 'Due on day', 'int', { required: true, min: 1, max: 31, hint: 'The last day of the month when the month is shorter' }), f('alertDays', 'alert_days', 'Alert, days before', 'int', { min: 0, max: 60 }),
      f('ownerRole', 'owner_role', 'Told', 'upper', { required: true, max: 12, pattern: /^[A-Z][A-Z0-9_]{1,11}$/ }), f('legalRef', 'legal_ref', 'Legal reference', 'text', { max: 120 })],
    filters: ['periodKind'],
  },
  // part 166.8 (S-05): the rules under the four Labour Codes, central or by state, from the date each applies (states notify on different dates)
  'labour-rules': {
    table: 'mdm_labour_rules', label: 'Labour Code rules', labelHi: 'श्रम संहिता नियम', masterType: 'LABOUR_RULE', edit: 'mdm.tax.edit', key: ['stateCode', 'codeKind'], dated: true, approval: true, flag: P16608, order: "CASE state_code WHEN 'CENTRAL' THEN 0 ELSE 1 END, state_code, code_kind, effective_from",
    fields: [f('stateCode', 'state_code', 'State (or CENTRAL)', 'upper', { required: true, max: 10, hint: 'CENTRAL, or the code of a state in the states master' }), f('codeKind', 'code_kind', 'Code', 'enum', { required: true, options: LABOUR_CODES }),
      f('ruleRef', 'rule_ref', 'Rules and notification', 'text', { required: true, max: 200 }), f('notifiedOn', 'notified_on', 'Notified on', 'date')],
    filters: ['codeKind'],
  },
  // part 166.8 (S-04): pay components and their class under the Code on Wages, s.2(y): wages, an exclusion (counted for the 50 % rule) or not remuneration
  'pay-components': {
    table: 'mdm_pay_components', label: 'Pay components', labelHi: 'वेतन घटक', masterType: 'PAY_COMPONENT', edit: 'hr.employee.edit', key: ['code'], dated: true, flag: P16608, order: "CASE wage_class WHEN 'WAGES' THEN 0 WHEN 'EXCLUDED' THEN 1 ELSE 2 END, code, effective_from",
    fields: [f('code', 'code', 'Code', 'upper', { required: true, max: 20, pattern: /^[A-Z][A-Z0-9_]{1,19}$/ }), f('name', 'name', 'Name', 'text', { required: true, max: 80 }),
      f('wageClass', 'wage_class', 'Under the Code on Wages', 'enum', { required: true, options: WAGE_CLASSES }), f('legalRef', 'legal_ref', 'Legal reference', 'text', { max: 120 })],
    filters: ['wageClass'],
  },
  states: {
    table: 'mdm_states', label: 'States and union territories', labelHi: 'राज्य और केंद्र शासित प्रदेश', masterType: 'STATE', edit: 'mdm.finance.edit', key: ['code'], order: 'gst_code',
    fields: [f('code', 'code', 'Code', 'upper', { required: true, max: 3, pattern: /^[A-Z]{2,3}$/ }), f('gstCode', 'gst_code', 'GST state code', 'text', { required: true, pattern: /^[0-9]{2}$/ }), f('name', 'name', 'Name', 'text', { required: true, max: 60 }),
      f('nameHi', 'name_hi', 'Name (Hindi)', 'text', { max: 60 }), f('isUt', 'is_ut', 'Union territory', 'bool')],
  },
  districts: {
    table: 'mdm_districts', label: 'Districts', labelHi: 'ज़िले', masterType: 'DISTRICT', edit: 'mdm.finance.edit', key: ['stateCode', 'code'], order: 'state_code, name',
    fields: [f('stateCode', 'state_code', 'State', 'ref', { required: true, ref: 'states' }), f('code', 'code', 'Code', 'upper', { required: true, max: 10, pattern: /^[A-Z0-9_]{2,10}$/ }), f('name', 'name', 'Name', 'text', { required: true, max: 60 }), f('nameHi', 'name_hi', 'Name (Hindi)', 'text', { max: 60 })],
    filters: ['stateCode'],
  },
  currencies: {
    table: 'mdm_currencies', label: 'Currencies', labelHi: 'मुद्राएँ', masterType: 'CURRENCY', edit: 'mdm.finance.edit', key: ['code'], order: "CASE code WHEN 'INR' THEN 0 ELSE 1 END, code",
    fields: [f('code', 'code', 'Code', 'upper', { required: true, pattern: /^[A-Z]{3}$/ }), f('name', 'name', 'Name', 'text', { required: true, max: 40 }), f('symbol', 'symbol', 'Symbol', 'text', { required: true, max: 4 }), f('decimals', 'decimals', 'Decimals', 'int', { required: true, min: 0, max: 4 })],
  },
  'exchange-rates': {
    table: 'mdm_exchange_rates', label: 'Exchange rates', labelHi: 'विनिमय दरें', masterType: 'EXCHANGE_RATE', edit: 'mdm.finance.edit', key: ['currencyCode', 'rateDate'], order: 'fx_date DESC, currency_code',
    fields: [f('currencyCode', 'currency_code', 'Currency', 'ref', { required: true, ref: 'currencies' }), f('rateDate', 'fx_date', 'Date', 'date', { required: true }), f('rateToInr', 'rate_to_inr', '1 unit in ₹', 'rate', { required: true, positive: true }),
      f('rateSource', 'fx_source', 'Source', 'enum', { options: [['MANUAL', 'Entered'], ['FEED', 'Provider feed'], ['IMPORT', 'Imported']] })],
    filters: ['currencyCode'],
  },
  banks: {
    table: 'mdm_banks', label: 'Banks and IFSC', labelHi: 'बैंक और आईएफएससी', masterType: 'BANK', edit: 'mdm.finance.edit', key: ['ifsc'], order: 'bank_name, ifsc', search: ['bank_name', 'ifsc', 'branch', 'city'],
    fields: [f('ifsc', 'ifsc', 'IFSC', 'upper', { required: true, format: 'IFSC' }), f('bankName', 'bank_name', 'Bank', 'text', { required: true, max: 100 }), f('branch', 'branch', 'Branch', 'text', { required: true, max: 100 }),
      f('city', 'city', 'City', 'text', { max: 60 }), f('stateName', 'state_name', 'State', 'text', { max: 60 }), f('address', 'address', 'Address', 'text', { max: 300 }), f('micr', 'micr', 'MICR', 'text', { pattern: /^[0-9]{9}$/ })],
  },
  'payment-terms': {
    table: 'mdm_payment_terms', label: 'Payment and delivery terms', labelHi: 'भुगतान और डिलीवरी शर्तें', masterType: 'PAYMENT_TERM', edit: 'mdm.finance.edit', key: ['code'], order: "CASE term_kind WHEN 'PAYMENT' THEN 0 WHEN 'DELIVERY' THEN 1 ELSE 2 END, code",
    fields: [f('code', 'code', 'Code', 'upper', { required: true, max: 16, pattern: /^[A-Z0-9][A-Z0-9_-]{1,15}$/ }), f('termKind', 'term_kind', 'Kind', 'enum', { required: true, options: [['PAYMENT', 'Payment term'], ['DELIVERY', 'Delivery term'], ['INCOTERM', 'Incoterm']] }),
      f('description', 'description', 'Description', 'text', { required: true, max: 160 }), f('advancePct', 'advance_pct', 'Advance %', 'percent', { max100: true }), f('creditDays', 'credit_days', 'Credit days', 'int', { min: 0, max: 365 }),
      f('milestones', 'structure_json', 'Milestones', 'json', { hint: 'Payments after the advance: [{ label, pct, days }]; advance and milestones add up to 100%' })],
    filters: ['termKind'],
  },
  'lookup-lists': {
    table: 'mdm_lookup_lists', label: 'Lookup lists', labelHi: 'लुकअप सूचियाँ', masterType: 'LOOKUP_LIST', edit: 'mdm.lookup.edit', key: ['code'], order: 'name',
    fields: [f('code', 'code', 'Code', 'upper', { required: true, max: 30, pattern: /^[A-Z][A-Z0-9_]{1,29}$/ }), f('name', 'name', 'Name', 'text', { required: true, max: 60 }), f('nameHi', 'name_hi', 'Name (Hindi)', 'text', { max: 60 })],
  },
  lookups: {
    table: 'mdm_lookups', label: 'Lookup values', labelHi: 'लुकअप मान', masterType: 'LOOKUP', edit: 'mdm.lookup.edit', key: ['listCode', 'code'], order: 'list_code, sort_order, code',
    fields: [f('listCode', 'list_code', 'List', 'ref', { required: true, ref: 'lookup-lists' }), f('code', 'code', 'Code', 'upper', { required: true, max: 30, pattern: /^[A-Z0-9][A-Z0-9_]{0,29}$/ }), f('labelEn', 'label_en', 'Label', 'text', { required: true, max: 80 }),
      f('labelHi', 'label_hi', 'Label (Hindi)', 'text', { max: 80 }), f('sortOrder', 'sort_order', 'Order', 'int', { min: 0, max: 9999 }), f('active', 'active', 'Active', 'bool')],
    filters: ['listCode'],
  },
};
for (const [code, d] of Object.entries(COMMON)) { d.code = code; masterLabels.set(d.masterType, d.label); }
const defOf = (code) => { const d = COMMON[code]; if (!d) throw notFound(`There is no common master called ${code}.`); return d; };
const keyCols = (d) => d.key.map((k) => d.fields.find((x) => x.key === k).col);

/** A row as the API shows it. */
function view(d, r) {
  const out = { id: r.id, system: r.company_id == null, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, status: r.row_status, rowVersion: r.version, changeRequestId: r.change_request_id, updatedAt: r.updated_at ?? r.created_at };
  for (const x of d.fields) {
    const v = r[x.col];
    out[x.key] = x.type === 'percent' ? pct(v) : x.type === 'money' ? rupees(v) : x.type === 'rate' ? rate4(v) : x.type === 'bool' ? Boolean(v) : x.type === 'json' ? JSON.parse(v || '[]') : v ?? null;
  }
  return out;
}

export function createCommonService({ db, flags = null }) {
  // part 166.8: a master or a field with a flag is there only while its flag is ON for the company (without a flag service, as in a bare test: ON)
  const flagOn = (actor, key) => (flags ? flags.isOn(actor, key) : true);
  const defFor = (actor, code) => { const d = defOf(code); if (d.flag && !flagOn(actor, d.flag)) throw notFound(`There is no common master called ${code}.`); return d; };
  const fieldsFor = (actor, d) => d.fields.filter((x) => !x.flag || flagOn(actor, x.flag));
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const may = (actor, key) => authz.check(actor, key).allowed;
  const needView = (actor) => { if (!may(actor, 'mdm.record.view')) throw forbidden('You may not see the common masters (permission mdm.record.view).'); };
  const needEdit = (actor, d) => { if (!may(actor, d.edit)) throw forbidden(`You may not change ${d.label.toLowerCase()} (permission ${d.edit}).`); };

  // ---- reading: the company's view of a master (its own rows over the system rows) ----
  /** SQL for the rows a company sees: own rows, and system rows its own rows do not replace (for a dated master on `asOf`: only the rows in force that day). */
  function scope(d, companyId, { asOf = null, status = 'current' } = {}) {
    const keys = keyCols(d).filter((c) => c !== 'effective_from');
    const sameKey = keys.map((c) => `x.${c} = t.${c}`).join(' AND ');
    const live = status === 'all' ? "('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')" : status === 'pending' ? "('PENDING')" : "('ACTIVE')";
    const where = ['t.deleted_at IS NULL', `t.row_status IN ${live}`];
    const args = [];
    if (d.dated && asOf) {
      where.push('t.effective_from <= ?', '(t.effective_to IS NULL OR t.effective_to >= ?)'); args.push(asOf, asOf);
      where.push(`(t.company_id = ? OR (t.company_id IS NULL AND NOT EXISTS (SELECT 1 FROM ${d.table} x WHERE x.company_id = ? AND ${sameKey} AND x.row_status = 'ACTIVE' AND x.deleted_at IS NULL AND x.effective_from <= ? AND (x.effective_to IS NULL OR x.effective_to >= ?))))`);
      args.push(companyId, companyId, asOf, asOf);
    } else if (d.dated) {
      where.push('(t.company_id = ? OR t.company_id IS NULL)'); args.push(companyId);
    } else {
      where.push(`(t.company_id = ? OR (t.company_id IS NULL AND NOT EXISTS (SELECT 1 FROM ${d.table} x WHERE x.company_id = ? AND ${sameKey} AND x.row_status IN ('ACTIVE', 'RETIRED') AND x.deleted_at IS NULL)))`);
      args.push(companyId, companyId);
      if (status === 'current') { where.push('(t.effective_to IS NULL OR t.effective_to >= ?)'); args.push(todayIST()); }
    }
    return { where, args };
  }
  function list(actor, code, fl = {}) {
    needView(actor);
    const d = defFor(actor, code);
    const asOf = fl.asOf ?? (d.dated && (fl.status ?? 'current') === 'current' ? todayIST() : null);
    const { where, args } = scope(d, actor.companyId, { asOf, status: fl.status ?? 'current' });
    if (fl.q) { const cols = d.search ?? d.fields.filter((x) => ['text', 'upper'].includes(x.type)).map((x) => x.col); where.push(`(${cols.map((c) => `t.${c} LIKE ?`).join(' OR ')})`); args.push(...cols.map(() => `%${fl.q}%`)); }
    for (const k of d.filters ?? []) if (fl[k]) { where.push(`t.${d.fields.find((x) => x.key === k).col} = ?`); args.push(fl[k]); }
    if (fl.key) { where.push(`t.${keyCols(d).filter((c) => c !== 'effective_from').at(-1)} = ?`); args.push(fl.key); }
    const sql = `FROM ${d.table} t WHERE ${where.join(' AND ')}`;
    const total = db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...args).n;
    const rows = db.prepare(`SELECT t.* ${sql} ORDER BY ${d.order.split(',').map((o) => (o.trim().startsWith('CASE') ? o : `t.${o.trim()}`)).join(', ')} LIMIT ? OFFSET ?`).all(...args, fl.limit ?? 50, fl.offset ?? 0).map((r) => view(d, r));
    return { rows, total, asOf, canEdit: may(actor, d.edit), approval: Boolean(d.approval), dated: Boolean(d.dated) };
  }
  const rowOf = (d, actor, id) => {
    const r = db.prepare(`SELECT * FROM ${d.table} WHERE id = ? AND (company_id IS NULL OR company_id = ?) AND deleted_at IS NULL`).get(id, actor.companyId);
    if (!r) throw notFound(`That ${d.label.toLowerCase()} row does not exist.`);
    return r;
  };
  function get(actor, code, id) {
    needView(actor);
    const d = defFor(actor, code);
    const r = rowOf(d, actor, id);
    const kc = keyCols(d).filter((c) => c !== 'effective_from');
    const history = db.prepare(`SELECT * FROM ${d.table} WHERE ${kc.map((c) => `${c} = ?`).join(' AND ')} AND (company_id IS NULL OR company_id = ?) AND deleted_at IS NULL ORDER BY effective_from DESC, id DESC`).all(...kc.map((c) => r[c]), actor.companyId).map((x) => view(d, x));
    const requests = db.prepare("SELECT id, change_type, request_status, justification, effective_from, requested_by, created_at, workflow_instance_id FROM mdm_change_requests WHERE company_id = ? AND master_type = ? AND json_extract(change_json, '$.key') = ? ORDER BY id DESC LIMIT 20").all(actor.companyId, d.masterType, kc.map((c) => r[c]).join('/'))
      .map((c) => ({ id: c.id, changeType: c.change_type, status: c.request_status, justification: c.justification, effectiveFrom: c.effective_from, requestedBy: c.requested_by, createdAt: c.created_at, instanceId: c.workflow_instance_id }));
    return { ...view(d, r), history, requests, canEdit: may(actor, d.edit) };
  }

  // ---- checking input ----
  const refExists = (companyId, refCode, value) => {
    const d = COMMON[refCode];
    const kc = keyCols(d).filter((c) => c !== 'effective_from');
    return Boolean(db.prepare(`SELECT 1 FROM ${d.table} WHERE ${kc.at(-1)} = ? AND (company_id IS NULL OR company_id = ?) AND row_status = 'ACTIVE' AND deleted_at IS NULL LIMIT 1`).get(value, companyId));
  };
  /** The input as stored (column values), checked field by field and by the rules of the master. `partial` keeps fields not given. */
  function clean(actor, d, input, base = null) {
    const problems = []; const cols = {};
    const known = new Set(fieldsFor(actor, d).map((x) => x.key));
    for (const k of Object.keys(input ?? {})) if (!known.has(k)) problems.push({ field: k, message: 'is not a field of this master' });
    for (const x of d.fields) {
      const has = input && x.key in input && known.has(x.key);
      let v = has ? input[x.key] : base ? base[x.col] : undefined;
      if (has) {
        if (v === '' || v === undefined) v = null;
        try {
          if (v == null) { /* empty */ }
          else if (x.type === 'text') { v = String(v).trim(); if (x.max && v.length > x.max) throw new Error(`at most ${x.max} characters`); }
          else if (x.type === 'upper') { v = String(v).trim().toUpperCase().replace(/\s+/g, ''); if (x.max && v.length > x.max) throw new Error(`at most ${x.max} characters`); }
          else if (x.type === 'int') { if (!/^-?\d+$/.test(String(v).trim())) throw new Error('must be a whole number'); v = Number(v); if ((x.min != null && v < x.min) || (x.max != null && v > x.max)) throw new Error(`between ${x.min} and ${x.max}`); }
          else if (['percent', 'money', 'rate'].includes(x.type)) { const s = String(v).trim().replace(/,/g, ''); if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('must be a number, not negative'); v = toUnits(s, x.type); if (x.max100 && v > 1_000_000) throw new Error('at most 100'); if (x.positive && v <= 0) throw new Error('must be more than 0'); }
          else if (x.type === 'decimal') { const s = String(v).trim(); if (!/^\d+(\.\d{1,12})?$/.test(s) || dec(s).isZero()) throw new Error('must be a number more than 0, up to 12 decimals'); v = s; }
          else if (x.type === 'bool') v = v === true || v === 1 || ['true', 'yes', '1', 'y'].includes(String(v).toLowerCase()) ? 1 : 0;
          else if (x.type === 'enum') { v = String(v).trim().toUpperCase(); if (!x.options.some(([k]) => k === v)) throw new Error(`choose one of ${x.options.map(([k]) => k).join(', ')}`); }
          else if (x.type === 'date') { if (!DATE.test(String(v))) throw new Error('use a date such as 2026-12-01'); v = String(v); }
          else if (x.type === 'ref') { v = String(v).trim().toUpperCase(); if (!refExists(actor.companyId, x.ref, v)) throw new Error(`${v} is not in ${COMMON[x.ref].label.toLowerCase()}`); }
          else if (x.type === 'json') { const arr = typeof v === 'string' ? JSON.parse(v) : v; if (!Array.isArray(arr) || arr.length > 20) throw new Error('a list of at most 20 milestones'); for (const m of arr) if (!m || typeof m.label !== 'string' || !(Number(m.pct) > 0) || !(Number(m.days) >= 0)) throw new Error('each milestone needs a label, a percentage above 0 and days'); v = JSON.stringify(arr.map((m) => ({ label: m.label.trim().slice(0, 80), pct: Number(m.pct), days: Math.round(Number(m.days)) }))); }
          if (v != null && x.pattern && !x.pattern.test(String(v))) throw new Error('is not in the expected form');
          if (v != null && x.format && !FORMATS[x.format].test(String(v))) throw new Error(`is not a valid ${FORMATS[x.format].label} (${FORMATS[x.format].hint})`);
        } catch (e) { problems.push({ field: x.key, message: `${x.label} ${e.message}` }); continue; }
      }
      if (v == null && x.required) problems.push({ field: x.key, message: `${x.label} is required` });
      cols[x.col] = v ?? (x.type === 'bool' ? 0 : x.type === 'json' ? '[]' : ['percent', 'money', 'int'].includes(x.type) && !x.required && x.col !== 'sort_order' ? 0 : x.col === 'sort_order' ? 0 : null);
      if (d.code === 'lookups' && x.key === 'active' && !has && !base) cols.active = 1;
      if (d.code === 'exchange-rates' && x.key === 'rateSource' && cols.fx_source == null) cols.fx_source = 'MANUAL';
    }
    if (d.code === 'tds-sections') { // part 166.8: a row without a nature takes the nature of the system row of its section (so a company's own 194C still replaces the system 194C)
      if (cols.nature_code == null) cols.nature_code = db.prepare('SELECT nature_code FROM mdm_tds_sections WHERE company_id IS NULL AND section = ? AND deleted_at IS NULL ORDER BY effective_from DESC LIMIT 1').get(cols.section)?.nature_code ?? 'OTHER';
      if (cols.act_code == null) cols.act_code = 'IT1961';
    }
    if (!problems.length) problems.push(...rules(actor, d, cols));
    if (problems.length) throw badRequest('Some fields are not valid.', problems);
    return cols;
  }
  /** The rules of each master beyond the field checks. */
  function rules(actor, d, c) {
    const p = [];
    if (d.code === 'labour-rules' && c.state_code !== 'CENTRAL' && !refExists(actor.companyId, 'states', c.state_code)) p.push({ field: 'stateCode', message: `${c.state_code} is neither CENTRAL nor a state in the states master` });
    if (d.code === 'statutory-calendar' && c.period_kind === 'QUARTER' && c.period_no > 4) p.push({ field: 'periodNo', message: 'A financial year has four quarters' });
    if (d.code === 'statutory-calendar' && c.period_kind === 'YEAR' && c.period_no !== 0) p.push({ field: 'periodNo', message: 'A yearly obligation has no period number: use 0' });
    if (d.code === 'gst-rates') {
      if (c.cgst_pct + c.sgst_pct !== c.igst_pct) p.push({ field: 'igstPct', message: 'IGST must equal CGST plus SGST/UTGST' });
      if (c.cgst_pct !== c.sgst_pct) p.push({ field: 'sgstPct', message: 'CGST and SGST/UTGST are equal halves' });
    }
    if (d.code === 'uom') {
      if (c.base_uom === c.code) { if (dec(c.factor_to_base).cmp(dec('1')) !== 0) p.push({ field: 'factorToBase', message: 'The base unit has factor 1' }); }
      else {
        const base = db.prepare("SELECT * FROM mdm_uoms WHERE code = ? AND (company_id IS NULL OR company_id = ?) AND row_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY company_id IS NULL LIMIT 1").get(c.base_uom, actor.companyId);
        if (!base) p.push({ field: 'baseUom', message: `${c.base_uom} is not a unit` });
        else if (base.category !== c.category) p.push({ field: 'baseUom', message: `${c.base_uom} measures ${base.category.toLowerCase()}, not ${c.category.toLowerCase()}` });
        else if (base.base_uom !== base.code) p.push({ field: 'baseUom', message: `${c.base_uom} is not a base unit (its base is ${base.base_uom}); use ${base.base_uom}` });
      }
    }
    if (d.code === 'payment-terms') {
      const ms = JSON.parse(c.structure_json || '[]');
      if (c.term_kind !== 'PAYMENT' && (c.advance_pct || c.credit_days || ms.length)) p.push({ field: 'termKind', message: 'Only a payment term has an advance, credit days or milestones' });
      if (ms.length) { const total = ms.reduce((n, m) => n.add(dec(String(m.pct))), fromUnits(c.advance_pct ?? 0, 'percent')); if (total.cmp(dec('100')) !== 0) p.push({ field: 'milestones', message: `The advance and the milestones add up to ${trimNum(total.toFixed())}%, not 100%` }); }
    }
    if (d.code === 'currencies' && c.code === 'INR' && c.decimals !== 2) p.push({ field: 'decimals', message: 'The rupee has 2 decimals' });
    if (d.code === 'exchange-rates' && c.currency_code === 'INR') p.push({ field: 'currencyCode', message: 'The rupee has no exchange rate to itself' });
    return p;
  }
  const keyOf = (d, cols) => keyCols(d).filter((c) => c !== 'effective_from').map((c) => cols[c]).join('/');
  const ownSame = (d, companyId, cols, exceptId = null) => {
    const kc = keyCols(d).filter((c) => c !== 'effective_from');
    return db.prepare(`SELECT * FROM ${d.table} WHERE company_id = ? AND ${kc.map((c) => `${c} = ?`).join(' AND ')} AND row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL ${exceptId ? 'AND id != ?' : ''} ORDER BY effective_from`).all(companyId, ...kc.map((c) => cols[c]), ...(exceptId ? [exceptId] : []));
  };
  const insertRow = (d, companyId, cols, { status = 'ACTIVE', from = null, crId = null, by, source = 'mdm_common' }) => {
    const all = { ...cols, company_id: companyId, row_status: status, change_request_id: crId, created_by: by, source_type: source, ...(from ? { effective_from: from } : {}) };
    const names = Object.keys(all);
    return Number(db.prepare(`INSERT INTO ${d.table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...names.map((n) => all[n])).lastInsertRowid);
  };
  const afterWrite = (d, actor, id) => { if (d.code === 'uom') syncCoreUom(db, rowOf(d, actor, id)); };

  // ---- writing ----
  /** A new row. A statutory master: a change request (ACCMGR then CFO); the others: saved now, audited. */
  function create(actor, code, b) {
    const d = defFor(actor, code);
    needEdit(actor, d);
    const cols = clean(actor, d, b.data);
    if (d.approval) return propose(actor, d, { cols, before: {}, changeType: 'CREATE', from: b.effectiveFrom ?? todayIST(), justification: b.justification });
    return transaction(db, () => {
      if (ownSame(d, actor.companyId, cols).length) throw conflict(`${keyOf(d, cols)} already exists in ${d.label.toLowerCase()}.`);
      const id = insertRow(d, actor.companyId, cols, { by: actor.user, from: b.effectiveFrom ?? null });
      writeAudit(db, { entity: d.table, entityId: id, action: 'create', newValues: view(d, { ...cols, id }), actor: actor.user, companyId: actor.companyId, reason: b.justification ?? null });
      publishEvent(db, { type: 'mdm.common.changed', entity: d.table, entityId: id, actorId: actor.user, companyId: actor.companyId, data: { master: code, key: keyOf(d, cols), action: 'create' } });
      afterWrite(d, actor, id);
      return { applied: true, row: view(d, rowOf(d, actor, id)) };
    });
  }
  /**
   * A change. A statutory master: a new version of the row from a date, approved (BR-01). The others: the company's own row is changed (row version checked); a system row is not changed for
   * every company, the company gets its own row with the change, which replaces the system row for it.
   */
  function update(actor, code, id, b) {
    const d = defFor(actor, code);
    needEdit(actor, d);
    const r = rowOf(d, actor, id);
    if (r.version !== b.version) throw conflict('This row was changed by someone else. Reload it and try again.');
    if (r.row_status !== 'ACTIVE') throw conflict(`This row is ${r.row_status.toLowerCase()} and cannot be changed.`);
    for (const k of d.key) if (k in (b.data ?? {}) && b.data[k] !== view(d, r)[k]) throw badRequest('The key of a row is not changed; add a new row instead.', [{ field: k, message: 'cannot be changed' }]);
    const cols = clean(actor, d, b.data, r);
    const changed = Object.keys(cols).filter((c) => String(cols[c] ?? '') !== String(r[c] ?? ''));
    if (!changed.length) throw badRequest('Nothing was changed.', [{ field: 'data', message: 'change at least one field' }]);
    if (d.approval) {
      const from = b.effectiveFrom ?? todayIST();
      if (from <= r.effective_from) throw badRequest(`A new rate applies after the current one, which applies from ${r.effective_from}.`, [{ field: 'effectiveFrom', message: `choose a date after ${r.effective_from}` }]);
      return propose(actor, d, { cols, before: view(d, r), changeType: 'UPDATE', from, justification: b.justification });
    }
    return transaction(db, () => {
      let rowId = r.id;
      if (r.company_id == null && ownSame(d, actor.companyId, r).length) throw conflict(`Your company already has its own ${keyOf(d, r)}; change that row instead of the system one.`);
      if (r.company_id == null) {
        rowId = insertRow(d, actor.companyId, { ...Object.fromEntries(d.fields.map((x) => [x.col, cols[x.col]])) }, { by: actor.user, from: r.effective_from, source: 'mdm_common_override' });
      } else {
        const sets = changed.map((c) => `${c} = ?`);
        db.prepare(`UPDATE ${d.table} SET ${sets.join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`).run(...changed.map((c) => cols[c]), actor.user, nowIso(), r.id, r.version);
      }
      writeAudit(db, { entity: d.table, entityId: rowId, action: r.company_id == null ? 'override' : 'update', oldValues: Object.fromEntries(changed.map((c) => [c, r[c]])), newValues: Object.fromEntries(changed.map((c) => [c, cols[c]])), actor: actor.user, companyId: actor.companyId, reason: b.justification ?? null });
      publishEvent(db, { type: 'mdm.common.changed', entity: d.table, entityId: rowId, actorId: actor.user, companyId: actor.companyId, data: { master: code, key: keyOf(d, cols), action: 'update' } });
      afterWrite(d, actor, rowId);
      return { applied: true, row: view(d, rowOf(d, actor, rowId)) };
    });
  }
  /** A row no longer used from a date (not for the statutory masters: a newer rate replaces an old one). It stays for the records that used it. */
  function retire(actor, code, id, b) {
    const d = defFor(actor, code);
    needEdit(actor, d);
    if (d.approval) throw unprocessable(`A ${d.label.toLowerCase()} row is not ended by hand: propose a new one from the date it changes.`);
    const r = rowOf(d, actor, id);
    if (r.version !== b.version) throw conflict('This row was changed by someone else. Reload it and try again.');
    if (r.row_status !== 'ACTIVE') throw conflict('This row is already ended.');
    return transaction(db, () => {
      let rowId = r.id;
      if (r.company_id == null) rowId = insertRow(d, actor.companyId, Object.fromEntries(d.fields.map((x) => [x.col, r[x.col]])), { by: actor.user, from: r.effective_from, status: 'RETIRED', source: 'mdm_common_override' });
      else db.prepare("UPDATE " + d.table + " SET row_status = 'RETIRED', effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(dayBefore(todayIST()), actor.user, nowIso(), r.id);
      writeAudit(db, { entity: d.table, entityId: rowId, action: 'retire', actor: actor.user, companyId: actor.companyId, reason: b.reason });
      publishEvent(db, { type: 'mdm.common.changed', entity: d.table, entityId: rowId, actorId: actor.user, companyId: actor.companyId, data: { master: code, key: keyOf(d, r), action: 'retire' } });
      return { applied: true };
    });
  }

  // ---- statutory changes: a pending row and a change request, approved by an accounts manager and then the CFO ----
  function propose(actor, d, { cols, before, changeType, from, justification }) {
    if (!justification || justification.trim().length < 10) throw badRequest('Say why the rate changes (at least 10 characters), for example the notification number.', [{ field: 'justification', message: 'is required for a statutory change' }]);
    if (!DATE.test(from)) throw badRequest('Give the date the change applies from.', [{ field: 'effectiveFrom', message: 'use a date such as 2026-12-01' }]);
    return transaction(db, () => {
      const key = keyOf(d, cols);
      const own = ownSame(d, actor.companyId, cols);
      if (own.some((x) => x.row_status === 'PENDING')) throw conflict(`A change of ${key} is already waiting for approval.`);
      if (own.some((x) => x.effective_from >= from)) throw conflict(`${key} already has a rate from ${own.at(-1).effective_from}; a change applies after it.`);
      if (changeType === 'CREATE' && db.prepare(`SELECT 1 FROM ${d.table} WHERE company_id IS NULL AND ${keyCols(d).filter((c) => c !== 'effective_from').map((c) => `${c} = ?`).join(' AND ')} AND row_status = 'ACTIVE' AND deleted_at IS NULL`).get(...keyCols(d).filter((c) => c !== 'effective_from').map((c) => cols[c])))
        throw conflict(`${key} already exists; change it instead (a change applies from its date).`);
      const after = view(d, { ...cols, effective_from: from });
      const fields = d.fields.filter((x) => changeType === 'CREATE' || String(after[x.key] ?? '') !== String(before[x.key] ?? '')).map((x) => ({ key: x.key, label: x.label, sensitive: false, before: before[x.key] ?? null, after: after[x.key] ?? null }));
      const crId = Number(db.prepare("INSERT INTO mdm_change_requests (company_id, master_type, record_id, change_type, change_json, before_json, justification, effective_from, sensitive, requested_by, created_by, source_type) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 1, ?, ?, 'mdm_common')")
        .run(actor.companyId, d.masterType, changeType, JSON.stringify({ master: d.code, key, fields }), JSON.stringify(before), justification.trim(), from, actor.user, actor.user).lastInsertRowid);
      const rowId = insertRow(d, actor.companyId, cols, { status: 'PENDING', from, crId, by: actor.user });
      db.prepare("UPDATE mdm_change_requests SET change_json = json_set(change_json, '$.rowId', ?) WHERE id = ?").run(rowId, crId);
      const instance = workflowOf(db).submit(actor, { docType: TAX_DOC, docId: crId, comment: justification.trim(), context: { master: d.code, masterType: d.masterType } });
      db.prepare('UPDATE mdm_change_requests SET workflow_instance_id = ? WHERE id = ?').run(instance.id, crId);
      writeAudit(db, { entity: 'mdm_change_requests', entityId: crId, action: 'submit', newValues: { master: d.code, key, from, changeType }, actor: actor.user, companyId: actor.companyId, reason: justification });
      publishEvent(db, { type: 'mdm.change.requested', entity: 'mdm_change_request', entityId: crId, actorId: actor.user, companyId: actor.companyId, data: { masterType: d.masterType, changeType } });
      return { applied: false, changeRequestId: crId, workflow: instance, effectiveFrom: from };
    });
  }
  const crOf = (instance) => db.prepare("SELECT * FROM mdm_change_requests WHERE id = ? AND source_type = 'mdm_common'").get(Number(instance.docId));
  const tell = (cr, decision, comment) => { const ch = JSON.parse(cr.change_json); notif.notify({ companyId: cr.company_id, templateCode: 'mdm.common.decided', recipients: [`user:${cr.requested_by}`], data: { decision, master: COMMON[ch.master]?.label ?? ch.master, key: ch.key, from: cr.effective_from, comment: comment ? `: ${comment}` : '' }, link: `/admin/master-data/common/${ch.master === 'gst-rates' || ch.master === 'hsn-sac' || ch.master === 'tds-sections' ? ch.master : ''}`, sourceType: 'mdm_change_request', sourceId: String(cr.id), eventKey: `mdm.common.decided:${cr.id}:${decision}` }); };
  const decisions = {
    /** Approved: the pending row is in force from its date; the company's previous row of the same key ends the day before (BR-01). */
    approved(instance, actor) {
      const cr = crOf(instance);
      if (!cr || cr.request_status !== 'PENDING') return;
      const ch = JSON.parse(cr.change_json); const d = COMMON[ch.master];
      const row = db.prepare(`SELECT * FROM ${d.table} WHERE id = ?`).get(ch.rowId);
      const kc = keyCols(d).filter((c) => c !== 'effective_from');
      db.prepare(`UPDATE ${d.table} SET effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND ${kc.map((c) => `${c} = ?`).join(' AND ')} AND row_status = 'ACTIVE' AND effective_from < ? AND (effective_to IS NULL OR effective_to >= ?)`)
        .run(dayBefore(row.effective_from), actor.user, nowIso(), cr.company_id, ...kc.map((c) => row[c]), row.effective_from, row.effective_from);
      db.prepare(`UPDATE ${d.table} SET row_status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(actor.user, nowIso(), row.id);
      const now = nowIso();
      db.prepare("UPDATE mdm_change_requests SET request_status = 'APPLIED', decided_by = ?, decided_at = ?, applied_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, now, now, cr.id);
      writeAudit(db, { entity: d.table, entityId: row.id, action: 'approve', newValues: { key: ch.key, from: row.effective_from }, actor: actor.user, companyId: cr.company_id });
      publishEvent(db, { type: 'mdm.common.changed', entity: d.table, entityId: row.id, actorId: actor.user, companyId: cr.company_id, data: { master: ch.master, key: ch.key, action: 'approved', effectiveFrom: row.effective_from } });
      tell(cr, 'approved');
    },
    ended(instance, actor, status, comment) {
      const cr = crOf(instance);
      if (!cr || !['PENDING', 'RETURNED'].includes(cr.request_status)) return;
      const ch = JSON.parse(cr.change_json); const d = COMMON[ch.master];
      const now = nowIso();
      db.prepare('UPDATE mdm_change_requests SET request_status = ?, decided_by = ?, decided_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor.user, status === 'RETURNED' ? null : now, now, cr.id);
      if (status !== 'RETURNED') db.prepare(`UPDATE ${d.table} SET row_status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND row_status = 'PENDING'`).run(actor.user, now, ch.rowId);
      writeAudit(db, { entity: 'mdm_change_requests', entityId: cr.id, action: status.toLowerCase(), actor: actor.user, companyId: cr.company_id, reason: comment ?? null });
      tell(cr, status === 'RETURNED' ? 'returned for correction' : status.toLowerCase(), comment);
    },
  };

  // ---- what other modules ask (BR-01: the value valid on the document date) ----
  const pick = (d, companyId, keyCol, value, date) => {
    const { where, args } = scope(d, companyId, { asOf: date });
    return db.prepare(`SELECT t.* FROM ${d.table} t WHERE ${where.join(' AND ')} AND t.${keyCol} = ? ORDER BY t.company_id IS NULL, t.effective_from DESC LIMIT 1`).get(...args, value) ?? null;
  };
  const tax = {
    /** The GST rate a code (GST18) or an HSN/SAC code has on a date: the rate of the code valid that day, through the HSN/SAC default rate valid that day. */
    gst(actor, { code, hsn, date }) {
      needView(actor);
      const on = date ?? todayIST();
      let h = null; let rateCode = code;
      if (hsn) { h = pick(COMMON['hsn-sac'], actor.companyId, 'code', hsn, on); if (!h) throw notFound(`HSN/SAC ${hsn} is not in force on ${on}.`); rateCode = h.default_gst_code; }
      const r = pick(COMMON['gst-rates'], actor.companyId, 'code', rateCode, on);
      if (!r) throw notFound(`GST rate ${rateCode} is not in force on ${on}.`);
      return { date: on, hsn: h ? { ...view(COMMON['hsn-sac'], h) } : null, rate: view(COMMON['gst-rates'], r) };
    },
    tds(actor, { section, date }) {
      needView(actor);
      const on = date ?? todayIST();
      const r = pick(COMMON['tds-sections'], actor.companyId, 'section', section, on);
      if (!r) throw notFound(`Section ${section} is not in force on ${on}.`);
      return { date: on, section: view(COMMON['tds-sections'], r) };
    },
    /** The exchange rate of a currency on a date: the latest rate entered on or before it. */
    exchange(actor, { currency, date }) {
      needView(actor);
      const on = date ?? todayIST();
      if (currency === 'INR') return { date: on, currency, rateToInr: '1', rateDate: on };
      const r = db.prepare("SELECT * FROM mdm_exchange_rates WHERE currency_code = ? AND fx_date <= ? AND (company_id = ? OR company_id IS NULL) AND row_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY fx_date DESC, company_id IS NULL LIMIT 1").get(currency, on, actor.companyId);
      if (!r) throw notFound(`There is no ${currency} rate on or before ${on}.`);
      return { date: on, currency, rateToInr: rate4(r.rate_to_inr), rateDate: r.fx_date, source: r.fx_source };
    },
    /** A quantity in another unit of the same category, through the base unit, as exact fractions (BR-02). */
    convert(actor, { quantity, from, to }) {
      needView(actor);
      const unit = (c) => { const u = db.prepare("SELECT * FROM mdm_uoms WHERE code = ? AND (company_id = ? OR company_id IS NULL) AND row_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY company_id IS NULL LIMIT 1").get(c, actor.companyId); if (!u) throw notFound(`${c} is not a unit.`); return u; };
      const a = unit(from); const b = unit(to);
      if (a.category !== b.category) throw unprocessable(`${from} measures ${a.category.toLowerCase()} and ${to} ${b.category.toLowerCase()}: they do not convert (an item's own factor, such as a bag of cement in kilograms, belongs to the item, 06.03).`);
      const result = convertExact(quantity, a.factor_to_base, b.factor_to_base, b.decimals);
      return { quantity: String(quantity), from, to, result, factor: convertExact('1', a.factor_to_base, b.factor_to_base, 12) };
    },
  };

  // ---- lookup lists ----
  const languageOf = (actor) => db.prepare('SELECT language FROM ui_user_preferences WHERE company_id = ? AND lower(user_ref) = lower(?) ORDER BY id DESC LIMIT 1').get(actor.companyId, actor.user)?.language
    ?? db.prepare('SELECT p.language FROM iam_user_profiles p JOIN iam_users u ON u.id = p.user_id WHERE u.company_id = ? AND lower(u.username) = lower(?)').get(actor.companyId, actor.user)?.language ?? 'en';
  const lookups = {
    lists(actor) {
      needView(actor);
      const { where, args } = scope(COMMON['lookup-lists'], actor.companyId, {});
      const hi = languageOf(actor) === 'hi';
      return { rows: db.prepare(`SELECT t.* FROM mdm_lookup_lists t WHERE ${where.join(' AND ')} ORDER BY t.name`).all(...args).map((r) => ({ ...view(COMMON['lookup-lists'], r), label: hi && r.name_hi ? r.name_hi : r.name, values: db.prepare(`SELECT COUNT(*) AS n FROM mdm_lookups t WHERE ${scope(COMMON.lookups, actor.companyId, {}).where.join(' AND ')} AND t.list_code = ?`).get(...scope(COMMON.lookups, actor.companyId, {}).args, r.code).n })), language: hi ? 'hi' : 'en', canEdit: may(actor, 'mdm.lookup.edit') };
    },
    /** The values of a list in the person's language (T-03): a Hindi label when the person works in Hindi and the value has one. */
    values(actor, listCode, { all = false, lang = null } = {}) {
      needView(actor);
      const code = listCode.toUpperCase().replace(/-/g, '_');
      if (!refExists(actor.companyId, 'lookup-lists', code)) throw notFound(`There is no lookup list ${code}.`);
      const hi = (lang ?? languageOf(actor)) === 'hi';
      const { where, args } = scope(COMMON.lookups, actor.companyId, {});
      const rows = db.prepare(`SELECT t.* FROM mdm_lookups t WHERE ${where.join(' AND ')} AND t.list_code = ? ${all ? '' : 'AND t.active = 1'} ORDER BY t.sort_order, t.code`).all(...args, code);
      return { list: code, language: hi ? 'hi' : 'en', rows: rows.map((r) => ({ ...view(COMMON.lookups, r), label: hi && r.label_hi ? r.label_hi : r.label_en })) };
    },
    /** The Lookup List Manager saves a whole list at once: new values are added, changed ones updated, values not sent are made inactive (never deleted: old records keep their code). */
    save(actor, listCode, { values, reason }) {
      if (!may(actor, 'mdm.lookup.edit')) throw forbidden('You may not change lookup lists (permission mdm.lookup.edit).');
      const code = listCode.toUpperCase().replace(/-/g, '_');
      if (!refExists(actor.companyId, 'lookup-lists', code)) throw notFound(`There is no lookup list ${code}.`);
      const seen = new Set();
      for (const v of values) { const c = String(v.code ?? '').trim().toUpperCase(); if (seen.has(c)) throw badRequest(`${c} is in the list twice.`, [{ field: 'values', message: `${c} twice` }]); seen.add(c); }
      return transaction(db, () => {
        const current = lookups.values(actor, code, { all: true }).rows;
        let added = 0; let changed = 0; let ended = 0;
        values.forEach((v, i) => {
          const data = { listCode: code, code: v.code, labelEn: v.labelEn, labelHi: v.labelHi ?? null, sortOrder: v.sortOrder ?? (i + 1) * 10, active: v.active !== false };
          const ex = current.find((x) => x.code === String(v.code).trim().toUpperCase());
          if (!ex) { create(actor, 'lookups', { data, justification: reason }); added += 1; return; }
          const diff = ['labelEn', 'labelHi', 'sortOrder', 'active'].some((k) => String(data[k] ?? '') !== String(ex[k] ?? ''));
          if (diff) { update(actor, 'lookups', ex.id, { data: { labelEn: data.labelEn, labelHi: data.labelHi, sortOrder: data.sortOrder, active: data.active }, version: ex.rowVersion, justification: reason }); changed += 1; }
        });
        for (const ex of current.filter((x) => x.active && !seen.has(x.code))) { update(actor, 'lookups', ex.id, { data: { active: false }, version: ex.rowVersion, justification: reason }); ended += 1; }
        return { added, changed, inactivated: ended, ...lookups.values(actor, code, { all: true }) };
      });
    },
    languageOf,
  };

  function catalogue(actor) {
    needView(actor);
    return { rows: Object.values(COMMON).filter((d) => !d.flag || flagOn(actor, d.flag)).map((d) => ({ code: d.code, label: d.label, labelHi: d.labelHi, dated: Boolean(d.dated), approval: Boolean(d.approval), key: d.key, filters: d.filters ?? [], canEdit: may(actor, d.edit), permission: d.edit,
      fields: fieldsFor(actor, d).map((x) => ({ key: x.key, label: x.label, type: x.type, required: Boolean(x.required), options: x.options ?? null, ref: x.ref ?? null, hint: x.hint ?? (x.format ? FORMATS[x.format].hint : null), max: x.max ?? null })) })) };
  }

  return { catalogue, list, get, create, update, retire, decisions, tax, lookups, scope, view };
}

/** qty x (from factor / to factor), exact until the final rounding to the target unit's decimals. */
export function convertExact(quantity, fromFactor, toFactor, decimals) {
  const q = dec(String(quantity)); const a = dec(fromFactor); const b = dec(toFactor);
  const num = q.mul(a);
  return trimNum(num.div(b, Math.max(decimals, 0)).toFixed());
}

/** The calculation engine (01.06) converts through core_uoms / core_uom_conversions: the master keeps them in step (D-042). */
export function syncCoreUom(db, u) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'core_uoms'").get()) return;
  const dim = { WEIGHT: 'mass', LENGTH: 'length', AREA: 'area', VOLUME: 'volume', COUNT: 'count', TIME: 'time' }[u.category];
  db.prepare("INSERT OR IGNORE INTO core_uoms (code, name, dimension, created_by, source_type) VALUES (?, ?, ?, 'system', 'mdm_uoms')").run(u.code, u.name, dim);
  if (u.code !== u.base_uom && !db.prepare('SELECT 1 FROM core_uom_conversions WHERE item_code IS NULL AND deleted_at IS NULL AND ((from_uom = ? AND to_uom = ?) OR (from_uom = ? AND to_uom = ?))').get(u.code, u.base_uom, u.base_uom, u.code))
    db.prepare("INSERT OR IGNORE INTO core_uom_conversions (item_code, from_uom, to_uom, factor, created_by, source_type) VALUES (NULL, ?, ?, ?, 'system', 'mdm_uoms')").run(u.code, u.base_uom, u.factor_to_base);
}

const services = new WeakMap();
export const bindCommon = (db, s) => services.set(db, s);
export const commonOf = (db) => services.get(db) ?? null;
const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
workflowTypes.register({
  docType: TAX_DOC, label: 'Tax rate or TDS section change', processOwner: 'ACCMGR', route: () => '/admin/master-data/change-requests?view=review',
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM mdm_change_requests WHERE id = ? AND company_id = ?').get(Number(id), companyId); if (!r) return null; const ch = JSON.parse(r.change_json); return { ref: `${COMMON[ch.master]?.label ?? ch.master} ${ch.key} from ${r.effective_from}`, title: r.justification, originator: r.requested_by }; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM mdm_change_requests WHERE id = ?').get(Number(id)); if (!r) return null; const ch = JSON.parse(r.change_json); return { fields: [{ label: 'Master', value: COMMON[ch.master]?.label ?? ch.master }, { label: 'Key', value: ch.key }, { label: 'Applies from', value: r.effective_from }, { label: 'Justification', value: r.justification }], lines: { columns: [{ key: 'field', label: 'Field' }, { key: 'before', label: 'Now' }, { key: 'after', label: 'From the date' }], rows: (ch.fields ?? []).map((x) => ({ field: x.label, before: x.before ?? '', after: x.after ?? '' })) } }; },
  defaultDefinition: { name: 'Tax rate or TDS section change approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('ACCMGR', 'Accounts manager', 'ACCMGR'), step('CFO', 'Chief financial officer', 'CFO')] },
  hooks: {
    onApproved: (db, { instance, actor }) => commonOf(db)?.decisions.approved(instance, actor),
    onRejected: (db, { instance, actor, comment }) => commonOf(db)?.decisions.ended(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => commonOf(db)?.decisions.ended(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => commonOf(db)?.decisions.ended(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(TAX_DOC, ({ db, instance }) => {
  const r = db.prepare('SELECT * FROM mdm_change_requests WHERE id = ?').get(Number(instance.docId));
  if (!r) return { sections: [] };
  const ch = JSON.parse(r.change_json);
  const used = ch.master === 'gst-rates' ? db.prepare("SELECT COUNT(*) AS n FROM mdm_hsn_sac WHERE default_gst_code = ? AND row_status = 'ACTIVE' AND (company_id IS NULL OR company_id = ?)").get(ch.key, r.company_id).n : null;
  return { sections: [{ code: 'mdm-tax', title: 'What the approver checks', kind: 'metrics', items: [{ label: 'Applies from', value: r.effective_from, format: 'text' }, { label: 'Changed fields', value: (ch.fields ?? []).map((x) => `${x.label}: ${x.before ?? '—'} → ${x.after ?? '—'}`).join('; ') || '—', format: 'text' }, ...(used != null ? [{ label: 'HSN/SAC codes using this rate', value: used, format: 'text' }] : []), { label: 'A transaction dated before', value: `${r.effective_from} keeps the old rate`, format: 'text' }] }] };
});
void Decimal;
