// Fixed datasets for the calculation golden outputs (part 01.06). The same cases are fed to the original direct-Decimal code
// (tests/helpers/legacy_calcs.js, which the golden files were captured from) and to the engine; the engine must reproduce
// the golden files exactly. Boundary cases (x.xx5, ties, zero) are included on purpose.

export const BOQ_LINE = [
  { quantity: '12.5', rate: '101.2345' }, { quantity: '3', rate: '0.005' }, { quantity: '0', rate: '99.9999' }, { quantity: '1000', rate: '1' },
  { quantity: '0.001', rate: '0.5' }, { quantity: '7.777', rate: '13.3333' }, { quantity: '250.125', rate: '88.8888' }, { quantity: '1', rate: '2.3450' },
  { quantity: '1', rate: '2.3550' }, { quantity: '99999.999', rate: '99999.9999' }, { quantity: '0.5', rate: '0.0001' }, { quantity: '45.250', rate: '1180.5000' },
];

const supplies = ['intra', 'inter'];
const taxable = ['0.00', '0.01', '1.00', '99.99', '100.00', '1265.43', '5000.50', '123456.78', '0.05', '17.95'];
const pcts = ['0', '5', '12', '18', '28', '2.5', '0.1'];
export const GST_SPLIT = taxable.flatMap((t, i) => supplies.map((supply, j) => ({ taxable: t, gst_percent: pcts[(i + j) % pcts.length], supply })));

export const STOCK_AVERAGE = [
  { opening_qty: '100', opening_value: '5000.00', receipt_qty: '50', receipt_rate: '60.5' },
  { opening_qty: '0', opening_value: '0', receipt_qty: '7', receipt_rate: '33.3333' },
  { opening_qty: '0', opening_value: '0', receipt_qty: '0', receipt_rate: '10' },
  { opening_qty: '12.345', opening_value: '999.99', receipt_qty: '0.001', receipt_rate: '0.0001' },
  { opening_qty: '1000', opening_value: '123456.78', receipt_qty: '333.333', receipt_rate: '87.6543' },
  { opening_qty: '3', opening_value: '10.00', receipt_qty: '3', receipt_rate: '3.3333' },
  { opening_qty: '250.5', opening_value: '41666.25', receipt_qty: '100', receipt_rate: '170.1234' },
  { opening_qty: '1', opening_value: '0.01', receipt_qty: '2', receipt_rate: '0.0050' },
];

export const NET_PAYABLE = [
  { gross: '100000.00', retention_percent: '5', tds_percent: '2' },
  { gross: '12345.67', retention_percent: '2.5', tds_percent: '1' },
  { gross: '250.00', retention_percent: '1', tds_percent: '1' },
  { gross: '0.00', retention_percent: '5', tds_percent: '2' },
  { gross: '50.00', retention_percent: '1', tds_percent: '1' },
  { gross: '150.00', retention_percent: '1', tds_percent: '1' },
  { gross: '250.00', retention_percent: '0.5', tds_percent: '1' },
  { gross: '99999999.99', retention_percent: '10', tds_percent: '10' },
  { gross: '1234.55', retention_percent: '2.5', tds_percent: '0.1' },
];

// Part 06.06: components and unit rates of rate analyses (the hand-calculated M25 example of T-01 among them).
export const RA_LINE = [
  { quantity: '0.4', wastage_percent: '2', rate: '7200' }, { quantity: '0.42', wastage_percent: '5', rate: '1850' }, { quantity: '0.84', wastage_percent: '5', rate: '1650' },
  { quantity: '0.17', wastage_percent: '0', rate: '950' }, { quantity: '2.5', wastage_percent: '0', rate: '650' }, { quantity: '0.07', wastage_percent: '0', rate: '2400' },
  { quantity: '0.001', wastage_percent: '2.5', rate: '0.0001' }, { quantity: '99.999', wastage_percent: '10', rate: '99999.9999' }, { quantity: '7.777', wastage_percent: '3.3333', rate: '13.3333' },
];
export const RA_RATE = [
  { direct_cost: '7205.25', basis_qty: '1', water_percent: '1', overhead_percent: '7.5', profit_percent: '7.5', contingency_percent: '0', insurance_percent: '0', escalation_percent: '0', gst_percent: '0' },
  { direct_cost: '1000.00', basis_qty: '10', water_percent: '0', overhead_percent: '10', profit_percent: '10', contingency_percent: '3', insurance_percent: '0', escalation_percent: '0', gst_percent: '18' },
  { direct_cost: '123456.78', basis_qty: '3', water_percent: '1', overhead_percent: '15', profit_percent: '0', contingency_percent: '2.5', insurance_percent: '0.5', escalation_percent: '4', gst_percent: '12' },
  { direct_cost: '0.01', basis_qty: '0.001', water_percent: '0', overhead_percent: '0', profit_percent: '0', contingency_percent: '0', insurance_percent: '0', escalation_percent: '0', gst_percent: '0' },
  { direct_cost: '58210.40', basis_qty: '100', water_percent: '1', overhead_percent: '7.5', profit_percent: '7.5', contingency_percent: '0', insurance_percent: '0', escalation_percent: '0', gst_percent: '18' },
];

export const CASES = { 'boq.line_amount': BOQ_LINE, 'tax.gst_split': GST_SPLIT, 'stock.weighted_average': STOCK_AVERAGE, 'billing.net_payable': NET_PAYABLE, 'ra.line_amount': RA_LINE, 'ra.unit_rate': RA_RATE };
export const GOLDEN_IDS = { 'boq.line_amount': 'calc.boq_line_amount', 'tax.gst_split': 'calc.gst_split', 'stock.weighted_average': 'calc.stock_weighted_average', 'billing.net_payable': 'calc.billing_net_payable', 'ra.line_amount': 'calc.ra_line_amount', 'ra.unit_rate': 'calc.ra_unit_rate' };
