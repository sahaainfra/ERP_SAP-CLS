import { createHash } from 'node:crypto';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { hasPermissionAnywhere } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { writeExport } from '../../platform/export/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { findFinancialYear } from '../core/api.js';
import { excelOf, importTypes } from '../eng/excel.js';
import { glOf } from '../fin/index.js';
import { invOf } from '../inv/index.js';
import { integrityRegistry } from '../../platform/integrity/registry.js';

// integrity: the workflow states of this part's tables (the Data Health check)
integrityRegistry.register({ statuses: { 'mig_objects': ['PLANNED', 'TRIAL', 'READY', 'SIGNOFF', 'SIGNED_OFF', 'LOADED'], 'mig_runs': ['PASSED', 'FAILED', 'LOADED', 'ROLLED_BACK'], 'mig_cutovers': ['PLANNED', 'FROZEN', 'CLOSED'] } });

/**
 * Part 29.05 — legacy data migration and opening balances: the Migration Cockpit.
 *
 * The migration lead plans the objects (each a kind of data with its owner role, phase and sequence: masters → open documents → balances)
 * and keeps each object's mapping workbook (legacy column names, legacy codes → new codes, cleansing rules). An object is loaded through the
 * service that owns the data, as the person running the load, so every rule and permission applies:
 *   TEMPLATE:<code>  an import type of the Excel engine (29.04 packs), all or nothing
 *   OPENING_TB       the general ledger's opening-balances journal (23.01) dated on the first day of the financial year
 *   OPENING_STOCK    the stores' opening stock import (16.x), all or nothing
 * A trial load runs the real load inside a savepoint, reconciles (counts, totals, trial balance tie-out by account, stock value) against the
 * legacy controls, and rolls everything back: nothing is left but the run and its reconciliation. After two passed trials on the current
 * mapping the lead asks the owner to sign off (financial objects then the CFO). The final load (BR-01) needs that sign-off, the cut-over
 * freeze window and the earlier phases loaded; it keeps the data only if its reconciliation passes, otherwise it is rolled back (the
 * rollback point). A delta load skips records that already exist.
 */
export const MIGRATION_FLAG = 'ff.admin.p2905';
export const SIGNOFF_TYPE = 'mig_object_signoff';
export const PHASES = Object.freeze({ MASTERS: 1, OPEN_DOCUMENTS: 2, BALANCES: 3 });
export const TRIALS_NEEDED = 2;
export const RUNBOOK = Object.freeze(['Freeze the legacy system and announce the window', 'Take the final extracts from the legacy system', 'Load the masters', 'Load the open documents', 'Load the balances', 'Reconcile every object against the legacy reports', 'Go / no-go decision with the business owners', 'Lift the freeze and start on the ERP']);
const FIXED = {
  OPENING_TB: { label: 'Opening trial balance', financial: true, columns: [{ key: 'accountCode', label: 'Account code', required: true }, { key: 'debit', label: 'Debit', type: 'money' }, { key: 'credit', label: 'Credit', type: 'money' }] },
  OPENING_STOCK: { label: 'Opening stock', financial: true, columns: [{ key: 'storeCode', label: 'Store code', required: true }, { key: 'itemCode', label: 'Item code', required: true }, { key: 'qty', label: 'Quantity', type: 'decimal', required: true }, { key: 'rate', label: 'Rate', type: 'money', required: true }, { key: 'binCode', label: 'Bin' }, { key: 'projectCode', label: 'Project' }, { key: 'batchNo', label: 'Batch' }, { key: 'date', label: 'Date' }] },
};
const iso = () => new Date().toISOString();
const paise = (v) => Math.round(Number(String(v ?? '0').replace(/,/g, '')) * 100);
const rs = (p) => (p / 100).toFixed(2);
const MAX_ROWS = 5000;

/** CSV with a header row: quotes, doubled quotes, commas and new lines inside quotes. */
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i += 1; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const data = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!data.length) return { header: [], rows: [] };
  const header = data[0].map((h) => h.trim());
  return { header, rows: data.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

const services = new WeakMap();
export const migrationOf = (db) => services.get(db) ?? null;

/** @param {any} context */
export function createMigrationCockpit(context) {
  const { db } = context;
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, MIGRATION_FLAG)) throw notFound('The migration cockpit is not enabled for this company.');
    if (key && !hasPermissionAnywhere(actor, key)) throw forbidden(`You may not do this (permission ${key}).`);
  };
  const kindOf = (kind) => {
    if (FIXED[kind]) return { kind, ...FIXED[kind] };
    const m = /^TEMPLATE:([A-Z][A-Z0-9_]{1,39})$/.exec(kind ?? ''); const d = m && importTypes.get(m[1]);
    if (!d) throw unprocessable(`Unknown object kind ${kind}. Use OPENING_TB, OPENING_STOCK or TEMPLATE:<an import type>.`);
    return { kind, template: d.code, label: d.label, financial: ['master data'].includes(d.module) && /CURRENCY|EXCHANGE|BANK|GST|TDS|PAYMENT/.test(d.code), columns: d.columns.map((c) => ({ key: c.key, label: c.label, required: Boolean(c.required), type: c.type })) };
  };
  const row = (actor, code) => { const o = db.prepare('SELECT * FROM mig_objects WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(actor.companyId, code); if (!o) throw notFound(`There is no migration object ${code}.`); return o; };
  const trialsOn = (o) => db.prepare("SELECT COUNT(*) AS n FROM mig_runs WHERE company_id = ? AND object_code = ? AND run_type = 'TRIAL' AND status = 'PASSED' AND mapping_version = ?").get(o.company_id, o.code, o.mapping_version).n;

  // ---------------------------------------------------------------- sign-off: owner, then the CFO for financial objects
  const engine = createApprovalEngine({ db, handlers: { [SIGNOFF_TYPE]: {
    authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
    apply(_db, request, actor) {
      const o = db.prepare('SELECT * FROM mig_objects WHERE id = ?').get(request.payload.objectId);
      if (!o || o.mapping_version !== request.payload.mappingVersion) throw conflict('The mapping changed after the sign-off was asked; run the trials again.');
      db.prepare("UPDATE mig_objects SET status = 'SIGNED_OFF', signed_off_by = ?, signed_off_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), actor.user, iso(), o.id);
      writeAudit(db, { companyId: o.company_id, entity: 'mig_objects', entityId: String(o.id), action: 'sign_off', actor: actor.user, newValues: { code: o.code, trials: request.payload.trials } });
      publishEvent(db, { type: 'admin.migration_object.signed_off', entity: 'mig_objects', entityId: o.id, actorId: actor.user, companyId: o.company_id, data: { code: o.code } });
    },
  } } });

  const view = (o, actor, mine = new Set()) => {
    const k = kindOf(o.kind); const last = db.prepare('SELECT * FROM mig_runs WHERE company_id = ? AND object_code = ? ORDER BY id DESC LIMIT 1').get(o.company_id, o.code);
    return { id: o.id, code: o.code, name: o.name, kind: o.kind, kindLabel: k.label, phase: o.phase, sequence: o.sequence, ownerRole: o.owner_role, ownerUser: o.owner_user, financial: Boolean(o.financial), status: o.status, mappingVersion: o.mapping_version,
      trialsPassed: trialsOn(o), trialsNeeded: TRIALS_NEEDED, lastTrialAt: o.last_trial_at, lastRun: last ? { id: last.id, type: last.run_type, status: last.status, at: last.started_at, records: last.records, errors: last.errors } : null,
      signedOffBy: o.signed_off_by, requestId: o.request_id, canSignOff: mine.has(o.request_id), canRun: hasPermissionAnywhere(actor, 'adm.migration.load'), columns: k.columns };
  };

  const objects = {
    board(actor) {
      guard(actor, 'adm.migration.view');
      const mine = new Set(engine.awaiting(actor).map((x) => x.id));
      const rows = db.prepare("SELECT * FROM mig_objects WHERE company_id = ? AND deleted_at IS NULL ORDER BY CASE phase WHEN 'MASTERS' THEN 1 WHEN 'OPEN_DOCUMENTS' THEN 2 ELSE 3 END, sequence, id").all(actor.companyId).map((o) => view(o, actor, mine));
      const cut = db.prepare("SELECT * FROM mig_cutovers WHERE company_id = ? AND deleted_at IS NULL AND status <> 'CLOSED' ORDER BY id DESC LIMIT 1").get(actor.companyId);
      return { rows, columns: ['PLANNED', 'TRIAL', 'READY', 'SIGNOFF', 'SIGNED_OFF', 'LOADED'], cutover: cut ? cutView(cut) : null, canManage: hasPermissionAnywhere(actor, 'adm.migration.manage'), canRun: hasPermissionAnywhere(actor, 'adm.migration.load'),
        kinds: [...Object.keys(FIXED).map((k) => ({ code: k, label: FIXED[k].label })), ...[...importTypes.values()].map((d) => ({ code: `TEMPLATE:${d.code}`, label: d.label }))],
        totals: { objects: rows.length, signedOff: rows.filter((r) => ['SIGNED_OFF', 'LOADED'].includes(r.status)).length, loaded: rows.filter((r) => r.status === 'LOADED').length } };
    },
    get(actor, code) {
      guard(actor, 'adm.migration.view');
      const o = row(actor, code); const mine = new Set(engine.awaiting(actor).map((x) => x.id));
      return { ...view(o, actor, mine), mapping: JSON.parse(o.mapping_json), runs: db.prepare('SELECT * FROM mig_runs WHERE company_id = ? AND object_code = ? ORDER BY id DESC LIMIT 20').all(o.company_id, o.code).map(runView) };
    },
    /** FR-01 the plan: an object with its owner, phase and sequence. */
    create(actor, { code, name, kind, phase, sequence, ownerRole, ownerUser = null }) {
      guard(actor, 'adm.migration.manage');
      const k = kindOf(kind);
      if (db.prepare('SELECT 1 FROM mig_objects WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(actor.companyId, code)) throw conflict(`${code} is already planned.`);
      if (k.template === undefined && phase !== 'BALANCES') throw unprocessable('Opening balances and stock are loaded in the balances phase.');
      const id = Number(db.prepare("INSERT INTO mig_objects (company_id, code, name, kind, phase, sequence, owner_role, owner_user, financial, mapping_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'migration_plan')")
        .run(actor.companyId, code, name, kind, phase, sequence, ownerRole, ownerUser, k.financial ? 1 : 0, JSON.stringify({ rename: {}, upper: [], defaults: {}, values: {}, dropBlank: [] }), actor.user).lastInsertRowid);
      writeAudit(db, { companyId: actor.companyId, entity: 'mig_objects', entityId: String(id), action: 'create', actor: actor.user, newValues: { code, kind, phase, sequence, ownerRole } });
      return objects.get(actor, code);
    },
    /** FR-02 the mapping workbook: legacy column names, value maps per column (legacy code → new code), upper-case, defaults, rows dropped when a column is blank. A change voids the trials and the sign-off. */
    setMapping(actor, code, mapping) {
      guard(actor, 'adm.migration.manage');
      const o = row(actor, code); const k = kindOf(o.kind); const keys = new Set(k.columns.map((c) => c.key));
      const bad = [...Object.values(mapping.rename), ...mapping.upper, ...Object.keys(mapping.defaults), ...Object.keys(mapping.values), ...mapping.dropBlank].filter((c) => !keys.has(c));
      if (bad.length) throw unprocessable(`Not a column of ${k.label}: ${[...new Set(bad)].join(', ')}.`);
      if (o.status === 'LOADED') throw conflict('The object is loaded; its mapping is kept as it was.');
      return transaction(db, () => {
        db.prepare("UPDATE mig_objects SET mapping_json = ?, mapping_version = mapping_version + 1, status = 'PLANNED', signed_off_by = NULL, signed_off_at = NULL, request_id = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(mapping), actor.user, iso(), o.id);
        writeAudit(db, { companyId: actor.companyId, entity: 'mig_objects', entityId: String(o.id), action: 'mapping', actor: actor.user, oldValues: { mappingVersion: o.mapping_version }, newValues: { mappingVersion: o.mapping_version + 1, values: Object.fromEntries(Object.entries(mapping.values).map(([c, m]) => [c, Object.keys(m).length])) } });
        return objects.get(actor, code);
      });
    },
    mappingWorkbook(actor, code) {
      guard(actor, 'adm.migration.view');
      const o = row(actor, code); const m = JSON.parse(o.mapping_json);
      const rows = [...Object.entries(m.values).flatMap(([col, map]) => Object.entries(map).map(([legacy, now]) => ({ kind: 'Code map', column: col, legacy, now }))), ...Object.entries(m.rename).map(([legacy, col]) => ({ kind: 'Legacy column', column: col, legacy, now: col })),
        ...m.upper.map((c) => ({ kind: 'Upper case', column: c, legacy: '', now: '' })), ...Object.entries(m.defaults).map(([c, v]) => ({ kind: 'Default when blank', column: c, legacy: '', now: v })), ...m.dropBlank.map((c) => ({ kind: 'Drop row when blank', column: c, legacy: '', now: '' }))];
      return { buffer: writeExport('xlsx', { title: `${o.name}: mapping v${o.mapping_version}`, sheetName: 'Mapping', columns: [['kind', 'Rule'], ['column', 'Column'], ['legacy', 'Legacy value'], ['now', 'New value']].map(([key, label]) => ({ key, label })), rows }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `mapping-${o.code}-v${o.mapping_version}.xlsx` };
    },
    /** FR-05 BR-01: ask the owner (then the CFO for financial objects) to sign off, once two trials passed on the current mapping. */
    requestSignOff(actor, code, { reason }) {
      guard(actor, 'adm.migration.manage');
      const o = row(actor, code); const n = trialsOn(o);
      if (n < TRIALS_NEEDED) throw unprocessable(`${o.name} has ${n} passed trial load(s) on its current mapping; ${TRIALS_NEEDED} are needed before sign-off.`);
      if (!['TRIAL', 'READY'].includes(o.status)) throw conflict(`${o.name} is ${o.status.toLowerCase().replace('_', ' ')}.`);
      return transaction(db, () => {
        const req = engine.submit(actor, { type: SIGNOFF_TYPE, title: `Migration sign-off: ${o.name} (${n} passed trials)`, targetType: 'mig_objects', targetId: String(o.id), payload: { objectId: o.id, code: o.code, mappingVersion: o.mapping_version, trials: n }, reason, chain: o.financial ? [o.owner_role, 'CFO'] : [o.owner_role] });
        db.prepare("UPDATE mig_objects SET status = 'SIGNOFF', request_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(req.id, actor.user, iso(), o.id);
        return objects.get(actor, code);
      });
    },
    decide(actor, code, body) {
      guard(actor, 'adm.migration.view');
      const o = row(actor, code); if (!o.request_id || o.status !== 'SIGNOFF') throw conflict('The object is not waiting for sign-off.');
      const out = engine.act(actor, o.request_id, body);
      if (out.status === 'REJECTED' || out.status === 'RETURNED') db.prepare("UPDATE mig_objects SET status = 'READY', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), o.id);
      return objects.get(actor, code);
    },
  };

  // ---------------------------------------------------------------- loading
  /** FR-02 cleansing and mapping: legacy columns renamed, values trimmed and mapped, upper-cased, defaulted; blank rows dropped. */
  function transform(o, csv) {
    const m = JSON.parse(o.mapping_json); const k = kindOf(o.kind); const keys = k.columns.map((c) => c.key);
    const parsed = parseCsv(csv);
    if (!parsed.header.length) throw unprocessable('The extract is empty.');
    if (parsed.rows.length > MAX_ROWS) throw unprocessable(`At most ${MAX_ROWS} rows in one load; split the extract.`);
    const headerKey = (h) => m.rename[h] ?? keys.find((x) => x.toLowerCase() === h.toLowerCase()) ?? k.columns.find((c) => c.label.toLowerCase() === h.toLowerCase())?.key ?? null;
    const unknown = parsed.header.filter((h) => !headerKey(h));
    const out = []; let dropped = 0;
    for (const r of parsed.rows) {
      const x = Object.fromEntries(keys.map((key) => [key, '']));
      for (const [h, v] of Object.entries(r)) { const key = headerKey(h); if (key) x[key] = v; }
      for (const [col, map] of Object.entries(m.values)) if (x[col] !== '' && Object.prototype.hasOwnProperty.call(map, x[col])) x[col] = map[x[col]];
      for (const col of m.upper) x[col] = String(x[col]).toUpperCase();
      for (const [col, v] of Object.entries(m.defaults)) if (x[col] === '') x[col] = v;
      if (m.dropBlank.some((col) => x[col] === '')) { dropped += 1; continue; }
      out.push(x);
    }
    return { rows: out, legacyRows: parsed.rows.length, dropped, ignoredColumns: unknown };
  }
  const recon = (check, legacy, migrated, ok = String(legacy) === String(migrated)) => ({ check, legacy: String(legacy), migrated: String(migrated), ok });

  /** The real load through the owner's service; returns { records, errors, reconciliation, refs }. Throws nothing for a refused row: errors are returned. */
  function load(actor, o, rows, controls, { delta }) {
    const k = kindOf(o.kind); const items = [];
    if (k.template) {
      const x = excelOf(db); if (!x?.grid) throw unprocessable('The Excel engine (04.13) is not installed.');
      const out = x.grid.commit(actor, k.template, rows, { onExisting: delta ? 'SKIP' : 'ERROR' });
      if (!out.ok) return { records: 0, errors: out.errors.slice(0, 200), reconciliation: [] };
      items.push(recon('Rows loaded', controls.count ?? rows.length, out.created + out.updated + out.skipped));
      if (controls.totalColumn) { const col = controls.totalColumn; const sum = rows.reduce((a, r) => a + paise(r[col]), 0); items.push(recon(`Total of ${col}`, controls.total ?? rs(sum), rs(sum))); }
      return { records: out.created + out.updated, errors: [], reconciliation: items, refs: out.refs.slice(0, 50), detail: { created: out.created, updated: out.updated, skipped: out.skipped } };
    }
    if (o.kind === 'OPENING_TB') {
      const gl = glOf(db); if (!gl?.journals) throw unprocessable('The general ledger (23.01) is not installed.');
      const fy = findFinancialYear(db, actor.companyId, controls.date ?? iso().slice(0, 10));
      if (!fy) return { records: 0, errors: [{ line: 0, errors: [{ column: null, message: 'There is no financial year to date the opening balances on.' }] }], reconciliation: [] };
      const acc = db.prepare('SELECT id, code FROM fin_accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL');
      const errors = []; const lines = [];
      rows.forEach((r, i) => { const a = acc.get(actor.companyId, r.accountCode); if (!a) errors.push({ line: i + 1, errors: [{ column: 'accountCode', message: `${r.accountCode} is not an account of the chart (map the legacy code).` }] }); else lines.push({ accountId: a.id, debit: r.debit === '' ? undefined : Number(String(r.debit).replace(/,/g, '')), credit: r.credit === '' ? undefined : Number(String(r.credit).replace(/,/g, '')) }); });
      if (errors.length) return { records: 0, errors, reconciliation: [] };
      let j; try { j = gl.journals.create(actor, { kind: 'OPENING', voucherDate: fy.start_date, narration: `Opening balances migrated (${o.code})`, lines, sourceType: 'mig_objects', sourceId: o.id }); } catch (e) { return { records: 0, errors: [{ line: 0, errors: (e.details?.length ? e.details : [{ field: null, message: e.message }]).map((d) => ({ column: d.field ?? null, message: d.message })) }], reconciliation: [] }; }
      // T-01: the loaded trial balance by account against the legacy closing trial balance
      const got = new Map(db.prepare('SELECT a.code, SUM(l.debit_paise) AS dr, SUM(l.credit_paise) AS cr FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.journal_id = ? GROUP BY a.code').all(j.id).map((x) => [x.code, x.dr - x.cr]));
      const want = new Map(); for (const r of controls.tb ?? rows) want.set(r.accountCode, (want.get(r.accountCode) ?? 0) + paise(r.debit) - paise(r.credit));
      let diff = 0; for (const code of new Set([...got.keys(), ...want.keys()])) { const d = (got.get(code) ?? 0) - (want.get(code) ?? 0); if (d) { diff += 1; items.push(recon(`Account ${code}`, rs(want.get(code) ?? 0), rs(got.get(code) ?? 0))); } }
      const dr = [...got.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0); const cr = -[...got.values()].filter((v) => v < 0).reduce((a, b) => a + b, 0);
      items.unshift(recon('Accounts tied out', want.size, want.size - diff, diff === 0), recon('Total debit', rs(controls.totalDebit != null ? paise(controls.totalDebit) : [...want.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0)), rs(dr)), recon('Total credit', rs(controls.totalCredit != null ? paise(controls.totalCredit) : -[...want.values()].filter((v) => v < 0).reduce((a, b) => a + b, 0)), rs(cr)));
      return { records: lines.length, errors: [], reconciliation: items, refs: [{ ref: j.docNo ?? j.doc_no ?? `journal ${j.id}`, id: j.id }], detail: { journalId: j.id, date: fy.start_date } };
    }
    // OPENING_STOCK
    const inv = invOf(db)?.invSvc?.movements; if (!inv?.openingImport) throw unprocessable('Stores (16.x) is not installed.');
    const input = rows.map((r) => ({ storeCode: r.storeCode, itemCode: r.itemCode, qty: Number(String(r.qty).replace(/,/g, '')), rate: Number(String(r.rate).replace(/,/g, '')), ...(r.binCode ? { binCode: r.binCode } : {}), ...(r.projectCode ? { projectCode: r.projectCode } : {}), ...(r.batchNo ? { batchNo: r.batchNo } : {}), ...(r.date ? { date: r.date } : {}) }));
    const bad = input.map((r, i) => (!Number.isFinite(r.qty) || r.qty <= 0 || !Number.isFinite(r.rate) || r.rate < 0 ? { line: i + 1, errors: [{ column: !Number.isFinite(r.qty) || r.qty <= 0 ? 'qty' : 'rate', message: 'Give a quantity above zero and a rate of zero or more.' }] } : null)).filter(Boolean);
    if (bad.length) return { records: 0, errors: bad, reconciliation: [] };
    let res; try { res = inv.openingImport(actor, { rows: input }); } catch (e) { return { records: 0, errors: (e.details?.length ? e.details : [{ field: null, message: e.message }]).map((d) => ({ line: Number(/rows\.(\d+)/.exec(d.field ?? '')?.[1] ?? -1) + 1, errors: [{ column: d.field?.split('.').pop() ?? null, message: d.message }] })), reconciliation: [] }; }
    const ids = res.entries.map((e) => e.id);
    const got = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(qty_in), 0) AS q, COALESCE(SUM(value), 0) AS v FROM inv_stock_ledger WHERE id IN (${ids.map(() => '?').join(',') || 'NULL'})`).get(...ids);
    const wantValue = controls.stockValue != null ? paise(controls.stockValue) : input.reduce((a, r) => a + Math.round(Math.round(r.qty * 1000) * Math.round(r.rate * 100) / 1000), 0);
    items.push(recon('Stock lines', controls.count ?? input.length, got.n), recon('Stock value', rs(wantValue), rs(got.v)));
    return { records: got.n, errors: [], reconciliation: items, detail: { quantity: (got.q / 1000).toFixed(3) } };
  }

  const runView = (r) => ({ id: r.id, objectCode: r.object_code, type: r.run_type, environment: r.environment, mode: r.mode, status: r.status, records: r.records, errors: r.errors, legacyRows: r.legacy_rows, dropped: r.dropped, mappingVersion: r.mapping_version, inputHash: r.input_hash,
    reconciliation: JSON.parse(r.reconciliation_json ?? '[]'), problems: JSON.parse(r.errors_json ?? '[]'), detail: JSON.parse(r.detail_json ?? '{}'), by: r.created_by, startedAt: r.started_at, finishedAt: r.finished_at });

  /** FR-03 a trial load (rolled back) or FR-04 the final load (kept only if it reconciles). */
  function run(actor, code, { type, csv, controls = {}, delta = false }) {
    guard(actor, 'adm.migration.load');
    const o = row(actor, code);
    if (type === 'FINAL') {
      if (o.status === 'LOADED' && !delta) throw conflict(`${o.name} is loaded; a later change is a delta load.`);
      if (!['SIGNED_OFF', 'LOADED'].includes(o.status) || trialsOn(o) < TRIALS_NEEDED) throw unprocessable(`${o.name} needs ${TRIALS_NEEDED} passed trial loads and the owner's sign-off before the final load (BR-01).`);
      const cut = db.prepare("SELECT * FROM mig_cutovers WHERE company_id = ? AND status = 'FROZEN' AND deleted_at IS NULL").get(actor.companyId);
      if (!cut || cut.freeze_from > iso() || cut.freeze_to < iso()) throw unprocessable('The final load runs only inside the cut-over freeze window; start the cut-over first.');
      const earlier = db.prepare("SELECT name FROM mig_objects WHERE company_id = ? AND deleted_at IS NULL AND status <> 'LOADED' AND (CASE phase WHEN 'MASTERS' THEN 1 WHEN 'OPEN_DOCUMENTS' THEN 2 ELSE 3 END) < ?").all(actor.companyId, PHASES[o.phase]);
      if (earlier.length) throw unprocessable(`Load the earlier phase first: ${earlier.map((e) => e.name).join(', ')}.`);
    } else if (o.status === 'LOADED') throw conflict(`${o.name} is loaded already.`);
    const t = transform(o, csv);
    const started = iso(); const hash = createHash('sha256').update(String(csv)).digest('hex');
    const sp = `mig_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`;
    db.exec(`SAVEPOINT ${sp}`);
    let out; let kept = false;
    try {
      out = load(actor, o, t.rows, controls, { delta });
      const passed = !out.errors.length && out.reconciliation.length > 0 && out.reconciliation.every((x) => x.ok);
      if (type === 'FINAL' && passed) { db.exec(`RELEASE ${sp}`); kept = true; } else { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); }
      out.passed = passed;
    } catch (e) { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); throw e; }
    const status = type === 'TRIAL' ? (out.passed ? 'PASSED' : 'FAILED') : kept ? 'LOADED' : 'ROLLED_BACK';
    return transaction(db, () => {
      const id = Number(db.prepare(`INSERT INTO mig_runs (company_id, object_code, environment, run_type, mode, status, records, errors, legacy_rows, dropped, mapping_version, input_hash, reconciliation_json, errors_json, detail_json, started_at, finished_at, created_by, source_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'migration')`).run(actor.companyId, o.code, type === 'TRIAL' ? 'TRIAL (rolled back)' : 'PRODUCTION', type, delta ? 'DELTA' : 'FULL', status, out.records, out.errors.length, t.legacyRows, t.dropped, o.mapping_version, hash,
        JSON.stringify(out.reconciliation), JSON.stringify(out.errors), JSON.stringify({ ...(out.detail ?? {}), refs: kept ? out.refs ?? [] : [], ignoredColumns: t.ignoredColumns }), started, iso(), actor.user).lastInsertRowid);
      const next = type === 'TRIAL' ? (o.status === 'PLANNED' || o.status === 'TRIAL' || o.status === 'READY' ? (trialsOn(o) >= TRIALS_NEEDED ? 'READY' : 'TRIAL') : o.status) : kept ? 'LOADED' : o.status;
      db.prepare('UPDATE mig_objects SET status = ?, last_trial_at = CASE WHEN ? THEN ? ELSE last_trial_at END, loaded_at = CASE WHEN ? THEN ? ELSE loaded_at END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(next, type === 'TRIAL' ? 1 : 0, iso(), kept ? 1 : 0, iso(), actor.user, iso(), o.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'mig_runs', entityId: String(id), action: type === 'TRIAL' ? 'trial_load' : 'final_load', actor: actor.user, newValues: { object: o.code, status, records: out.records, errors: out.errors.length, delta } });
      publishEvent(db, { type: type === 'TRIAL' ? 'admin.migration.trial_completed' : 'admin.migration.final_completed', entity: 'mig_runs', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { object: o.code, status, records: out.records } });
      return runView(db.prepare('SELECT * FROM mig_runs WHERE id = ?').get(id));
    });
  }

  // ---------------------------------------------------------------- the cut-over runbook (FR-04)
  const cutView = (c) => ({ id: c.id, name: c.name, freezeFrom: c.freeze_from, freezeTo: c.freeze_to, status: c.status, rollbackPoint: c.rollback_point, steps: JSON.parse(c.steps_json), by: c.created_by, frozenAt: c.frozen_at, closedAt: c.closed_at });
  const cutovers = {
    plan(actor, { name, freezeFrom, freezeTo, rollbackPoint }) {
      guard(actor, 'adm.migration.manage');
      if (!(freezeTo > freezeFrom)) throw unprocessable('The freeze ends after it starts.');
      if (db.prepare("SELECT 1 FROM mig_cutovers WHERE company_id = ? AND status IN ('PLANNED', 'FROZEN') AND deleted_at IS NULL").get(actor.companyId)) throw conflict('A cut-over is already planned.');
      const id = Number(db.prepare("INSERT INTO mig_cutovers (company_id, name, freeze_from, freeze_to, rollback_point, steps_json, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'PLANNED', ?, 'cutover')")
        .run(actor.companyId, name, freezeFrom, freezeTo, rollbackPoint, JSON.stringify(RUNBOOK.map((title, i) => ({ no: i + 1, title, done: false, by: null, at: null, note: null }))), actor.user).lastInsertRowid);
      writeAudit(db, { companyId: actor.companyId, entity: 'mig_cutovers', entityId: String(id), action: 'plan', actor: actor.user, newValues: { freezeFrom, freezeTo } });
      return cutView(db.prepare('SELECT * FROM mig_cutovers WHERE id = ?').get(id));
    },
    setStatus(actor, id, status) {
      guard(actor, 'adm.migration.manage');
      const c = db.prepare('SELECT * FROM mig_cutovers WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!c) throw notFound('That cut-over does not exist.');
      const allowed = { PLANNED: ['FROZEN', 'CLOSED'], FROZEN: ['CLOSED'], CLOSED: [] }; if (!allowed[c.status].includes(status)) throw conflict(`A ${c.status.toLowerCase()} cut-over cannot become ${status.toLowerCase()}.`);
      db.prepare(`UPDATE mig_cutovers SET status = ?, ${status === 'FROZEN' ? 'frozen_at' : 'closed_at'} = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(status, iso(), actor.user, iso(), c.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'mig_cutovers', entityId: String(c.id), action: status.toLowerCase(), actor: actor.user });
      publishEvent(db, { type: status === 'FROZEN' ? 'admin.cutover.frozen' : 'admin.cutover.closed', entity: 'mig_cutovers', entityId: c.id, actorId: actor.user, companyId: actor.companyId, data: { name: c.name } });
      return cutView(db.prepare('SELECT * FROM mig_cutovers WHERE id = ?').get(c.id));
    },
    step(actor, id, no, { done, note = null }) {
      guard(actor, 'adm.migration.manage');
      const c = db.prepare('SELECT * FROM mig_cutovers WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!c) throw notFound('That cut-over does not exist.');
      if (c.status === 'CLOSED') throw conflict('The cut-over is closed.');
      const steps = JSON.parse(c.steps_json); const s = steps.find((x) => x.no === no); if (!s) throw notFound('No such step.');
      Object.assign(s, { done, note, by: done ? actor.user : null, at: done ? iso() : null });
      db.prepare('UPDATE mig_cutovers SET steps_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(steps), actor.user, iso(), c.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'mig_cutovers', entityId: String(c.id), action: 'step', actor: actor.user, newValues: { no, done, note } });
      return cutView(db.prepare('SELECT * FROM mig_cutovers WHERE id = ?').get(c.id));
    },
  };

  const svc = { objects, run, cutovers, engine, transform };
  services.set(db, svc);
  return svc;
}
