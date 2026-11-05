import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { signProviders } from '../src/server/modules/eng/signatures.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.12: digital signature and QR verification.
// T-01 a modified PDF fails the hash check; T-02 the public page shows no amount (or anything else) beyond the configured fields.
const S = '/api/v1/sig';
const V = '/api/v1/verify';
const T = '/api/v1/tpl';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 's') => ({ ...json, 'idempotency-key': `sg-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const sys = as('SYSADM', 'sys1');
const dir = as('DIR', 'dir1');
const pm = as('PM', 'pm1');
const acc = as('ACCMGR', 'acc1');
const aud = as('AUD', 'aud1');
const emp = as('EMP', 'emp1');
const hr = as('HRMGR', 'hr1');
const procmgr = as('PROCMGR', 'pm2');
const pub = { user: null, company: null };

const setup = async () => {
  const storage = mkdtempSync(join(tmpdir(), 'erp-sig-'));
  const api = await startApi({}, { storagePath: storage });
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  api.db.prepare("UPDATE org_companies SET legal_name = 'Main Infra Pvt Ltd' WHERE id = 1").run();
  for (const [n, r] of [['sys1', ['SYSADM']], ['dir1', ['DIR']], ['pm1', ['PM']], ['acc1', ['ACCMGR']], ['aud1', ['AUD']], ['emp1', ['EMP']], ['hr1', ['HRMGR']], ['pm2', ['PROCMGR']], ['pd1', ['PD']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n.toUpperCase(), JSON.stringify(r), `${n}@example.com`);
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')").run().lastInsertRowid);
  const runtime = runtimeOf(api.db);
  const drain = async () => { for (let i = 0; i < 6; i += 1) { runtime.bus.drain(); await runtime.jobs.drain(); } };
  return { api, project, runtime, drain, cleanup: async () => { await api.close(); rmSync(storage, { recursive: true, force: true }); } };
};
const call = (t, method, path, who, body, k) => t.api.call(method, path, { ...who, headers: key(k), body });
const textOf = async (buffer) => {
  const doc = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, verbosity: 0 }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i += 1) out += `${(await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ')}\n`;
  return out.replace(/\s+/g, ' ');
};
const po = (n = '0042') => ({ docNo: `PO/2026-27/${n}`, docDate: '2026-11-03', party: { name: 'Shree Cement Traders', gstin: '27AAACS1234A1Z5', address: 'Pune', stateCode: '27' }, supply: { stateCode: '27' }, lines: [{ description: 'OPC 53 cement', hsn: '2523', uom: 'Bag', qty: '1200', rate: '412.50', gstRate: '28' }] });
const generate = async (t, entityId = 'po-42', n = '0042', extra = {}) => {
  const r = await call(t, 'PUT', `${T}/records`, sys, { docType: 'PO', entityId, data: po(n), approved: true, projectId: t.project }, 'r');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const g = await call(t, 'POST', `${T}/generate`, procmgr, { docType: 'PO', entityId, ...extra }, 'g');
  assert.equal(g.status, 201, JSON.stringify(g.json));
  return g.json.data;
};
const pdfOf = async (t, who, id) => (await t.api.raw('GET', `${T}/generated/${id}/content`, who)).buffer;
const check = (t, code, buffer) => t.api.raw('POST', `${V}/${code}/file`, { ...pub, headers: { 'content-type': 'application/pdf' }, body: buffer });
const act = async (t, who, instanceId) => {
  const task = (await t.api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  assert.ok(task, `${who.user} has the task`);
  assert.equal((await t.api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action: 'approve', comment: 'ok' } })).status, 200);
};

test('T-01 BR-01 FR-02 AC-01 the QR code opens the check: a genuine document verifies, the signed copy verifies, and a file with one byte changed fails and is a security event', async () => {
  const t = await setup();
  try {
    const g = await generate(t);
    const pub1 = await t.api.call('GET', `${V}/${g.verifyCode}`, pub);
    assert.equal(pub1.status, 200, JSON.stringify(pub1.json));
    assert.equal(pub1.json.data.status, 'VALID');
    assert.equal(pub1.json.data.docNo, 'PO/2026-27/0042');
    assert.equal(pub1.json.data.issuer, 'Main Infra Pvt Ltd');
    assert.deepEqual(pub1.json.data.signers, []);
    // signing: the electronic approval by the project manager, then the picture of the accounts manager
    const s1 = await call(t, 'POST', `${S}/documents/${g.id}/sign`, pm, { method: 'APPROVAL', label: 'Project manager' }, 's1');
    assert.equal(s1.status, 201, JSON.stringify(s1.json));
    assert.equal((await call(t, 'POST', `${S}/documents/${g.id}/sign`, pm, { method: 'APPROVAL' }, 's1b')).status, 409, 'once');
    assert.equal((await call(t, 'POST', `${S}/documents/${g.id}/sign`, acc, { method: 'IMAGE' }, 's2')).status, 422, 'no picture yet');
    const png = await sharp({ create: { width: 220, height: 70, channels: 4, background: { r: 20, g: 40, b: 120, alpha: 1 } } }).png().toBuffer();
    assert.equal((await t.api.call('PUT', `${S}/profile`, { ...acc, headers: key('p'), body: { image: 'data:image/png;base64,not-a-picture' } })).status, 400);
    const put = await t.api.call('PUT', `${S}/profile`, { ...acc, headers: key('p'), body: { image: `data:image/png;base64,${png.toString('base64')}` } });
    assert.equal(put.status, 200, JSON.stringify(put.json));
    const s2 = await call(t, 'POST', `${S}/documents/${g.id}/sign`, acc, { method: 'IMAGE' }, 's2');
    assert.equal(s2.status, 201, JSON.stringify(s2.json));
    const d = s2.json.data;
    assert.equal(d.signatures.length, 2);
    assert.equal(d.chainIntact, true);
    assert.equal(d.signatures[0].digest.length, 64);
    assert.equal(d.copies.length, 2, 'a stamped copy for each state');
    // the original is untouched; the signed copy shows the signatures and is another file
    const original = await pdfOf(t, procmgr, g.id);
    assert.equal(original.length > 0 && (await import('node:crypto')).createHash('sha256').update(original).digest('hex'), g.hash);
    const signed = await t.api.raw('GET', `${S}/documents/${g.id}/signed`, acc);
    assert.equal(signed.status, 200);
    assert.equal(signed.headers.get('x-signed-copy'), '1');
    const text = await textOf(signed.buffer);
    assert.ok(text.includes('Signed copy') && text.includes('PM1') && text.includes('ACC1') && text.includes('Electronic approval') && text.includes('Signature image'), text);
    assert.notEqual((await import('node:crypto')).createHash('sha256').update(signed.buffer).digest('hex'), g.hash);
    // the check by file: the original and the signed copy match; one byte changed does not
    const m1 = (await check(t, g.verifyCode, original)).json.data;
    assert.deepEqual([m1.file.match, m1.file.kind], [true, 'original']);
    const m2 = (await check(t, g.verifyCode, signed.buffer)).json.data;
    assert.deepEqual([m2.file.match, m2.file.kind], [true, 'signed copy']);
    const bad = Buffer.from(original);
    bad[Math.floor(bad.length / 2)] ^= 0x01;
    const m3 = (await check(t, g.verifyCode, bad)).json.data;
    assert.equal(m3.file.match, false);
    assert.match(m3.file.message, /NOT the document/);
    assert.equal((await check(t, g.verifyCode, Buffer.concat([original, Buffer.from('\n')]))).json.data.file.match, false, 'an appended byte too');
    assert.equal((await t.api.raw('POST', `${V}/${g.verifyCode}/file`, { ...pub, headers: { 'content-type': 'application/pdf' }, body: Buffer.alloc(0) })).status, 400);
    assert.ok(t.api.db.prepare("SELECT 1 FROM core_security_events WHERE type = 'sig.tamper_detected'").get());
    const full = (await call(t, 'GET', `${S}/documents/${g.id}`, acc)).json.data;
    assert.equal(full.verifications.mismatches, 2);
    assert.ok(full.verifications.count >= 5);
    assert.equal((await t.api.call('GET', `${V}/ABCDEFGHJKLM`, pub)).json.data.found, false);
    assert.equal((await t.api.call('GET', `${V}/bad`, pub)).status, 400);
  } finally { await t.cleanup(); }
});

test('T-02 FR-03 the public page shows only the configured fields, never an amount unless the company chose it (and never for a payslip); the settings change by approval', async () => {
  const t = await setup();
  try {
    const g = await generate(t);
    await call(t, 'POST', `${S}/documents/${g.id}/sign`, pm, { method: 'APPROVAL' }, 's');
    const open = (await t.api.call('GET', `${V}/${g.verifyCode}`, pub)).json.data;
    assert.deepEqual(Object.keys(open).sort(), ['found', 'docNo', 'issuedAt', 'issuer', 'message', 'signers', 'status', 'type', 'valid', 'version'].sort());
    const flat = JSON.stringify(open);
    for (const secret of ['94,33', '19,04', 'Shree Cement', '27AAACS', 'Ring Road', '412', 'pm1@example.com', t.api.db.prepare('SELECT hash FROM tpl_generated_docs').get().hash]) assert.equal(flat.includes(secret), false, secret);
    assert.deepEqual(open.signers.map((s) => [s.name, s.method, s.status]), [['PM1', 'Electronic approval', 'Signed']]);
    assert.equal(open.signers[0].ip, undefined);
    // a change of the settings is maker-checker: the administrator proposes, a director approves, nothing changes before
    const bad = await call(t, 'POST', `${S}/config/changes`, sys, { publicFields: ['type', 'nonsense'], signApprovals: true, placements: {}, reason: 'Show more' }, 'c');
    assert.equal(bad.status, 400);
    assert.equal((await call(t, 'POST', `${S}/config/changes`, pm, { publicFields: ['type'], signApprovals: true, placements: {}, reason: 'Show more' }, 'c')).status, 403);
    const prop = await call(t, 'POST', `${S}/config/changes`, sys, { publicFields: ['type', 'docNo', 'issuer', 'version', 'issuedAt', 'status', 'signers', 'project', 'amount'], signApprovals: true, placements: { PO: { page: 'last', anchor: 'top', width: 140, height: 56, perRow: 3, margin: 30 } }, reason: 'Vendors want the amount on the check' }, 'c');
    assert.equal(prop.status, 202, JSON.stringify(prop.json));
    assert.equal((await call(t, 'POST', `${S}/config/changes`, sys, { publicFields: ['type'], signApprovals: true, placements: {}, reason: 'Second change' }, 'c2')).status, 409);
    assert.equal(Object.hasOwn((await t.api.call('GET', `${V}/${g.verifyCode}`, pub)).json.data, 'amount'), false, 'not before approval');
    assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, sys)).json.data.rows.find((x) => x.instance.id === prop.json.data.workflow.id), undefined, 'the maker cannot approve');
    await act(t, dir, prop.json.data.workflow.id);
    const after = (await t.api.call('GET', `${V}/${g.verifyCode}`, pub)).json.data;
    assert.match(after.amount, /^₹[\d,]+\.\d\d$/);
    assert.equal(after.project, 'Ring Road');
    assert.ok(t.api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'sig_config' AND action = 'activate'").get());
    assert.ok(t.api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'sig_config' AND action = 'propose'").get());
    // never the net pay of a payslip, whatever the settings
    const pay = { docNo: 'PAY/1', employee: { name: 'Sunil', code: 'E1' }, month: 'October 2026', lines: [{ label: 'Basic', amount: '38000' }], deductions: [{ label: 'PF', amount: '4560' }] };
    assert.equal((await call(t, 'PUT', `${T}/records`, sys, { docType: 'PAYSLIP', entityId: 'e1', data: pay, approved: true }, 'r')).status, 200);
    const ps = (await call(t, 'POST', `${T}/generate`, hr, { docType: 'PAYSLIP', entityId: 'e1' }, 'g')).json.data;
    const pv = (await t.api.call('GET', `${V}/${ps.verifyCode}`, pub)).json.data;
    assert.equal(Object.hasOwn(pv, 'amount'), false);
    assert.equal(JSON.stringify(pv).includes('33,440'), false);
    // the placement of the settings is used for the stamp
    await call(t, 'POST', `${S}/documents/${g.id}/sign`, acc, { method: 'APPROVAL' }, 's3');
    assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM sig_copies WHERE generated_doc_id = ?').get(g.id).n, 2);
  } finally { await t.cleanup(); }
});

test('BR-02 FR-04 a cancelled or superseded document verifies as such with its date; a revoked signature is shown and the stamp is redrawn; no more signatures after cancelling', async () => {
  const t = await setup();
  try {
    const g1 = await generate(t);
    const s = await call(t, 'POST', `${S}/documents/${g1.id}/sign`, pm, { method: 'APPROVAL' }, 's');
    const sigId = s.json.data.signatures[0].id;
    // a new version supersedes the first
    const g2 = (await call(t, 'POST', `${T}/generate`, procmgr, { docType: 'PO', entityId: 'po-42', reason: 'The rate was corrected' }, 'g2')).json.data;
    const sup = (await t.api.call('GET', `${V}/${g1.verifyCode}`, pub)).json.data;
    assert.equal(sup.status, 'SUPERSEDED');
    assert.match(sup.message, /^Superseded on \d\d-[A-Z][a-z]{2}-\d{4}\./);
    assert.equal(sup.valid, false);
    assert.equal((await call(t, 'POST', `${S}/documents/${g1.id}/sign`, acc, { method: 'APPROVAL' }, 'x')).status, 409, 'the old version cannot be signed');
    // revoking: only the system administrator; the verification shows it
    assert.equal((await call(t, 'POST', `${S}/signatures/${sigId}/revoke`, pm, { reason: 'Signed by mistake' }, 'v')).status, 403);
    assert.equal((await call(t, 'POST', `${S}/signatures/${sigId}/revoke`, sys, { reason: 'x' }, 'v')).status, 400);
    const copies = t.api.db.prepare('SELECT COUNT(*) AS n FROM sig_copies WHERE generated_doc_id = ?').get(g1.id).n;
    const rv = await call(t, 'POST', `${S}/signatures/${sigId}/revoke`, sys, { reason: 'Signed by mistake' }, 'v');
    assert.equal(rv.status, 200, JSON.stringify(rv.json));
    assert.equal(rv.json.data.signatures[0].status, 'REVOKED');
    assert.equal(rv.json.data.chainIntact, true);
    assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM sig_copies WHERE generated_doc_id = ?').get(g1.id).n, copies + 1);
    assert.equal((await call(t, 'POST', `${S}/signatures/${sigId}/revoke`, sys, { reason: 'Again please' }, 'v2')).status, 409);
    assert.equal((await t.api.call('GET', `${V}/${g1.verifyCode}`, pub)).json.data.signers[0].status, 'Revoked');
    assert.throws(() => t.api.db.prepare("UPDATE sig_signatures SET hash = 'x' WHERE id = ?").run(sigId), /cannot be changed/);
    assert.throws(() => t.api.db.prepare('DELETE FROM sig_signatures WHERE id = ?').run(sigId), /cannot be deleted/);
    // cancelling the current document
    assert.equal((await call(t, 'POST', `${S}/documents/${g2.id}/cancel`, acc, { reason: 'Order withdrawn' }, 'c')).status, 403);
    const c = await call(t, 'POST', `${S}/documents/${g2.id}/cancel`, pm, { reason: 'Order withdrawn' }, 'c');
    assert.equal(c.status, 200, JSON.stringify(c.json));
    assert.equal(c.json.data.status, 'CANCELLED');
    const cv = (await t.api.call('GET', `${V}/${g2.verifyCode}`, pub)).json.data;
    assert.equal(cv.status, 'CANCELLED');
    assert.match(cv.message, /^Cancelled on /);
    assert.equal((await call(t, 'POST', `${S}/documents/${g2.id}/sign`, acc, { method: 'APPROVAL' }, 'y')).status, 409);
    assert.equal((await call(t, 'POST', `${S}/documents/${g2.id}/cancel`, pm, { reason: 'Order withdrawn' }, 'c3')).status, 409);
    assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'sig.document.cancelled'").get());
    assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'sig.signature.revoked'").get());
    // the stored file itself was changed behind the system's back: the check says so
    const g3 = await generate(t, 'po-43', '0043');
    t.api.db.prepare("UPDATE core_files SET sha256 = 'tampered' WHERE id = ?").run(g3.fileId);
    assert.equal((await t.api.call('GET', `${V}/${g3.verifyCode}`, pub)).json.data.status, 'INVALID');
  } finally { await t.cleanup(); }
});

test('FR-01 AC-01 the approvals of the workflow become signatures with the time of each approval, and eSign or DSC need a provider', async () => {
  const t = await setup();
  try {
    assert.equal((await call(t, 'PUT', `/api/v1/tpl/rules`, sys, { workflowDocType: 'ENG_SAMPLE_DOC', docType: 'PO', enabled: true }, 'r')).status, 200);
    const made = await t.api.call('POST', '/api/v1/eng/sample-docs', { ...as('PD', 'pd1'), headers: key('m'), body: { title: 'Shuttering', amount: '12000.00', projectId: t.project } });
    const doc = made.json.data;
    assert.equal((await call(t, 'PUT', `${T}/records`, sys, { docType: 'PO', entityId: String(doc.id), data: po('0999'), approved: true, projectId: t.project }, 'r')).status, 200);
    const inst = (await t.api.call('POST', `/api/v1/eng/sample-docs/${doc.id}/submit`, { ...as('PD', 'pd1'), headers: key('s'), body: {} })).json.data.workflow.id;
    await act(t, pm, inst);
    await act(t, acc, inst);
    await t.drain();
    const g = t.api.db.prepare("SELECT * FROM tpl_generated_docs WHERE purpose = 'MILESTONE'").get();
    assert.ok(g, 'the milestone made the document');
    const sigs = t.api.db.prepare('SELECT signer_name, method, certificate_ref, workflow_instance_id, signed_at FROM sig_signatures WHERE generated_doc_id = ? ORDER BY id').all(g.id);
    assert.deepEqual(sigs.map((x) => [x.signer_name, x.method, x.workflow_instance_id]), [['pm1', 'APPROVAL', inst], ['acc1', 'APPROVAL', inst]]);
    assert.equal(sigs[0].certificate_ref, `workflow:${inst}`);
    assert.ok(sigs[0].signed_at < sigs[1].signed_at, 'in the order of the approvals');
    assert.ok(t.api.db.prepare('SELECT 1 FROM sig_copies WHERE generated_doc_id = ?').get(g.id), 'the stamped copy was made by the job');
    await t.drain();
    assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM sig_signatures WHERE generated_doc_id = ?').get(g.id).n, 2, 'once');
    const pubv = (await t.api.call('GET', `${V}/${g.verify_code}`, pub)).json.data;
    assert.deepEqual(pubv.signers.map((s) => s.name), ['PM1', 'ACC1']);
    // providers
    const full = (await call(t, 'GET', `${S}/documents/${g.id}`, pm)).json.data;
    assert.deepEqual(full.providers, { ESIGN: false, DSC: false });
    const none = await call(t, 'POST', `${S}/documents/${g.id}/sign`, hr, { method: 'DSC' }, 'd');
    assert.equal(none.status, 409);
    assert.match(none.json.error.message, /needs a provider/);
    signProviders.set('DSC', { sign: async ({ docHash }) => ({ certificateRef: `CN=HR One;serial=${docHash.slice(0, 6)}` }) });
    try {
      const ok = await call(t, 'POST', `${S}/documents/${g.id}/sign`, hr, { method: 'DSC' }, 'd2');
      assert.equal(ok.status, 201, JSON.stringify(ok.json));
      assert.match(ok.json.data.signatures.at(-1).certificateRef, /^CN=HR One/);
    } finally { signProviders.delete('DSC'); }
  } finally { await t.cleanup(); }
});

test('FR-04 AC-03 the register and the detail: who sees what, filters, summary, export; the detail by code for the signed-in', async () => {
  const t = await setup();
  try {
    const g = await generate(t);
    await call(t, 'POST', `${S}/documents/${g.id}/sign`, pm, { method: 'APPROVAL' }, 's1');
    await call(t, 'POST', `${S}/documents/${g.id}/sign`, acc, { method: 'APPROVAL' }, 's2');
    assert.equal((await call(t, 'GET', `${S}/register`, emp)).status, 403);
    assert.equal((await call(t, 'GET', `${S}/register`, acc)).status, 403, 'signing is not the register');
    for (const who of [aud, sys]) {
      const r = (await call(t, 'GET', `${S}/register`, who)).json.data;
      assert.equal(r.total, 2);
      assert.deepEqual(r.rows.map((x) => x.signer).sort(), ['acc1', 'pm1']);
      assert.equal(r.canRevoke, who === sys);
    }
    const f = (await call(t, 'GET', `${S}/register?signer=pm1&method=APPROVAL&status=SIGNED&q=PO%2F2026`, aud)).json.data;
    assert.equal(f.total, 1);
    assert.equal((await call(t, 'GET', `${S}/register?method=DSC`, aud)).json.data.total, 0);
    assert.equal((await call(t, 'GET', `${S}/register?limit=500`, aud)).status, 400);
    await t.api.call('GET', `${V}/${g.verifyCode}`, pub);
    const sum = (await call(t, 'GET', `${S}/register`, aud)).json.data.summary;
    assert.equal(sum.byMethod[0].n, 2);
    assert.ok(sum.checks >= 1);
    const csv = await t.api.raw('GET', `${S}/register/export?format=csv`, aud);
    assert.match(csv.buffer.toString(), /Number,Document,Version,Signer/);
    // the detail by code: a person who may see the document; not an employee, not the public
    const d = await call(t, 'GET', `${S}/verify/${g.verifyCode}`, pm);
    assert.equal(d.status, 200);
    assert.equal(d.json.data.hash, g.hash);
    assert.equal(d.json.data.signatures[0].ip === undefined, false);
    assert.equal((await call(t, 'GET', `${S}/verify/${g.verifyCode}`, emp)).status, 404);
    assert.equal((await t.api.call('GET', `${S}/verify/${g.verifyCode}`, pub)).status, 401);
    // a payslip's signatures are not in the register of someone without the pay right
    const pay = { docNo: 'PAY/1', employee: { name: 'Sunil', code: 'E1' }, month: 'October 2026', lines: [{ label: 'Basic', amount: '38000' }], deductions: [] };
    await call(t, 'PUT', `${T}/records`, sys, { docType: 'PAYSLIP', entityId: 'e1', data: pay, approved: true }, 'r');
    const ps = (await call(t, 'POST', `${T}/generate`, hr, { docType: 'PAYSLIP', entityId: 'e1' }, 'g')).json.data;
    assert.equal((await call(t, 'POST', `${S}/documents/${ps.id}/sign`, hr, { method: 'APPROVAL' }, 'p')).status, 201);
    assert.equal((await call(t, 'GET', `${S}/register?docType=PAYSLIP`, aud)).json.data.total, 0);
    assert.equal((await call(t, 'GET', `${S}/register?docType=PAYSLIP`, sys)).json.data.total, 0);
    assert.equal((await call(t, 'GET', `${S}/documents/${ps.id}`, acc)).status, 404);
  } finally { await t.cleanup(); }
});
