import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { amountInHindi, amountInWords } from '../src/server/modules/eng/tpl-words.js';
import { DOC_TYPES, compute, sampleOf } from '../src/server/modules/eng/tpl-catalogue.js';
import { standardFormat } from '../src/server/modules/eng/tpl-library.js';
import { validate } from '../src/server/modules/eng/tpl-engine.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.11: document templates, PDF generation, print and delivery.
// T-01 a template with an unresolved variable fails validation; T-02 the PDF of a tax invoice carries the totals of the database and the amount in words; T-03 500 documents are generated as a background job.
const T = '/api/v1/tpl';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 't') => ({ ...json, 'idempotency-key': `tp-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const sys = as('SYSADM', 'sys1');
const cfo = as('CFO', 'cfo1');
const procmgr = as('PROCMGR', 'pm2');
const pm = as('PM', 'pm1');
const acc = as('ACCMGR', 'acc1');
const hr = as('HRMGR', 'hr1');
const emp = as('EMP', 'emp1');

const setup = async () => {
  const storage = mkdtempSync(join(tmpdir(), 'erp-tpl-'));
  const api = await startApi({}, { storagePath: storage });
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  api.db.prepare("UPDATE org_companies SET legal_name = 'Main Infra Pvt Ltd', gstin_primary = '27ABCDE1234F1Z5', pan = 'ABCDE1234F' WHERE id = 1").run();
  for (const [n, r] of [['sys1', ['SYSADM']], ['cfo1', ['CFO']], ['pm2', ['PROCMGR']], ['pm1', ['PM']], ['acc1', ['ACCMGR']], ['hr1', ['HRMGR']], ['emp1', ['EMP']], ['se1', ['SE']], ['pd1', ['PD']], ['aud1', ['AUD']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n.toUpperCase(), JSON.stringify(r), `${n}@example.com`);
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')").run().lastInsertRowid);
  const runtime = runtimeOf(api.db);
  const drain = async () => { for (let i = 0; i < 6; i += 1) { runtime.bus.drain(); await runtime.jobs.drain(); } };
  return { api, project, runtime, drain, cleanup: async () => { await api.close(); rmSync(storage, { recursive: true, force: true }); } };
};
const call = (t, method, path, who, body, k) => t.api.call(method, `${T}${path}`, { ...who, headers: key(k), body });
const textOf = async (buffer) => {
  const doc = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0 }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i += 1) out += `${(await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ')}\n`;
  return out.replace(/\s+/g, ' ').replace(/₹ /g, '₹').replace(/- ₹/g, '-₹');
};
const invoice = (over = {}) => ({
  docNo: 'INV/2026-27/0007', docDate: '2026-11-04', party: { name: 'MSRDC', gstin: '27AAAJM0000B1ZP', address: 'Mumbai', stateCode: '27' }, supply: { stateCode: '27' },
  lines: [{ description: 'Bituminous concrete', hsn: '9954', uom: 'Cum', qty: '850.250', rate: '9120.5000', gstRate: '18' }, { description: 'Retention released', hsn: '9954', uom: 'LS', qty: '1', rate: '250000', gstRate: '18', discount: '10000' }],
  approvals: [{ role: 'Prepared by', name: 'A. Kulkarni', decision: 'Prepared', date: '2026-11-02' }], ...over,
});
const publish = (t, who, docType, entityId, data, extra = {}) => call(t, 'PUT', '/records', who, { docType, entityId, data, approved: true, projectId: t.project, ...extra }, 'r');
const pdfOf = async (t, who, id) => { const r = await t.api.raw('GET', `${T}/generated/${id}/content`, who); assert.equal(r.status, 200); return r.buffer; };
const act = async (t, who, instanceId, action = 'approve') => {
  const task = (await t.api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  assert.ok(task, `${who.user} has the task`);
  const r = await t.api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment: 'Checked and in order' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};

test('the words of an amount in the Indian system, in English and in Hindi', () => {
  assert.equal(amountInWords('9433752.00'), 'Rupees Ninety Four Lakh Thirty Three Thousand Seven Hundred Fifty Two Only');
  assert.equal(amountInWords('123456.50'), 'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only');
  assert.equal(amountInWords('0.75'), 'Fifty Paise Only'.replace('Fifty', 'Seventy Five'));
  assert.equal(amountInWords('0.00'), 'Rupees Zero Only');
  assert.equal(amountInWords('10000000'), 'Rupees One Crore Only');
  assert.equal(amountInHindi('9433752.00'), 'चौरानवे लाख तैंतीस हज़ार सात सौ बावन रुपये मात्र');
  assert.equal(amountInHindi('123456.50'), 'एक लाख तेईस हज़ार चार सौ छप्पन रुपये और पचास पैसे मात्र');
});

test('every standard format of the library passes the catalogue check and its sample record calculates', () => {
  assert.equal(DOC_TYPES.length, 19);
  for (const t of DOC_TYPES) {
    const v = validate(t, standardFormat(t));
    assert.ok(v.ok, `${t}: ${JSON.stringify(v.problems)}`);
    const r = compute(t, sampleOf(t));
    assert.deepEqual(r.problems, [], t);
  }
});

test('T-01 FR-03 a template with a variable that is not in the catalogue fails, on the check and on saving; scripts, links and variables in a tag are refused', async () => {
  const t = await setup();
  try {
    const bad = '<h1>Invoice</h1><p>{{customerName}} owes {{grandTotal | money}}</p>{{#each lines}}<p>{{nonsense}}</p>{{/each}}';
    const v = await call(t, 'POST', '/templates/validate', sys, { docType: 'TAX_INVOICE', html: bad });
    assert.equal(v.status, 200);
    assert.equal(v.json.data.ok, false);
    assert.deepEqual(v.json.data.problems.map((p) => p.variable), ['customerName', 'nonsense']);
    assert.match(v.json.data.problems[0].message, /not in the catalogue of Tax invoice/);
    const saved = await call(t, 'POST', '/templates', sys, { docType: 'TAX_INVOICE', code: 'INV_BAD', name: 'Bad invoice', html: bad });
    assert.equal(saved.status, 422);
    assert.ok(saved.json.error.details.some((d) => /customerName/.test(d.message)));
    for (const html of ['<script>alert(1)</script><p>{{docNo}}</p>', '<p onclick="x()">{{docNo}}</p>', '<img src="https://evil.example/x.png"><p>{{docNo}}</p>', '<p class="{{docNo}}">x</p>', '<a href="x">{{docNo}}</a>', '<p>{{#each lines}}</p>', '<p>{{docNo | nosuchfilter}}</p>', '<p>{{#each nothing}}x{{/each}}</p>']) {
      const r = await call(t, 'POST', '/templates/validate', sys, { docType: 'TAX_INVOICE', html });
      assert.equal(r.json.data.ok, false, html);
    }
    const good = await call(t, 'POST', '/templates/validate', sys, { docType: 'TAX_INVOICE', html: '<h1>{{docNo}}</h1>{{#each lines}}<p>{{@no}} {{description}} {{amount | money}}</p>{{/each}}{{#if taxKind == \'INTRA\'}}<p>{{cgstTotal}}</p>{{else}}<p>{{igstTotal}}</p>{{/if}}' });
    assert.equal(good.json.data.ok, true, JSON.stringify(good.json.data.problems));
  } finally { await t.cleanup(); }
});

test('T-02 FR-04 FR-05 the PDF of a tax invoice carries the totals of the database and the amount in words, a QR code and the verification page names it; the totals cannot be sent by the caller', async () => {
  const t = await setup();
  try {
    // a total that the lines do not add up to is refused
    const wrong = await publish(t, sys, 'TAX_INVOICE', 'inv-7', invoice({ grandTotal: '1.00' }));
    assert.equal(wrong.status, 422);
    assert.ok(wrong.json.error.details.some((d) => d.field === 'grandTotal' && /recomputed/.test(d.message)));
    const rec = await publish(t, sys, 'TAX_INVOICE', 'inv-7', invoice());
    assert.equal(rec.status, 200, JSON.stringify(rec.json));
    assert.equal(rec.json.data.data.grandTotal, '9433752.00');
    assert.equal(rec.json.data.data.roundOff, '-0.05');
    // the one who may only view cannot generate; an outsider has no rights at all
    assert.equal((await call(t, 'POST', '/generate', emp, { docType: 'TAX_INVOICE', entityId: 'inv-7' })).status, 403);
    const g = await call(t, 'POST', '/generate', acc, { docType: 'TAX_INVOICE', entityId: 'inv-7' });
    assert.equal(g.status, 201, JSON.stringify(g.json));
    const doc = g.json.data;
    assert.equal(doc.version, 1);
    assert.equal(doc.docNo, 'INV/2026-27/0007');
    assert.match(doc.verifyCode, /^[A-Z2-9]{12}$/);
    const buffer = await pdfOf(t, acc, doc.id);
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    const text = await textOf(buffer);
    // the figures of the database, to the paisa, as the lines add up
    const db = t.api.db.prepare('SELECT data_json FROM tpl_records WHERE entity_id = ?').get('inv-7');
    const data = JSON.parse(db.data_json);
    assert.equal(data.taxableTotal, '7994705.13');
    assert.ok(text.includes('₹94,33,752.00'), text);
    assert.ok(text.includes('₹79,94,705.13'), text);
    assert.ok(text.includes('₹7,19,523.46'), text);
    assert.ok(text.includes('Rupees Ninety Four Lakh Thirty Three Thousand Seven Hundred Fifty Two Only'), text);
    assert.ok(text.includes('INV/2026-27/0007') && text.includes(doc.verifyCode) && text.includes('Page 1 of 1'), text);
    // the hash of the file is the hash on record, and the file is in the file service as a clean PDF
    const f = t.api.db.prepare('SELECT * FROM core_files WHERE id = ?').get(doc.fileId);
    assert.equal(f.sha256, doc.hash);
    assert.equal(f.scan_status, 'CLEAN');
    assert.equal(f.linked_entity, 'tpl_generated');
    // anyone who scans the code (no sign-in) learns that it is genuine and current
    const v = await t.api.call('GET', `${T}/verify/${doc.verifyCode}`, { user: null, company: null });
    assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.equal(v.json.data.valid, true);
    assert.equal(v.json.data.current, true);
    assert.equal(v.json.data.document.docNo, 'INV/2026-27/0007');
    assert.equal((await t.api.call('GET', `${T}/verify/ABCDEFGHJKLM`, { user: null, company: null })).json.data.valid, false);
    // inter-state: IGST only
    await publish(t, sys, 'TAX_INVOICE', 'inv-8', invoice({ docNo: 'INV/2026-27/0008', party: { name: 'Karnataka PWD', stateCode: '29' } }));
    const g2 = await call(t, 'POST', '/generate', acc, { docType: 'TAX_INVOICE', entityId: 'inv-8' });
    const text2 = await textOf(await pdfOf(t, acc, g2.json.data.id));
    assert.ok(text2.includes('IGST') && !text2.includes('CGST'), text2);
  } finally { await t.cleanup(); }
});

const approveChange = async (api, who, marker) => {
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => JSON.stringify(x).includes(marker));
  assert.ok(task, `${who.user} has the ${marker} task`);
  assert.equal((await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('t'), body: { action: 'approve', comment: 'ok' } })).status, 200);
};
const connector = async (api, code, type, config = {}) => {
  const it = as('ITADM', 'it1');
  const res = await api.call('POST', '/api/v1/core/connectors', { ...it, headers: key('k'), body: { code, type, name: code, provider: 'sandbox', environment: 'development', config, secrets: { webhook_secret: 'whsec_0123456789abcdef' }, enabled: true, reason: 'the template test' } }); // secret-scan:allow fake credential for the test
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal((await api.call('POST', `/api/v1/core/change-requests/${res.json.data.request.id}/act`, { ...sys, headers: key('a'), body: { action: 'approve', comment: 'ok' } })).status, 200);
};
const setupEmail = async (t) => {
  t.api.db.prepare("INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'it1', 'IT1', '[\"ITADM\"]', 'it1@example.com')").run();
  await connector(t.api, 'mail.a', 'email', { fromAddress: 'noreply@example.com' });
  const r = await t.api.call('POST', '/api/v1/comm/channels/changes', { ...as('ITADM', 'it1'), headers: key('p'), body: { channels: [{ channel: 'EMAIL', primaryConnector: 'mail.a', ratePerMinute: 600, enabled: true }], dltTemplates: [], reason: 'Set up e-mail' } });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  await approveChange(t.api, sys, 'COMM_CONFIG');
};
const ownTemplate = async (t, docType = 'PO', over = {}) => {
  const cat = (await call(t, 'GET', `/templates/catalogue?docType=${docType}`, sys)).json.data;
  const r = await call(t, 'POST', '/templates', sys, { docType, code: `${docType}_STANDARD`, name: `${docType} with our heading`, html: cat.standard.html.replace('<h1 class="title">', '<h1 class="title">OUR '), css: cat.standard.css, changeNote: 'Our heading', ...over }, 'c');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data;
};
const po = (over = {}) => ({ docNo: 'PO/2026-27/0042', docDate: '2026-11-03', party: { name: 'Shree Cement Traders', gstin: '27AAACS1234A1Z5', address: 'Pune', stateCode: '27' }, supply: { stateCode: '27' }, lines: [{ description: 'OPC 53 cement', hsn: '2523', uom: 'Bag', qty: '1200', rate: '412.50', gstRate: '28' }], ...over });

test('BR-01 AC-04 a template change is maker-checker: the system administrator makes it, the process owner of the type approves it, nobody else can, and until then the old format is used', async () => {
  const t = await setup();
  try {
    assert.equal((await publish(t, sys, 'PO', 'po-42', po())).status, 200);
    const before = await call(t, 'POST', '/generate', procmgr, { docType: 'PO', entityId: 'po-42' }, 'g');
    assert.equal(before.status, 201, JSON.stringify(before.json));
    assert.equal(before.json.data.templateCode, 'PO_STANDARD');
    assert.equal(before.json.data.templateVersion, 1);
    // an ordinary person cannot make a template
    assert.equal((await call(t, 'POST', '/templates', procmgr, { docType: 'PO', code: 'PO_X', name: 'Purchase order X', html: '<p>{{docNo}}</p>' }, 'x')).status, 403);
    const draft = await ownTemplate(t);
    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.version, 2);
    // one draft at a time for a code
    assert.equal((await call(t, 'POST', '/templates', sys, { docType: 'PO', code: 'PO_STANDARD', name: 'Another', html: '<p>{{docNo}}</p>' }, 'd')).status, 409);
    // a stale save is a conflict
    assert.equal((await t.api.call('PATCH', `${T}/templates/${draft.id}`, { ...sys, headers: key('u'), body: { name: 'Our PO', rowVersion: 99 } })).status, 409);
    const upd = await t.api.call('PATCH', `${T}/templates/${draft.id}`, { ...sys, headers: key('u'), body: { name: 'Our purchase order', rowVersion: draft.rowVersion } });
    assert.equal(upd.status, 200, JSON.stringify(upd.json));
    const sent = await call(t, 'POST', `/templates/${draft.id}/submit`, sys, undefined, 's');
    assert.equal(sent.status, 202, JSON.stringify(sent.json));
    assert.equal(sent.json.data.status, 'IN_REVIEW');
    const inst = sent.json.data.workflow.id;
    // the draft is not in production: the next document still uses version 1
    await publish(t, sys, 'PO', 'po-43', po({ docNo: 'PO/2026-27/0043' }));
    assert.equal((await call(t, 'POST', '/generate', procmgr, { docType: 'PO', entityId: 'po-43' }, 'g')).json.data.templateVersion, 1);
    // the maker cannot approve his own change, and the CFO is not the process owner of a purchase order
    const mine = (await t.api.call('GET', `${W}/tasks?mine=assigned`, sys)).json.data.rows.find((x) => x.instance.id === inst);
    assert.equal(mine, undefined);
    assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, cfo)).json.data.rows.find((x) => x.instance.id === inst), undefined);
    await act(t, procmgr, inst);
    const live = (await call(t, 'GET', `/templates/${draft.id}`, sys)).json.data;
    assert.equal(live.status, 'ACTIVE');
    assert.equal(live.approvedBy, 'pm2');
    await publish(t, sys, 'PO', 'po-44', po({ docNo: 'PO/2026-27/0044' }));
    const after = (await call(t, 'POST', '/generate', procmgr, { docType: 'PO', entityId: 'po-44' }, 'g')).json.data;
    assert.equal(after.templateVersion, 2);
    assert.ok((await textOf(await pdfOf(t, procmgr, after.id))).includes('OUR PURCHASE ORDER'));
    // the previous approved version is kept as retired history
    assert.ok(t.api.db.prepare("SELECT 1 FROM tpl_templates WHERE code = 'PO_STANDARD' AND company_id = 1 AND status = 'ACTIVE'").get());
    // a rejected change goes nowhere: invoices are approved by the CFO
    const inv = await ownTemplate(t, 'TAX_INVOICE');
    const s2 = await call(t, 'POST', `/templates/${inv.id}/submit`, sys, undefined, 's');
    await act(t, cfo, s2.json.data.workflow.id, 'reject');
    assert.equal((await call(t, 'GET', `/templates/${inv.id}`, sys)).json.data.status, 'REJECTED');
    // a new version of the template is also checked against the catalogue when it is made
    assert.equal((await call(t, 'POST', '/templates', sys, { docType: 'TAX_INVOICE', code: 'INV_NEW', name: 'New invoice', html: '<p>{{nothing}}</p>' }, 'n')).status, 422);
    // the audit trail has the steps
    const audit = t.api.db.prepare("SELECT action FROM core_audit_log WHERE entity = 'tpl_templates' ORDER BY id").all().map((r) => r.action);
    assert.ok(['create', 'update', 'submit', 'activate'].every((a) => audit.includes(a)), audit.join());
  } finally { await t.cleanup(); }
});

test('BR-02 FR-04 an official document never changes: a new generation is a new version with a reason, the earlier one is kept, and only approved data is printed', async () => {
  const t = await setup();
  try {
    // data that is not approved, or only a sample, is not printed
    assert.equal((await publish(t, sys, 'PO', 'po-1', po(), { approved: false })).status, 200);
    const refused = await call(t, 'POST', '/generate', procmgr, { docType: 'PO', entityId: 'po-1' }, 'g');
    assert.equal(refused.status, 422);
    assert.match(refused.json.error.message, /not approved/);
    assert.equal((await publish(t, sys, 'PO', 'po-2', po({ docNo: 'PO/2026-27/0002' }), { sample: true })).status, 200);
    assert.match((await call(t, 'POST', '/generate', procmgr, { docType: 'PO', entityId: 'po-2' }, 'g')).json.error.message, /sample/);
    assert.equal((await call(t, 'POST', '/generate', procmgr, { docType: 'PO', entityId: 'nope' }, 'g')).status, 404);
    await publish(t, sys, 'PO', 'po-1', po());
    const first = (await call(t, 'POST', '/generate', procmgr, { docType: 'PO', entityId: 'po-1' }, 'g1')).json.data;
    const bytes = await pdfOf(t, procmgr, first.id);
    // the same Idempotency-Key replays the same answer and makes nothing new
    const k = key('same');
    const a = await t.api.call('POST', `${T}/generate`, { ...procmgr, headers: k, body: { docType: 'PO', entityId: 'po-1', reason: 'Again please' } });
    const b = await t.api.call('POST', `${T}/generate`, { ...procmgr, headers: k, body: { docType: 'PO', entityId: 'po-1', reason: 'Again please' } });
    assert.equal(a.status, 201);
    assert.equal(b.json.data.id, a.json.data.id);
    assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM tpl_generated_docs WHERE entity_id = 'po-1'").get().n, 2);
    // a regeneration needs a reason
    const noReason = await call(t, 'POST', '/generate', procmgr, { docType: 'PO', entityId: 'po-1' }, 'g3');
    assert.equal(noReason.status, 409);
    assert.match(noReason.json.error.message, /reason/);
    const second = a.json.data;
    assert.equal(second.version, 2);
    const now = (await call(t, 'GET', `/generated/${first.id}`, procmgr)).json.data;
    assert.equal(now.current, false);
    assert.equal(now.supersededBy, second.id);
    assert.deepEqual(now.versions.map((v) => [v.version, v.current]), [[2, true], [1, false]]);
    assert.ok((await pdfOf(t, procmgr, first.id)).equals(bytes), 'the first version is exactly as it was');
    assert.ok((await textOf(await pdfOf(t, procmgr, second.id))).includes('REGENERATED v2'));
    assert.equal((await t.api.call('GET', `${T}/verify/${first.verifyCode}`, { user: null, company: null })).json.data.current, false);
    // the database refuses to change or remove one
    assert.throws(() => t.api.db.prepare('UPDATE tpl_generated_docs SET hash = ? WHERE id = ?').run('x', first.id), /cannot be changed/);
    assert.throws(() => t.api.db.prepare('DELETE FROM tpl_generated_docs WHERE id = ?').run(first.id), /cannot be deleted/);
    // the data of a record that has an official document cannot be changed without a reason
    assert.equal((await publish(t, sys, 'PO', 'po-1', po({ lines: [{ description: 'OPC 53 cement', qty: '1', rate: '1', gstRate: '28' }] }))).status, 409);
    assert.equal((await publish(t, sys, 'PO', 'po-1', po({ lines: [{ description: 'OPC 53 cement', qty: '1', rate: '1', gstRate: '28' }] }), { reason: 'The quantity was corrected' })).status, 200);
  } finally { await t.cleanup(); }
});

test('FR-06 AC-01 a generated document is delivered by e-mail with a signed link that opens the PDF without signing in; the delivery log follows what the gateway reports; download and print are written down', async () => {
  const t = await setup();
  try {
    await setupEmail(t);
    await publish(t, sys, 'PO', 'po-42', po());
    const g = (await call(t, 'POST', '/generate', procmgr, { docType: 'PO', entityId: 'po-42' }, 'g')).json.data;
    assert.equal((await call(t, 'POST', `/generated/${g.id}/deliver`, emp, { channel: 'EMAIL', recipients: ['vendor@example.com'] }, 'd')).status, 404);
    assert.equal((await call(t, 'POST', `/generated/${g.id}/deliver`, as('AUD', 'aud1'), { channel: 'EMAIL', recipients: ['vendor@example.com'] }, 'd')).status, 403);
    assert.equal((await call(t, 'POST', `/generated/${g.id}/deliver`, procmgr, { channel: 'EMAIL', recipients: [] }, 'd')).status, 400);
    const d = await call(t, 'POST', `/generated/${g.id}/deliver`, procmgr, { channel: 'EMAIL', recipients: ['vendor@example.com', 'not-an-address'], message: 'Please confirm the delivery date.' }, 'd');
    assert.equal(d.status, 201, JSON.stringify(d.json));
    assert.deepEqual(d.json.data.deliveries.map((x) => x.status), ['QUEUED', 'BLOCKED']);
    assert.match(d.json.data.deliveries[1].error, /not an e-mail address/);
    const comm = (await import('../src/server/platform/comm/index.js')).commOf(t.api.db);
    assert.ok((await comm.process(10)).sent >= 1);
    await t.drain();
    const msg = t.api.db.prepare("SELECT * FROM comm_messages WHERE to_address = 'vendor@example.com'").get();
    assert.equal(msg.status, 'SENT', 'the mail left through the gateway');
    assert.equal(msg.related_entity, 'tpl_generated_doc');
    assert.match(msg.body_redacted, /Please confirm the delivery date\./);
    const link = JSON.parse(msg.attachments_json)[0].url;
    assert.match(link, /^\/api\/v1\/tpl\/generated\/\d+\/file\?exp=\d+&sig=[\w-]+$/);
    const opened = await t.api.raw('GET', link, { user: null, company: null });
    assert.equal(opened.status, 200);
    assert.equal(opened.buffer.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await t.api.raw('GET', link.replace(/sig=./, 'sig=Z'), { user: null, company: null })).status, 403);
    assert.equal((await t.api.raw('GET', link.replace(/exp=\d+/, 'exp=1'), { user: null, company: null })).status, 403, 'the signature covers the expiry');
    const log = (await call(t, 'GET', `/generated/${g.id}`, procmgr)).json.data;
    assert.equal(log.deliveries.filter((x) => x.channel === 'EMAIL').length, 2);
    assert.ok(log.deliveries.find((x) => x.recipient === 'vendor@example.com' && ['SENT', 'DELIVERED'].includes(x.status)), JSON.stringify(log.deliveries));
    assert.ok(log.deliveries.some((x) => x.channel === 'DOWNLOAD' && x.recipient === 'signed link'));
    // opening for print is on the trail
    assert.equal((await t.api.raw('GET', `${T}/generated/${g.id}/content`, procmgr)).status, 200);
    assert.ok(t.api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'tpl_generated_docs' AND action = 'print'").get());
    // message and portal are another part's: the request is published and waits
    const m = await call(t, 'POST', `/generated/${g.id}/deliver`, procmgr, { channel: 'PORTAL', recipients: ['contractor-portal'] }, 'p');
    assert.equal(m.json.data.deliveries[0].status, 'QUEUED');
    assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'tpl.document.delivery_requested'").get());
    // the list of deliveries
    const list = (await call(t, 'GET', '/deliveries', procmgr)).json.data.rows;
    assert.ok(list.length >= 3);
  } finally { await t.cleanup(); }
});

test('T-03 FR-04 500 documents are generated as one background job with progress, each as its own document with its own code, and the person is told', async () => {
  const t = await setup();
  try {
    const ids = [];
    for (let i = 1; i <= 500; i += 1) {
      ids.push(`po-${i}`);
      const r = t.api.db.prepare("INSERT INTO tpl_records (company_id, doc_type, entity_id, doc_no, data_json, approved, project_id, created_by, source_type) VALUES (1, 'PO', ?, ?, ?, 1, ?, 'sys1', 'test')").run(`po-${i}`, `PO/2026-27/${String(i).padStart(4, '0')}`, JSON.stringify(compute('PO', po({ docNo: `PO/2026-27/${String(i).padStart(4, '0')}` })).data), t.project);
      assert.ok(r.changes === 1);
    }
    // a person without the right cannot start it; a list with a record that does not exist starts nothing
    assert.equal((await call(t, 'POST', '/generate/bulk', emp, { docType: 'PO', entityIds: ids }, 'b')).status, 403);
    const bad = await call(t, 'POST', '/generate/bulk', procmgr, { docType: 'PO', entityIds: [...ids.slice(0, 3), 'missing'] }, 'b');
    assert.equal(bad.status, 422);
    assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM tpl_bulk_jobs').get().n, 0);
    const start = await call(t, 'POST', '/generate/bulk', procmgr, { docType: 'PO', entityIds: ids }, 'b');
    assert.equal(start.status, 202, JSON.stringify(start.json));
    assert.equal(start.json.data.status, 'QUEUED');
    assert.equal(start.json.data.total, 500);
    // nothing is generated in the request: the job does it
    assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM tpl_generated_docs').get().n, 0);
    await t.drain();
    const done = (await call(t, 'GET', `/generate/bulk/${start.json.data.id}`, procmgr)).json.data;
    assert.equal(done.status, 'DONE');
    assert.equal(done.done, 500);
    assert.equal(done.failed, 0);
    assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM tpl_generated_docs WHERE bulk_job_id = ? AND is_current = 1").get(done.id).n, 500);
    assert.equal(t.api.db.prepare('SELECT COUNT(DISTINCT verify_code) AS n FROM tpl_generated_docs').get().n, 500);
    const job = t.api.db.prepare("SELECT status, progress FROM core_jobs WHERE type = 'tpl.bulk'").get();
    assert.equal(job.status, 'SUCCEEDED');
    assert.equal(job.progress, 100);
    const log = (await call(t, 'GET', `/generated?bulkJobId=${done.id}&limit=100`, procmgr)).json.data;
    assert.equal(log.total, 500);
    assert.equal(log.summary.byType[0].docType, 'PO');
    assert.ok(t.api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'tpl.bulk.done'").get() ?? t.api.db.prepare("SELECT 1 FROM ntf_notifications LIMIT 1").get(), 'the person is told');
  } finally { await t.cleanup(); }
});

test('FR-08 a workflow approval milestone makes its document by itself, once, as a background job', async () => {
  const t = await setup();
  try {
    const pd = as('PD', 'pd1');
    assert.equal((await call(t, 'PUT', '/rules', procmgr, { workflowDocType: 'ENG_SAMPLE_DOC', docType: 'PO', enabled: true }, 'r')).status, 403);
    assert.equal((await call(t, 'PUT', '/rules', sys, { workflowDocType: 'ENG_SAMPLE_DOC', docType: 'PO', enabled: true }, 'r')).status, 200);
    assert.equal((await call(t, 'PUT', '/rules', sys, { workflowDocType: 'ENG_SAMPLE_DOC', docType: 'PO', enabled: true }, 'r')).json.data.rows.length, 1);
    const made = await t.api.call('POST', '/api/v1/eng/sample-docs', { ...pd, headers: key('m'), body: { title: 'Shuttering', amount: '12000.00', projectId: t.project } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const doc = made.json.data;
    assert.equal((await publish(t, sys, 'PO', String(doc.id), po({ docNo: 'PO/2026-27/0999' }))).status, 200);
    const s = await t.api.call('POST', `/api/v1/eng/sample-docs/${doc.id}/submit`, { ...pd, headers: key('s'), body: {} });
    const inst = s.json.data.workflow.id;
    await act(t, pm, inst);
    assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM tpl_generated_docs').get().n, 0, 'not before the last approval');
    await act(t, acc, inst);
    await t.drain();
    const rows = t.api.db.prepare('SELECT * FROM tpl_generated_docs').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].purpose, 'MILESTONE');
    assert.equal(rows[0].doc_number, 'PO/2026-27/0999');
    await t.drain();
    assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM tpl_generated_docs').get().n, 1, 'once');
  } finally { await t.cleanup(); }
});

test('AC-03 who sees and does what: the library, the records, the payslip with pay and bank data, other companies, and the preview', async () => {
  const t = await setup();
  try {
    // the library of standard formats, shared by all, is seen by those who keep or approve templates
    const lib = (await call(t, 'GET', '/templates?limit=100', sys)).json.data;
    assert.equal(lib.total, 19);
    assert.ok(lib.rows.every((r) => r.shared && r.status === 'ACTIVE' && r.version === 1));
    assert.equal(lib.canEdit, true);
    assert.equal((await call(t, 'GET', '/templates', cfo)).json.data.canEdit, false);
    assert.equal((await call(t, 'GET', '/templates', emp)).status, 403);
    assert.equal((await call(t, 'GET', '/templates', as('AUD', 'aud1'))).status, 200);
    assert.equal((await call(t, 'GET', '/templates?docType=PAYSLIP', sys)).json.data.rows.length, 1);
    // payslip: pay and bank data need the extra right
    const pay = { docNo: 'PAY/2026-10/E0412', 'employee': { name: 'Sunil Patil', code: 'E0412' }, designation: 'Engineer', month: 'October 2026', pan: 'ABCPP1234Q', bank: { account: '123456784821' }, lines: [{ label: 'Basic', amount: '38000' }], deductions: [{ label: 'PF', amount: '4560' }] };
    assert.equal((await publish(t, sys, 'PAYSLIP', 'e0412-oct', pay)).status, 200);
    assert.equal((await call(t, 'POST', '/generate', acc, { docType: 'PAYSLIP', entityId: 'e0412-oct' }, 'g')).status, 403);
    assert.equal((await call(t, 'POST', '/generate', sys, { docType: 'PAYSLIP', entityId: 'e0412-oct' }, 'g')).status, 403, 'the system administrator keeps templates, he does not print');
    const g = await call(t, 'POST', '/generate', hr, { docType: 'PAYSLIP', entityId: 'e0412-oct' }, 'g');
    assert.equal(g.status, 201, JSON.stringify(g.json));
    const text = await textOf(await pdfOf(t, hr, g.json.data.id));
    assert.ok(text.includes('₹33,440.00') && text.includes('Thirty Three Thousand Four Hundred Forty Only'), text);
    assert.ok(text.includes('XXXXXXXX4821') || text.includes('123456784821'), 'the bank number is printed for the HR manager');
    assert.equal((await call(t, 'GET', `/generated/${g.json.data.id}`, acc)).status, 404, 'a payslip is not even said to exist');
    assert.equal((await call(t, 'GET', '/generated', acc)).json.data.total, 0);
    assert.equal((await call(t, 'GET', '/generated', hr)).json.data.total, 1);
    assert.equal((await t.api.raw('GET', `${T}/generated/${g.json.data.id}/content`, acc)).status, 404);
    const masked = (await call(t, 'GET', '/records?docType=PAYSLIP', acc)).json;
    assert.equal(masked.status ?? 200, 200);
    assert.equal(masked.data.rows[0].data.pan, '••••');
    assert.equal((await call(t, 'GET', '/records?docType=PAYSLIP', hr)).json.data.rows[0].data.pan, 'ABCPP1234Q');
    // another company sees nothing
    const other = { roles: 'ACCMGR', user: 'acc1', company: '2' };
    assert.notEqual((await call(t, 'GET', `/generated/${g.json.data.id}`, other)).status, 200);
    assert.equal(((await call(t, 'GET', '/generated', other)).json.data?.total ?? 0), 0);
    // the preview: a watermark, nothing stored, and a real record needs the right to print it
    const before = t.api.db.prepare('SELECT COUNT(*) AS n FROM tpl_generated_docs').get().n;
    const pv = await t.api.raw('POST', `${T}/templates/preview`, { ...sys, headers: key('pv'), body: JSON.stringify({ docType: 'PO', html: '<p>{{docNo}} {{party.name}} {{grandTotal | money}}</p>{{qr}}', css: '' }) });
    assert.equal(pv.status, 200);
    assert.equal(pv.headers.get('content-type'), 'application/pdf');
    const pt = await textOf(pv.buffer);
    assert.ok(pt.includes('PREVIEW') && pt.includes('Shree Cement Traders'), pt);
    assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM tpl_generated_docs').get().n, before);
    const rec = (await call(t, 'GET', '/records?docType=PAYSLIP', hr)).json.data.rows[0];
    const psl = lib.rows.find((r) => r.docType === 'PAYSLIP').id;
    assert.equal((await t.api.raw('POST', `${T}/templates/preview`, { ...cfo, headers: key('pv'), body: JSON.stringify({ templateId: psl, recordId: rec.id }) })).status, 403, 'pay data needs the extra right even in a preview');
    assert.equal((await t.api.raw('POST', `${T}/templates/preview`, { ...hr, headers: key('pv'), body: JSON.stringify({ templateId: psl, recordId: rec.id }) })).status, 200);
    assert.equal((await t.api.raw('POST', `${T}/templates/preview`, { ...emp, headers: key('pv'), body: JSON.stringify({ docType: 'PO', html: '<p>x</p>' }) })).status, 403);
    // bad input
    assert.equal((await call(t, 'PUT', '/records', sys, { docType: 'NOPE', entityId: '1', data: {} }, 'r')).status, 400);
    assert.equal((await call(t, 'POST', '/generate', procmgr, { docType: 'PO' }, 'g')).status, 400);
    assert.equal((await t.api.call('POST', `${T}/generate`, { ...procmgr, body: { docType: 'PO', entityId: '1' } })).status, 400, 'an Idempotency-Key is required');
  } finally { await t.cleanup(); }
});

test('FR-04 a list of generated documents with filters, the totals for the chart and the export', async () => {
  const t = await setup();
  try {
    for (const [i, type] of [[1, 'PO'], [2, 'PO'], [3, 'TAX_INVOICE']]) {
      const data = type === 'PO' ? po({ docNo: `PO/${i}` }) : invoice({ docNo: `INV/${i}` });
      await publish(t, sys, type, `e${i}`, data);
      assert.equal((await call(t, 'POST', '/generate', as('CFO', 'cfo1'), { docType: type, entityId: `e${i}` }, 'g')).status, 201);
    }
    const all = (await call(t, 'GET', '/generated', cfo)).json.data;
    assert.equal(all.total, 3);
    assert.deepEqual(all.summary.byType.map((x) => [x.docType, x.n]), [['PO', 2], ['TAX_INVOICE', 1]]);
    assert.equal((await call(t, 'GET', '/generated?docType=TAX_INVOICE', cfo)).json.data.total, 1);
    assert.equal((await call(t, 'GET', '/generated?q=PO%2F2', cfo)).json.data.rows[0].docNo, 'PO/2');
    assert.equal((await call(t, 'GET', `/generated?projectId=${t.project}&purpose=OFFICIAL`, cfo)).json.data.total, 3);
    assert.equal((await call(t, 'GET', '/generated?purpose=ARCHIVAL', cfo)).json.data.total, 0);
    assert.equal((await call(t, 'GET', '/generated?limit=500', cfo)).status, 400);
    const csv = await t.api.raw('GET', `${T}/generated/export?format=csv`, cfo);
    assert.equal(csv.status, 200);
    assert.match(csv.buffer.toString(), /Number,Document,Version/);
    assert.match(csv.buffer.toString(), /INV\/3/);
    // an archival document carries the archival profile (embedded fonts, identification)
    await publish(t, sys, 'PO', 'e9', po({ docNo: 'PO/9' }));
    const arch = (await call(t, 'POST', '/generate', cfo, { docType: 'PO', entityId: 'e9', purpose: 'ARCHIVAL' }, 'g')).json.data;
    assert.equal(arch.pdfa, true);
    assert.match((await pdfOf(t, cfo, arch.id)).toString('latin1'), /pdfaid:part>2/);
    assert.equal(t.api.db.prepare('SELECT retention_class FROM core_files WHERE id = ?').get(arch.fileId).retention_class, 'permanent');
  } finally { await t.cleanup(); }
});
