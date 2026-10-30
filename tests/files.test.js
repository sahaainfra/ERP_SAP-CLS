import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import '../src/server/modules/registry.js';
import { EICAR, TEST_VIRUS, createBuiltinScanner, createClamdScanner, parseClamdReply, runScanners } from '../src/server/platform/files/scan.js';
import { checkType, extensionOf, looksLikeText } from '../src/server/platform/files/types.js';
import { createLocalStorage } from '../src/server/platform/files/storage.js';
import { createSigner } from '../src/server/platform/files/signing.js';
import { readJpegExif, stripJpegMetadata, stripPngMetadata } from '../src/server/platform/files/exif.js';
import { createFileService } from '../src/server/modules/core/files/service.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { setupCompany, startApi } from './helpers.js';

const C = '/api/v1/core';
const key = (n) => ({ 'idempotency-key': `file-${n}-${Math.random().toString(36).slice(2, 10)}` });
const json = { 'content-type': 'application/json' };
const sys = { roles: 'SYSADM', user: 'sysadmin', company: '1' };
const itadm = { roles: 'ITADM', user: 'ishaan', company: '1' };
const pm = { roles: 'PM', user: 'pooja', company: '1' };
const dir = { roles: 'DIR', user: 'dinesh', company: '1' };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const pdf = (extra = '') => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${extra}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);

/** An API with its own storage folder, a company ready to number documents, and one draft sample document. */
async function setup({ company = '1' } = {}) {
  const storage = mkdtempSync(join(tmpdir(), 'erp-files-'));
  const api = await startApi({}, { storagePath: storage, logger: { info() {}, warn() {}, error: (e) => process.env.DEBUG_FILES && console.log('SERVER-ERROR', JSON.stringify(e).slice(0, 900)) } });
  await setupCompany(api, { company });
  const doc = (await api.call('POST', `${C}/sample-documents`, { ...pm, company, headers: { ...key('d'), ...json }, body: { title: 'Site memo', docDate: '2026-10-15' } })).json.data;
  const jobs = runtimeOf(api.db).jobs;
  const form = (buf, name, extra = {}) => {
    const fd = new FormData();
    fd.append('entity', 'sample_document');
    fd.append('entityId', String(extra.entityId ?? doc.id));
    for (const [k, v] of Object.entries(extra)) if (k !== 'entityId') fd.append(k, String(v));
    fd.append('file', new Blob([buf]), name);
    return fd;
  };
  const upload = (buf, name, extra = {}, who = pm) => api.raw('POST', `${C}/files`, { company, ...who, body: form(buf, name, extra) });
  const done = async () => (await jobs.drain(), undefined);
  const cleanup = async () => {
    await api.close();
    rmSync(storage, { recursive: true, force: true });
  };
  return { api, doc, storage, jobs, upload, done, cleanup, company };
}

const uploaded = async (t, buf, name, extra) => {
  const r = await t.upload(buf, name, extra);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  await t.done();
  return r.json.data;
};

// ---- type rules ----
test('FR-03 / T-02 the allow-list checks extension and content, and refuses programs whatever they are called', async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.deepEqual({ ...checkType('plan.PDF', pdf()) }, { ok: true, extension: 'pdf', mime: 'application/pdf', category: 'document', inline: true });
  assert.equal(checkType('photo.png', png).category, 'image');
  assert.match(checkType('photo.jpg', png).problem, /not a real \.jpg file/, 'a PNG called .jpg');
  assert.match(checkType('plan.pdf', png).problem, /not a real \.pdf file/);
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(0x3a), Buffer.from([0x80, 0, 0, 0]), Buffer.alloc(0x40), Buffer.from('PE\0\0'), Buffer.from('This program cannot be run in DOS mode.')]);
  assert.match(checkType('report.pdf', exe).problem, /a Windows program renamed to \.pdf/, 'T-02');
  assert.match(checkType('x.txt', Buffer.from('#!/bin/sh\nrm -rf /\n')).problem, /a script/);
  assert.match(checkType('x.pdf', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])).problem, /a Linux program/);
  assert.match(checkType('run.exe', exe).problem, /\.exe are not allowed/);
  assert.match(checkType('page.html', Buffer.from('<html>')).problem, /not allowed/);
  assert.match(checkType('noextension', pdf()).problem, /no extension/);
  assert.equal(checkType('MZ notes.txt', Buffer.from('MZ-101 site notes\nline two\n')).ok, true, 'text that merely starts with MZ is not a program');
  assert.equal(checkType('data.csv', Buffer.from('a,b\n1,2\n')).ok, true);
  assert.match(checkType('data.csv', Buffer.from([0, 1, 2, 3, 0, 0])).problem, /not a real \.csv/);
  assert.equal(checkType('gone.gif', Buffer.from('GIF89a....'), ['png']).ok, false, 'a type the company switched off');
  assert.equal(checkType('drawing.dwg', Buffer.from('AC1032\0\0\0')).category, 'drawing');
  assert.equal(checkType('walk.mp4', Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])).category, 'video');
  assert.equal(checkType('sheet.xlsx', Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from('....[Content_Types].xml')])).ok, true);
  assert.equal(extensionOf('a.b.TXT'), 'txt');
  assert.equal(looksLikeText(Buffer.alloc(0)), false);
});

test('the storage adapter keeps every key inside its folder', async () => {
  const root = mkdtempSync(join(tmpdir(), 'erp-store-'));
  try {
    const s = createLocalStorage({ root });
    await s.putBuffer('c1/2026/10/a.bin', Buffer.from('hello'));
    assert.equal(await s.size('c1/2026/10/a.bin'), 5);
    await s.move('c1/2026/10/a.bin', 'quarantine/c1/a.bin');
    assert.equal(await s.size('c1/2026/10/a.bin'), null);
    assert.equal(Buffer.concat(await Array.fromAsync(s.createReadStream('quarantine/c1/a.bin', { start: 1, end: 3 }))).toString(), 'ell');
    await s.remove('quarantine/c1/a.bin');
    assert.equal(await s.size('quarantine/c1/a.bin'), null);
    for (const bad of ['../outside', 'c1/../../x', '/etc/passwd', 'c1//x', 'c:\\x', '']) await assert.rejects(() => s.putBuffer(bad, Buffer.from('x')), /Invalid storage key/, bad);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('signed links cover the file, expiry, variant and disposition, and expire', () => {
  let t = 1_000_000_000_000;
  const signer = createSigner('s'.repeat(40), () => t);
  const link = signer.sign({ id: 7, ttlSeconds: 120 });
  assert.equal(signer.check({ id: 7, ...link }), null);
  assert.equal(signer.check({ id: 8, ...link }), 'invalid', 'another file');
  assert.equal(signer.check({ id: 7, ...link, d: 'attachment' }), 'invalid', 'another disposition');
  assert.equal(signer.check({ id: 7, ...link, v: 'thumbnail' }), 'invalid', 'another variant');
  assert.equal(signer.check({ id: 7, ...link, exp: link.exp + 600 }), 'invalid', 'a longer life');
  assert.equal(signer.check({ id: 7, ...link, sig: 'x' }), 'invalid');
  assert.equal(signer.check({ id: 7, exp: 'abc', v: 'file', d: 'inline', sig: 'x' }), 'invalid');
  t += 119_000;
  assert.equal(signer.check({ id: 7, ...link }), null, 'still valid just before the end');
  t += 2_000;
  assert.equal(signer.check({ id: 7, ...link }), 'expired');
});

test('FR-04 photo metadata: time and position are read, and everything else can be stripped', async () => {
  const jpg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } })
    .withExif({ IFD0: { Make: 'TestCam', Model: 'T1' }, IFD2: { DateTimeOriginal: '2026:10:30 10:15:00' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '12/1 58/1 30/1', GPSLongitudeRef: 'E', GPSLongitude: '77/1 36/1 0/1' } })
    .jpeg()
    .toBuffer();
  assert.deepEqual({ ...readJpegExif(jpg), orientation: null }, { capturedAt: '2026-10-30T10:15:00', gps: { lat: -12.975, lon: 77.6 }, orientation: null });
  assert.ok(jpg.includes('TestCam'));
  const stripped = stripJpegMetadata(jpg);
  assert.ok(!stripped.includes('TestCam') && readJpegExif(stripped) === null);
  assert.deepEqual((await sharp(stripped).metadata()).width, 64, 'the picture still opens');
  assert.equal(readJpegExif(Buffer.from('not a jpeg')), null);
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } }).png().toBuffer();
  assert.equal((await sharp(stripPngMetadata(png)).metadata()).width, 4);
});

// ---- scanners ----
test('FR-03 the built-in scanner finds the EICAR test string anywhere, even across read boundaries', async () => {
  const s = createBuiltinScanner();
  const open = (...parts) => () => (async function* () { yield* parts.map((p) => Buffer.from(p)); })();
  assert.deepEqual(await s.scan(open('hello ', EICAR, ' world')), { status: 'INFECTED', detail: 'Eicar-Test-Signature' });
  assert.equal((await s.scan(open(EICAR.slice(0, 20), EICAR.slice(20)))).status, 'INFECTED', 'split across two chunks');
  assert.deepEqual(await s.scan(open('x', TEST_VIRUS)), { status: 'INFECTED', detail: 'ERP-Test-Signature' });
  assert.equal((await s.scan(open('perfectly ordinary', ' text'))).status, 'CLEAN');
  assert.equal((await runScanners([s, { name: 'x', scan: async () => ({ status: 'CLEAN' }) }], open('fine'))).status, 'CLEAN');
  await assert.rejects(() => runScanners([{ name: 'broken', scan: async () => { throw new Error('down'); } }], open('x')), /down/);
});

test('the ClamAV scanner speaks the clamd protocol and reports its verdict or failure', async () => {
  assert.deepEqual(parseClamdReply('stream: OK\0'), { status: 'CLEAN', detail: null });
  assert.deepEqual(parseClamdReply('stream: Win.Test.EICAR_HDB-1 FOUND\0'), { status: 'INFECTED', detail: 'Win.Test.EICAR_HDB-1' });
  assert.throws(() => parseClamdReply('INSTREAM size limit exceeded. ERROR\0'), /could not scan/);
  const fake = (verdict) => new Promise((resolve) => {
    const received = [];
    const server = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        received.push(d);
        if (buf.subarray(-4).equals(Buffer.alloc(4)) && buf.includes('zINSTREAM')) sock.end(`${verdict}\0`);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received }));
  });
  const open = () => (async function* () { yield Buffer.from('some file bytes'); })();
  const ok = await fake('stream: OK');
  assert.equal((await createClamdScanner({ host: '127.0.0.1', port: ok.port }).scan(open)).status, 'CLEAN');
  assert.ok(Buffer.concat(ok.received).includes('zINSTREAM'));
  assert.ok(Buffer.concat(ok.received).includes('some file bytes'), 'the bytes were streamed to the daemon');
  ok.server.close();
  const bad = await fake('stream: Eicar-Signature FOUND');
  assert.deepEqual(await createClamdScanner({ host: '127.0.0.1', port: bad.port }).scan(open), { status: 'INFECTED', detail: 'Eicar-Signature' });
  bad.server.close();
  await assert.rejects(() => createClamdScanner({ host: '127.0.0.1', port: 1, timeoutMs: 500 }).scan(open), /not reachable/);
});

// ---- upload, scan, download ----
test('AC-01 / AC-02 a PDF is stored, scanned, and opened through a short-lived signed link that streams, honours ranges and is tamper-proof', async () => {
  const t = await setup();
  try {
    const body = pdf('x'.repeat(5000));
    const r = await t.upload(body, 'Site Memo.pdf');
    assert.equal(r.status, 201);
    const f = r.json.data;
    assert.deepEqual([f.scanStatus, f.mime, f.category, f.versionNo, f.sha256, f.sizeBytes, f.uploadedBy, f.retentionClass], ['PENDING', 'application/pdf', 'document', 1, sha(body), body.length, 'pooja', 'standard']);
    assert.ok(!JSON.stringify(f).includes('c1/'), 'the storage key never reaches the client');

    const early = await t.api.call('GET', `${C}/files/${f.id}/url`, pm);
    assert.equal(early.status, 409, 'BR-01: not downloadable before the scan');
    assert.equal(early.json.error.code, 'FILE_NOT_AVAILABLE');
    await t.done();
    const meta = (await t.api.call('GET', `${C}/files/${f.id}`, pm)).json.data;
    assert.deepEqual([meta.scanStatus, meta.locked], ['CLEAN', false]);

    const link = (await t.api.call('GET', `${C}/files/${f.id}/url`, pm)).json.data;
    assert.match(link.url, /^\/api\/v1\/core\/files\/\d+\/content\?exp=\d+&v=file&d=inline&sig=/);
    assert.equal(link.disposition, 'inline');
    const ttl = Date.parse(link.expiresAt) - Date.now();
    assert.ok(ttl > 100_000 && ttl <= 121_000, `the link lasts about 120 s, not ${ttl} ms`);
    const dl = await t.api.raw('GET', link.url, { user: null, company: '' }); // no sign-in: the link is the proof
    assert.equal(dl.status, 200);
    assert.deepEqual(dl.buffer, body);
    assert.equal(dl.headers.get('content-type'), 'application/pdf');
    assert.match(dl.headers.get('content-disposition'), /^inline; filename="Site Memo.pdf"/);
    assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(dl.headers.get('cache-control'), 'private, no-store');
    assert.match(dl.headers.get('content-security-policy'), /sandbox/);

    const part = await t.api.raw('GET', link.url, { user: null, company: '', headers: { range: 'bytes=5-14' } });
    assert.equal(part.status, 206);
    assert.deepEqual([part.buffer.toString(), part.headers.get('content-range')], [body.subarray(5, 15).toString(), `bytes 5-14/${body.length}`]);
    assert.equal((await t.api.raw('GET', link.url, { user: null, company: '', headers: { range: 'bytes=999999-' } })).status, 416);
    assert.equal((await t.api.raw('GET', link.url, { user: null, company: '', headers: { range: 'bytes=-4' } })).buffer.toString(), body.subarray(-4).toString());

    for (const tamper of [link.url.replace(/exp=\d+/, 'exp=99999999999'), link.url.replace('d=inline', 'd=attachment'), link.url.replace(/sig=.*/, 'sig=abc'), link.url.replace('/files/1/', '/files/2/')]) {
      const x = await t.api.raw('GET', tamper, { user: null, company: '' });
      assert.ok([403, 404].includes(x.status), `${tamper} -> ${x.status}`);
    }
    const dlAs = await t.api.call('GET', `${C}/files/${f.id}/url?download=true`, pm);
    assert.equal(dlAs.json.data.disposition, 'attachment');
    assert.equal((await t.api.call('GET', `${C}/files/${f.id}/url?variant=thumbnail`, pm)).status, 404, 'a PDF has no thumbnail');

    const events = t.api.db.prepare("SELECT event_type FROM core_outbox WHERE event_type LIKE 'core.file.%' ORDER BY id").all().map((e) => e.event_type);
    assert.deepEqual(events, ['core.file.uploaded', 'core.file.available']);
    const audit = t.api.db.prepare("SELECT action FROM core_audit_log WHERE entity = 'core_files' ORDER BY id").all().map((a) => a.action);
    assert.deepEqual(audit, ['upload', 'download_link', 'download_link']);
  } finally {
    await t.cleanup();
  }
});

test('FR-05 an image gets a thumbnail and the link for it serves a small WebP', async () => {
  const t = await setup();
  try {
    const big = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#aa5522' } }).jpeg().toBuffer();
    const f = await uploaded(t, big, 'site.jpg');
    const meta = (await t.api.call('GET', `${C}/files/${f.id}`, pm)).json.data;
    assert.deepEqual([meta.scanStatus, meta.hasThumbnail, meta.category], ['CLEAN', true, 'image']);
    const link = (await t.api.call('GET', `${C}/files/${f.id}/url?variant=thumbnail`, pm)).json.data;
    const thumb = await t.api.raw('GET', link.url, { user: null, company: '' });
    assert.equal(thumb.headers.get('content-type'), 'image/webp');
    const info = await sharp(thumb.buffer).metadata();
    assert.deepEqual([info.format, Math.max(info.width, info.height)], ['webp', 256]);
    assert.ok(thumb.buffer.length < big.length);
  } finally {
    await t.cleanup();
  }
});

test('T-01 an anti-virus test file is quarantined and is not downloadable (the harmless ERP test string; EICAR itself is covered in memory because a real anti-virus deletes it on disk)', async () => {
  const t = await setup();
  try {
    const r = await t.upload(Buffer.from(`quarterly notes
${TEST_VIRUS}
`), 'notes.txt');
    assert.equal(r.status, 201, 'a text file passes the type check');
    const id = r.json.data.id;
    await t.done();
    const meta = (await t.api.call('GET', `${C}/files/${id}`, pm)).json.data;
    assert.deepEqual([meta.scanStatus, meta.scanDetail], ['INFECTED', 'ERP-Test-Signature (builtin)']);
    const url = await t.api.call('GET', `${C}/files/${id}/url`, pm);
    assert.equal(url.status, 409);
    assert.match(url.json.error.message, /quarantined/);
    assert.equal((await t.api.call('GET', `${C}/files/${id}/url?download=true`, sys)).status, 409, 'not even an administrator');
    const row = t.api.db.prepare('SELECT storage_key FROM core_files WHERE id = ?').get(id);
    assert.match(row.storage_key, /^quarantine\/c1\//);
    assert.ok(existsSync(join(t.storage, 'files', row.storage_key)), 'the file is kept, apart, for review');
    assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.file.quarantined'").get().n, 1);
    const overview = (await t.api.call('GET', `${C}/files/overview`, sys)).json.data;
    assert.equal(overview.statuses.INFECTED.files, 1);
    assert.equal(overview.attention[0].name, 'notes.txt');
    assert.equal((await t.api.call('POST', `${C}/files/${id}/rescan`, { ...sys, headers: { ...key(1), ...json }, body: {} })).status, 422, 'a quarantined file cannot be scanned again');
  } finally {
    await t.cleanup();
  }
});

test('T-02 a renamed executable and other bad uploads are rejected and leave nothing behind', async () => {
  const t = await setup();
  try {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(0x3a), Buffer.from([0x80, 0, 0, 0]), Buffer.alloc(0x40), Buffer.from('PE\0\0'), Buffer.from('This program cannot be run in DOS mode.')]);
    const bad = await t.upload(exe, 'invoice.pdf');
    assert.equal(bad.status, 422);
    assert.equal(bad.json.error.code, 'FILE_REJECTED');
    assert.match(bad.json.error.message, /Windows program renamed to \.pdf/);
    assert.equal((await t.upload(Buffer.from('plain text'), 'invoice.pdf')).status, 422, 'text called pdf');
    assert.equal((await t.upload(Buffer.alloc(0), 'empty.pdf')).status, 422);
    assert.equal((await t.upload(pdf(), 'setup.exe')).status, 422);
    assert.equal((await t.upload(pdf(), 'noext')).status, 422);
    assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM core_files').get().n, 0);
    const left = existsSync(join(t.storage, 'files', '_uploads')) ? readdirSync(join(t.storage, 'files', '_uploads')) : [];
    assert.deepEqual(left, [], 'no temporary file is left');
    assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.file.uploaded'").get().n, 0);
  } finally {
    await t.cleanup();
  }
});

// ---- permissions ----
test('T-03 / AC-05 access to a file is access to its record: no view permission, 403; another company, 404; no sign-in, 401', async () => {
  const t = await setup();
  try {
    const f = await uploaded(t, pdf('a'), 'memo.pdf');
    for (const path of [`/files/${f.id}`, `/files/${f.id}/url`, `/files?entity=sample_document&entityId=${t.doc.id}`]) {
      assert.equal((await t.api.call('GET', C + path, dir)).status, 403, `DIR (no sample-document permission) ${path}`);
      assert.equal((await t.api.call('GET', C + path, { ...pm, company: '2' })).status, 404, `another company ${path}`);
      assert.equal((await t.api.call('GET', C + path, { user: null })).status, 401, `anonymous ${path}`);
      assert.equal((await t.api.call('GET', C + path, pm)).status, 200, `PM ${path}`);
    }
    assert.equal((await t.upload(pdf('b'), 'other.pdf', {}, dir)).status, 403, 'attaching needs edit permission on the record');
    assert.equal((await t.upload(pdf('c'), 'other.pdf', {}, { ...pm, company: '2' })).status, 404);
    assert.equal((await t.api.call('DELETE', `${C}/files/${f.id}`, { ...dir, body: {} })).status, 403);
    assert.equal((await t.api.call('DELETE', `${C}/files/${f.id}`, { ...pm, company: '2', body: {} })).status, 404);
    const unknown = await t.upload(pdf('d'), 'x.pdf', { entityId: 99999 });
    assert.equal(unknown.status, 404, 'a record that does not exist');
    const wrong = new FormData();
    wrong.append('entity', 'invoice');
    wrong.append('entityId', '1');
    wrong.append('file', new Blob([pdf()]), 'x.pdf');
    assert.equal((await t.api.raw('POST', `${C}/files`, { ...pm, body: wrong })).status, 422, 'a kind of record nobody registered');
    assert.equal((await t.api.call('GET', `${C}/files?entity=sample_document`, pm)).status, 400);
  } finally {
    await t.cleanup();
  }
});

test('administration is for ITADM and SYSADM only', async () => {
  const t = await setup();
  try {
    for (const path of ['/files/settings', '/files/overview', '/files/admin']) {
      assert.equal((await t.api.call('GET', C + path, sys)).status, 200, `SYSADM ${path}`);
      assert.equal((await t.api.call('GET', C + path, itadm)).status, 200, `ITADM ${path}`);
      assert.equal((await t.api.call('GET', C + path, pm)).status, 403, `PM ${path}`);
    }
  } finally {
    await t.cleanup();
  }
});

// ---- duplicates, versions, deletion ----
test('FR-07 / BR-03 duplicates are refused, versions supersede, and a locked record keeps its files', async () => {
  const t = await setup();
  try {
    const v1 = await uploaded(t, pdf('first'), 'plan.pdf');
    const dup = await t.upload(pdf('first'), 'plan copy.pdf');
    assert.equal(dup.status, 409);
    assert.equal(dup.json.error.code, 'DUPLICATE_FILE');
    assert.match(dup.json.error.message, new RegExp(`file ${v1.id}`));
    const same = await t.upload(pdf('first'), 'plan.pdf', { supersedesId: v1.id });
    assert.equal(same.status, 409, 'a "new version" with identical content is still a duplicate');

    const v2 = (await t.upload(pdf('second'), 'plan v2.pdf', { supersedesId: v1.id })).json.data;
    assert.deepEqual([v2.versionNo, v2.supersedesId], [2, v1.id]);
    assert.equal((await t.upload(pdf('third'), 'plan v3.pdf', { supersedesId: v1.id })).status, 409, 'v1 already has a newer version');
    assert.equal((await t.upload(pdf('x'), 'plan.pdf', { supersedesId: 99999 })).status, 422);
    await t.done();
    const list = (await t.api.call('GET', `${C}/files?entity=sample_document&entityId=${t.doc.id}`, pm)).json.data;
    assert.deepEqual(list.map((f) => [f.id, f.current, f.versionNo]), [[v2.id, true, 2], [v1.id, false, 1]]);

    const submitted = await t.api.call('POST', `${C}/sample-documents/${t.doc.id}/submit`, { ...pm, headers: { ...key('s'), ...json }, body: { version: t.doc.version } });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
    const locked = await t.api.call('DELETE', `${C}/files/${v2.id}`, { ...pm, body: {} });
    assert.equal(locked.status, 422, 'BR-03');
    assert.match(locked.json.error.message, /Upload a new version/);
    const v3 = await t.upload(pdf('third'), 'plan v3.pdf', { supersedesId: v2.id });
    assert.equal(v3.status, 201, 'a locked record can still be superseded');
    assert.equal(v3.json.data.versionNo, 3);
    assert.equal((await t.api.call('GET', `${C}/files/${v3.json.data.id}`, pm)).json.data.locked, true);
  } finally {
    await t.cleanup();
  }
});

test('BR-03 deleting is a soft delete: the row stays, the file disappears from the record, and the same content can be attached again', async () => {
  const t = await setup();
  try {
    const f = await uploaded(t, pdf('removable'), 'temp.pdf');
    const del = await t.api.call('DELETE', `${C}/files/${f.id}`, { ...pm, headers: json, body: { reason: 'attached to the wrong memo' } });
    assert.deepEqual(del.json.data, { id: f.id, deleted: true });
    const row = t.api.db.prepare('SELECT is_active, deleted_by FROM core_files WHERE id = ?').get(f.id);
    assert.deepEqual({ ...row }, { is_active: 0, deleted_by: 'pooja' });
    assert.equal((await t.api.call('GET', `${C}/files/${f.id}`, pm)).status, 404);
    assert.deepEqual((await t.api.call('GET', `${C}/files?entity=sample_document&entityId=${t.doc.id}`, pm)).json.data, []);
    assert.equal((await t.upload(pdf('removable'), 'again.pdf')).status, 201);
    const audit = t.api.db.prepare("SELECT reason FROM core_audit_log WHERE entity = 'core_files' AND action = 'delete'").get();
    assert.equal(audit.reason, 'attached to the wrong memo');
    assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.file.deleted'").get().n, 1);
  } finally {
    await t.cleanup();
  }
});

test('FR-04 photo time and position are recorded; stripping on request removes the rest from the stored file', async () => {
  const t = await setup();
  try {
    const jpg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } })
      .withExif({ IFD0: { Make: 'TestCam', Model: 'T1' }, IFD2: { DateTimeOriginal: '2026:10:30 10:15:00' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '12/1 58/1 30/1', GPSLongitudeRef: 'E', GPSLongitude: '77/1 36/1 0/1' } })
      .jpeg()
      .toBuffer();
    const kept = await uploaded(t, jpg, 'camera.jpg');
    assert.deepEqual([kept.exif.capturedAt, kept.exif.gps, kept.exifStripped], ['2026-10-30T10:15:00', { lat: 12.975, lon: 77.6 }, false]);
    const link = (await t.api.call('GET', `${C}/files/${kept.id}/url`, pm)).json.data;
    assert.ok((await t.api.raw('GET', link.url, { user: null, company: '' })).buffer.includes('TestCam'), 'kept as uploaded');

    const other = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336698' } })
      .withExif({ IFD0: { Make: 'TestCam', Model: 'T1' }, IFD2: { DateTimeOriginal: '2026:10:30 10:15:00' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '12/1 58/1 30/1', GPSLongitudeRef: 'E', GPSLongitude: '77/1 36/1 0/1' } })
      .jpeg()
      .toBuffer();
    const clean = await uploaded(t, other, 'camera2.jpg', { stripExif: true });
    assert.equal(clean.exifStripped, true);
    assert.equal(clean.exif.gps.lat, 12.975, 'the record still knows when and where');
    const link2 = (await t.api.call('GET', `${C}/files/${clean.id}/url`, pm)).json.data;
    const stored = (await t.api.raw('GET', link2.url, { user: null, company: '' })).buffer;
    assert.ok(!stored.includes('TestCam') && readJpegExif(stored) === null, 'the stored file carries no camera or position data');
    assert.equal(clean.sizeBytes, stored.length);
    assert.equal(clean.sha256, sha(stored), 'the checksum is of what is stored');
  } finally {
    await t.cleanup();
  }
});

// ---- resumable uploads ----
test('T-04 / FR-02 a resumable upload continues after the connection drops', async () => {
  const t = await setup();
  try {
    const body = Buffer.concat([pdf('big'), randomBytes(600_000)]);
    const begin = await t.api.call('POST', `${C}/files/uploads`, { ...pm, headers: { ...key('u'), ...json }, body: { fileName: 'drawing set.pdf', size: body.length, entity: 'sample_document', entityId: t.doc.id } });
    assert.equal(begin.status, 201);
    const up = begin.json.data;
    assert.deepEqual([up.received, up.chunkSize, up.status], [0, 4 * 1024 * 1024, 'OPEN']);
    const put = (offset, buf, who = pm) => t.api.raw('PUT', `${C}/files/uploads/${up.uploadId}?offset=${offset}`, { ...who, headers: { 'content-type': 'application/octet-stream' }, body: buf });

    const first = await put(0, body.subarray(0, 200_000));
    assert.equal(first.json.data.received, 200_000);

    // The second chunk starts and the connection dies half way through.
    await new Promise((resolve) => {
      const url = new URL(t.api.base);
      const req = http.request({ host: url.hostname, port: url.port, method: 'PUT', path: `${C}/files/uploads/${up.uploadId}?offset=200000`, headers: { 'content-type': 'application/octet-stream', 'content-length': '300000', 'x-erp-user': 'pooja', 'x-erp-roles': 'PM', 'x-erp-company': '1' } });
      req.on('error', resolve);
      req.write(body.subarray(200_000, 260_000), () => setTimeout(() => { req.destroy(); resolve(); }, 50));
    });
    await new Promise((r) => setTimeout(r, 150));
    const status = (await t.api.call('GET', `${C}/files/uploads/${up.uploadId}`, pm)).json.data;
    assert.equal(status.received, 200_000, 'the half chunk counts for nothing');

    const wrongOffset = await put(300_000, body.subarray(300_000, 350_000));
    assert.equal(wrongOffset.status, 409);
    assert.match(wrongOffset.json.error.message, /Resume from 200000/);
    const early = await t.api.call('POST', `${C}/files/uploads/${up.uploadId}/complete`, { ...pm, headers: { ...key('c'), ...json }, body: {} });
    assert.equal(early.status, 409, 'cannot complete with bytes missing');

    const resumed = await put(status.received, body.subarray(status.received, 450_000));
    assert.equal(resumed.json.data.received, 450_000);
    assert.equal((await put(450_000, body.subarray(450_000))).json.data.received, body.length);
    assert.equal((await put(body.length, Buffer.from('x'))).status, 422, 'more than was declared');
    const stranger = await t.api.raw('PUT', `${C}/files/uploads/${up.uploadId}?offset=0`, { ...sys, headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('x') });
    assert.equal(stranger.status, 404, 'only the user who started it can continue it');

    const complete = await t.api.call('POST', `${C}/files/uploads/${up.uploadId}/complete`, { ...pm, headers: { ...key('c2'), ...json }, body: {} });
    assert.equal(complete.status, 201, JSON.stringify(complete.json));
    assert.deepEqual([complete.json.data.sha256, complete.json.data.sizeBytes], [sha(body), body.length], 'the assembled file is byte-for-byte what was sent');
    const again = await t.api.call('POST', `${C}/files/uploads/${up.uploadId}/complete`, { ...pm, headers: { ...key('c3'), ...json }, body: {} });
    assert.equal(again.json.data.id, complete.json.data.id, 'completing twice returns the same file');
    await t.done();
    assert.equal((await t.api.call('GET', `${C}/files/${complete.json.data.id}`, pm)).json.data.scanStatus, 'CLEAN');
  } finally {
    await t.cleanup();
  }
});

test('a resumable upload is refused early for a bad type or size, and expired sessions are cleaned up', async () => {
  const t = await setup();
  try {
    const begin = (body) => t.api.call('POST', `${C}/files/uploads`, { ...pm, headers: { ...key('b'), ...json }, body: { entity: 'sample_document', entityId: t.doc.id, ...body } });
    assert.equal((await begin({ fileName: 'tool.exe', size: 100 })).status, 422);
    assert.equal((await begin({ fileName: 'huge.pdf', size: 51 * 1024 * 1024 })).status, 422, 'over the 50 MB document limit');
    assert.equal((await begin({ fileName: 'a/b.pdf', size: 100 })).status, 400, 'no path in a file name');
    assert.equal((await begin({ fileName: 'ok.pdf', size: 0 })).status, 400);
    const ok = (await begin({ fileName: 'ok.pdf', size: 100 })).json.data;
    t.api.db.prepare("UPDATE core_file_uploads SET expires_at = '2020-01-01T00:00:00.000Z' WHERE upload_id = ?").run(ok.uploadId);
    const expired = await t.api.raw('PUT', `${C}/files/uploads/${ok.uploadId}?offset=0`, { ...pm, headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('x') });
    assert.equal(expired.status, 422);
    const out = await runtimeOf(t.api.db).jobs.enqueue('core.file_upload_cleanup', {});
    await t.done();
    assert.equal(runtimeOf(t.api.db).jobs.get(out.id).result.aborted, 1);
    assert.equal(t.api.db.prepare('SELECT status FROM core_file_uploads WHERE upload_id = ?').get(ok.uploadId).status, 'ABORTED');
    assert.ok(!existsSync(join(t.storage, 'files', '_uploads', ok.uploadId)), 'its temporary file is gone');
  } finally {
    await t.cleanup();
  }
});

// ---- settings: maker-checker ----
test('AC-06 file settings change only after approval: SYSADM asks, ITADM decides, then limits and types apply and the link life changes', async () => {
  const t = await setup();
  try {
    const ask = (who, body, n) => t.api.call('POST', `${C}/files/settings/change-requests`, { ...who, headers: { ...key(n), ...json }, body });
    assert.equal((await ask(itadm, { changes: { urlTtlSeconds: 30 }, reason: 'shorter links' }, 1)).status, 403, 'only SYSADM configures');
    assert.equal((await ask(sys, { changes: { maxSizeMb: { document: 0 } }, reason: 'too small' }, 2)).status, 400);
    assert.equal((await ask(sys, { changes: { allowedExtensions: ['nope'] }, reason: 'unknown type' }, 3)).status, 400);
    assert.equal((await ask(sys, { changes: { urlTtlSeconds: 120 }, reason: 'the same value' }, 4)).status, 422);
    assert.equal((await ask(sys, {}, 5)).status, 400);
    const req = await ask(sys, { changes: { urlTtlSeconds: 30, maxSizeMb: { document: 1 }, allowedExtensions: ['pdf', 'png', 'jpg', 'txt'], retention: { document: 'statutory' } }, reason: 'tighten file handling' }, 6);
    assert.equal(req.status, 201);
    assert.equal((await ask(sys, { changes: { urlTtlSeconds: 60 }, reason: 'a second request' }, 7)).status, 409, 'one open request');
    assert.equal((await t.api.call('GET', `${C}/files/settings`, sys)).json.data.settings.urlTtlSeconds, 120, 'nothing changes before approval');

    const act = (who, n) => t.api.call('POST', `${C}/change-requests/${req.json.data.id}/act`, { ...who, headers: { ...key(n), ...json }, body: { action: 'approve', comment: 'ok' } });
    assert.equal((await act(sys, 8)).status, 403, 'the requester cannot approve');
    assert.equal((await act(itadm, 9)).status, 200);
    const settings = (await t.api.call('GET', `${C}/files/settings`, itadm)).json.data;
    assert.deepEqual([settings.settings.urlTtlSeconds, settings.settings.maxSizeMb.document, settings.settings.maxSizeMb.image, settings.settings.retention.document, settings.custom, settings.version], [30, 1, 20, 'statutory', true, 1]);

    assert.equal((await t.upload(Buffer.from('GIF89a......'), 'anim.gif')).status, 422, 'gif is no longer allowed');
    const big = await t.upload(Buffer.concat([pdf(), Buffer.alloc(1_100_000, 0x20)]), 'large.pdf');
    assert.equal(big.status, 422);
    assert.match(big.json.error.message, /limit for document files is 1 MB/);
    const f = await uploaded(t, pdf('small'), 'small.pdf');
    assert.equal(f.retentionClass, 'statutory');
    const link = (await t.api.call('GET', `${C}/files/${f.id}/url`, pm)).json.data;
    const ttl = Date.parse(link.expiresAt) - Date.now();
    assert.ok(ttl > 25_000 && ttl <= 31_000, `link life is now 30 s, not ${ttl} ms`);
    assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'core_file_settings' AND action = 'change_approved'").get().n, 1);
    assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.file_settings.changed'").get().n, 1);
  } finally {
    await t.cleanup();
  }
});

test('a file larger than the biggest limit is refused while it streams in', async () => {
  const t = await setup();
  try {
    t.api.db.prepare("INSERT INTO core_file_settings (company_id, settings_json) VALUES (1, ?)").run(JSON.stringify({ allowedExtensions: ['pdf'], maxSizeMb: { image: 1, document: 1, drawing: 1, video: 1 }, retention: { image: 'standard', document: 'standard', drawing: 'permanent', video: 'short' }, urlTtlSeconds: 120 }));
    const r = await t.upload(Buffer.concat([pdf(), Buffer.alloc(1_500_000, 0x20)]), 'large.pdf');
    assert.equal(r.status, 413);
    assert.equal(r.json.error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM core_files').get().n, 0);
    const none = new FormData();
    none.append('entity', 'sample_document');
    none.append('entityId', String(t.doc.id));
    assert.equal((await t.api.raw('POST', `${C}/files`, { ...pm, body: none })).status, 400, 'no file part');
    assert.equal((await t.api.raw('POST', `${C}/files`, { ...pm, headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400, 'not multipart');
  } finally {
    await t.cleanup();
  }
});

// ---- scan failures ----
test('a scan that cannot decide is retried, and after the last attempt the file is marked ERROR, stays unavailable and can be scanned again', async () => {
  const t = await setup();
  try {
    const r = await t.upload(pdf('scan me'), 'doc.pdf');
    const id = r.json.data.id;
    const failing = createFileService({
      db: t.api.db,
      storage: createLocalStorage({ root: join(t.storage, 'files') }),
      scanners: [{ name: 'down', scan: async () => { throw new Error('ClamAV is not reachable'); } }],
      jobs: runtimeOf(t.api.db).jobs,
      signer: createSigner('s'.repeat(40)),
      approvals: null,
    });
    await assert.rejects(() => failing.scanFile({ fileId: id, attempt: 1 }), /not reachable/);
    assert.equal(t.api.db.prepare('SELECT scan_status FROM core_files WHERE id = ?').get(id).scan_status, 'PENDING');
    await assert.rejects(() => failing.scanFile({ fileId: id, attempt: 5 }), /not reachable/);
    const row = t.api.db.prepare('SELECT scan_status, scan_detail FROM core_files WHERE id = ?').get(id);
    assert.deepEqual({ ...row }, { scan_status: 'ERROR', scan_detail: 'ClamAV is not reachable' });
    assert.equal((await t.api.call('GET', `${C}/files/${id}/url`, pm)).status, 409);
    const overview = (await t.api.call('GET', `${C}/files/overview`, itadm)).json.data;
    assert.equal(overview.attention[0].canRescan, true);

    assert.equal((await t.api.call('POST', `${C}/files/${id}/rescan`, { ...pm, headers: { ...key(1), ...json }, body: {} })).status, 403);
    const again = await t.api.call('POST', `${C}/files/${id}/rescan`, { ...itadm, headers: { ...key(2), ...json }, body: {} });
    assert.equal(again.json.data.scanStatus, 'PENDING');
    await t.done();
    assert.equal((await t.api.call('GET', `${C}/files/${id}`, pm)).json.data.scanStatus, 'CLEAN');
    assert.equal((await t.api.call('POST', `${C}/files/${id}/rescan`, { ...itadm, headers: { ...key(3), ...json }, body: {} })).status, 422, 'a clean file needs no rescan');
  } finally {
    await t.cleanup();
  }
});

test('the admin list filters by scan status and the whole feature is hidden while ff.core.p0105 is OFF', async () => {
  const t = await setup();
  try {
    await uploaded(t, pdf('listed'), 'listed.pdf');
    await t.upload(Buffer.from(TEST_VIRUS), 'virus.txt');
    await t.done();
    const all = (await t.api.call('GET', `${C}/files/admin?pageSize=10`, sys)).json;
    assert.equal(all.meta.total, 2);
    const bad = (await t.api.call('GET', `${C}/files/admin?filter[scan_status]=INFECTED`, sys)).json;
    assert.deepEqual(bad.data.map((f) => f.name), ['virus.txt']);
    assert.equal((await t.api.call('GET', `${C}/files/admin?filter[nope]=1`, sys)).status, 400);
    await t.api.call('PATCH', `${C}/feature-flags/ff.core.p0105`, { ...sys, headers: { ...key(1), ...json }, body: { scope: { level: 'company', companyId: 1 }, enabled: false, reason: 'switching files off' } });
    for (const path of ['/files/overview', `/files?entity=sample_document&entityId=${t.doc.id}`]) assert.equal((await t.api.call('GET', C + path, sys)).status, 404, path);
    assert.equal((await t.api.call('GET', `${C}/financial-years`, sys)).status, 200, 'other parts are unaffected');
  } finally {
    await t.cleanup();
  }
});
