import { createHash, randomUUID } from 'node:crypto';
import { strFromU8 } from 'fflate';
import { transaction, inTransaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { writeExport, FORMATS } from '../../platform/export/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { createBuiltinScanner, runScanners } from '../../platform/files/scan.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { workflowTypes, evidenceProviders } from '../../platform/workflow/index.js';
import { Decimal } from '../../../shared/decimal.js';
import { formatDateTime } from '../../../shared/dates.js';
import { colIndex, readWorkbook, tableWorkbook, templateWorkbook } from './xl-xlsx.js';

// The Excel data-exchange engine (part 04.13): one way for bulk data to enter and leave the ERP. A module registers an import type (its columns, how to find an existing record, its own validation and how to
// create or update a record through its own service). The engine does the rest: the template (a protected header, instructions, drop-down lists from the masters), the upload (virus scan, structure check),
// the row-level check (types, required, formats, lookups by code or name, duplicates in the file and in the data, the module's rules), the preview with an impact summary and an error file, the commit (all or
// nothing, or in chunks with resume) and the history. A row is created only through the module's service, so it meets the same rules, permissions and approvals as a person typing it (BR-01).
export const TEMPLATE_DOC = 'XL_TEMPLATE';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_ROWS = 20_000;
export const CHUNK_DEFAULT = 500;
export const EXPORT_MAX_ROWS = 50_000;
const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// ---- the registers: what modules plug in ----
export const importTypes = new Map();
/** @param {any} def see the description at the top of this file; `columns` is [{ key, label, type, required, ... }] and `commitRow` is how a row becomes a record */
export function registerImportType(def) {
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(def.code ?? '')) throw new Error(`Import type code "${def.code}" must be capital letters, digits and underscores`);
  if (importTypes.has(def.code)) throw new Error(`Import type ${def.code} is already registered`);
  for (const k of ['label', 'module', 'permission', 'columns', 'keys', 'commitRow']) if (!def[k]) throw new Error(`Import type ${def.code} needs ${k}`);
  importTypes.set(def.code, { onExisting: ['ERROR'], chunked: false, maxRows: DEFAULT_MAX_ROWS, ...def });
}
export const exportSources = new Map();
/** A list that can be exported: `{ code, label, permission, columns: [{key,label,type,sensitive?}], rows(ctx, filters) -> object[] }`. Sensitive columns are masked without `unmaskPermission`. */
export function registerExportSource(def) {
  if (exportSources.has(def.code)) throw new Error(`Export ${def.code} is already registered`);
  exportSources.set(def.code, def);
}

// ---- reading a cell by its type ----
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const realDate = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null; };
function parseDate(raw) {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  const s = String(raw).trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return realDate(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) return realDate(Number(m[3]), Number(m[2]), Number(m[1]));
  if ((m = /^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4})$/.exec(s)) && MONTHS[m[2].toLowerCase()]) return realDate(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  return null;
}
/** A cell that a spreadsheet would run as a formula: = + - @ at the start (a number such as -5 is not one), or a tab or carriage return. */
export const looksLikeFormula = (s) => /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s);
const numText = (raw) => (typeof raw === 'number' ? String(raw) : String(raw).trim().replace(/,/g, ''));

/** Read one cell: { value, error?: string, code?: string, id? }. `ctx` is for lookups. */
function parseCell(ctx, col, raw) {
  const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
  if (empty) return col.required ? { value: null, error: `${col.label} is required.`, code: 'REQUIRED' } : { value: null };
  if (typeof raw === 'string' && looksLikeFormula(raw)) return { value: raw, error: `${col.label} starts with "${raw[0]}", which a spreadsheet would run as a formula. Remove that character (or write it as text without it).`, code: 'FORMULA' };
  switch (col.type) {
    case 'int': {
      const t = numText(raw);
      if (!/^-?\d+$/.test(t)) return { value: String(raw), error: `${col.label} must be a whole number.`, code: 'FORMAT' };
      const n = Number(t);
      if (col.min != null && n < col.min) return { value: String(n), error: `${col.label} must be at least ${col.min}.`, code: 'RANGE' };
      if (col.max != null && n > col.max) return { value: String(n), error: `${col.label} must be at most ${col.max}.`, code: 'RANGE' };
      return { value: n };
    }
    case 'decimal': case 'money': {
      const t = numText(raw);
      if (!/^-?\d+(\.\d+)?$/.test(t)) return { value: String(raw), error: `${col.label} must be a number.`, code: 'FORMAT' };
      const scale = col.scale ?? (col.type === 'money' ? 2 : 3);
      if ((t.split('.')[1] ?? '').length > scale) return { value: t, error: `${col.label} can have at most ${scale} decimal places.`, code: 'FORMAT' };
      const d = Decimal.of(t);
      if (col.min != null && d.lt(String(col.min))) return { value: t, error: `${col.label} must be at least ${col.min}.`, code: 'RANGE' };
      if (col.max != null && d.gt(String(col.max))) return { value: t, error: `${col.label} must be at most ${col.max}.`, code: 'RANGE' };
      return { value: d.toFixed(scale) };
    }
    case 'date': {
      const d = parseDate(raw);
      return d ? { value: d } : { value: String(raw), error: `${col.label} must be a real date, such as 31-Mar-2027 or 2027-03-31.`, code: 'FORMAT' };
    }
    case 'bool': {
      const s = String(raw).trim().toLowerCase();
      if (['yes', 'y', 'true', '1'].includes(s)) return { value: true };
      if (['no', 'n', 'false', '0'].includes(s)) return { value: false };
      return { value: String(raw), error: `${col.label} must be Yes or No.`, code: 'FORMAT' };
    }
    case 'enum': {
      const s = String(raw).trim();
      const hit = (col.values ?? []).find((v) => v.toLowerCase() === s.toLowerCase());
      return hit ? { value: hit } : { value: s, error: `${col.label} must be one of: ${(col.values ?? []).join(', ')}.`, code: 'NOT_IN_LIST' };
    }
    case 'lookup': {
      const s = String(raw).trim();
      const hits = col.lookup.resolve(ctx, s);
      if (hits.length === 0) return { value: s, error: `${col.label}: "${s}" is not a ${col.lookup.noun ?? 'known value'} (code or name).`, code: 'LOOKUP' };
      if (hits.length > 1) return { value: s, error: `${col.label}: "${s}" matches more than one ${col.lookup.noun ?? 'value'}; use the code.`, code: 'AMBIGUOUS' };
      return { value: hits[0].code, id: hits[0].id };
    }
    default: {
      const s = (typeof raw === 'number' ? String(raw) : raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw)).trim();
      if (col.maxLength && s.length > col.maxLength) return { value: s, error: `${col.label} can have at most ${col.maxLength} characters.`, code: 'LENGTH' };
      if (col.pattern && !new RegExp(col.pattern).test(s)) return { value: s, error: col.patternMessage ?? `${col.label} is not in the expected form.`, code: 'FORMAT' };
      return { value: s };
    }
  }
}

export function createExcelService({ db, engine, storage, jobs }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const scanner = createBuiltinScanner();
  const may = (actor, key, scope) => authz.check(actor, key, scope ?? { companyId: actor.companyId }).allowed;
  const anywhere = (actor, key) => authz.check(actor, key).allowed;
  const nowIso = () => engine.clock().toISOString();
  const ctxOf = (actor) => ({ db, actor, companyId: actor.companyId, can: (key, scope) => may(actor, key, { companyId: actor.companyId, ...(scope ?? {}) }), authz });
  const defOf = (code) => { const d = importTypes.get(code); if (!d) throw notFound(`There is no import type ${code}.`); return d; };
  const mustImport = (actor, def) => { if (!anywhere(actor, def.permission)) throw forbidden(`You may not import ${def.label} (permission ${def.permission}).`); };

  // ---- the template of a type: the module's definition with the company's approved settings ----
  const active = (companyId, code) => db.prepare("SELECT * FROM xl_templates WHERE company_id = ? AND import_type = ? AND status = 'ACTIVE' AND is_active = 1").get(companyId, code);
  function effective(companyId, def) {
    const row = active(companyId, def.code);
    const over = row ? JSON.parse(row.columns_json) : {};
    const settings = row ? JSON.parse(row.settings_json) : {};
    const columns = def.columns.map((c) => {
      const o = over[c.key] ?? {};
      return { ...c, label: o.label ?? c.label, help: o.help ?? c.help, required: c.required || o.required === true };
    });
    return { version: row?.template_version ?? 0, columns, instructions: row?.instructions ?? '', settings: { allowChunked: false, chunkSize: CHUNK_DEFAULT, ...settings }, maxRows: Math.min(settings.maxRows ?? def.maxRows, DEFAULT_MAX_ROWS) };
  }
  const instructionLines = (def, eff) => [
    `Import: ${def.label}`,
    'Fill one row for each record on the Data sheet, from row 2. Do not change the header row (it is protected) or the order of the columns.',
    'Columns marked * are required. Where a column has a drop-down list, choose from it. A code or a name of a master record both work.',
    `Dates: write 31-Mar-2027 or 2027-03-31. Numbers: write the number only, without the rupee sign.`,
    'Do not start a text with = + - or @ (a spreadsheet would run it as a formula); such cells are refused.',
    `At most ${eff.maxRows} rows in one file. The file is checked first; nothing is saved until you review the preview and commit.`,
    ...(def.description ? [def.description] : []),
    ...String(eff.instructions || '').split('\n').filter(Boolean),
  ];
  const listOf = (ctx, c) => (c.type === 'enum' ? c.values : c.type === 'bool' ? ['Yes', 'No'] : c.type === 'lookup' && c.lookup.list ? c.lookup.list(ctx).slice(0, 1000) : null);
  const templates = {
    types(actor) {
      const all = anywhere(actor, 'xl.template.view');
      return [...importTypes.values()].filter((d) => all || anywhere(actor, d.permission)).sort((a, b) => a.label.localeCompare(b.label)).map((d) => {
        const e = effective(actor.companyId, d);
        const last = db.prepare("SELECT status, started_at FROM xl_jobs WHERE company_id = ? AND import_type = ? AND started_by = ? AND is_active = 1 ORDER BY id DESC LIMIT 1").get(actor.companyId, d.code, actor.user);
        return { code: d.code, label: d.label, module: d.module, description: d.description ?? '', permission: d.permission, canImport: anywhere(actor, d.permission), version: e.version, columns: e.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, required: Boolean(c.required), help: c.help ?? '' })), keys: d.keys, onExisting: d.onExisting, chunked: d.chunked && e.settings.allowChunked, maxRows: e.maxRows, canExport: Boolean(d.exportRows) && anywhere(actor, d.exportPermission ?? d.permission), lastJob: last ? { status: last.status, at: last.started_at } : null };
      });
    },
    download(actor, code) {
      const def = defOf(code);
      mustImport(actor, def);
      const eff = effective(actor.companyId, def);
      const ctx = ctxOf(actor);
      const buffer = templateWorkbook({ importType: def.code, version: eff.version, title: `${def.label}: import template`, columns: eff.columns.map((c) => ({ key: c.key, label: c.label, required: c.required, type: c.type, help: `${c.help ?? ''}${c.type === 'enum' ? ` One of: ${c.values.join(', ')}.` : ''}`.trim(), list: listOf(ctx, c), min: c.min, max: c.max, width: c.maxLength ? Math.min(40, c.maxLength) : undefined })), instructions: instructionLines(def, eff), maxRows: Math.min(eff.maxRows, 5000) });
      writeAudit(db, { entity: 'xl_templates', entityId: code, action: 'download', newValues: { version: eff.version }, actor: actor.user, companyId: actor.companyId });
      return { buffer, fileName: `${code.toLowerCase()}-template-v${eff.version}.xlsx` };
    },
    /** The data of a type in the form of its template, so that it can be changed in Excel and imported again (FR-06). */
    exportData(actor, code, filters = {}) {
      const def = defOf(code);
      if (!def.exportRows) throw conflict(`${def.label} has no export.`);
      if (!anywhere(actor, def.exportPermission ?? def.permission)) throw forbidden(`You may not export ${def.label} (permission ${def.exportPermission ?? def.permission}).`);
      const ctx = ctxOf(actor);
      const eff = effective(actor.companyId, def);
      const rows = def.exportRows(ctx, filters);
      if (rows.length > EXPORT_MAX_ROWS) throw unprocessable(`The export has more than ${EXPORT_MAX_ROWS} rows. Narrow it with a filter.`);
      const masked = (c, v) => (c.sensitive && !(c.unmaskPermission ? may(actor, c.unmaskPermission) : false) ? '••••' : v);
      const buffer = templateWorkbook({ importType: def.code, version: eff.version, title: `${def.label}: export`, columns: eff.columns.map((c) => ({ key: c.key, label: c.label, required: c.required, type: c.type, help: c.help, list: listOf(ctx, c) })), instructions: ['This is an export in the form of the import template. Change the rows and import the file again to update records.', ...instructionLines(def, eff).slice(1, 3)], rows: rows.map((r) => eff.columns.map((c) => masked(c, r[c.key] ?? null))), maxRows: Math.max(5000, rows.length + 100) });
      writeAudit(db, { entity: 'xl_templates', entityId: code, action: 'export', newValues: { rows: rows.length }, actor: actor.user, companyId: actor.companyId });
      return { buffer, fileName: `${code.toLowerCase()}-data.xlsx`, rows: rows.length };
    },
    config(actor) {
      if (!anywhere(actor, 'xl.template.view')) throw forbidden('You may not see the import templates (permission xl.template.view).');
      const pending = db.prepare("SELECT * FROM xl_templates WHERE company_id = ? AND status = 'PENDING' AND is_active = 1").all(actor.companyId);
      return {
        types: [...importTypes.values()].sort((a, b) => a.label.localeCompare(b.label)).map((d) => {
          const row = active(actor.companyId, d.code);
          const p = pending.find((x) => x.import_type === d.code);
          return { code: d.code, label: d.label, module: d.module, version: row?.template_version ?? 0, columns: d.columns.map((c) => ({ key: c.key, label: c.label, defaultLabel: c.label, defaultHelp: c.help ?? '', defaultRequired: Boolean(c.required), type: c.type, required: Boolean(c.required), help: c.help ?? '', ...(row ? JSON.parse(row.columns_json)[c.key] ?? {} : {}) })), instructions: row?.instructions ?? '', settings: { allowChunked: false, chunkSize: CHUNK_DEFAULT, ...(row ? JSON.parse(row.settings_json) : {}) }, chunkedPossible: Boolean(d.chunked), maxRows: d.maxRows, pending: p ? { id: p.id, instanceId: p.instance_id, by: p.created_by, reason: p.reason } : null, history: db.prepare('SELECT template_version, status, created_by, created_at, reason FROM xl_templates WHERE company_id = ? AND import_type = ? AND is_active = 1 ORDER BY template_version DESC LIMIT 10').all(actor.companyId, d.code).map((h) => ({ version: h.template_version, status: h.status, by: h.created_by, at: h.created_at, reason: h.reason })) };
        }),
        canEdit: may(actor, 'xl.template.edit'),
      };
    },
    /** A change of a template (instructions, labels, help, tighter required, chunked commit): the maker proposes, a second person approves (maker-checker). */
    propose(actor, b) {
      if (!may(actor, 'xl.template.edit')) throw forbidden('You may not change import templates (permission xl.template.edit).');
      const def = defOf(b.importType);
      const problems = [];
      for (const [k, v] of Object.entries(b.columns)) {
        if (!def.columns.some((c) => c.key === k)) problems.push({ field: `columns.${k}`, message: `${k} is not a column of ${def.label}.` });
        if (v.label !== undefined && /^[=+\-@]/.test(v.label)) problems.push({ field: `columns.${k}.label`, message: 'A label cannot start with = + - or @.' });
      }
      if (b.settings.allowChunked && !def.chunked) problems.push({ field: 'settings.allowChunked', message: `${def.label} cannot be imported in chunks.` });
      const labels = def.columns.map((c) => (b.columns[c.key]?.label ?? c.label).toLowerCase());
      if (new Set(labels).size !== labels.length) problems.push({ field: 'columns', message: 'Two columns have the same label.' });
      if (problems.length) throw badRequest('The template is not valid.', problems);
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM xl_templates WHERE company_id = ? AND import_type = ? AND status = 'PENDING' AND is_active = 1").get(actor.companyId, def.code)) throw conflict('A change of this template is already waiting for approval. It must be decided first.');
        const v = (db.prepare('SELECT MAX(template_version) AS v FROM xl_templates WHERE company_id = ? AND import_type = ?').get(actor.companyId, def.code).v ?? 0) + 1;
        const id = Number(db.prepare("INSERT INTO xl_templates (company_id, import_type, template_version, columns_json, instructions, settings_json, status, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, 'template_change')")
          .run(actor.companyId, def.code, v, JSON.stringify(b.columns), b.instructions, JSON.stringify(b.settings), b.reason, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'xl_templates', entityId: id, action: 'propose', newValues: { importType: def.code, version: v, columns: b.columns, settings: b.settings }, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        const instance = engine.submit(actor, { docType: TEMPLATE_DOC, docId: id, comment: b.reason, context: {} });
        db.prepare('UPDATE xl_templates SET instance_id = ? WHERE id = ?').run(instance.id, id);
        return { id, version: v, workflow: instance };
      });
    },
    activate(instance, actor) {
      const r = db.prepare('SELECT * FROM xl_templates WHERE id = ?').get(Number(instance.docId));
      if (!r) return;
      const stamp = nowIso();
      db.prepare("UPDATE xl_templates SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND import_type = ? AND status = 'ACTIVE'").run(actor.user, stamp, r.company_id, r.import_type);
      db.prepare("UPDATE xl_templates SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, stamp, r.id);
      writeAudit(db, { entity: 'xl_templates', entityId: r.id, action: 'activate', newValues: { importType: r.import_type, version: r.template_version }, actor: actor.user, companyId: r.company_id });
      publishEvent(db, { type: 'xl.template.changed', entity: 'import_template', entityId: r.id, actorId: actor.user, companyId: r.company_id, data: { importType: r.import_type, version: r.template_version } });
    },
    reject(instance, actor) { db.prepare("UPDATE xl_templates SET status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'PENDING'").run(actor.user, nowIso(), Number(instance.docId)); },
  };

  // ---- the check of a workbook against a type ----
  /** Read and check a workbook: { structure?: string[], rows: [{ line, cells, values, ids, errors: [{ key, label, value, message, code }], action }], warnings: string[] }. */
  async function check(actor, def, eff, buffer, { onExisting }) {
    const ctx = ctxOf(actor);
    let wb;
    try { wb = await readWorkbook(buffer); } catch { return { structure: ['That file could not be read as an Excel workbook (.xlsx).'], rows: [], warnings: [] }; }
    if (wb.meta?.importType && wb.meta.importType !== def.code) return { structure: [`This file is the template of another import (${wb.meta.importType}), not ${def.code}. Download the template of ${def.label}.`], rows: [], warnings: [] };
    if (wb.meta?.columns?.length && wb.meta.columns.join(',') !== def.columns.map((c) => c.key).join(',')) return { structure: [`The columns of this file are out of date (it is version ${wb.meta.version}, the template is now version ${eff.version}). Download the template again.`], rows: [], warnings: [] };
    const sheet = wb.sheets.find((s) => s.name === 'Data') ?? wb.sheets.find((s) => !['Instructions', 'Lists', '__xl'].includes(s.name));
    if (!sheet || sheet.rows.length === 0) return { structure: ['The file has no data sheet.'], rows: [], warnings: [] };
    const norm = (s) => String(s ?? '').replace(/\s*\*\s*$/, '').trim().toLowerCase();
    const header = sheet.rows[0].map(norm);
    const at = {};
    const structure = [];
    for (const c of eff.columns) {
      const i = [c.label, c.key, def.columns.find((x) => x.key === c.key).label].map(norm).map((n) => header.indexOf(n)).find((x) => x >= 0);
      at[c.key] = i ?? -1;
      if ((c.required) && at[c.key] < 0) structure.push(`The column "${c.label}" is missing from the header row.`);
    }
    const warnings = header.map((h, i) => ({ h, i })).filter((x) => x.h && !Object.values(at).includes(x.i)).map((x) => `The column "${sheet.rows[0][x.i]}" is not part of the template and was ignored.`);
    const dataRows = sheet.rows.slice(1).map((r, i) => ({ r, line: i + 2 })).filter((x) => x.r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''));
    if (dataRows.length > eff.maxRows) structure.push(`The file has ${dataRows.length} rows; at most ${eff.maxRows} are allowed in one file. Split it.`);
    if (dataRows.length === 0) structure.push('The file has no rows to import.');
    if (structure.length) return { structure, rows: [], warnings };
    const formulaAt = new Map(wb.formulas.filter((f) => f.sheet === sheet.name).map((f) => [`${f.row}:${f.col}`, true]));
    const rows = checkRows(ctx, def, eff, dataRows.map(({ r, line }) => ({ line, raw: Object.fromEntries(eff.columns.map((c) => [c.key, at[c.key] >= 0 ? r[at[c.key]] ?? null : null])), formulas: new Set(eff.columns.filter((c) => at[c.key] >= 0 && formulaAt.has(`${line}:${at[c.key]}`)).map((c) => c.key)) })), { onExisting });
    return { structure: [], rows, warnings };
  }

  /** The row-level check shared by a file and the bulk entry grid (part 29.04): types, required, lookups, duplicates in the batch and in the data, the module's rules. */
  function checkRows(ctx, def, eff, input, { onExisting }) {
    const seen = new Map();
    const rows = [];
    for (const { line, raw: cellsIn, formulas = new Set() } of input) {
      const row = { line, cells: {}, values: {}, ids: {}, errors: [], action: 'ERROR' };
      for (const c of eff.columns) {
        const raw = cellsIn[c.key] ?? null;
        row.cells[c.key] = raw instanceof Date ? raw.toISOString().slice(0, 10) : raw === null ? '' : String(raw);
        if (formulas.has(c.key)) { row.errors.push({ key: c.key, label: c.label, value: row.cells[c.key], message: `${c.label} holds a formula. Paste the value instead (a formula could run code in a spreadsheet).`, code: 'FORMULA' }); continue; }
        const p = parseCell(ctx, c, raw);
        if (p.error) row.errors.push({ key: c.key, label: c.label, value: row.cells[c.key], message: p.error, code: p.code });
        else { row.values[c.key] = p.value; if (p.id !== undefined) row.ids[c.key] = p.id; }
      }
      if (!row.errors.length) {
        const keyOf = def.keys.map((k) => String(row.values[k] ?? '').toLowerCase()).join('|');
        const dup = seen.get(keyOf);
        if (dup) row.errors.push({ key: def.keys[0], label: eff.columns.find((c) => c.key === def.keys[0]).label, value: row.cells[def.keys[0]], message: `Duplicate of row ${dup}: ${def.keys.map((k) => row.cells[k]).join(', ')} is already in this file.`, code: 'DUPLICATE_IN_FILE' });
        else seen.set(keyOf, line);
      }
      if (!row.errors.length) {
        for (const p of def.validateRow?.(ctx, row.values, row.ids) ?? []) { const c = eff.columns.find((x) => x.key === p.column); row.errors.push({ key: p.column ?? null, label: c?.label ?? null, value: p.column ? row.cells[p.column] : '', message: p.message, code: p.code ?? 'RULE' }); }
      }
      if (!row.errors.length) {
        const existing = def.findExisting?.(ctx, row.values, row.ids) ?? null;
        row.existing = existing;
        if (existing) {
          if (onExisting === 'UPDATE') row.action = 'UPDATE';
          else if (onExisting === 'SKIP') row.action = 'SKIP';
          else row.errors.push({ key: def.keys[0], label: eff.columns.find((c) => c.key === def.keys[0]).label, value: row.cells[def.keys[0]], message: `${def.keys.map((k) => row.cells[k]).join(', ')} already exists. Choose to update or skip existing records, or remove the row.`, code: 'DUPLICATE_IN_DATA' });
        } else row.action = 'CREATE';
      }
      if (row.errors.length) row.action = 'ERROR';
      rows.push(row);
    }
    return rows;
  }

  // ---- jobs ----
  const jobRow = (j, actor) => ({
    id: j.id, importType: j.import_type, typeLabel: importTypes.get(j.import_type)?.label ?? j.import_type, templateVersion: j.template_version, fileName: j.file_name, fileHash: j.file_hash, status: j.status, mode: j.mode, onExisting: j.on_existing, totalRows: j.total_rows, validRows: j.valid_rows, errorRows: j.error_rows,
    createRows: j.create_rows, updateRows: j.update_rows, skipRows: j.skip_rows, committedRows: j.committed_rows, progress: j.progress, lastError: j.last_error, startedBy: j.started_by, startedAt: j.started_at, validatedAt: j.validated_at, committedBy: j.committed_by, committedAt: j.committed_at, cancelledAt: j.cancelled_at,
    rowVersion: j.version, result: JSON.parse(j.result_json || '{}'), canCommit: j.status === 'PREVIEW' || j.status === 'PARTIAL', canCancel: ['PREVIEW', 'PARTIAL', 'FAILED', 'UPLOADED'].includes(j.status), mine: j.started_by === actor?.user,
  });
  const loadJob = (actor, id) => {
    const j = db.prepare('SELECT * FROM xl_jobs WHERE id = ? AND company_id = ? AND is_active = 1').get(id, actor.companyId);
    if (!j) throw notFound('That import job does not exist.');
    if (j.started_by !== actor.user && !anywhere(actor, 'xl.job.view_all')) throw notFound('That import job does not exist.');
    return j;
  };
  const owns = (actor, j) => j.started_by === actor.user;
  const label = (j) => importTypes.get(j.import_type)?.label ?? j.import_type;

  const job = {
    async upload(actor, { importType, fileName, buffer, onExisting = 'ERROR' }) {
      const def = defOf(importType);
      mustImport(actor, def);
      if (!def.onExisting.includes(onExisting)) throw badRequest(`${def.label} cannot ${onExisting.toLowerCase()} existing records.`, [{ field: 'onExisting', message: `Choose ${def.onExisting.join(' or ').toLowerCase()}.` }]);
      if (!buffer?.length) throw badRequest('The file is empty.', [{ field: 'file', message: 'Choose the filled template.' }]);
      if (buffer.length > MAX_FILE_BYTES) throw badRequest(`The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`, [{ field: 'file', message: 'is too large' }]);
      if (!/\.xlsx$/i.test(fileName)) throw badRequest('Only .xlsx files can be imported.', [{ field: 'file', message: 'must be an .xlsx file' }]);
      // the virus scan covers the file and every part inside it (the parts are compressed)
      const verdict = await runScanners([scanner], async function* () { yield buffer; });
      let inner = verdict;
      if (verdict.status === 'CLEAN') {
        try {
          const wb = await readWorkbook(buffer);
          for (const [name, bytes] of Object.entries(wb.entries)) { inner = await runScanners([scanner], async function* () { yield Buffer.from(bytes); }); if (inner.status === 'INFECTED') { inner = { ...inner, detail: `${inner.detail} in ${name}` }; break; } }
        } catch { /* not a workbook: the check says so */ }
      }
      if (inner.status === 'INFECTED') {
        writeAudit(db, { entity: 'xl_jobs', entityId: importType, action: 'upload_infected', newValues: { fileName, detail: inner.detail }, actor: actor.user, companyId: actor.companyId });
        throw unprocessable(`The file was refused by the virus scan (${inner.detail}).`);
      }
      const hash = sha256(buffer);
      const day = engine.clock();
      const key = `c${actor.companyId}/xl/${day.getUTCFullYear()}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.xlsx`;
      await storage.putBuffer(key, buffer);
      return transaction(db, () => {
        const f = db.prepare(`INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, scanned_at, linked_entity, linked_id, version_no, retention_class, created_by, source_type)
          VALUES (?, ?, ?, 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'document', ?, ?, 'CLEAN', ?, 'xl_job', 0, 1, 'standard', ?, 'xl_upload')`).run(actor.companyId, key, fileName.slice(0, 200), buffer.length, hash, nowIso(), actor.user);
        const fileId = Number(f.lastInsertRowid);
        const eff = effective(actor.companyId, def);
        const id = Number(db.prepare("INSERT INTO xl_jobs (company_id, import_type, template_version, file_id, file_name, file_hash, status, on_existing, started_by, started_at, actor_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'UPLOADED', ?, ?, ?, ?, ?, 'xl_upload')")
          .run(actor.companyId, def.code, eff.version, fileId, fileName.slice(0, 200), hash, onExisting, actor.user, nowIso(), JSON.stringify(snapshot(actor)), actor.user).lastInsertRowid);
        db.prepare('UPDATE core_files SET linked_id = ? WHERE id = ?').run(id, fileId);
        const cj = jobs.enqueue('xl.validate', { jobId: id }, { createdBy: actor.user, companyId: actor.companyId });
        db.prepare('UPDATE xl_jobs SET core_job_id = ? WHERE id = ?').run(cj?.jobId ?? null, id);
        writeAudit(db, { entity: 'xl_jobs', entityId: id, action: 'upload', newValues: { importType: def.code, fileName, size: buffer.length, hash, onExisting }, actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'xl.job.uploaded', entity: 'import_job', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { importType: def.code, fileName } });
        return jobRow(db.prepare('SELECT * FROM xl_jobs WHERE id = ?').get(id), actor);
      });
    },
    /** The background job that checks the file: writes the errors, the counts and the action of each row. */
    async validate(ctx0) {
      const j = db.prepare('SELECT * FROM xl_jobs WHERE id = ?').get(ctx0.params.jobId);
      if (!j || j.status !== 'UPLOADED') return { skipped: true };
      const def = defOf(j.import_type);
      const actor = actorOf(j);
      db.prepare("UPDATE xl_jobs SET status = 'VALIDATING', updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), j.id);
      const buffer = await readFile(j);
      const eff = effective(j.company_id, def);
      const res = await check(actor, def, eff, buffer, { onExisting: j.on_existing });
      saveCheck(j, res);
      ctx0.setProgress?.(100, 'Checked');
      tell(j, 'xl.job.checked', { label: label(j), file: j.file_name, valid: String(res.rows.filter((r) => r.action !== 'ERROR').length), errors: String(res.rows.filter((r) => r.action === 'ERROR').length) });
      return { rows: res.rows.length };
    },
    get(actor, id) {
      const j = loadJob(actor, id);
      const errs = db.prepare('SELECT COUNT(*) AS n FROM xl_job_errors WHERE job_id = ?').get(j.id).n;
      return { ...jobRow(j, actor), errorCount: errs, structure: JSON.parse(j.result_json || '{}').structure ?? [], warnings: JSON.parse(j.result_json || '{}').warnings ?? [] };
    },
    list(actor, q = {}) {
      if (!anywhere(actor, 'xl.import.use')) throw forbidden('You may not use the Import Center (permission xl.import.use).');
      const all = anywhere(actor, 'xl.job.view_all') && q.scope !== 'mine';
      const where = ['j.company_id = :c', 'j.is_active = 1'];
      const p = { c: actor.companyId };
      if (!all) { where.push('j.started_by = :me'); p.me = actor.user; }
      if (q.importType) { where.push('j.import_type = :t'); p.t = q.importType; }
      if (q.status) { where.push('j.status = :s'); p.s = q.status; }
      if (q.from) { where.push('j.started_at >= :from'); p.from = `${q.from}T00:00:00.000Z`; }
      if (q.to) { where.push('j.started_at <= :to'); p.to = `${q.to}T23:59:59.999Z`; }
      if (q.q) { where.push("(j.file_name LIKE :q ESCAPE '\\' OR j.started_by LIKE :q ESCAPE '\\')"); p.q = `%${String(q.q).replace(/[\\%_]/g, '\\$&')}%`; }
      const w = where.join(' AND ');
      const sorts = { newest: 'j.started_at DESC, j.id DESC', oldest: 'j.started_at ASC, j.id ASC', type: 'j.import_type ASC, j.id DESC', status: 'j.status ASC, j.id DESC' };
      const total = db.prepare(`SELECT COUNT(*) AS n FROM xl_jobs j WHERE ${w}`).get(p).n;
      const limit = [25, 50, 100].includes(Number(q.limit)) ? Number(q.limit) : 25;
      const offset = Math.max(0, Number(q.offset) || 0);
      const rows = db.prepare(`SELECT j.* FROM xl_jobs j WHERE ${w} ORDER BY ${sorts[q.sort] ?? sorts.newest} LIMIT :lim OFFSET :off`).all({ ...p, lim: limit, off: offset }).map((j) => jobRow(j, actor));
      const byStatus = db.prepare(`SELECT j.status AS status, COUNT(*) AS n FROM xl_jobs j WHERE ${w} GROUP BY j.status ORDER BY n DESC`).all(p);
      return { rows, total, limit, offset, summary: { total, byStatus }, canViewAll: anywhere(actor, 'xl.job.view_all'), all };
    },
    /** A page of the rows of the file as read, with what each will do (create, update, skip or the errors), sensitive columns masked. */
    async preview(actor, id, { limit = 50, offset = 0 } = {}) {
      const j = loadJob(actor, id);
      if (!['PREVIEW', 'PARTIAL', 'COMMITTED', 'COMMITTING'].includes(j.status)) throw conflict('This job has no preview: its file is not checked yet, or it failed.');
      const def = defOf(j.import_type);
      const eff = effective(j.company_id, def);
      const wb = await readWorkbook(await readFile(j));
      const sheet = wb.sheets.find((s) => s.name === 'Data') ?? wb.sheets.find((s) => !['Instructions', 'Lists', '__xl'].includes(s.name));
      const norm = (s) => String(s ?? '').replace(/\s*\*\s*$/, '').trim().toLowerCase();
      const header = sheet.rows[0].map(norm);
      const at = Object.fromEntries(eff.columns.map((c) => [c.key, [c.label, c.key, def.columns.find((x) => x.key === c.key).label].map(norm).map((n) => header.indexOf(n)).find((x) => x >= 0) ?? -1]));
      const actions = JSON.parse(j.result_json || '{}').actions ?? [];
      const errs = db.prepare('SELECT row_no, column_key, message FROM xl_job_errors WHERE job_id = ? ORDER BY row_no, id').all(j.id);
      const byRow = new Map();
      for (const e of errs) { if (!byRow.has(e.row_no)) byRow.set(e.row_no, []); byRow.get(e.row_no).push(e); }
      const dataRows = sheet.rows.slice(1).map((r, i) => ({ r, line: i + 2 })).filter((x) => x.r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''));
      const mask = (c, v) => (c.sensitive && !(c.unmaskPermission && may(actor, c.unmaskPermission)) && v !== '' ? '••••' : v);
      const page = dataRows.slice(offset, offset + limit).map(({ r, line }, k) => ({ line, action: actions[offset + k] ?? 'ERROR', errors: (byRow.get(line) ?? []).map((e) => ({ column: e.column_key, message: e.message })), cells: Object.fromEntries(eff.columns.map((c) => { const v = at[c.key] >= 0 ? r[at[c.key]] : ''; return [c.key, mask(c, v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v))]; })) }));
      return { columns: eff.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, required: Boolean(c.required) })), rows: page, total: dataRows.length, limit, offset };
    },
    errors(actor, id, { limit = 100, offset = 0 } = {}) {
      const j = loadJob(actor, id);
      const total = db.prepare('SELECT COUNT(*) AS n FROM xl_job_errors WHERE job_id = ?').get(j.id).n;
      const rows = db.prepare('SELECT * FROM xl_job_errors WHERE job_id = ? ORDER BY row_no, id LIMIT ? OFFSET ?').all(j.id, Math.min(limit, 500), offset).map((e) => ({ id: e.id, sheet: e.sheet, row: e.row_no, column: e.column_label ?? e.column_key ?? '', columnKey: e.column_key, value: e.value ?? '', message: e.message, code: e.code }));
      return { rows, total, limit, offset, structure: JSON.parse(j.result_json || '{}').structure ?? [] };
    },
    /** The file the person filled, with a column that says what is wrong with each row, to correct and upload again (FR-03). */
    async errorFile(actor, id) {
      const j = loadJob(actor, id);
      const def = defOf(j.import_type);
      const eff = effective(j.company_id, def);
      const wb = await readWorkbook(await readFile(j));
      const sheet = wb.sheets.find((s) => s.name === 'Data') ?? wb.sheets[0];
      const errs = db.prepare('SELECT row_no, column_label, column_key, message FROM xl_job_errors WHERE job_id = ? ORDER BY row_no, id').all(j.id);
      const byRow = new Map();
      for (const e of errs) { if (!byRow.has(e.row_no)) byRow.set(e.row_no, []); byRow.get(e.row_no).push(`${e.column_label ?? e.column_key ?? 'Row'}: ${e.message}`); }
      const head = sheet.rows[0].map((h, i) => ({ key: `c${i}`, label: String(h ?? '') }));
      const rows = [...byRow.keys()].filter((n) => n >= 2).map((n) => Object.fromEntries([...sheet.rows[n - 1].map((v, i) => [`c${i}`, v instanceof Date ? v.toISOString().slice(0, 10) : v]), ['row', n], ['errors', byRow.get(n).join('\n')]]));
      const structure = JSON.parse(j.result_json || '{}').structure ?? [];
      const out = tableWorkbook({ name: 'Errors', columns: [{ key: 'row', label: 'Row' }, ...head, { key: 'errors', label: 'Errors' }], rows: structure.length ? structure.map((s) => ({ row: 0, errors: s })) : rows });
      void eff;
      writeAudit(db, { entity: 'xl_jobs', entityId: j.id, action: 'error_file', actor: actor.user, companyId: actor.companyId });
      return { buffer: out, fileName: `${j.file_name.replace(/\.xlsx$/i, '')}-errors.xlsx` };
    },
    commit(actor, id, b = {}) {
      const j = loadJob(actor, id);
      if (!owns(actor, j) && !anywhere(actor, 'xl.job.view_all')) throw notFound('That import job does not exist.');
      const def = defOf(j.import_type);
      mustImport(actor, def);
      if (b.version != null && b.version !== j.version) throw conflict('Someone changed this job. Refresh it and look again.');
      if (!['PREVIEW', 'PARTIAL'].includes(j.status)) throw conflict(`This job is ${j.status.toLowerCase()}; only a checked job (or one that stopped part-way) can be committed.`);
      const eff = effective(j.company_id, def);
      const mode = b.mode ?? j.mode;
      if (mode === 'CHUNKED' && !(def.chunked && eff.settings.allowChunked)) throw unprocessable(`${def.label} is imported all or nothing; chunked import is not enabled for it.`);
      if (j.error_rows > 0 && !b.skipInvalid) throw conflict(`${j.error_rows} row(s) have errors. Correct the file and upload it again, or choose to import only the correct rows.`);
      if (j.valid_rows - j.skip_rows === 0 && j.status === 'PREVIEW' && j.create_rows + j.update_rows === 0) throw unprocessable('There is nothing to import: no row is both correct and new or changed.');
      db.prepare("UPDATE xl_jobs SET status = 'COMMITTING', mode = ?, committed_by = ?, commit_actor_json = ?, last_error = NULL, progress = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(mode, actor.user, JSON.stringify(snapshot(actor)), actor.user, nowIso(), j.id);
      const cj = jobs.enqueue('xl.commit', { jobId: j.id, skipInvalid: Boolean(b.skipInvalid) }, { createdBy: actor.user, companyId: actor.companyId });
      db.prepare('UPDATE xl_jobs SET core_job_id = ? WHERE id = ?').run(cj?.jobId ?? null, j.id);
      writeAudit(db, { entity: 'xl_jobs', entityId: j.id, action: 'commit', newValues: { mode, skipInvalid: Boolean(b.skipInvalid), rows: j.valid_rows }, actor: actor.user, companyId: actor.companyId });
      return job.get(actor, j.id);
    },
    /** The background job that commits: the file is read again and checked again (the data may have changed since the preview), then the rows are created or updated through the module. */
    async runCommit(ctx0) {
      const j = db.prepare('SELECT * FROM xl_jobs WHERE id = ?').get(ctx0.params.jobId);
      if (!j || j.status !== 'COMMITTING') return { skipped: true };
      const def = defOf(j.import_type);
      const actor = actorOf(j, true);
      const eff = effective(j.company_id, def);
      const res = await check(actor, def, eff, await readFile(j), { onExisting: j.on_existing });
      // resuming a chunked commit: the rows saved before the stop exist now, so the check sees them as existing; they are done, not errors
      if (j.mode === 'CHUNKED' && j.committed_rows > 0 && res.rows.length) {
        const planned = (JSON.parse(j.result_json || '{}').actions ?? []).map((x, i) => [x, i]).filter(([x]) => x === 'CREATE' || x === 'UPDATE').slice(0, j.committed_rows).map(([, i]) => i);
        for (const i of planned) if (res.rows[i]) { res.rows[i].action = 'DONE'; res.rows[i].errors = []; }
      }
      const bad = res.rows.filter((r) => r.action === 'ERROR');
      if (res.structure.length || (bad.length && !ctx0.params.skipInvalid)) {
        saveCheck(j, res, { backTo: 'PREVIEW', note: 'The data changed since the preview; the file was checked again and nothing was committed.' });
        return { stopped: true };
      }
      const todo = res.rows.filter((r) => r.action === 'CREATE' || r.action === 'UPDATE');
      const skipped = res.rows.filter((r) => r.action === 'SKIP').length;
      const chunk = j.mode === 'CHUNKED' ? Math.max(1, Math.min(eff.settings.chunkSize, 5000)) : todo.length || 1;
      const ctx = ctxOf(actor);
      const stamp = nowIso();
      const done = { created: j.status === 'COMMITTING' ? JSON.parse(j.result_json || '{}').created ?? 0 : 0, updated: JSON.parse(j.result_json || '{}').updated ?? 0, refs: JSON.parse(j.result_json || '{}').refs ?? [] };
      const start = 0;
      if (j.mode !== 'CHUNKED') { done.created = 0; done.updated = 0; done.refs = []; }
      let at = start;
      let snap = { created: done.created, updated: done.updated, refs: [...done.refs] };
      try {
        while (at < todo.length) {
          snap = { created: done.created, updated: done.updated, refs: [...done.refs] };
          const part = todo.slice(at, at + chunk);
          transaction(db, () => {
            for (const r of part) {
              let out;
              try { out = def.commitRow(ctx, { row: r.values, ids: r.ids, existing: r.existing, action: r.action.toLowerCase(), line: r.line }); } catch (e) { e.line = r.line; throw e; }
              if (r.action === 'CREATE') done.created += 1; else done.updated += 1;
              if (out?.ref && done.refs.length < 200) done.refs.push({ line: r.line, ref: out.ref, id: out.id ?? null });
              db.prepare('UPDATE xl_jobs SET committed_rows = committed_rows + 1 WHERE id = ?').run(j.id);
            }
            if (j.mode === 'CHUNKED') db.prepare('UPDATE xl_jobs SET result_json = ?, progress = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(j.result_json || '{}'), ...done }), Math.round(((at + part.length) / todo.length) * 100), nowIso(), j.id);
          });
          at += part.length;
          ctx0.setProgress?.(Math.round((at / todo.length) * 100), `${at} of ${todo.length}`);
        }
      } catch (e) {
        // all or nothing: the transaction of the whole job (or of the chunk) was rolled back
        Object.assign(done, snap);
        const partial = j.mode === 'CHUNKED' && at > 0;
        const msg = `Row ${e.line ?? '?'}: ${e.message}`;
        if (!partial) db.prepare('UPDATE xl_jobs SET committed_rows = 0 WHERE id = ?').run(j.id);
        db.prepare('INSERT INTO xl_job_errors (company_id, job_id, sheet, row_no, column_key, column_label, value, message, code, created_by, source_type) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)').run(j.company_id, j.id, 'Data', e.line ?? 0, `Commit stopped: ${e.message}`, 'COMMIT_FAILED', 'system', 'xl_commit');
        db.prepare('UPDATE xl_jobs SET status = ?, last_error = ?, result_json = ?, progress = 0, updated_at = ?, version = version + 1 WHERE id = ?').run(partial ? 'PARTIAL' : 'PREVIEW', partial ? `${msg}. ${db.prepare('SELECT committed_rows AS n FROM xl_jobs WHERE id = ?').get(j.id).n} row(s) were saved; commit again to continue after the cause is removed.` : `${msg}. Nothing was saved.`, JSON.stringify({ ...JSON.parse(j.result_json || '{}'), ...done }), nowIso(), j.id);
        writeAudit(db, { entity: 'xl_jobs', entityId: j.id, action: 'commit_failed', newValues: { row: e.line ?? null, message: e.message, partial }, actor: actor.user, companyId: j.company_id });
        publishEvent(db, { type: 'xl.job.failed', entity: 'import_job', entityId: j.id, actorId: actor.user, companyId: j.company_id, data: { importType: j.import_type, row: e.line ?? null, message: e.message } });
        return { failed: true };
      }
      db.prepare("UPDATE xl_jobs SET status = 'COMMITTED', committed_at = ?, progress = 100, create_rows = ?, update_rows = ?, skip_rows = ?, error_rows = ?, result_json = ?, last_error = NULL, updated_at = ?, version = version + 1 WHERE id = ?")
        .run(stamp, done.created, done.updated, skipped, bad.length, JSON.stringify({ ...JSON.parse(db.prepare('SELECT result_json FROM xl_jobs WHERE id = ?').get(j.id).result_json || '{}'), created: done.created, updated: done.updated, skipped, left: bad.length, refs: done.refs }), nowIso(), j.id);
      writeAudit(db, { entity: 'xl_jobs', entityId: j.id, action: 'committed', newValues: { created: done.created, updated: done.updated, skipped, left: bad.length }, actor: actor.user, companyId: j.company_id });
      publishEvent(db, { type: 'xl.job.committed', entity: 'import_job', entityId: j.id, actorId: actor.user, companyId: j.company_id, data: { importType: j.import_type, created: done.created, updated: done.updated } });
      tell(j, 'xl.job.committed', { label: label(j), file: j.file_name, created: String(done.created), updated: String(done.updated), skipped: String(skipped) }, j.committed_by);
      return done;
    },
    cancel(actor, id) {
      const j = loadJob(actor, id);
      if (!owns(actor, j) && !anywhere(actor, 'xl.job.view_all')) throw notFound('That import job does not exist.');
      if (!['PREVIEW', 'PARTIAL', 'FAILED', 'UPLOADED'].includes(j.status)) throw conflict(`This job is ${j.status.toLowerCase()}; it cannot be cancelled.`);
      db.prepare("UPDATE xl_jobs SET status = 'CANCELLED', cancelled_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, nowIso(), j.id);
      writeAudit(db, { entity: 'xl_jobs', entityId: j.id, action: 'cancel', actor: actor.user, companyId: actor.companyId });
      publishEvent(db, { type: 'xl.job.cancelled', entity: 'import_job', entityId: j.id, actorId: actor.user, companyId: actor.companyId, data: { importType: j.import_type } });
      return job.get(actor, j.id);
    },
  };

  // what the jobs share
  /** What a background job needs to act as the person: the roles and the identity of the request, kept with the job (a person's own rights, never more). */
  const snapshot = (actor) => ({ roles: actor.roles ?? [], userId: actor.userId ?? null });
  const actorOf = (j, committing = false) => {
    const user = committing ? j.committed_by : j.started_by;
    const kept = JSON.parse((committing ? j.commit_actor_json : j.actor_json) || '{}');
    const u = db.prepare('SELECT id, roles_json FROM iam_users WHERE company_id = ? AND username = ?').get(j.company_id, user);
    return { user, userId: kept.userId ?? u?.id, roles: kept.roles?.length ? kept.roles : u ? JSON.parse(u.roles_json || '[]') : [], companyId: j.company_id };
  };
  async function readFile(j) {
    const f = db.prepare('SELECT storage_key FROM core_files WHERE id = ?').get(j.file_id);
    const chunks = [];
    for await (const c of storage.createReadStream(f.storage_key)) chunks.push(c);
    return Buffer.concat(chunks);
  }
  function saveCheck(j, res, { backTo = null, note = null } = {}) {
    const bad = res.rows.filter((r) => r.action === 'ERROR');
    const counts = { create: res.rows.filter((r) => r.action === 'CREATE').length, update: res.rows.filter((r) => r.action === 'UPDATE').length, skip: res.rows.filter((r) => r.action === 'SKIP').length };
    transaction(db, () => {
      db.prepare('DELETE FROM xl_job_errors WHERE job_id = ?').run(j.id);
      const ins = db.prepare('INSERT INTO xl_job_errors (company_id, job_id, sheet, row_no, column_key, column_label, value, message, code, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      let n = 0;
      for (const s of res.structure) ins.run(j.company_id, j.id, 'Data', 0, null, null, null, s, 'STRUCTURE', 'system', 'xl_check');
      for (const r of bad) for (const e of r.errors) { if (n >= 20_000) break; ins.run(j.company_id, j.id, 'Data', r.line, e.key, e.label, String(e.value ?? '').slice(0, 300), e.message, e.code, 'system', 'xl_check'); n += 1; }
      const failed = res.structure.length > 0;
      db.prepare('UPDATE xl_jobs SET status = ?, total_rows = ?, valid_rows = ?, error_rows = ?, create_rows = ?, update_rows = ?, skip_rows = ?, committed_rows = 0, progress = 0, validated_at = ?, result_json = ?, last_error = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(backTo ?? (failed ? 'FAILED' : 'PREVIEW'), res.rows.length, res.rows.length - bad.length, bad.length, counts.create, counts.update, counts.skip, nowIso(), JSON.stringify({ structure: res.structure, warnings: res.warnings, actions: res.rows.map((r) => r.action), checked: counts }), note ?? (failed ? res.structure[0] : null), nowIso(), j.id);
      publishEvent(db, { type: 'xl.job.validated', entity: 'import_job', entityId: j.id, actorId: j.started_by, companyId: j.company_id, data: { importType: j.import_type, rows: res.rows.length, errors: bad.length } });
    });
  }
  function tell(j, code, data, user = j.started_by) {
    if (db.prepare("SELECT 1 FROM iam_users WHERE company_id = ? AND username = ? AND is_active = 1").get(j.company_id, user)) notif.notify({ companyId: j.company_id, templateCode: code, recipients: [`user:${user}`], data, link: `/import/job?id=${j.id}`, sourceType: 'xl_job', sourceId: j.id, eventKey: `xl:${j.id}:${code}:${j.version}:${nowIso()}` });
  }

  // ---- exports of lists (FR-06) ----
  const exports = {
    list(actor) { return [...exportSources.values()].filter((d) => anywhere(actor, d.permission)).map((d) => ({ code: d.code, label: d.label, columns: d.columns.map((c) => ({ key: c.key, label: c.label })) })); },
    /** Any registered list, in xlsx, csv or pdf: the rows are the module's (limited to what the person may see), sensitive columns are masked, every cell that could run as a formula is made inert. */
    run(actor, code, { format = 'xlsx', filters = {} } = {}) {
      const d = exportSources.get(code);
      if (!d) throw notFound(`There is no export ${code}.`);
      if (!anywhere(actor, d.permission)) throw forbidden(`You may not export ${d.label} (permission ${d.permission}).`);
      if (!FORMATS[format]) throw badRequest('Use xlsx, csv or pdf.', [{ field: 'format', message: 'Use xlsx, csv or pdf' }]);
      const rows = d.rows(ctxOf(actor), filters);
      if (rows.length > EXPORT_MAX_ROWS) throw unprocessable(`The export has more than ${EXPORT_MAX_ROWS} rows. Narrow it with a filter.`);
      const unmask = (c) => !c.sensitive || (c.unmaskPermission && may(actor, c.unmaskPermission));
      const shown = rows.map((r) => Object.fromEntries(d.columns.map((c) => [c.key, unmask(c) ? r[c.key] : '••••'])));
      const day = engine.clock().toISOString().slice(0, 10);
      writeAudit(db, { entity: 'xl_exports', entityId: code, action: 'export', newValues: { rows: rows.length, format, filters }, actor: actor.user, companyId: actor.companyId });
      return { buffer: writeExport(format, { columns: d.columns, rows: shown, footer: [`${d.label}. Exported by ${actor.user} at ${formatDateTime(nowIso())}. Only what you may see is listed; sensitive fields are masked.`], sheetName: d.label.slice(0, 30), title: d.label }), type: FORMATS[format], fileName: `${code.replace(/\./g, '-')}-${day}.${format}`, rows: rows.length };
    },
  };

  // ---- part 29.04: the bulk entry grid checks and commits rows typed or pasted in the browser with the same rules as a file ----
  const grid = {
    /** The columns of a type for the grid: label, type, required, help and the drop-down values (enum, Yes/No, lookups up to 1,000). */
    columns(actor, code) {
      const def = defOf(code); mustImport(actor, def); const eff = effective(actor.companyId, def); const ctx = ctxOf(actor);
      return { code: def.code, label: def.label, module: def.module, version: eff.version, keys: def.keys, onExisting: def.onExisting, maxRows: Math.min(eff.maxRows, 2000), description: def.description ?? '',
        columns: eff.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, required: Boolean(c.required), help: c.help ?? '', values: listOf(ctx, c), min: c.min ?? null, max: c.max ?? null, maxLength: c.maxLength ?? null, sensitive: Boolean(c.sensitive) })) };
    },
    /** Check rows ({ key: raw }); each result gives its errors by column and what it would do. */
    check(actor, code, rows, { onExisting = 'ERROR' } = {}) {
      const def = defOf(code); mustImport(actor, def); const eff = effective(actor.companyId, def);
      if (!def.onExisting.includes(onExisting)) throw badRequest(`${def.label} cannot ${onExisting.toLowerCase()} existing records.`);
      if (rows.length > Math.min(eff.maxRows, 2000)) throw unprocessable(`At most ${Math.min(eff.maxRows, 2000)} rows in one batch.`);
      return checkRows(ctxOf(actor), def, eff, rows.map((raw, i) => ({ line: i + 1, raw })), { onExisting }).map((r) => ({ line: r.line, action: r.action, errors: r.errors.map((e) => ({ column: e.key, message: e.message, code: e.code })) }));
    },
    /** All or nothing: checked again, then every row created or updated through the module inside one savepoint; any failure saves nothing. */
    commit(actor, code, rows, { onExisting = 'ERROR' } = {}) {
      const def = defOf(code); mustImport(actor, def); const eff = effective(actor.companyId, def); const ctx = ctxOf(actor);
      const checked = checkRows(ctx, def, eff, rows.map((raw, i) => ({ line: i + 1, raw })), { onExisting });
      const bad = checked.filter((r) => r.action === 'ERROR');
      if (bad.length) return { ok: false, errors: bad.map((r) => ({ line: r.line, errors: r.errors.map((e) => ({ column: e.key, message: e.message, code: e.code })) })) };
      const out = { ok: true, created: 0, updated: 0, skipped: 0, refs: [] };
      const sp = `bulk_${randomUUID().replace(/-/g, '')}`;
      db.exec(`SAVEPOINT ${sp}`);
      try {
        for (const r of checked) {
          if (r.action === 'SKIP') { out.skipped += 1; continue; }
          let res; try { res = def.commitRow(ctx, { row: r.values, ids: r.ids, existing: r.existing, action: r.action.toLowerCase(), line: r.line }); } catch (e) { e.line = r.line; throw e; }
          if (r.action === 'CREATE') out.created += 1; else out.updated += 1;
          if (res?.ref && out.refs.length < 500) out.refs.push({ line: r.line, ref: res.ref, id: res.id ?? null });
        }
        db.exec(`RELEASE ${sp}`);
      } catch (e) {
        db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`);
        return { ok: false, errors: [{ line: e.line ?? 0, errors: [{ column: null, message: `Nothing was saved: ${e.message}`, code: 'COMMIT_FAILED' }] }] };
      }
      writeAudit(db, { entity: 'xl_templates', entityId: def.code, action: 'bulk_commit', newValues: { created: out.created, updated: out.updated, skipped: out.skipped }, actor: actor.user, companyId: actor.companyId });
      return out;
    },
  };

  return { templates, job, exports, importTypes, effective, grid };
}

// ---- the approval of a change of a template ----
const services = new WeakMap();
export const bind = (db, s) => services.set(db, s);
const bound = (db) => services.get(db);
/** The Excel engine of a database, for the bulk entry workspace (part 29.04). */
export const excelOf = (db) => services.get(db) ?? null;
workflowTypes.register({
  docType: TEMPLATE_DOC,
  label: 'Import template change',
  processOwner: 'SYSADM',
  route: () => '/admin/import-templates',
  describe(db, companyId, id) {
    const r = db.prepare('SELECT * FROM xl_templates WHERE id = ? AND company_id = ?').get(Number(id), companyId);
    return r ? { ref: `${r.import_type} template version ${r.template_version}`, title: 'Change of an import template', originator: r.created_by } : null;
  },
  summarise(db, actor, id) {
    const r = db.prepare('SELECT * FROM xl_templates WHERE id = ?').get(Number(id));
    if (!r) return null;
    const c = JSON.parse(r.columns_json); const s = JSON.parse(r.settings_json);
    return { fields: [{ label: 'Import', value: importTypes.get(r.import_type)?.label ?? r.import_type }, { label: 'Version', value: String(r.template_version) }, { label: 'Columns changed', value: Object.keys(c).join(', ') || 'none' }, { label: 'Chunked commit', value: s.allowChunked ? `Yes, ${s.chunkSize} rows at a time` : 'No' }, { label: 'Reason', value: r.reason ?? '' }] };
  },
  defaultDefinition: { name: 'Import template approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('CHECK', 'System administrator or director', 'SYSADM|DIR')] },
  hooks: {
    onApproved: (db, { instance, actor }) => bound(db)?.templates.activate(instance, actor),
    onRejected: (db, { instance, actor }) => bound(db)?.templates.reject(instance, actor),
    onReturned: (db, { instance, actor }) => bound(db)?.templates.reject(instance, actor),
    onCancelled: (db, { instance, actor }) => bound(db)?.templates.reject(instance, actor),
  },
});
evidenceProviders.register(TEMPLATE_DOC, ({ db, instance }) => {
  const r = db.prepare('SELECT * FROM xl_templates WHERE id = ?').get(Number(instance.docId));
  if (!r) return { sections: [] };
  const was = db.prepare("SELECT * FROM xl_templates WHERE company_id = ? AND import_type = ? AND status = 'ACTIVE'").get(r.company_id, r.import_type);
  const a = was ? JSON.parse(was.columns_json) : {}; const b = JSON.parse(r.columns_json);
  const changed = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const tightened = Object.keys(b).filter((k) => b[k].required === true && a[k]?.required !== true);
  return { sections: [{ code: 'template', title: 'What changes', kind: 'metrics', items: [{ label: 'Columns changed', value: changed.join(', ') || 'none', format: 'text' }, { label: 'Made required', value: tightened.join(', ') || 'none', format: 'text', tone: tightened.length ? 'warn' : undefined }, { label: 'Instructions changed', value: was && was.instructions === r.instructions ? 'No' : 'Yes', format: 'text' }] }], flags: tightened.length ? [{ tone: 'warn', text: 'A column becomes required: files that leave it empty will be refused.' }] : [] };
});

fileEntities.register({
  entity: 'xl_job', label: 'Import file',
  resolve(db, actor, id) {
    const j = db.prepare('SELECT * FROM xl_jobs WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId);
    if (!j) return null;
    const ok = j.started_by === actor.user || authzOf(db).check(actor, 'xl.job.view_all').allowed;
    return ok ? { companyId: j.company_id, projectId: null, siteId: null, canView: true, canEdit: false, locked: true } : null;
  },
});
void inTransaction;
void strFromU8;
void colIndex;
