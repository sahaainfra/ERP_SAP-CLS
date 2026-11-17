import { createHash } from 'node:crypto';
import { alertDatasets } from '../../platform/alerts/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { badRequest, forbidden, notFound } from '../../platform/http/errors.js';
import { todayIST } from '../../../shared/dates.js';
import { FORM_PURPOSES, NATURES, P16608 } from './common.js';

// Part 166.8: the statutory changes of 2025-26 as dated master rows read by date, never constants in code.
//  FR-02 resolution by date: the GST rate of an HSN/SAC code on a document date (cement 28 % up to 21-09-2025, 18 % from 22-09-2025); the TDS section
//        for a nature of payment on the date of credit (194C of the 1961 Act up to 31-03-2026, 393(1) of the 2025 Act from 01-04-2026) with its legal
//        reference and TRACES payment code; the certificate and return form of a period (16A up to 31-03-2026, 131 from 01-04-2026).
//  S-04  wagesUnderCode: wages under the Code on Wages, s.2(y): when the exclusions are more than half of all remuneration, the excess is wages.
//  FR-03 the statutory calendar: due dates by period, offered to the alert centre.
//  FR-04 the migration report: documents not yet approved whose tax differs from the master on their date; approved documents are never changed.
const MS_DAY = 86_400_000;
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_DAY);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const pctOf = (units) => Number(units) / 10_000; // stored x10000
const rupees = (paise) => Math.round(Number(paise)) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fyOf = (y, m) => (m >= 4 ? `${y}-${String((y + 1) % 100).padStart(2, '0')}` : `${y - 1}-${String(y % 100).padStart(2, '0')}`);
const PERSONS = ['PROPRIETORSHIP', 'INDIVIDUAL', 'HUF'];
const label = (list, k) => list.find(([c]) => c === k)?.[1] ?? k;

/** The row of a dated master in force on a date for a company: its own row over the system row, the latest start first. */
function inForce(db, table, companyId, where, args, date) {
  return db.prepare(`SELECT * FROM ${table} WHERE ${where} AND (company_id = ? OR company_id IS NULL) AND row_status = 'ACTIVE' AND deleted_at IS NULL AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ORDER BY company_id IS NULL, effective_from DESC LIMIT 1`).get(...args, companyId, date, date) ?? null;
}

export function createStatutoryService({ db, flags }) {
  const authz = authzOf(db);
  const may = (actor, key) => authz.check(actor, key).allowed;
  const on = (actor) => Boolean(flags?.isOn(actor, P16608));
  const needOn = (actor) => { if (!on(actor)) throw notFound('The statutory updates are not enabled for your company yet (feature flag ff.mdm.p16608).'); };
  const needView = (actor) => { needOn(actor); if (!may(actor, 'mdm.record.view')) throw forbidden('You may not see the statutory masters (permission mdm.record.view).'); };

  const resolve = {
    /** The GST rate of an HSN/SAC code on a date (BR-01: the date of the document). */
    gst(companyId, { hsn, date }) {
      const h = inForce(db, 'mdm_hsn_sac', companyId, 'code = ?', [hsn], date);
      if (!h) return null;
      const r = inForce(db, 'mdm_gst_rates', companyId, 'code = ?', [h.default_gst_code], date);
      if (!r) return null;
      return { hsn, date, rateCode: r.code, pct: pctOf(r.igst_pct), hsnFrom: h.effective_from, hsnTo: h.effective_to, description: h.description };
    },
    /** The TDS section for a nature of payment on the date of credit or payment, with its rate for the payee's constitution. */
    tds(companyId, { nature, date, constitution = null }) {
      const t = inForce(db, 'mdm_tds_sections', companyId, "nature_code = ? AND tax_kind = 'TDS'", [nature], date);
      if (!t) return null;
      const person = PERSONS.includes(constitution);
      const cert = resolve.form(companyId, { purpose: 'NON_SALARY_CERT', date }); const ret = resolve.form(companyId, { purpose: 'NON_SALARY_RETURN', date });
      return { nature, date, section: t.section, act: t.act_code, legalRef: t.legal_ref ?? `Section ${t.section}`, paymentCode: (person ? t.payment_code : t.payment_code_other) ?? null, pct: pctOf(person ? t.rate_individual : t.rate_company),
        person, thresholdSingle: rupees(t.threshold_single), thresholdAnnual: rupees(t.threshold_annual), from: t.effective_from, to: t.effective_to, certificate: cert?.formCode ?? null, statement: ret?.formCode ?? null };
    },
    /** The certificate or return form of a date (the end of the period it is for). */
    form(companyId, { purpose, date }) {
      const f = inForce(db, 'mdm_tds_forms', companyId, 'purpose = ?', [purpose], date);
      return f ? { purpose, formCode: f.form_code, act: f.act_code, replaces: f.replaces, legalRef: f.legal_ref, from: f.effective_from, to: f.effective_to } : null;
    },
  };

  // ---- S-04: wages under the Code on Wages ----
  const monthOk = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m ?? '');
  function payOf(companyId, employeeId, date) {
    return db.prepare('SELECT p.* FROM hr_employee_pay p WHERE p.company_id = ? AND p.employee_id = ? AND p.deleted_at IS NULL AND p.effective_from <= ? AND (p.effective_to IS NULL OR p.effective_to >= ?) ORDER BY p.component_code').all(companyId, employeeId, date, date);
  }
  /**
   * Wages for a month under the Code on Wages, s.2(y): remuneration = every component but those that are not remuneration; when the exclusions are more
   * than half of it, the excess is added back to wages. Before the Code was in force (the CENTRAL WAGES row of the Labour Code rules), wages are the
   * components classed as wages. The figures are the monthly amounts in force on the last day of the month.
   */
  function wagesUnderCode(companyId, employeeId, month) {
    if (!monthOk(month)) throw badRequest('Give the month as YYYY-MM.', [{ field: 'month', message: 'YYYY-MM' }]);
    const [y, m] = month.split('-').map(Number); const end = iso(y, m, lastDay(y, m));
    const lines = payOf(companyId, employeeId, end).map((p) => {
      const c = inForce(db, 'mdm_pay_components', companyId, 'code = ?', [p.component_code], end);
      return { code: p.component_code, name: c?.name ?? p.component_code, wageClass: c?.wage_class ?? 'WAGES', classified: Boolean(c), amount: rupees(p.monthly_paise), paise: p.monthly_paise, from: p.effective_from };
    });
    const sum = (k) => lines.filter((l) => l.wageClass === k).reduce((n, l) => n + l.paise, 0);
    const wages = sum('WAGES'); const excluded = sum('EXCLUDED'); const remuneration = wages + excluded;
    const code = inForce(db, 'mdm_labour_rules', companyId, "state_code = 'CENTRAL' AND code_kind = 'WAGES'", [], end);
    const half = Math.floor(remuneration / 2);
    const addedBack = code && excluded > half ? excluded - half : 0;
    return {
      employeeId, month, asOf: end, lines, remuneration: rupees(remuneration), wagesClassed: rupees(wages), excluded: rupees(excluded), addedBack: rupees(addedBack), wages: rupees(wages + addedBack),
      ruleApplies: Boolean(code), rule: code ? { ref: code.rule_ref, from: code.effective_from } : null,
      note: !lines.length ? 'No pay is recorded for this month.' : code ? (addedBack > 0 ? `The exclusions are ${rupees(excluded)}, more than half of the remuneration ${rupees(remuneration)}: ${rupees(addedBack)} is added back to wages.` : 'The exclusions are not more than half of the remuneration: wages are the components classed as wages.') : 'The Code on Wages was not in force in this month: wages are the components classed as wages.',
      unclassified: lines.filter((l) => !l.classified).map((l) => l.code),
    };
  }

  // ---- FR-03: the statutory calendar ----
  /** The obligations whose period ends in [from, to], each with its due date and the form in force for the period. */
  function dues(companyId, { from, to }) {
    const out = [];
    const [fy, fm] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number);
    for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y += 1, m = 1) : (m += 1)) {
      const end = iso(y, m, lastDay(y, m));
      const rows = db.prepare("SELECT * FROM mdm_statutory_calendar WHERE (company_id = ? OR company_id IS NULL) AND row_status = 'ACTIVE' AND deleted_at IS NULL AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) ORDER BY company_id IS NULL, effective_from DESC").all(companyId, end, end);
      const seen = new Set();
      const quarter = [6, 9, 12, 3].indexOf(m) + 1; // the financial year's quarters end in June, September, December and March
      const candidates = rows.filter((r) => (r.period_kind === 'MONTH' && (r.period_no === 0 || r.period_no === m)) || (r.period_kind === 'QUARTER' && quarter > 0 && (r.period_no === 0 || r.period_no === quarter)) || (r.period_kind === 'YEAR' && m === 3));
      // a row for a particular period (March) replaces the row for every period of the same purpose and kind; a company's own row replaces the system row of its code
      candidates.sort((a, b) => (b.period_no > 0) - (a.period_no > 0));
      for (const r of candidates) {
        const k = `${r.purpose ?? r.code}/${r.period_kind}`; if (seen.has(k) || seen.has(r.code)) continue; seen.add(k); seen.add(r.code);
        let dy = y; let dm = m + r.due_months_after; while (dm > 12) { dm -= 12; dy += 1; }
        const due = iso(dy, dm, Math.min(r.due_day, lastDay(dy, dm)));
        const form = r.purpose && r.purpose !== 'TDS_DEPOSIT' ? resolve.form(companyId, { purpose: r.purpose, date: end }) : null;
        const period = r.period_kind === 'MONTH' ? `${MONTHS[m - 1]} ${y}` : r.period_kind === 'QUARTER' ? `Q${quarter} FY ${fyOf(y, m)}` : `FY ${fyOf(y, m)}`;
        out.push({ code: r.code, obligation: r.obligation, purpose: r.purpose, period, periodEnd: end, dueDate: due, alertDays: r.alert_days, ownerRole: r.owner_role, legalRef: r.legal_ref, form: form ? `Form ${form.formCode}` : null, rowFrom: r.effective_from });
      }
    }
    return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.code.localeCompare(b.code));
  }
  const shift = (d, months) => { const [y, m] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + months, 1)); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, 1); };

  // ---- FR-04: the migration report ----
  const hashOf = (table, id) => createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id))).digest('hex');
  function migrationReport(actor) {
    needView(actor);
    const c = actor.companyId; const rows = [];
    const seesBills = may(actor, 'bill.vendor_invoice.view'); const seesSub = may(actor, 'bill.sub_bill.view'); const seesPo = may(actor, 'proc.purchase_order.view');
    if (seesBills) {
      for (const l of db.prepare("SELECT i.id, i.doc_no, i.invoice_date, i.status, l.line_no, l.hsn, l.gst_pct_bp FROM bill_vendor_invoices i JOIN bill_vendor_invoice_lines l ON l.invoice_id = i.id AND l.deleted_at IS NULL WHERE i.company_id = ? AND i.deleted_at IS NULL AND i.status IN ('DRAFT', 'RETURNED', 'SUBMITTED') AND l.hsn IS NOT NULL ORDER BY i.invoice_date, i.id, l.line_no").all(c)) {
        const g = resolve.gst(c, { hsn: l.hsn, date: l.invoice_date });
        if (g && Math.round(g.pct * 100) !== l.gst_pct_bp) rows.push({ kind: 'VINV', label: 'Vendor invoice', id: l.id, ref: l.doc_no, date: l.invoice_date, status: l.status, route: `/bill/vendor-invoices?id=${l.id}`, what: `Line ${l.line_no}, HSN ${l.hsn}`, has: `${l.gst_pct_bp / 100}%`, inForce: `${g.pct}% (${g.rateCode} from ${g.hsnFrom})`, action: 'Return the invoice to the vendor for a corrected invoice, or correct the line before approval' });
      }
    }
    if (seesSub) {
      for (const b of db.prepare("SELECT b.id, b.doc_no, b.period_to, b.status, b.deductions_json, p.constitution FROM bill_sub_bills b JOIN mdm_partners p ON p.id = b.subcontractor_id WHERE b.company_id = ? AND b.deleted_at IS NULL AND b.status IN ('DRAFT', 'RETURNED', 'SUBMITTED') ORDER BY b.period_to, b.id").all(c)) {
        const tdsLine = JSON.parse(b.deductions_json).find((x) => x.kind === 'TDS');
        const t = resolve.tds(c, { nature: tdsLine?.nature ?? 'CONTRACTOR', date: b.period_to, constitution: b.constitution });
        if (!t) continue;
        const used = tdsLine?.section ?? (tdsLine ? String(tdsLine.label ?? '').split(' ').at(-1) : null);
        if (used !== t.section) rows.push({ kind: 'SBILL', label: 'Subcontractor bill', id: b.id, ref: b.doc_no, date: b.period_to, status: b.status, route: `/bill/sub-bills?id=${b.id}`, what: 'TDS', has: used ? `Section ${used}` : 'no TDS', inForce: `${t.legalRef} (${t.pct}%)`, action: 'Recalculate the bill: the section in force on its date is taken from the master' });
      }
    }
    if (seesPo) {
      for (const l of db.prepare("SELECT o.id, o.doc_no, o.doc_date, o.status, pl.line_no, pl.tax_code AS gst_code, i.hsn_sac_code AS hsn FROM proc_purchase_orders o JOIN proc_po_lines pl ON pl.po_id = o.id LEFT JOIN mdm_items i ON i.id = pl.item_id WHERE o.company_id = ? AND o.deleted_at IS NULL AND o.status IN ('DRAFT', 'RETURNED', 'SUBMITTED') AND i.hsn_sac_code IS NOT NULL ORDER BY o.doc_date, o.id, pl.line_no").all(c)) {
        const g = resolve.gst(c, { hsn: l.hsn, date: l.doc_date });
        if (g && l.gst_code && g.rateCode !== l.gst_code) rows.push({ kind: 'PO', label: 'Purchase order', id: l.id, ref: l.doc_no, date: l.doc_date, status: l.status, route: `/proc/purchase-orders?id=${l.id}`, what: `Line ${l.line_no}, HSN ${l.hsn}`, has: l.gst_code, inForce: `${g.rateCode} from ${g.hsnFrom}`, action: 'Change the line\'s GST rate before approval' });
      }
    }
    const changes = [
      ...db.prepare("SELECT 'GST' AS kind, code AS ref, effective_from AS d, description FROM mdm_hsn_sac WHERE (company_id = ? OR company_id IS NULL) AND row_status = 'ACTIVE' AND deleted_at IS NULL AND effective_from > '2017-07-01'").all(c),
      ...db.prepare("SELECT 'TDS' AS kind, section || ' ' || nature_code AS ref, effective_from AS d, description FROM mdm_tds_sections WHERE (company_id = ? OR company_id IS NULL) AND row_status = 'ACTIVE' AND deleted_at IS NULL AND act_code = 'IT2025'").all(c),
    ].map((x) => ({ kind: x.kind, ref: x.ref, from: x.d, description: x.description }));
    return { rows, changes, scope: { vendorInvoices: seesBills, subBills: seesSub, purchaseOrders: seesPo }, note: 'Only documents not yet approved are listed; approved and posted documents keep the tax of their date and are never changed.' };
  }

  return {
    resolve, wagesUnderCode, dues, hashOf, on,
    /** FR-02: the GST rate of an HSN code, the TDS section of a nature of payment and the forms, on a date (the page "Statutory Changes"). */
    lookup(actor, { hsn, nature, date, constitution }) {
      needView(actor);
      const d = date ?? todayIST();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw badRequest('Give the date as YYYY-MM-DD.', [{ field: 'date', message: 'YYYY-MM-DD' }]);
      return {
        date: d,
        gst: hsn ? resolve.gst(actor.companyId, { hsn, date: d }) : null,
        tds: nature ? resolve.tds(actor.companyId, { nature, date: d, constitution }) : null,
        forms: FORM_PURPOSES.map(([p, l]) => ({ purpose: p, label: l, ...(resolve.form(actor.companyId, { purpose: p, date: d }) ?? {}) })),
        natures: NATURES.filter(([k]) => k !== 'SALE_GOODS').map(([k, l]) => ({ code: k, label: l })),
      };
    },
    calendar(actor, { from, to }) {
      needView(actor);
      const today = todayIST();
      const f = from ?? shift(today, -3).slice(0, 7); const t = to ?? shift(today, 3).slice(0, 7);
      if (!monthOk(f) || !monthOk(t) || f > t) throw badRequest('Give the months as YYYY-MM, the first not after the last.', [{ field: 'from', message: 'YYYY-MM' }]);
      return { from: f, to: t, today, rows: dues(actor.companyId, { from: f, to: t }).map((r) => ({ ...r, daysToDue: days(today, r.dueDate) })) };
    },
    migrationReport,
    wages(actor, employeeId, month) {
      needOn(actor);
      if (!may(actor, 'hr.employee.sensitive.view')) throw forbidden('You may not see the pay of an employee (permission hr.employee.sensitive.view).');
      const e = db.prepare('SELECT id FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(employeeId), actor.companyId);
      if (!e) throw notFound('That employee does not exist.');
      return wagesUnderCode(actor.companyId, e.id, month ?? todayIST().slice(0, 7));
    },
    /** The monthly pay of an employee by component from a date: the components not sent end the day before. */
    setPay(actor, employeeId, { effectiveFrom, lines, reason }) {
      needOn(actor);
      if (!may(actor, 'hr.employee.edit') || !may(actor, 'hr.employee.sensitive.view')) throw forbidden('You may not change the pay of an employee (permissions hr.employee.edit and hr.employee.sensitive.view).');
      const e = db.prepare('SELECT id FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(employeeId), actor.companyId);
      if (!e) throw notFound('That employee does not exist.');
      const problems = [];
      const seen = new Set();
      for (const [i, l] of lines.entries()) {
        if (seen.has(l.code)) problems.push({ field: `lines.${i}.code`, message: `${l.code} is given twice` }); seen.add(l.code);
        if (!inForce(db, 'mdm_pay_components', actor.companyId, 'code = ?', [l.code], effectiveFrom)) problems.push({ field: `lines.${i}.code`, message: `${l.code} is not a pay component in force on ${effectiveFrom}` });
      }
      if (problems.length) throw badRequest('Some lines are not valid.', problems);
      const dayBefore = new Date(Date.parse(`${effectiveFrom}T00:00:00Z`) - MS_DAY).toISOString().slice(0, 10);
      const now = new Date().toISOString();
      db.exec('SAVEPOINT pay');
      try {
        db.prepare('UPDATE hr_employee_pay SET deleted_at = ?, deleted_by = ? WHERE employee_id = ? AND effective_from >= ? AND deleted_at IS NULL').run(now, actor.user, e.id, effectiveFrom);
        db.prepare('UPDATE hr_employee_pay SET effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE employee_id = ? AND deleted_at IS NULL AND (effective_to IS NULL OR effective_to >= ?)').run(dayBefore, actor.user, now, e.id, effectiveFrom);
        for (const l of lines) db.prepare("INSERT INTO hr_employee_pay (company_id, employee_id, component_code, monthly_paise, effective_from, created_by, source_type, remarks) VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)").run(actor.companyId, e.id, l.code, Math.round(l.amount * 100), effectiveFrom, actor.user, reason);
        db.exec('RELEASE pay');
      } catch (err) { db.exec('ROLLBACK TO pay'); db.exec('RELEASE pay'); throw err; }
      return wagesUnderCode(actor.companyId, e.id, effectiveFrom.slice(0, 7));
    },
    labelOfNature: (k) => label(NATURES, k),
  };
}

/** The resolution by date alone (no person, no flag): for the services that compute documents (sub bill, vendor invoice). */
export const statutoryResolver = (db) => createStatutoryService({ db, flags: null }).resolve;

// FR-03: the alert centre reads the obligations due within their alert days (a rule of the library, "Statutory return or deposit due", turns it on).
alertDatasets.register({
  code: 'mdm.statutory_due', label: 'Statutory returns and deposits due', ownerModule: 'mdm', entity: 'mdm_statutory_calendar',
  fields: [{ key: 'obligation', label: 'Obligation', type: 'text' }, { key: 'period', label: 'Period', type: 'text' }, { key: 'dueDate', label: 'Due date', type: 'date' }, { key: 'form', label: 'Form', type: 'text' },
    { key: 'daysToDue', label: 'Days to the due date', type: 'number' }, { key: 'withinAlert', label: 'Within its alert days', type: 'bool' }],
  query(db, { companyId, today }) {
    const svc = createStatutoryService({ db, flags: null });
    const t = today ?? todayIST();
    const [y, m] = t.split('-').map(Number); const back = new Date(Date.UTC(y, m - 4, 1)); const from = `${back.getUTCFullYear()}-${String(back.getUTCMonth() + 1).padStart(2, '0')}`;
    return svc.dues(companyId, { from, to: t.slice(0, 7) }).filter((r) => r.dueDate >= t).map((r) => {
      const left = days(t, r.dueDate);
      return { id: `${r.code}/${r.periodEnd}`, label: `${r.obligation}, ${r.period}`, route: '/admin/master-data/statutory', projectId: null, siteId: null, owners: [`role:${r.ownerRole}`],
        fields: { obligation: r.obligation, period: r.period, dueDate: r.dueDate, form: r.form ?? '—', daysToDue: left, withinAlert: left <= r.alertDays } };
    });
  },
});
