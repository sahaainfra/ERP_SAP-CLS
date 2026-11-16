import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE } from '../src/shared/i18n/locales/index.js';
import { LANGS, compareLanguages, placeholdersOf } from '../src/shared/i18n/catalogue.js';
import { amountInWords } from '../src/shared/i18n/words.js';
import { formatCompact, formatDate } from '../src/shared/i18n/format.js';
import { migrateDown, migrateUp } from '../src/server/platform/db/index.js';
import { stampText, stampTime, PHOTO_MAX_BYTES } from '../src/client/platform/device/camera.js';
import { admin, memoryDb, setupCompany, startApi } from './helpers.js';

// Part 166.3: the mobile site app for site teams and Telugu. T-03 (Telugu key coverage of the field pages), FR-07 (Telugu words, dates, the
// language accepted by the preferences and the translation workflow), FR-01 (role field home and today's counts), FR-02 (bottom bar by role),
// T-04 (the photo limit and stamp text; the browser part is in e2e/field-p16603.spec.js) and the migration's down and up.
const U = '/api/v1/ui';
const json = { 'content-type': 'application/json' };
const key = (k) => ({ ...json, 'idempotency-key': `fld-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const FIELD_NS = ['common', 'shell', 'palette', 'field', 'format', 'notify'];

test('T-03 every text of the shell and the field pages has Telugu, with the same {placeholders} as the English', () => {
  assert.deepEqual(LANGS, ['en', 'hi', 'te']);
  const cmp = compareLanguages(CATALOGUE, 'te');
  assert.deepEqual(cmp.missing.filter((m) => FIELD_NS.includes(m.ns)), [], 'nothing missing in the shell and field namespaces');
  assert.deepEqual(cmp.missing.filter((m) => m.ns === 'site' && m.key.startsWith('dpr.')), [], 'the daily progress report entry is complete');
  assert.deepEqual(cmp.placeholders, [], 'no Telugu text drops or adds a placeholder');
  assert.deepEqual(cmp.extra, [], 'no Telugu key that the English does not have');
  // Hindi still complete for the keys this part added
  assert.deepEqual(compareLanguages(CATALOGUE, 'hi').missing.filter((m) => FIELD_NS.includes(m.ns)), []);
});

test('T-03 every key the field pages ask for exists in Telugu (read from the source)', () => {
  const asked = (file, ns) => [...readFileSync(file, 'utf8').matchAll(/\bt[f]?\('([a-zA-Z][\w.-]*)'/g)].map((m) => m[1]).filter((k) => CATALOGUE.en[ns]?.[k] !== undefined || /^(today|greet|sync|voice|photo|qty|sameAsYesterday)/.test(k));
  const keys = new Set([...asked('src/client/modules/ui/FieldHomePage.jsx', 'field'), ...asked('src/client/platform/device/VoiceNote.jsx', 'field')]);
  for (const code of ['approvals', 'dpr', 'dprDraft', 'inspections', 'ncrs', 'observations', 'permits', 'gate']) keys.add(`today.${code}`);
  for (const k of keys) assert.ok(CATALOGUE.te.field[k] ?? CATALOGUE.te.field[`${k}_other`], `field.${k} has Telugu`);
  const dpr = [...readFileSync('src/client/modules/site/DprEntryPage.jsx', 'utf8').matchAll(/\bt\('(dpr\.[\w.]+)'/g)].map((m) => m[1]);
  for (const k of dpr) assert.ok(CATALOGUE.te.site[k], `site.${k} has Telugu`);
});

test('FR-07 amounts in Telugu words by the Indian places, Telugu months, lakh and crore in Telugu', () => {
  assert.equal(amountInWords('12345678.90', 'te'), 'ఒక కోటి ఇరవై మూడు లక్షల నలభై ఐదు వేల ఆరు వందల డెబ్బై ఎనిమిది రూపాయలు మరియు తొంభై పైసలు మాత్రమే');
  assert.equal(amountInWords('1', 'te'), 'ఒక రూపాయి మాత్రమే');
  assert.equal(amountInWords('150', 'te'), 'నూట యాభై రూపాయలు మాత్రమే');
  assert.equal(amountInWords('250000', 'te'), 'రెండు లక్షల యాభై వేల రూపాయలు మాత్రమే');
  assert.equal(amountInWords('0.50', 'te'), 'యాభై పైసలు మాత్రమే');
  assert.equal(amountInWords('-5', 'te'), 'మైనస్ ఐదు రూపాయలు మాత్రమే');
  assert.equal(amountInWords('2500000000', 'te'), 'రెండు వందల యాభై కోట్ల రూపాయలు మాత్రమే');
  assert.equal(amountInWords('12345678.90', 'en'), 'Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Ninety Paise Only', 'English unchanged');
  assert.equal(formatDate('2026-11-05', { lang: 'te' }), '05-నవం-2026');
  assert.equal(formatDate('2026-11-05', { lang: 'en' }), '05-Nov-2026');
  assert.equal(formatCompact('24300000', { lang: 'te' }), '₹ 2.43 కోట్లు');
  assert.equal(formatCompact('408000', { lang: 'te' }), '₹ 4.08 లక్షలు');
});

test('T-04 the photo limit is 300 KB and the stamp carries India time and the position', () => {
  assert.equal(PHOTO_MAX_BYTES, 300 * 1024);
  assert.equal(stampTime('2026-11-05T08:35:00Z'), '05-Nov-2026 14:05 IST');
  assert.equal(stampText({ at: '2026-11-05T08:35:00Z', gps: { lat: 17.385044, lng: 78.486671, accuracy: 12.4 } }), '05-Nov-2026 14:05 IST · 17.38504, 78.48667 ±12 m');
  assert.equal(stampText({ at: '2026-11-05T08:35:00Z', gps: null }), '05-Nov-2026 14:05 IST · no position');
});

test('migration 20261209000328 goes down and up again: Telugu preferences fall back to English, the columns and the bottom bar come and go', () => {
  const db = memoryDb();
  const last = db.prepare('SELECT id FROM core_schema_migrations ORDER BY id DESC LIMIT 1').get().id;
  assert.equal(last, '20261209000328_field_p16603', 'this part is the newest migration');
  db.prepare("INSERT INTO org_companies (code, legal_name, short_name) VALUES ('TE1', 'Te One Pvt Ltd', 'TE1')").run();
  const company = db.prepare("SELECT id FROM org_companies WHERE code = 'TE1'").get().id;
  db.prepare("INSERT INTO ui_user_preferences (company_id, user_ref, language) VALUES (?, 'u1', 'te')").run(company);
  migrateDown(db, 1);
  assert.equal(db.prepare("SELECT language FROM ui_user_preferences WHERE user_ref = 'u1'").get().language, 'en');
  assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'ui_bottom_bar'").get());
  assert.ok(!db.prepare("SELECT name FROM pragma_table_info('ui_navigation_entries')").all().some((c) => c.name === 'label_te'));
  assert.throws(() => db.prepare("UPDATE ui_user_preferences SET language = 'te'").run(), /CHECK/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ui_field_tiles').get().n, 4, 'the 03.06 tiles as they were');
  migrateUp(db);
  db.prepare("UPDATE ui_user_preferences SET language = 'te'").run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ui_bottom_bar').get().n, 12);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

async function world(api) {
  await setupCompany(api, { company: '1' });
  const project = (await api.call('POST', '/api/v1/iam/org/projects', { ...as('PM', 'pm1'), headers: key('p'), body: { code: 'NH1', name: 'NH-48 Widening', type: 'ROAD' } })).json.data;
  const site = (await api.call('POST', '/api/v1/iam/org/sites', { ...as('PM', 'pm1'), headers: key('s'), body: { code: 'S1', name: 'Km 12 camp', projectId: project.id } })).json.data;
  api.db.prepare("UPDATE org_sites SET status = 'ACTIVE' WHERE id = ?").run(site.id); // a site starts as a draft; the field teams work on active ones
  return { project, site };
}
const tiles = (n) => n.groups.flatMap((g) => g.pages).filter((p) => p.field).sort((a, b) => a.field.order - b.field.order).map((p) => p.field.code);

test('FR-01 FR-02 the field tiles and the bottom bar follow the role; Telugu labels come with the navigation', async () => {
  const api = await startApi();
  try {
    await world(api);
    const nav = async (who) => (await api.call('GET', `${U}/navigation`, who)).json.data;
    const se = await nav(as('SE', 'se1'));
    const sk = await nav(as('SK', 'sk1'));
    const pm = await nav(as('PM', 'pm1'));
    const acc = await nav(as('ACCMGR', 'acc1'));
    assert.equal(tiles(se)[0], 'dpr', 'a site engineer\'s first tile is the daily progress report');
    assert.ok(tiles(se).includes('ir-new') && !tiles(se).includes('grn'), 'an inspection request, not a GRN');
    assert.ok(['gate-entry', 'grn', 'issue-slip', 'stock-count'].every((c) => tiles(sk).includes(c)), `the storekeeper's stores tiles: ${tiles(sk)}`);
    assert.ok(!tiles(sk).includes('dpr'));
    assert.ok(!tiles(acc).includes('dpr') && !tiles(acc).includes('grn'), 'an accounts manager gets no site tiles');
    assert.ok(!tiles(se).includes('material-request'), 'the 03.06 sample tile is retired while the part is on');
    const dpr = se.groups.flatMap((g) => g.pages).find((p) => p.code === 'site-dpr-entry');
    assert.equal(dpr.labelTe, 'రోజువారీ ప్రగతి నివేదిక (DPR)');
    assert.equal(dpr.field.labelTe, 'రోజువారీ ప్రగతి నివేదిక');
    assert.deepEqual(se.bottomBar.map((b) => b.item), ['home', 'work', 'scan', 'messages'], 'the default bar');
    assert.deepEqual(pm.bottomBar.map((b) => b.item === 'page' ? b.code : b.item), ['home', 'field-approvals', 'scan', 'messages'], 'a project manager decides on the phone');
    assert.equal(pm.bottomBar[1].labelTe, 'ఆమోదాలు');
    // the registry change carries a Telugu label (maker-checker as before)
    const ch = await api.call('POST', `${U}/navigation/changes`, { ...as('SYSADM', 'sys1'), headers: key('chg'), body: { code: 'field-scan', changes: { labelTe: 'స్కాన్ చేయండి' }, reason: 'Telugu wording for site teams' } });
    assert.equal(ch.status, 201, JSON.stringify(ch.json));
  } finally { await api.close(); }
});

test('FR-01 today\'s counts come from the records, only to a person who may see them', async () => {
  const api = await startApi();
  try {
    const w = await world(api);
    const today = async (who) => api.call('GET', `${U}/field/today`, who);
    const se = await today(as('SE', 'se1'));
    assert.equal(se.status, 200, JSON.stringify(se.json));
    const card = (r, code) => r.json.data.cards.find((c) => c.code === code);
    assert.equal(card(se, 'dpr')?.count, 1, 'one active site without a DPR sent today');
    assert.equal(card(se, 'dpr').route, '/site/dpr-entry');
    assert.ok(card(se, 'approvals'), 'everyone has the approvals card');
    const acc = await today(as('ACCMGR', 'acc1'));
    assert.equal(card(acc, 'dpr'), undefined, 'no DPR card without site.dpr.create');
    assert.equal(card(acc, 'gate'), undefined, 'no gate card without inv.grn.create');
    const sk = await today(as('SK', 'sk1'));
    assert.equal(card(sk, 'gate')?.count, 0, 'the storekeeper sees the gate entries waiting for a GRN');
    void w;
  } finally { await api.close(); }
});

test('FR-07 a person may choose Telugu; the translation workflow takes Telugu wording and reports what has no Telugu', async () => {
  const api = await startApi();
  try {
    await world(api);
    const me = as('SE', 'se1');
    const p = await api.call('GET', `${U}/preferences`, me);
    const saved = await api.call('PATCH', `${U}/preferences`, { ...me, body: { language: 'te', version: p.json.data.version ?? 0 } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.data.language, 'te');
    const bad = await api.call('PATCH', `${U}/preferences`, { ...me, body: { language: 'ta' } });
    assert.equal(bad.status, 400, 'a language the screens do not speak is refused');
    const strings = await api.call('GET', `${U}/translations/te/field`, me);
    assert.equal(strings.status, 200, JSON.stringify(strings.json));
    assert.equal(strings.json.data.strings.title, 'ఫీల్డ్ హోమ్');
    const missing = await api.call('GET', `${U}/translations/missing`, admin('1'));
    assert.equal(missing.status, 200, JSON.stringify(missing.json));
    assert.ok(missing.json.data.telugu.perNamespace.find((n) => n.namespace === 'field').missing === 0);
    const change = await api.call('POST', `${U}/translations/changes`, { ...admin('1'), headers: key('tr'), body: { changes: [{ namespace: 'field', key: 'title', lang: 'te', text: 'సైట్ హోమ్' }], reason: 'Wording the site teams use' } });
    assert.equal(change.status, 201, JSON.stringify(change.json));
    const wrong = await api.call('POST', `${U}/translations/changes`, { ...admin('1'), headers: key('tr2'), body: { changes: [{ namespace: 'field', key: 'sync.some', lang: 'te', text: 'వేచి ఉన్నాయి' }], reason: 'Drop the count by mistake' } });
    assert.equal(wrong.status, 400, 'a Telugu text must keep {count}');
    assert.deepEqual(placeholdersOf(CATALOGUE.te.field['sync.some']), ['count']);
  } finally { await api.close(); }
});
