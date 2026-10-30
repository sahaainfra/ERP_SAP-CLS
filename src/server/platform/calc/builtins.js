// The business calculations that exist today, registered as version 1 of their formulas (FR-06). Each one was a plain
// Decimal computation before; the golden outputs in golden/outputs/calc.*.json were captured from that code and the
// engine reproduces them exactly (tests/calc-golden.test.js). Seeded as ACTIVE by the system; every later version goes
// through a draft, tests and an approval chain.

const t = (inputs, expect) => ({ inputs, expect });

export const BUILTIN_FORMULAS = Object.freeze([
  {
    code: 'boq.line_amount',
    description: 'Amount of a bill-of-quantities line: quantity x rate, rounded once to paise.',
    ownerModule: 'boq',
    financial: true,
    roundingPolicy: 'half_up',
    inputs: [
      { name: 'quantity', type: 'quantity', min: '0' },
      { name: 'rate', type: 'rate', min: '0' },
    ],
    expression: 'amount = round(quantity * rate, 2)',
    outputs: [{ name: 'amount', type: 'money', label: 'Line amount' }],
    tests: [
      t({ quantity: '12.5', rate: '101.2345' }, { amount: '1265.43' }),
      t({ quantity: '3', rate: '0.005' }, { amount: '0.02' }),
      t({ quantity: '0', rate: '99.9999' }, { amount: '0.00' }),
    ],
  },
  {
    code: 'tax.gst_split',
    description: 'GST on a taxable value: CGST and SGST (half the rate each) within a state, IGST between states, each rounded to paise.',
    ownerModule: 'tax',
    financial: true,
    roundingPolicy: 'half_up',
    inputs: [
      { name: 'taxable', type: 'money', min: '0' },
      { name: 'gst_percent', type: 'percent', min: '0', max: '100' },
      { name: 'supply', type: 'string', allowed: ['intra', 'inter'] },
    ],
    expression: [
      'half = gst_percent / 2',
      "cgst = if(supply == 'intra', round(taxable * half / 100, 2), 0)",
      "sgst = if(supply == 'intra', round(taxable * half / 100, 2), 0)",
      "igst = if(supply == 'inter', round(taxable * gst_percent / 100, 2), 0)",
      'tax_total = cgst + sgst + igst',
      'total = taxable + tax_total',
    ].join('\n'),
    outputs: [
      { name: 'cgst', type: 'money', label: 'CGST' },
      { name: 'sgst', type: 'money', label: 'SGST' },
      { name: 'igst', type: 'money', label: 'IGST' },
      { name: 'tax_total', type: 'money', label: 'Total tax' },
      { name: 'total', type: 'money', label: 'Total' },
    ],
    tests: [
      t({ taxable: '1265.43', gst_percent: '18', supply: 'intra' }, { cgst: '113.89', sgst: '113.89', igst: '0.00', tax_total: '227.78', total: '1493.21' }),
      t({ taxable: '1265.43', gst_percent: '18', supply: 'inter' }, { cgst: '0.00', sgst: '0.00', igst: '227.78', tax_total: '227.78', total: '1493.21' }),
      t({ taxable: '100.00', gst_percent: '5', supply: 'intra' }, { cgst: '2.50', sgst: '2.50', igst: '0.00', tax_total: '5.00', total: '105.00' }),
    ],
  },
  {
    code: 'stock.weighted_average',
    description: 'Stock valuation after a receipt: moving weighted-average rate from the opening balance and the receipt.',
    ownerModule: 'stores',
    financial: true,
    roundingPolicy: 'half_up',
    inputs: [
      { name: 'opening_qty', type: 'quantity', min: '0' },
      { name: 'opening_value', type: 'money', min: '0' },
      { name: 'receipt_qty', type: 'quantity', min: '0' },
      { name: 'receipt_rate', type: 'rate', min: '0' },
    ],
    expression: [
      'receipt_value = round(receipt_qty * receipt_rate, 2)',
      'new_qty = opening_qty + receipt_qty',
      'new_value = opening_value + receipt_value',
      'average_rate = if(new_qty == 0, 0, new_value / new_qty)',
    ].join('\n'),
    outputs: [
      { name: 'new_qty', type: 'quantity', label: 'Quantity on hand' },
      { name: 'new_value', type: 'money', label: 'Stock value' },
      { name: 'average_rate', type: 'rate', label: 'Average rate' },
    ],
    tests: [
      t({ opening_qty: '100', opening_value: '5000.00', receipt_qty: '50', receipt_rate: '60.5' }, { new_qty: '150.000', new_value: '8025.00', average_rate: '53.5000' }),
      t({ opening_qty: '0', opening_value: '0', receipt_qty: '7', receipt_rate: '33.3333' }, { new_qty: '7.000', new_value: '233.33', average_rate: '33.3329' }),
      t({ opening_qty: '0', opening_value: '0', receipt_qty: '0', receipt_rate: '10' }, { new_qty: '0.000', new_value: '0.00', average_rate: '0.0000' }),
    ],
  },
  {
    code: 'billing.net_payable',
    description: "Net payable on a running bill: gross less retention and TDS. Statutory rounding, so banker's (half even); TDS to whole rupees.",
    ownerModule: 'billing',
    financial: true,
    roundingPolicy: 'bankers',
    inputs: [
      { name: 'gross', type: 'money', min: '0' },
      { name: 'retention_percent', type: 'percent', min: '0', max: '100' },
      { name: 'tds_percent', type: 'percent', min: '0', max: '100' },
    ],
    expression: [
      'retention = round(gross * retention_percent / 100, 2)',
      'tds = round(gross * tds_percent / 100, 0)',
      'net_payable = gross - retention - tds',
    ].join('\n'),
    outputs: [
      { name: 'retention', type: 'money', label: 'Retention' },
      { name: 'tds', type: 'money', label: 'TDS' },
      { name: 'net_payable', type: 'money', label: 'Net payable' },
    ],
    tests: [
      t({ gross: '100000.00', retention_percent: '5', tds_percent: '2' }, { retention: '5000.00', tds: '2000.00', net_payable: '93000.00' }),
      t({ gross: '12345.67', retention_percent: '2.5', tds_percent: '1' }, { retention: '308.64', tds: '123.00', net_payable: '11914.03' }),
      t({ gross: '250.00', retention_percent: '1', tds_percent: '1' }, { retention: '2.50', tds: '2.00', net_payable: '245.50' }),
    ],
  },
]);
