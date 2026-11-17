import { z } from 'zod';
import readXlsxFile from 'read-excel-file/node';
import { assertPermission } from '../../platform/auth/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, unprocessable } from '../../platform/http/errors.js';
import { localisationOf } from '../../platform/i18n/index.js';
import { createParameterStore } from '../../platform/parameters/index.js';
import { toXlsx } from '../../platform/export/index.js';
import { parse } from '../../platform/validation/index.js';
import { LANGS, compareLanguages, placeholdersOf } from '../../../shared/i18n/catalogue.js';
import { CATALOGUE, NAMESPACES } from '../../../shared/i18n/locales/index.js';
import { todayIST } from '../../../shared/dates.js';

// Part 03.09: the text of the screens and messages. The built-in English and Hindi are code (shared/i18n/locales); a company changes the wording of
// a string with an override. Every change to wording is a request that another administrator approves (maker-checker), audited with the old and
// new text; an import of a translator's spreadsheet is one such request. Each person also picks their number grouping and hour format.

export const APPROVAL_TYPE = 'ui_translation_change';
export const CHAIN = ['SYSADM'];
const MAX_TEXT = 2000;
const MAX_CHANGES = 1000;

const lang = z.enum(['en', 'hi', 'te']);
const ns = z.string().regex(/^[a-z][a-z0-9]*$/).max(40);
const key = z.string().min(1).max(120).regex(/^[A-Za-z0-9_.-]+$/, 'Use letters, digits, dots, dashes and underscores');
const change = z.object({ namespace: ns, key, lang, text: z.string().max(MAX_TEXT).nullable() }).strict();
export const parseChanges = (b) => parse(z.object({ changes: z.array(change).min(1).max(MAX_CHANGES), reason: z.string().trim().min(5, 'Say why in at least 5 characters').max(500) }).strict(), b);
export const parseCatalogueParams = (p) => parse(z.object({ lang, namespace: z.union([z.literal('all'), ns]) }).strict(), p);
export const parseTranslationList = (q) => parse(z.object({
  lang: lang.optional(), namespace: ns.optional(), q: z.string().max(100).default(''), show: z.enum(['all', 'missing', 'overridden']).default('all'),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().refine((n) => [25, 50, 100].includes(n), 'Use 25, 50 or 100').default(50),
}).strict(), q ?? {});
export const parseHistory = (q) => parse(z.object({ namespace: ns, key }).strict(), q);
export const parseImportQuery = (q) => parse(z.object({ commit: z.enum(['0', '1']).default('0'), reason: z.string().trim().max(500).default('') }).strict(), q ?? {});
export const parseLocalePrefs = (b) => parse(z.object({
  numberStyle: z.enum(['indian', 'international']).nullable().optional(), timeFormat: z.enum(['12', '24']).nullable().optional(), version: z.number().int().min(0).optional(),
}).strict().refine((v) => v.numberStyle !== undefined || v.timeFormat !== undefined, { message: 'Change at least one setting', path: ['numberStyle'] }), b);

const nowIso = () => new Date().toISOString();
const unquote = (s) => (typeof s === 'string' && /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s); // the apostrophe an export put before a leading = + - @

/** The approval handler: an approved request writes the overrides in the approver's transaction. */
export const translationHandlers = {
  [APPROVAL_TYPE]: {
    apply(db, request, actor) {
      const { changes } = request.payload;
      const at = nowIso();
      const done = [];
      for (const c of changes) {
        if (CATALOGUE.en[c.namespace]?.[c.key] === undefined) throw unprocessable(`The text ${c.namespace}.${c.key} no longer exists, so the change cannot be applied.`);
        const row = db.prepare('SELECT * FROM ui_translations WHERE company_id = ? AND namespace = ? AND msg_key = ? AND lang = ?').get(request.companyId, c.namespace, c.key, c.lang);
        const base = CATALOGUE[c.lang]?.[c.namespace]?.[c.key] ?? null;
        const before = row && row.deleted_at === null ? row.text : base;
        if (c.text === null || c.text === base) {
          // back to the built-in text: the override goes
          if (row) db.prepare('DELETE FROM ui_translations WHERE id = ?').run(row.id);
        } else if (row) {
          db.prepare('UPDATE ui_translations SET text = ?, is_active = 1, deleted_at = NULL, deleted_by = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(c.text, actor.user, at, row.id);
        } else {
          db.prepare("INSERT INTO ui_translations (company_id, namespace, msg_key, lang, text, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, 'translation_change', ?)").run(request.companyId, c.namespace, c.key, c.lang, c.text, actor.user, String(request.id));
        }
        done.push({ namespace: c.namespace, key: c.key, lang: c.lang, before, after: c.text ?? base });
      }
      writeAudit(db, { entity: 'ui_translations', entityId: request.id, action: 'update', oldValues: Object.fromEntries(done.map((d) => [`${d.namespace}.${d.key}.${d.lang}`, d.before])), newValues: Object.fromEntries(done.map((d) => [`${d.namespace}.${d.key}.${d.lang}`, d.after])), reason: request.reason, actor: actor.user, companyId: request.companyId });
      publishEvent(db, { type: 'ui.translation.changed', entity: 'translation', entityId: request.id, actorId: actor.user, companyId: request.companyId, data: { changes: done.length, languages: [...new Set(done.map((d) => d.lang))] } });
      localisationOf(db).invalidate(request.companyId);
    },
  },
};

export function createTranslationService({ db, approvals }) {
  const loc = localisationOf(db);
  const must = (actor) => assertPermission(actor, 'ui.translation.manage');

  /** The effective text of every string: { ns, key, en, hi, te, enBase, hiBase, teBase, enOverridden, hiOverridden, teOverridden } (Telugu from part 166.3). */
  function rows(actor) {
    const eff = loc.catalogue(actor.companyId);
    const own = new Set(db.prepare('SELECT namespace, msg_key, lang FROM ui_translations WHERE company_id = ? AND deleted_at IS NULL AND is_active = 1').all(actor.companyId).map((o) => `${o.namespace}|${o.msg_key}|${o.lang}`));
    const out = [];
    for (const [n, keys] of Object.entries(CATALOGUE.en)) {
      for (const k of Object.keys(keys)) {
        out.push({ namespace: n, key: k, en: eff.en[n][k], hi: eff.hi?.[n]?.[k] ?? null, enBase: keys[k], hiBase: CATALOGUE.hi?.[n]?.[k] ?? null, enOverridden: own.has(`${n}|${k}|en`), hiOverridden: own.has(`${n}|${k}|hi`),
          te: eff.te?.[n]?.[k] ?? null, teBase: CATALOGUE.te?.[n]?.[k] ?? null, teOverridden: own.has(`${n}|${k}|te`) });
      }
    }
    return out;
  }

  /** The strings a screen needs, in one language: one namespace or all of them (any signed-in person). */
  /** The text of a language. `only: 'overrides'` (part 166.4) leaves out what equals the text built into the application, which the browser has already: the screens need only the rest. */
  function strings(actor, { lang: l, namespace }, { only = null } = {}) {
    const eff = loc.catalogue(actor.companyId);
    if (namespace !== 'all' && !NAMESPACES.includes(namespace)) throw badRequest('Some fields are invalid.', [{ field: 'namespace', message: `There is no text area called ${namespace}.` }]);
    const full = (name) => ({ ...(eff.en[name] ?? {}), ...(l === 'en' ? {} : eff[l]?.[name] ?? {}) });
    const pick = only === 'overrides' ? (name) => Object.fromEntries(Object.entries(full(name)).filter(([k, v]) => CATALOGUE[l]?.[name]?.[k] !== v)) : full;
    const body = namespace === 'all' ? { namespaces: Object.fromEntries(NAMESPACES.map((name) => [name, pick(name)])) } : { namespace, strings: pick(namespace) };
    const stamp = db.prepare('SELECT COUNT(*) AS n, MAX(COALESCE(updated_at, created_at)) AS at FROM ui_translations WHERE company_id = ? AND deleted_at IS NULL').get(actor.companyId);
    return { lang: l, ...body, etag: `${stamp.n}-${stamp.at ?? ''}` };
  }

  function list(actor, q) {
    must(actor);
    const needle = q.q.trim().toLowerCase();
    const l = q.lang === 'te' ? 'te' : 'hi'; // "missing" is of the language asked for, Hindi unless Telugu is named
    const all = rows(actor).filter((r) => (!q.namespace || r.namespace === q.namespace)
      && (q.show === 'all' || (q.show === 'missing' ? !r[l] || String(r[l]).trim() === '' : r.enOverridden || r.hiOverridden || r.teOverridden))
      && (!needle || `${r.namespace}.${r.key} ${r.en} ${r.hi ?? ''} ${r.te ?? ''}`.toLowerCase().includes(needle)));
    const start = (q.page - 1) * q.pageSize;
    return { rows: all.slice(start, start + q.pageSize), meta: { total: all.length, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(all.length / q.pageSize)) }, namespaces: NAMESPACES };
  }

  /** The missing-key report (FR-02): English text with no Hindi, Hindi with different placeholders, and overrides of text that no longer exists. */
  function missing(actor) {
    must(actor);
    const eff = loc.catalogue(actor.companyId);
    const cmp = compareLanguages(eff);
    const stale = db.prepare('SELECT namespace, msg_key, lang FROM ui_translations WHERE company_id = ? AND deleted_at IS NULL').all(actor.companyId).filter((o) => CATALOGUE.en[o.namespace]?.[o.msg_key] === undefined).map((o) => ({ ns: o.namespace, key: o.msg_key, lang: o.lang }));
    const perNamespace = NAMESPACES.map((name) => {
      const total = Object.keys(CATALOGUE.en[name]).length;
      const gone = cmp.missing.filter((m) => m.ns === name).length;
      return { namespace: name, total, translated: total - gone, missing: gone };
    });
    // Telugu (part 166.3): the same report; areas a field team does not use are filled module by module (D-676)
    const te = compareLanguages(eff, 'te');
    const teluguPerNamespace = NAMESPACES.map((name) => {
      const total = Object.keys(CATALOGUE.en[name]).length;
      const gone = te.missing.filter((m) => m.ns === name).length;
      return { namespace: name, total, translated: total - gone, missing: gone };
    });
    return { languages: LANGS, perNamespace, missing: cmp.missing.map((m) => ({ ...m, en: eff.en[m.ns][m.key] })), placeholders: cmp.placeholders, orphaned: stale,
      telugu: { perNamespace: teluguPerNamespace, missing: te.missing.length, placeholders: te.placeholders } };
  }

  /** Check and reduce a list of changes to the ones that differ from the text in force. */
  function checkChanges(actor, changes) {
    const eff = loc.catalogue(actor.companyId);
    const problems = [];
    const real = [];
    changes.forEach((c, i) => {
      const english = CATALOGUE.en[c.namespace]?.[c.key];
      if (english === undefined) { problems.push({ field: `changes.${i}.key`, message: `There is no text ${c.namespace}.${c.key}.` }); return; }
      const base = CATALOGUE[c.lang]?.[c.namespace]?.[c.key] ?? null;
      const current = eff[c.lang]?.[c.namespace]?.[c.key] ?? null;
      const next = c.text === null ? base : c.text;
      if (next === null) { problems.push({ field: `changes.${i}.text`, message: 'This text has no built-in version to go back to; give the text.' }); return; }
      if (String(next).trim() === '') { problems.push({ field: `changes.${i}.text`, message: 'The text cannot be empty.' }); return; }
      if (placeholdersOf(next).join() !== placeholdersOf(english).join()) { problems.push({ field: `changes.${i}.text`, message: `The text must use the same {placeholders} as the English (${placeholdersOf(english).map((p) => `{${p}}`).join(' ') || 'none'}).` }); return; }
      if (next !== current) real.push({ namespace: c.namespace, key: c.key, lang: c.lang, text: c.text === null || c.text === base ? null : c.text });
    });
    return { problems, real };
  }

  const openRequest = (actor) => db.prepare("SELECT id FROM core_change_requests WHERE company_id = ? AND type = ? AND status = 'SUBMITTED' AND is_active = 1").get(actor.companyId, APPROVAL_TYPE);

  function propose(actor, { changes, reason }) {
    must(actor);
    const { problems, real } = checkChanges(actor, changes);
    if (problems.length) throw badRequest('Some fields are invalid.', problems);
    if (real.length === 0) throw unprocessable('Nothing is different from the text in force, so there is nothing to approve.');
    if (openRequest(actor)) throw conflict('A change to the wording is already waiting for approval. Ask for it to be decided, or withdraw it, first.');
    return approvals.submit(actor, { type: APPROVAL_TYPE, title: real.length === 1 ? `Change the wording of ${real[0].namespace}.${real[0].key} (${real[0].lang})` : `Change the wording of ${real.length} texts`, targetType: 'translation', targetId: 0, payload: { changes: real }, reason, chain: CHAIN });
  }

  function pending(actor) {
    must(actor);
    return approvals.list(actor, { type: APPROVAL_TYPE, status: 'SUBMITTED', limit: 50, offset: 0 }).rows.map((r) => ({ id: r.id, title: r.title, changes: r.payload?.changes ?? [], requestedBy: r.requestedBy, requestedAt: r.requestedAt, reason: r.reason }));
  }

  function history(actor, { namespace, key: k }) {
    must(actor);
    return db.prepare("SELECT id, action, old_values, new_values, reason, actor, created_at FROM core_audit_log WHERE entity = 'ui_translations' ORDER BY id DESC LIMIT 200").all()
      .map((a) => ({ id: a.id, reason: a.reason, actor: a.actor, at: a.created_at, old: a.old_values ? JSON.parse(a.old_values) : {}, next: a.new_values ? JSON.parse(a.new_values) : {} }))
      .map((a) => ({ ...a, hi: [a.old[`${namespace}.${k}.hi`], a.next[`${namespace}.${k}.hi`]], en: [a.old[`${namespace}.${k}.en`], a.next[`${namespace}.${k}.en`]], te: [a.old[`${namespace}.${k}.te`], a.next[`${namespace}.${k}.te`]] }))
      .filter((a) => a.hi[1] !== undefined || a.en[1] !== undefined || a.te[1] !== undefined)
      .map(({ old, next, ...rest }) => ({ ...rest, oldValues: old, newValues: next }));
  }

  /** The strings for translators: namespace, key, English, Hindi (the text now in force) and whether it is the company's own wording. */
  function exportXlsx(actor) {
    must(actor);
    const data = rows(actor).map((r) => ({ namespace: r.namespace, key: r.key, en: r.en, hi: r.hi ?? '', te: r.te ?? '', note: [r.enOverridden && 'English changed by the company', r.hiOverridden && 'Hindi changed by the company', r.teOverridden && 'Telugu changed by the company', !r.hi && 'Hindi missing', !r.te && 'Telugu missing'].filter(Boolean).join('; ') }));
    writeAudit(db, { entity: 'ui_translations', entityId: 'export', action: 'export', newValues: { strings: data.length }, actor: actor.user, companyId: actor.companyId });
    return { buffer: toXlsx({ sheetName: 'Translations', columns: [{ key: 'namespace', label: 'Namespace', type: 'text' }, { key: 'key', label: 'Key', type: 'text' }, { key: 'en', label: 'English', type: 'text' }, { key: 'hi', label: 'Hindi', type: 'text' }, { key: 'te', label: 'Telugu', type: 'text' }, { key: 'note', label: 'Note', type: 'text' }], rows: data, footer: ['Change only the English and Hindi columns. Keep every {placeholder} exactly as in the English text. Import the file on the Translations page.'] }), fileName: `translations-${todayIST()}.xlsx` };
  }

  /** Read a translator's file: a preview of what would change and what is wrong; with `commit`, the change request (one for the whole file). */
  async function importXlsx(actor, buffer, { commit, reason }) {
    must(actor);
    let sheets;
    try { sheets = await readXlsxFile(buffer); } catch { throw badRequest('That file could not be read as an Excel workbook (.xlsx).', [{ field: 'file', message: 'is not a valid .xlsx file' }]); }
    const table = sheets[0]?.data ?? [];
    const header = (table[0] ?? []).map((h) => String(h ?? '').trim().toLowerCase());
    const col = (name) => header.indexOf(name);
    const [cNs, cKey, cEn, cHi, cTe] = ['namespace', 'key', 'english', 'hindi', 'telugu'].map(col); // Telugu (166.3) is optional: an older file has none
    if ([cNs, cKey, cEn, cHi].some((c) => c < 0)) throw badRequest('The first row must name the columns Namespace, Key, English and Hindi.', [{ field: 'file', message: 'is missing one of the columns Namespace, Key, English, Hindi' }]);
    if (table.length - 1 > 20000) throw badRequest('The file has too many rows.', [{ field: 'file', message: 'has more than 20,000 rows' }]);
    const wanted = [];
    const errors = [];
    table.slice(1).forEach((r, i) => {
      const line = i + 2;
      const n = String(r[cNs] ?? '').trim();
      const k = String(r[cKey] ?? '').trim();
      if (!n && !k) return;
      for (const [l, c] of [['en', cEn], ['hi', cHi], ...(cTe >= 0 ? [['te', cTe]] : [])]) {
        const text = unquote(r[c] === null || r[c] === undefined ? '' : String(r[c]));
        if (text.trim() === '') continue; // a blank cell leaves the text as it is
        wanted.push({ namespace: n, key: k, lang: l, text, line });
      }
    });
    const { problems, real } = checkChanges(actor, wanted.map(({ line: _l, ...c }) => c));
    for (const p of problems) { const idx = Number(/changes\.(\d+)/.exec(p.field)?.[1]); errors.push({ line: wanted[idx]?.line ?? null, message: p.message }); }
    const preview = { rows: table.length - 1, changes: real.length, errors, sample: real.slice(0, 20) };
    if (!commit) return { ...preview, committed: false };
    if (errors.length) throw unprocessable(`The file has ${errors.length} problem(s). Correct them and import again; nothing was requested.`);
    if (real.length === 0) throw unprocessable('Nothing in the file differs from the text in force, so there is nothing to approve.');
    if (reason.trim().length < 5) throw badRequest('Some fields are invalid.', [{ field: 'reason', message: 'Say why in at least 5 characters' }]);
    return { ...preview, committed: true, request: propose(actor, { changes: real, reason: reason.trim() }) };
  }

  // ---- each person's number grouping and hour format ----
  const defaults = (actor) => {
    const store = createParameterStore(db);
    const d = { companyId: actor.companyId, date: todayIST() };
    return { numberStyle: String(store.get('ui.locale.number_style', d)), timeFormat: String(store.get('ui.locale.time_format', d)) };
  };
  function localePrefs(actor) {
    const r = db.prepare('SELECT * FROM ui_locale_preferences WHERE company_id = ? AND user_ref = ? AND deleted_at IS NULL').get(actor.companyId, actor.user);
    const d = defaults(actor);
    return { numberStyle: r?.number_style ?? null, timeFormat: r?.time_format ?? null, defaults: d, effective: { numberStyle: r?.number_style ?? d.numberStyle, timeFormat: r?.time_format ?? d.timeFormat }, version: r?.version ?? 0 };
  }
  function saveLocalePrefs(actor, input) {
    return transaction(db, () => {
      const r = db.prepare('SELECT * FROM ui_locale_preferences WHERE company_id = ? AND user_ref = ? AND deleted_at IS NULL').get(actor.companyId, actor.user);
      if (input.version !== undefined && input.version !== (r?.version ?? 0)) throw conflict('Your settings were changed on another device. Reload them and choose again.');
      const next = { number_style: input.numberStyle === undefined ? r?.number_style ?? null : input.numberStyle, time_format: input.timeFormat === undefined ? r?.time_format ?? null : input.timeFormat };
      const at = nowIso();
      let id;
      if (r) {
        db.prepare('UPDATE ui_locale_preferences SET number_style = ?, time_format = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(next.number_style, next.time_format, actor.user, at, r.id);
        id = r.id;
      } else {
        id = Number(db.prepare("INSERT INTO ui_locale_preferences (company_id, user_id, user_ref, number_style, time_format, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'locale_preferences')").run(actor.companyId, actor.userId ?? null, actor.user, next.number_style, next.time_format, actor.user).lastInsertRowid);
      }
      writeAudit(db, { entity: 'ui_locale_preferences', entityId: id, action: r ? 'update' : 'create', oldValues: r ? { numberStyle: r.number_style, timeFormat: r.time_format } : null, newValues: { numberStyle: next.number_style, timeFormat: next.time_format }, actor: actor.user, companyId: actor.companyId });
      publishEvent(db, { type: 'ui.locale.changed', entity: 'locale_preferences', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { numberStyle: next.number_style ?? 'default', timeFormat: next.time_format ?? 'default' } });
      return localePrefs(actor);
    });
  }

  return { strings, list, missing, propose, pending, history, exportXlsx, importXlsx, localePrefs, saveLocalePrefs };
}
