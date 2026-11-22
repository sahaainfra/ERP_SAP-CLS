import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { localisationOf } from '../src/server/platform/i18n/index.js';
import { toXlsx } from '../src/server/platform/export/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 03.09: the text of the screens over the API: who reads and who manages it, an override as a request another administrator approves,
// the translator's spreadsheet, the missing-key report, number formats per person and messages in the language of their recipient.
const U = '/api/v1/ui';
const json = { 'content-type': 'application/json' };
const key = (k) => ({ ...json, 'idempotency-key': `i18n-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const sys = as('SYSADM', 'sys1');
const sys2 = as('SYSADM', 'sys2');
const pm = as('PM', 'pm1');
const xlsx = (rows) => toXlsx({ sheetName: 'Translations', columns: ['Namespace', 'Key', 'English', 'Hindi'].map((l) => ({ key: l, label: l, type: 'text' })), rows });
const act = (api, who, id, action = 'approve') => api.call('POST', `/api/v1/core/change-requests/${id}/act`, { ...who, headers: key('act'), body: { action, comment: 'checked and fine' } });

test('FR-01 any signed-in person reads the text of a language; an unknown area or language is refused', async () => {
  const api = await startApi();
  await setupCompany(api, { company: '1' });
  const hi = await api.call('GET', `${U}/translations/hi/field`, pm);
  assert.equal(hi.status, 200, JSON.stringify(hi.json));
  assert.equal(hi.json.data.strings.title, 'फ़ील्ड होम');
  const en = await api.call('GET', `${U}/translations/en/field`, as('EMP', 'emp1'));
  assert.equal(en.json.data.strings.title, 'Field Home');
  const all = await api.call('GET', `${U}/translations/hi/all`, pm);
  assert.deepEqual(Object.keys(all.json.data.namespaces).sort(), ['aa', 'adm', 'af', 'ai', 'bd', 'bill', 'bud', 'cash', 'cf', 'common', 'ct', 'ctr', 'cv', 'di', 'engg', 'ess', 'est', 'ex', 'exp', 'fa', 'fc', 'field', 'fin', 'format', 'gst', 'hse', 'ic', 'inv', 'lk', 'mc', 'mr', 'notify', 'pa', 'palette', 'pc', 'pl', 'plan', 'plant', 'pp', 'pr', 'prf', 'proc', 'proj', 'ps', 'qa', 'rd', 'rmc', 'scn', 'sep', 'shell', 'site', 'st', 'trn', 'why', 'wr']);
  assert.equal((await api.call('GET', `${U}/translations/hi/nothing`, pm)).status, 400);
  assert.equal((await api.call('GET', `${U}/translations/fr/field`, pm)).status, 400);
  await api.close();
});

test('AC-04 AC-05 only the system administrator manages wording; a change is a request another administrator approves, audited with old and new text', async () => {
  const api = await startApi();
  await setupCompany(api, { company: '1' });
  assert.equal((await api.call('GET', `${U}/translations`, pm)).status, 403);
  assert.equal((await api.call('GET', `${U}/translations/missing`, pm)).status, 403);
  assert.equal((await api.call('POST', `${U}/translations/changes`, { ...pm, headers: key('p'), body: { changes: [{ namespace: 'field', key: 'title', lang: 'hi', text: 'साइट होम' }], reason: 'clearer for the site team' } })).status, 403);
  const list = await api.call('GET', `${U}/translations?namespace=field&q=title`, sys);
  assert.equal(list.status, 200);
  assert.ok(list.json.data.rows.some((r) => r.key === 'title' && r.hi === 'फ़ील्ड होम' && !r.hiOverridden));
  const propose = (who, changes, reason = 'clearer for the site team') => api.call('POST', `${U}/translations/changes`, { ...who, headers: key('c'), body: { changes, reason } });
  // refused: unknown text, a placeholder lost, an empty text, the same text, no reason
  assert.equal((await propose(sys, [{ namespace: 'field', key: 'nope', lang: 'hi', text: 'x' }])).status, 400);
  const lost = await propose(sys, [{ namespace: 'field', key: 'sync.some', lang: 'hi', text: 'कुछ भेजना बाकी है' }]);
  assert.equal(lost.status, 400);
  assert.match(JSON.stringify(lost.json), /placeholders/);
  assert.equal((await propose(sys, [{ namespace: 'field', key: 'title', lang: 'hi', text: '   ' }])).status, 400);
  assert.equal((await propose(sys, [{ namespace: 'field', key: 'title', lang: 'hi', text: 'फ़ील्ड होम' }])).status, 422, 'the text in force: nothing to approve');
  assert.equal((await propose(sys, [{ namespace: 'field', key: 'title', lang: 'hi', text: 'साइट होम' }], 'no')).status, 400);
  const ok = await propose(sys, [{ namespace: 'field', key: 'title', lang: 'hi', text: 'साइट होम' }]);
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal((await api.call('GET', `${U}/translations/hi/field`, pm)).json.data.strings.title, 'फ़ील्ड होम', 'not in force until approved');
  assert.equal((await propose(sys, [{ namespace: 'field', key: 'online', lang: 'hi', text: 'चालू' }])).status, 409, 'one request at a time');
  assert.equal((await api.call('GET', `${U}/translations/pending`, sys)).json.data.length, 1);
  assert.equal((await act(api, sys, ok.json.data.id)).status, 403, 'the person who asked cannot approve');
  assert.equal((await act(api, pm, ok.json.data.id)).status, 403);
  const done = await act(api, sys2, ok.json.data.id);
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal((await api.call('GET', `${U}/translations/hi/field`, pm)).json.data.strings.title, 'साइट होम', 'in force after approval, for everyone in the company');
  assert.equal((await api.call('GET', `${U}/translations/hi/field`, { ...pm, company: '2' })).json.data.strings.title, 'फ़ील्ड होम', 'another company keeps the built-in text');
  const a = api.db.prepare("SELECT action, old_values, new_values, reason, actor FROM core_audit_log WHERE entity = 'ui_translations' AND action = 'update'").get();
  assert.deepEqual([a.actor, a.reason, JSON.parse(a.old_values)['field.title.hi'], JSON.parse(a.new_values)['field.title.hi']], ['sys2', 'clearer for the site team', 'फ़ील्ड होम', 'साइट होम']);
  assert.ok(api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'ui.translation.changed'").get());
  const hist = (await api.call('GET', `${U}/translations/history?namespace=field&key=title`, sys)).json.data;
  assert.equal(hist.length, 1);
  assert.deepEqual(hist[0].hi, ['फ़ील्ड होम', 'साइट होम']);
  assert.equal((await api.call('GET', `${U}/translations?show=overridden`, sys)).json.data.rows.length, 1);
  // asking for the built-in text again removes the override
  const back = await propose(sys2, [{ namespace: 'field', key: 'title', lang: 'hi', text: null }], 'back to the standard wording');
  assert.equal((await act(api, sys, back.json.data.id)).status, 200);
  assert.equal((await api.call('GET', `${U}/translations/hi/field`, pm)).json.data.strings.title, 'फ़ील्ड होम');
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM ui_translations').get().n, 0);
  await api.close();
});

test('FR-02 the translator\'s spreadsheet: export, a preview with problems, import as one request; the missing-key report', async () => {
  const api = await startApi();
  await setupCompany(api, { company: '1' });
  const raw = await api.raw('GET', `${U}/translations/export`, sys);
  assert.equal(raw.status, 200);
  assert.match(raw.headers.get('content-type'), /spreadsheetml/);
  assert.equal((await api.raw('GET', `${U}/translations/export`, pm)).status, 403);
  const post = (rows, q = '') => api.raw('POST', `${U}/translations/import${q}`, { ...sys, headers: { 'content-type': 'application/octet-stream', 'idempotency-key': 'x' }, body: rows });
  const good = { Namespace: 'common', Key: 'cancel', English: 'Cancel', Hindi: 'रद्द' };
  const bad = { Namespace: 'common', Key: 'pager.summary', English: '', Hindi: 'केवल {total} {noun}' };
  const unknown = { Namespace: 'common', Key: 'zzz', English: '', Hindi: 'x' };
  const preview = await post(xlsx([good, bad, unknown]));
  assert.equal(preview.status, 200, preview.buffer.toString());
  assert.equal(preview.json.data.committed, false);
  assert.equal(preview.json.data.changes, 1);
  assert.equal(preview.json.data.errors.length, 2);
  assert.deepEqual(preview.json.data.errors.map((e) => e.line), [3, 4]);
  assert.equal((await post(xlsx([good, bad]), '?commit=1&reason=translator%20review')).status, 422, 'nothing is requested while the file has problems');
  assert.equal((await post(xlsx([good]), '?commit=1')).status, 400, 'a reason is needed');
  assert.equal((await post(Buffer.from('not a workbook'), '')).status, 400);
  assert.equal((await post(xlsx([{ Namespace: 'a', Key: 'b', English: '', Hindi: '' }]), '')).status, 200, 'a blank row changes nothing');
  const sent = await post(xlsx([good]), '?commit=1&reason=translator%20review');
  assert.equal(sent.status, 201, sent.buffer.toString());
  assert.ok(sent.json.data.request.id);
  assert.equal((await act(api, as('SYSADM', 'sys2'), sent.json.data.request.id)).status, 200);
  assert.equal((await api.call('GET', `${U}/translations/hi/common`, pm)).json.data.strings.cancel, 'रद्द');
  const missing = await api.call('GET', `${U}/translations/missing`, sys);
  assert.equal(missing.status, 200);
  assert.deepEqual([missing.json.data.missing.length, missing.json.data.placeholders.length, missing.json.data.orphaned.length], [0, 0, 0], 'the built-in Hindi is complete');
  assert.ok(missing.json.data.perNamespace.every((n) => n.missing === 0 && n.total > 0));
  api.db.prepare("INSERT INTO ui_translations (company_id, namespace, msg_key, lang, text, created_by) VALUES (1, 'common', 'gone', 'hi', 'x', 't')").run();
  assert.equal((await api.call('GET', `${U}/translations/missing`, sys)).json.data.orphaned.length, 1, 'an override of text that no longer exists is reported');
  await api.close();
});

test('FR-03 a person\'s number grouping and hour format: own choice over the company default, version-checked, audited', async () => {
  const api = await startApi();
  await setupCompany(api, { company: '1' });
  const get = async (who = pm) => (await api.call('GET', `${U}/locale-preferences`, who)).json.data;
  assert.deepEqual([(await get()).effective, (await get()).numberStyle], [{ numberStyle: 'indian', timeFormat: '24' }, null]);
  const put = (body, who = pm) => api.call('PUT', `${U}/locale-preferences`, { ...who, body });
  const saved = await put({ numberStyle: 'international', timeFormat: '12' });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.data.effective, { numberStyle: 'international', timeFormat: '12' });
  assert.deepEqual((await get(as('PM', 'pm2'))).effective, { numberStyle: 'indian', timeFormat: '24' }, 'only their own');
  assert.equal((await put({ timeFormat: '24', version: 0 })).status, 409, 'changed on another device');
  assert.equal((await put({ timeFormat: '24', version: saved.json.data.version })).status, 200);
  assert.equal((await put({ numberStyle: null })).json.data.effective.numberStyle, 'indian', 'null goes back to the company default');
  assert.equal((await put({})).status, 400);
  assert.equal((await put({ numberStyle: 'french' })).status, 400);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'ui_locale_preferences'").get().n, 3, 'a create and two updates; the refused ones leave nothing');
  const loc = localisationOf(api.db);
  assert.deepEqual(loc.formatPrefs({ companyId: 1, userRef: 'pm1', lang: 'hi' }), { grouping: 'indian', hour12: false, lang: 'hi' });
  await api.close();
});

test('FR-04 messages are written in the language of their recipient, with the company\'s wording', async () => {
  const api = await startApi();
  await setupCompany(api, { company: '1' });
  const loc = localisationOf(api.db);
  assert.equal(loc.languageOf({ companyId: 1, username: 'rajesh' }), 'en');
  await api.call('PATCH', `${U}/preferences`, { ...as('PM', 'rajesh'), body: { language: 'hi' } });
  assert.equal(loc.languageOf({ companyId: 1, username: 'rajesh' }), 'hi');
  const t = loc.translator(1, 'hi');
  assert.equal(t('notify', 'reset.body', { code: '123456', minutes: 15 }), 'आपका पासवर्ड रीसेट कोड 123456 है। यह 15 मिनट तक, केवल एक बार चलता है। यदि आपने इसे नहीं माँगा, तो इस संदेश को अनदेखा करें।');
  assert.match(loc.translator(1, 'en')('notify', 'reset.body', { code: '123456', minutes: 15 }), /^Your password reset code is 123456\./);
  await api.close();
});
