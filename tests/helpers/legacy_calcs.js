// The calculations as they were written before the engine: plain Decimal code with the money helpers. The golden outputs
// were captured from THIS code; the engine has to give the same answers (T-04). Nothing here uses the formula language.
import { ROUND, dec } from '../../src/shared/decimal.js';
import { lineAmount, money, percentOf, quantity, rate } from '../../src/shared/money.js';

export const boqLineAmount = ({ quantity: q, rate: r }) => ({ amount: lineAmount(q, r).toFixed(2) });

export function gstSplit({ taxable, gst_percent: pct, supply }) {
  const t = money(taxable);
  const half = dec(pct).div(2, 8);
  const cgst = supply === 'intra' ? percentOf(t, half) : money(0);
  const sgst = supply === 'intra' ? percentOf(t, half) : money(0);
  const igst = supply === 'inter' ? percentOf(t, pct) : money(0);
  const tax = cgst.add(sgst).add(igst);
  return { cgst: cgst.toFixed(2), sgst: sgst.toFixed(2), igst: igst.toFixed(2), tax_total: tax.toFixed(2), total: t.add(tax).toFixed(2) };
}

export function stockWeightedAverage({ opening_qty: oq, opening_value: ov, receipt_qty: rq, receipt_rate: rr }) {
  const newQty = dec(oq).add(rq);
  const newValue = dec(ov).add(lineAmount(rq, rr));
  const avg = newQty.isZero() ? dec(0) : newValue.div(newQty, 4);
  return { new_qty: quantity(newQty).toFixed(3), new_value: money(newValue).toFixed(2), average_rate: rate(avg).toFixed(4) };
}

export function billingNetPayable({ gross, retention_percent: rp, tds_percent: tp }) {
  const g = dec(gross);
  const retention = g.mul(rp).div(100, 8).round(2, ROUND.HALF_EVEN);
  const tds = g.mul(tp).div(100, 8).round(0, ROUND.HALF_EVEN).round(2);
  return { retention: retention.toFixed(2), tds: tds.toFixed(2), net_payable: g.sub(retention).sub(tds).toFixed(2) };
}

export const LEGACY = { 'boq.line_amount': boqLineAmount, 'tax.gst_split': gstSplit, 'stock.weighted_average': stockWeightedAverage, 'billing.net_payable': billingNetPayable };
