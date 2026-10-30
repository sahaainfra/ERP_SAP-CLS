import { z } from 'zod';
import { assertPermission, hasPermission } from '../../../platform/auth/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { fileEntities } from '../../../platform/files/entities.js';
import { parse } from '../../../platform/validation/index.js';
import { parseListQuery, pageResponse } from '../../../platform/pagination/index.js';
import { conflict, notFound, unprocessable } from '../../../platform/http/errors.js';
import { fromUnits, toUnits } from '../../../../shared/money.js';

const LINE = 'boq.line_amount';
const GST = 'tax.gst_split';

const decimalText = (digits) => z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(new RegExp(String.raw`^\d{1,9}(\.\d{1,${digits}})?$`), `Use a positive number with at most ${digits} decimal places`));
const fields = {
  title: z.string().trim().min(2).max(120),
  quantity: decimalText(3),
  unitRate: decimalText(4),
  gstPercent: decimalText(4),
  supply: z.enum(['intra', 'inter']),
};
export const parseBillCreate = (b) => parse(z.object(fields), b);
export const parseBillUpdate = (b) => parse(z.object({ ...fields, version: z.number().int().positive() }).partial({ title: true, quantity: true, unitRate: true, gstPercent: true, supply: true }).required({ version: true }), b);
export const parseBillAction = (b) => parse(z.object({ version: z.number().int().positive() }), b);
export const parseBillList = (q) => parseListQuery(q, { sortable: ['id'], defaultSort: [{ column: 'id', dir: 'desc' }] });
export const parseBillId = (v) => parse(z.coerce.number().int().positive(), v);

// Bills can carry attachments and show their calculation like any record: register the record type.
fileEntities.register({
  entity: 'sample_bill',
  label: 'Sample bill',
  resolve(db, actor, id) {
    const b = db.prepare('SELECT id, company_id, project_id, status FROM core_sample_bills WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!b) return null;
    const allowed = hasPermission(actor, 'core.sample.use');
    return { companyId: b.company_id, projectId: b.project_id ?? null, siteId: null, canView: allowed, canEdit: allowed, locked: b.status !== 'DRAFT' };
  },
});

/**
 * A reference record that takes its numbers from the engine: line amount (boq.line_amount) and GST (tax.gst_split), the
 * formula versions it used kept on the bill (BR-01), and a trace of each calculation for "Show calculation" (AC-03).
 * A draft is recalculated with the versions in force today; a submitted bill only ever with the versions it was calculated with.
 */
export function createSampleBillService({ db, engine }) {
  const companyOf = (actor) => companyScope(actor).params._company_scope;
  const use = (actor) => {
    assertPermission(actor, 'core.sample.use');
    return companyOf(actor);
  };

  const present = (b) => {
    const pins = JSON.parse(b.formula_pins_json);
    return {
      id: b.id,
      title: b.title,
      status: b.status,
      quantity: fromUnits(b.quantity, 'quantity').toFixed(3),
      unitRate: fromUnits(b.unit_rate, 'rate').toFixed(4),
      gstPercent: fromUnits(b.gst_percent, 'percent').toString().replace(/0+$/, '').replace(/\.$/, ''),
      supply: b.supply,
      taxableAmount: fromUnits(b.taxable_amount, 'money').toFixed(2),
      cgstAmount: fromUnits(b.cgst_amount, 'money').toFixed(2),
      sgstAmount: fromUnits(b.sgst_amount, 'money').toFixed(2),
      igstAmount: fromUnits(b.igst_amount, 'money').toFixed(2),
      totalAmount: fromUnits(b.total_amount, 'money').toFixed(2),
      formulaPins: pins,
      calculations: {
        taxableAmount: { formula: LINE, version: pins[LINE], output: 'amount' },
        cgstAmount: { formula: GST, version: pins[GST], output: 'cgst' },
        sgstAmount: { formula: GST, version: pins[GST], output: 'sgst' },
        igstAmount: { formula: GST, version: pins[GST], output: 'igst' },
        totalAmount: { formula: GST, version: pins[GST], output: 'total' },
      },
      version: b.version,
      createdBy: b.created_by,
    };
  };

  /** Run both calculations and return the amounts in storage units. Writes the traces. */
  function compute(actor, bill, pins) {
    const common = { entity: 'sample_bill', entityId: bill.id, companyId: bill.company_id, user: actor.user };
    const line = engine.evaluate(LINE, { quantity: fromUnits(bill.quantity, 'quantity').toString(), rate: fromUnits(bill.unit_rate, 'rate').toString() }, { ...common, version: pins?.[LINE] ?? null });
    const gst = engine.evaluate(GST, { taxable: line.result.amount, gst_percent: fromUnits(bill.gst_percent, 'percent').toString(), supply: bill.supply }, { ...common, version: pins?.[GST] ?? null });
    return {
      pins: { [LINE]: line.formula.version, [GST]: gst.formula.version },
      amounts: {
        taxable_amount: toUnits(line.result.amount, 'money'),
        cgst_amount: toUnits(gst.result.cgst, 'money'),
        sgst_amount: toUnits(gst.result.sgst, 'money'),
        igst_amount: toUnits(gst.result.igst, 'money'),
        total_amount: toUnits(gst.result.total, 'money'),
      },
    };
  }
  const store = (id, c, actor) =>
    db.prepare(
      `UPDATE core_sample_bills SET taxable_amount = :taxable_amount, cgst_amount = :cgst_amount, sgst_amount = :sgst_amount, igst_amount = :igst_amount, total_amount = :total_amount,
              formula_pins_json = :pins, updated_by = :actor, updated_at = :now, version = version + 1 WHERE id = :id`,
    ).run({ ...c.amounts, pins: JSON.stringify(c.pins), actor: actor.user, now: new Date().toISOString(), id });
  const load = (companyId, id) => {
    const b = db.prepare('SELECT * FROM core_sample_bills WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId);
    if (!b) throw notFound('That bill does not exist.');
    return b;
  };

  return {
    list(actor, query) {
      const company = use(actor);
      const total = db.prepare('SELECT COUNT(*) AS n FROM core_sample_bills WHERE company_id = ? AND deleted_at IS NULL').get(company).n;
      const rows = db.prepare('SELECT * FROM core_sample_bills WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ? OFFSET ?').all(company, query.limit, query.offset);
      return pageResponse(rows.map(present), total, query);
    },

    get(actor, id) {
      return present(load(use(actor), id));
    },

    create(actor, v, correlationId) {
      const company = use(actor);
      return transaction(db, () => {
        const id = Number(
          db
            .prepare(
              `INSERT INTO core_sample_bills (company_id, title, quantity, unit_rate, gst_percent, supply, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_amount, formula_pins_json, created_by, source_type)
               VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, '{}', ?, 'sample_bill')`,
            )
            .run(company, v.title, toUnits(v.quantity, 'quantity'), toUnits(v.unitRate, 'rate'), toUnits(v.gstPercent, 'percent'), v.supply, actor.user).lastInsertRowid,
        );
        const bill = db.prepare('SELECT * FROM core_sample_bills WHERE id = ?').get(id);
        store(id, compute(actor, bill, null), actor);
        writeAudit(db, { entity: 'core_sample_bills', entityId: id, action: 'create', newValues: v, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.sample_bill.created', entity: 'sample_bill', entityId: id, actorId: actor.user, companyId: company, correlationId, data: {} });
        return present(db.prepare('SELECT * FROM core_sample_bills WHERE id = ?').get(id));
      });
    },

    /** Change a draft's inputs: every amount is recalculated on the server (a client can never send an amount). */
    update(actor, id, v, correlationId) {
      const company = use(actor);
      return transaction(db, () => {
        const b = load(company, id);
        if (b.status !== 'DRAFT') throw unprocessable('A submitted bill cannot be changed.');
        if (b.version !== v.version) throw conflict('This bill was changed by someone else. Reload it and apply your change again.');
        db.prepare('UPDATE core_sample_bills SET title = ?, quantity = ?, unit_rate = ?, gst_percent = ?, supply = ? WHERE id = ?').run(
          v.title ?? b.title, v.quantity === undefined ? b.quantity : toUnits(v.quantity, 'quantity'), v.unitRate === undefined ? b.unit_rate : toUnits(v.unitRate, 'rate'),
          v.gstPercent === undefined ? b.gst_percent : toUnits(v.gstPercent, 'percent'), v.supply ?? b.supply, id);
        const fresh = db.prepare('SELECT * FROM core_sample_bills WHERE id = ?').get(id);
        store(id, compute(actor, fresh, null), actor);
        writeAudit(db, { entity: 'core_sample_bills', entityId: id, action: 'update', newValues: v, actor: actor.user, correlationId });
        return present(db.prepare('SELECT * FROM core_sample_bills WHERE id = ?').get(id));
      });
    },

    /** Submitting freezes the amounts and the formula versions behind them. */
    submit(actor, id, { version }, correlationId) {
      const company = use(actor);
      return transaction(db, () => {
        const b = load(company, id);
        if (b.status !== 'DRAFT') throw unprocessable(`Only a draft can be submitted; this bill is ${b.status.toLowerCase()}.`);
        if (b.version !== version) throw conflict('This bill was changed by someone else. Reload it and submit again.');
        db.prepare("UPDATE core_sample_bills SET status = 'SUBMITTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, new Date().toISOString(), id);
        writeAudit(db, { entity: 'core_sample_bills', entityId: id, action: 'submit', actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.sample_bill.submitted', entity: 'sample_bill', entityId: id, actorId: actor.user, companyId: company, correlationId, data: {} });
        return present(db.prepare('SELECT * FROM core_sample_bills WHERE id = ?').get(id));
      });
    },

    /**
     * Calculate again (BR-01). A draft picks up the formula versions in force today. A submitted bill is recalculated with the versions it
     * was calculated with, so a newer formula never changes an approved amount; the result must equal what is stored.
     */
    recalculate(actor, id, correlationId) {
      const company = use(actor);
      return transaction(db, () => {
        const b = load(company, id);
        const pins = b.status === 'SUBMITTED' ? JSON.parse(b.formula_pins_json) : null;
        const c = compute(actor, b, pins);
        const before = { ...b };
        const changed = Object.entries(c.amounts).some(([k, val]) => before[k] !== val) || JSON.stringify(c.pins) !== b.formula_pins_json;
        if (b.status === 'SUBMITTED' && changed) throw unprocessable('The stored amounts of a submitted bill do not match its own formula versions. Tell an administrator.');
        if (changed) store(id, c, actor);
        writeAudit(db, { entity: 'core_sample_bills', entityId: id, action: 'recalculate', newValues: { changed, pins: c.pins }, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.sample_bill.recalculated', entity: 'sample_bill', entityId: id, actorId: actor.user, companyId: company, correlationId, data: { changed } });
        return { ...present(db.prepare('SELECT * FROM core_sample_bills WHERE id = ?').get(id)), recalculation: { changed, usedPinnedVersions: pins !== null } };
      });
    },
  };
}
