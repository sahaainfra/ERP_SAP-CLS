import { CATALOGUE } from './tpl-catalogue.js';

// The standard business format library and the corporate design standard (part 04.11, FR-02 and FR-07). Every format has the same letterhead, fonts (IBM Plex Sans, with Devanagari and the rupee sign),
// colours, table style, totals box, amount in words in English and Hindi, signature block, QR verification code and a footer with the page numbers. `standardFormat(docType)` gives the HTML and the style of
// the format of a type; a company changes it in the Template Editor and the change is approved (maker-checker) before it is used.
export const BASE_CSS = `
h1 { font-size: 15pt; color: #14315f; margin-top: 6pt; margin-bottom: 4pt; }
h2 { font-size: 11pt; color: #14315f; margin-top: 8pt; margin-bottom: 3pt; }
.brand { font-size: 14pt; font-weight: bold; color: #14315f; }
.muted { color: #5b6573; font-size: 8pt; }
.title { text-align: left; }
.num { text-align: right; }
.center { text-align: center; }
.box { background: #f3f6fb; border: 0.75pt solid #c5d0e3; padding: 5pt; margin-bottom: 4pt; }
table.lines th { background: #14315f; color: #ffffff; font-size: 8.5pt; }
table.lines td { border-bottom: 0.5pt solid #d5dbe6; }
table.totals td { padding: 2pt 4pt; }
table.totals .grand td { font-weight: bold; font-size: 10.5pt; border-top: 0.75pt solid #14315f; }
table.meta td { padding: 1.5pt 4pt; }
.sig { border-top: 0.5pt solid #5b6573; padding-top: 2pt; font-size: 8.5pt; }
.words { font-size: 9pt; margin-top: 4pt; }
hr.accent { border-top: 1.5pt solid #14315f; margin-top: 3pt; margin-bottom: 3pt; }
`.trim();

const HEADER = `<header>
<table><tr><td width="70%">{{logo}}<div class="brand">{{company.name}}</div><div class="muted">{{company.address}}</div><div class="muted">GSTIN {{company.gstin}} &nbsp; PAN {{company.pan}} &nbsp; {{company.phone}} &nbsp; {{company.email}}</div></td>
<td align="right">{{qr}}<div class="muted">Verify: {{verifyCode}}</div></td></tr></table>
<hr class="accent">
</header>`;
const FOOTER = `<footer>
<hr>
<table><tr><td class="muted">{{docNo}} &nbsp;·&nbsp; {{copyLabel}} &nbsp;·&nbsp; {{company.footerNote}}</td><td align="right" class="muted">Generated {{generatedAt}} &nbsp;·&nbsp; Page {{page}} of {{pages}}</td></tr></table>
</footer>`;
const SIGNATURES = `<h2>Approvals</h2>
<table><tr>{{#each approvals}}<td><div style="height: 22pt"></div><div class="sig"><strong>{{name}}</strong><br>{{role}} &nbsp; {{decision}} {{date}}</div></td>{{/each}}</tr></table>`;

const row = (label, path) => `<td class="muted">${label}</td><td><strong>{{${path}}}</strong></td>`;
function meta(cat) {
  const skip = (k, v) => v.derived || k.startsWith('party.') || ['remarks', 'narration', 'bankDetails', 'paymentTerms', 'deliveryTerms', 'scope', 'summary', 'description', 'workDescription', 'precautions', 'rootCause', 'correctiveAction', 'certificate.text', 'taxKind', 'supply.stateCode', 'party.stateCode'].includes(k) || v.sensitive || k.startsWith('candidate.') || k.startsWith('employee.') || k.startsWith('certificate.') || k.startsWith('recipient.');
  const fields = [['docNo', 'Document no.'], ['docDate', 'Date'], ...Object.entries(cat.scalars).filter(([k, v]) => !skip(k, v)).map(([k, v]) => [k, v.label])];
  const rows = [];
  for (let i = 0; i < fields.length; i += 2) rows.push(`<tr>${row(fields[i][1], fields[i][0])}${fields[i + 1] ? row(fields[i + 1][1], fields[i + 1][0]) : '<td></td><td></td>'}</tr>`);
  return `<table class="meta">${rows.join('\n')}</table>`;
}
function party(cat) {
  if (!('party.name' in cat.scalars)) return '';
  const name = cat.scalars['party.name'].label;
  return `<div class="box"><span class="muted">${name}</span><br><strong>{{party.name}}</strong>${'party.address' in cat.scalars ? '<br>{{party.address}}' : ''}${'party.gstin' in cat.scalars ? '<br><span class="muted">GSTIN {{party.gstin}}</span>' : ''}</div>`;
}
const COLS = {
  commercial: ['no', 'description', 'hsn', 'uom', 'qty', 'rate', 'taxable', 'gstRate', 'amount'],
};
const NUMERIC = new Set(['qty', 'rate', 'amount', 'taxable', 'gstRate', 'discount', 'taxAmount', 'ordered', 'accepted']);
const WIDTH = { no: '5%', hsn: '9%', uom: '6%', qty: '9%', rate: '11%', taxable: '12%', gstRate: '7%', amount: '13%', discount: '9%' };
function table(group, g, cols) {
  const columns = (cols ?? Object.keys(g.columns)).filter((c) => g.columns[c]);
  const head = columns.map((c) => `<th${WIDTH[c] ? ` width="${WIDTH[c]}"` : ''}${NUMERIC.has(c) ? ' class="num"' : ''}>${c === 'no' ? '#' : g.columns[c].label}</th>`).join('');
  const cells = columns.map((c) => `<td${NUMERIC.has(c) ? ' class="num"' : ''}>${c === 'no' ? '{{@no}}' : `{{${c}}}`}</td>`).join('');
  return `<table class="lines"><thead><tr>${head}</tr></thead><tbody>{{#each ${group}}}<tr>${cells}</tr>{{/each}}</tbody></table>`;
}
const totalsRow = (label, path, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><td class="num">${label}</td><td class="num" width="34%">{{${path}}}</td></tr>`;
const COMMERCIAL_TOTALS = `<table class="totals"><tr><td width="50%"></td><td><table class="totals">
${totalsRow('Total before discount', 'subtotal')}
{{#if discountTotal}}${totalsRow('Discount', 'discountTotal')}{{/if}}
${totalsRow('Taxable value', 'taxableTotal')}
{{#if taxKind == 'INTRA'}}${totalsRow('CGST', 'cgstTotal')}${totalsRow('SGST', 'sgstTotal')}{{else}}${totalsRow('IGST', 'igstTotal')}{{/if}}
{{#if roundOff}}${totalsRow('Round off', 'roundOff')}{{/if}}
${totalsRow('Grand total', 'grandTotal', 'grand')}
</table></td></tr></table>
<div class="words"><strong>Amount in words:</strong> {{amountWords}}<br>{{amountWordsHi}}</div>`;
const TERMS = (cat) => ['paymentTerms' in cat.scalars ? '{{#if paymentTerms}}<p><strong>Payment terms:</strong> {{paymentTerms}}</p>{{/if}}' : '', 'deliveryTerms' in cat.scalars ? '{{#if deliveryTerms}}<p><strong>Delivery terms:</strong> {{deliveryTerms}}</p>{{/if}}' : '', 'bankDetails' in cat.scalars ? '{{#if bankDetails}}<p><strong>Bank details:</strong> {{bankDetails}}</p>{{/if}}' : '', 'narration' in cat.scalars ? '{{#if narration}}<p><strong>Narration:</strong> {{narration}}</p>{{/if}}' : '', 'remarks' in cat.scalars ? '{{#if remarks}}<p><strong>Remarks:</strong> {{remarks}}</p>{{/if}}' : ''].join('\n');

/** The standard format of a document type: { name, html, css }. */
export function standardFormat(docType) {
  const cat = CATALOGUE[docType];
  if (!cat) return null;
  const title = `<h1 class="title">${cat.label.toUpperCase()}</h1>`;
  let body;
  if (docType === 'OFFER_LETTER') {
    body = `${title}<p>Date: {{docDate}}</p><p>{{candidate.name}}<br>{{candidate.address}}</p><p>Dear {{candidate.name}},</p>
<p>We are pleased to offer you the position of <strong>{{position}}</strong> in the {{department}} department, reporting to {{reportingTo}}, with effect from {{joiningDate}}.</p>
<p>Your annual cost to company will be <strong>{{ctc}}</strong> ({{ctcWords}}).</p>
{{#if probation}}<p>You will be on probation for {{probation}}.</p>{{/if}}
<h2>Components of the pay</h2>${table('lines', cat.groups.lines)}
<p>Please sign and return a copy of this letter to accept the offer.</p>${SIGNATURES}`;
  } else if (docType === 'CERTIFICATE') {
    body = `<h1 class="center">{{certificate.title}}</h1><p class="center">This is to certify that</p><h2 class="center">{{recipient.name}}</h2><p class="center">{{certificate.text}}</p>
<p class="center">Issued for: {{issuedFor}} &nbsp; Issued on: {{issuedOn}} &nbsp; {{#if validUntil}}Valid until: {{validUntil}}{{/if}}</p>${SIGNATURES}`;
  } else if (docType === 'PAYSLIP') {
    body = `${title}<table class="meta">
<tr>${row('Employee', 'employee.name')}${row('Code', 'employee.code')}</tr><tr>${row('Designation', 'designation')}${row('Department', 'department')}</tr>
<tr>${row('Pay month', 'month')}${row('Days paid', 'daysPaid')}</tr><tr>${row('PAN', 'pan')}${row('Bank account', 'bank.account')}</tr></table>
<h2>Earnings</h2>${table('lines', cat.groups.lines, ['no', 'label', 'amount'])}
<h2>Deductions</h2>${table('deductions', cat.groups.deductions, ['no', 'label', 'amount'])}
<table class="totals"><tr><td width="50%"></td><td><table class="totals">${totalsRow('Gross earnings', 'grossEarnings')}${totalsRow('Total deductions', 'totalDeductions')}${totalsRow('Net pay', 'netPay', 'grand')}</table></td></tr></table>
<div class="words"><strong>Net pay in words:</strong> {{amountWords}}<br>{{amountWordsHi}}</div>
<p class="muted">This is a system generated payslip. Its authenticity can be verified with the QR code.</p>`;
  } else if (cat.compute === 'commercial') {
    body = `${title}${meta(cat)}${party(cat)}${table('lines', cat.groups.lines, COLS.commercial)}${COMMERCIAL_TOTALS}${TERMS(cat)}${SIGNATURES}`;
  } else if (cat.compute === 'voucher' || cat.compute === 'measure') {
    body = `${title}${meta(cat)}${party(cat)}${table('lines', cat.groups.lines)}
<table class="totals"><tr><td width="50%"></td><td><table class="totals">${totalsRow('Total', 'total', 'grand')}</table></td></tr></table>
<div class="words"><strong>Amount in words:</strong> {{amountWords}}<br>{{amountWordsHi}}</div>${TERMS(cat)}${SIGNATURES}`;
  } else {
    const long = Object.entries(cat.scalars).filter(([k]) => ['summary', 'description', 'workDescription', 'precautions', 'rootCause', 'correctiveAction', 'remarks'].includes(k));
    body = `${title}${meta(cat)}${party(cat)}${long.map(([k, v]) => `{{#if ${k}}}<p><strong>${v.label}:</strong> {{${k}}}</p>{{/if}}`).join('\n')}${table('lines', cat.groups.lines)}${SIGNATURES}`;
  }
  return { name: `${cat.label} (standard format)`, html: `${HEADER}\n${body}\n${FOOTER}`, css: BASE_CSS };
}
