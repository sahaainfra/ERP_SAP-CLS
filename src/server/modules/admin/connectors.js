import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { hasPermissionAnywhere } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { integrationsOf } from '../../platform/integrations/index.js';
import { cashOf } from '../fin/index.js';
import { punchesOf } from '../hr/punches.js';
import { plantOf } from '../plant/index.js';

/**
 * Part 29.02 — business connectors on the integration hub (01.08).
 *
 * The hub keeps each connector's configuration, vault-held key, approval (bank and GST connectors: ITADM then the CFO), rate limit, circuit
 * breaker, retries and log. This part adds the providers and what flows through them, always into the owner's own service so inbound data
 * passes the same validation and approvals as manual entry (BR-01):
 *   bank        bank_http: statement fetch → the 23.06 statement import (duplicates skipped, auto-matched to the books); account validation
 *               (penny-drop) for a partner's bank account (06.04)
 *   biometric   biometric_http (ZKTeco/eSSL bridges): punches pulled → the 07.05 device punch, each with a stable client id so a punch pulled
 *               twice is stored once, and the punch rules (duplicate window, site, shift) apply
 *   maps        telematics_http: equipment GPS and engine hours → the 17.07 telematics ingest
 *   export      Tally XML of approved journals and the ledgers they use, with value mappings and a reconciliation (vouchers, debit = credit)
 * `int_mappings` translate values (account → Tally ledger, device user → employee code, GST rate → tax ledger, TDS section → 2025-Act code,
 * tracker id → asset code); a mapping is used only once the accounts or HR manager approves it. `int_sync_runs` records every run with its
 * counts, errors and outcome; a daily job pulls the connectors set to sync automatically.
 */
export const CONNECTORS_FLAG = 'ff.admin.p2902';
export const MAPPING_TYPE = 'int_mapping_change';
export const MAP_ENTITIES = Object.freeze({
  gl_account: { label: 'Account → Tally ledger', approver: 'ACCMGR' },
  gst_rate: { label: 'GST rate → tax ledger', approver: 'ACCMGR' },
  tds_section: { label: 'TDS section → code', approver: 'ACCMGR' },
  biometric_user: { label: 'Device user → employee code', approver: 'HRMGR' },
  equipment: { label: 'Tracker → asset code', approver: 'PLANTMGR' },
});
const KINDS = { BANK_STATEMENT: 'bank', PENNY_DROP: 'bank', BIOMETRIC: 'biometric', TELEMATICS: 'maps', ACCOUNTING_EXPORT: null };
const shape = { type: 'object', additionalProperties: true };
eventTypes.define({ type: 'admin.connector.synced', version: 1, schema: shape, owner: 'admin', description: 'A business connector run finished (part 29.02): data { connector, kind, records, errors, status }.' });
eventTypes.define({ type: 'admin.mapping.approved', version: 1, schema: shape, owner: 'admin', description: 'A connector value mapping was approved and is now used (part 29.02).' });

const iso = () => new Date().toISOString();
const xml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rs = (p) => (Number(p) / 100).toFixed(2);

/** The providers this part adds to the hub's registry (idempotent). */
export function registerBusinessProviders(db) {
  const reg = integrationsOf(db).providers;
  const http = async (ctx, path, body) => { const { httpJson } = await import('../../platform/integrations/providers.js'); return httpJson(ctx, { path, headers: ctx.secrets.api_key ? { authorization: `Bearer ${ctx.secrets.api_key}` } : {}, body }); };
  const base = { secrets: [{ name: 'api_key', label: 'API key', required: false }], health: async () => ({ message: 'Configured.' }),
    validateConfig: (c) => (String(c.baseUrl ?? '').startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(String(c.baseUrl ?? '')) ? [] : ['The base URL must start with https://.']) };
  const op = (need, path, out) => ({ validate: (p) => need.filter((k) => p?.[k] == null).map((k) => ({ field: k, message: `Give ${k}.` })), run: async (ctx, p) => { const r = await http(ctx, path, p); return { httpStatus: r.httpStatus, data: out(r.data ?? {}) }; } });
  if (!reg.get('bank', 'bank_http')) reg.register({ type: 'bank', provider: 'bank_http', label: 'Bank API (H2H)', description: 'A bank\'s host-to-host API: statements (MT940 or CSV) and account validation (penny-drop).', ...base,
    configFields: [{ name: 'baseUrl', label: 'Base URL', required: true }, { name: 'corporateId', label: 'Corporate id', required: true }],
    operations: { fetchStatement: op(['accountRef', 'from', 'to'], '/statements', (d) => ({ format: d.format === 'CSV' ? 'CSV' : 'MT940', content: String(d.content ?? '') })),
      validateAccount: op(['ifsc', 'accountNo'], '/penny-drop', (d) => ({ valid: d.valid === true, nameAtBank: d.nameAtBank ?? null, utr: d.utr ?? null })) } });
  if (!reg.get('biometric', 'biometric_http')) reg.register({ type: 'biometric', provider: 'biometric_http', label: 'Biometric devices (ZKTeco/eSSL bridge)', description: 'The punch log of attendance devices through their vendor bridge.', ...base,
    configFields: [{ name: 'baseUrl', label: 'Base URL', required: true }, { name: 'siteId', label: 'Site id of the devices', required: true }],
    operations: { pullPunches: op(['since'], '/punches', (d) => ({ punches: Array.isArray(d.punches) ? d.punches : [] })) } });
  if (!reg.get('maps', 'telematics_http')) reg.register({ type: 'maps', provider: 'telematics_http', label: 'Telematics (GPS and engine hours)', description: 'Equipment positions, engine hours, ignition and fuel from a telematics provider.', ...base,
    configFields: [{ name: 'baseUrl', label: 'Base URL', required: true }],
    operations: { readings: op(['since'], '/readings', (d) => ({ readings: Array.isArray(d.readings) ? d.readings : [] })) } });
}

const services = new WeakMap();
export const connectorsOf = (db) => services.get(db) ?? null;

/** @param {any} context @param {{ jobs?: any, scheduler?: any }} [deps] */
export function createBusinessConnectors(context, { jobs, scheduler } = {}) {
  const { db } = context;
  registerBusinessProviders(db);
  const hub = () => integrationsOf(db).hub;
  const guard = (actor, key) => {
    if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, CONNECTORS_FLAG)) throw notFound('Business connectors are not enabled for this company.');
    if (key && !hasPermissionAnywhere(actor, key)) throw forbidden(`You may not do this (permission ${key}).`);
  };
  const connector = (companyId, code, type = null) => {
    const c = db.prepare('SELECT * FROM core_connectors WHERE company_id = ? AND code = ? AND is_active = 1 AND deleted_at IS NULL').get(companyId, code);
    if (!c) throw notFound(`The connector ${code} does not exist.`);
    if (type && c.type !== type) throw unprocessable(`${code} is a ${c.type} connector, not a ${type} one.`);
    if (c.status !== 'ENABLED') throw unprocessable(`${code} is not enabled (it is ${c.status.toLowerCase()}); its activation needs approval first.`);
    return c;
  };

  // ---------------------------------------------------------------- value mappings: proposed by IT, used only once approved
  const handlers = { [MAPPING_TYPE]: {
    authorize(_db, actor, r) { if (actor.companyId !== r.company_id) throw forbidden('Another company\'s request.'); },
    apply(_db, request, actor) {
      const m = request.payload;
      db.prepare("UPDATE int_mappings SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND connector_code = ? AND entity = ? AND external_value = ? AND status = 'ACTIVE'").run(actor.user, iso(), request.companyId, m.connector, m.entity, m.external);
      db.prepare("UPDATE int_mappings SET status = 'ACTIVE', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), actor.user, iso(), m.mappingId);
      writeAudit(db, { companyId: request.companyId, entity: 'int_mappings', entityId: String(m.mappingId), action: 'approve', actor: actor.user, newValues: m });
      publishEvent(db, { type: 'admin.mapping.approved', entity: 'int_mappings', entityId: m.mappingId, actorId: actor.user, companyId: request.companyId, data: m });
    },
  } };
  const engine = createApprovalEngine({ db, handlers });
  const active = (companyId, code, entity) => new Map(db.prepare("SELECT internal_value, external_value FROM int_mappings WHERE company_id = ? AND connector_code = ? AND entity = ? AND status = 'ACTIVE' AND deleted_at IS NULL").all(companyId, code, entity).map((m) => [m.external_value, m.internal_value]));
  const mappings = {
    list(actor, { connector: code = null, entity = null } = {}) {
      guard(actor, 'adm.connector.view');
      const rows = db.prepare(`SELECT * FROM int_mappings WHERE company_id = ? AND deleted_at IS NULL ${code ? 'AND connector_code = ?' : ''} ${entity ? 'AND entity = ?' : ''} ORDER BY connector_code, entity, external_value, id DESC LIMIT 1000`).all(...[actor.companyId, ...(code ? [code] : []), ...(entity ? [entity] : [])]);
      const mine = new Set(engine.awaiting(actor).map((x) => x.id));
      return { rows: rows.map((m) => ({ id: m.id, connector: m.connector_code, entity: m.entity, entityLabel: MAP_ENTITIES[m.entity].label, internal: m.internal_value, external: m.external_value, status: m.status, requestId: m.request_id, canApprove: mine.has(m.request_id), by: m.created_by, approvedBy: m.approved_by })),
        entities: Object.entries(MAP_ENTITIES).map(([code, e]) => ({ code, label: e.label, approver: e.approver })) };
    },
    propose(actor, { connector: code, entity, internal, external, reason }) {
      guard(actor, 'adm.connector.configure');
      if (!MAP_ENTITIES[entity]) throw unprocessable('Unknown mapping.');
      if (code !== 'ACCOUNTING_EXPORT') connector(actor.companyId, code);
      if (db.prepare("SELECT 1 FROM int_mappings WHERE company_id = ? AND connector_code = ? AND entity = ? AND external_value = ? AND status = 'PENDING' AND deleted_at IS NULL").get(actor.companyId, code, entity, external)) throw conflict(`A mapping of ${external} is already waiting for approval.`);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO int_mappings (company_id, connector_code, entity, internal_value, external_value, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, 'mapping')").run(actor.companyId, code, entity, internal, external, actor.user).lastInsertRowid);
        const req = engine.submit(actor, { type: MAPPING_TYPE, title: `${MAP_ENTITIES[entity].label}: ${external} → ${internal} (${code})`, targetType: 'int_mappings', targetId: String(id), payload: { mappingId: id, connector: code, entity, internal, external }, reason, chain: [MAP_ENTITIES[entity].approver] });
        db.prepare('UPDATE int_mappings SET request_id = ? WHERE id = ?').run(req.id, id);
        return { id, requestId: req.id, status: 'PENDING', approver: MAP_ENTITIES[entity].approver };
      });
    },
    decide(actor, requestId, body) { guard(actor, 'adm.connector.view'); const r = engine.get(actor, requestId); if (r.type !== MAPPING_TYPE) throw notFound('That request does not exist.');
      const out = engine.act(actor, requestId, body); if (out.status === 'REJECTED') db.prepare("UPDATE int_mappings SET status = 'REJECTED', updated_by = ?, updated_at = ? WHERE request_id = ?").run(actor.user, iso(), requestId); return out; },
  };

  // ---------------------------------------------------------------- the runs
  function startRun(actor, code, kind, direction, params) {
    return Number(db.prepare("INSERT INTO int_sync_runs (company_id, connector_code, kind, direction, started_at, status, params_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'RUNNING', ?, ?, 'sync')").run(actor.companyId, code, kind, direction, iso(), JSON.stringify(params), actor.user).lastInsertRowid);
  }
  function finishRun(actor, id, { records, errors, detail, output = null, status = null }) {
    const st = status ?? (errors.length ? (records ? 'PARTIAL' : 'FAILED') : 'SUCCEEDED');
    db.prepare('UPDATE int_sync_runs SET finished_at = ?, records = ?, errors = ?, errors_json = ?, detail_json = ?, output_text = ?, status = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(iso(), records, errors.length, JSON.stringify(errors.slice(0, 500)), JSON.stringify(detail), output, st, iso(), id);
    const r = db.prepare('SELECT * FROM int_sync_runs WHERE id = ?').get(id);
    writeAudit(db, { companyId: actor.companyId, entity: 'int_sync_runs', entityId: String(id), action: r.kind.toLowerCase(), actor: actor.user, newValues: { connector: r.connector_code, records, errors: errors.length, status: st } });
    publishEvent(db, { type: 'admin.connector.synced', entity: 'int_sync_runs', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { connector: r.connector_code, kind: r.kind, records, errors: errors.length, status: st } });
    return runs.get(actor, id);
  }
  const failRun = (actor, id, e) => finishRun(actor, id, { records: 0, errors: [{ message: String(e?.message ?? e).slice(0, 500), code: e?.code ?? null }], detail: {}, status: 'FAILED' });

  const sync = {
    /** FR-01 / T-01: the statement of a period, fetched and handed to the 23.06 import, which skips lines seen before and matches the rest. */
    async bankStatement(actor, { connector: code, bankAccountId, from, to }) {
      guard(actor, 'adm.connector.run');
      const c = connector(actor.companyId, code, 'bank');
      const cash = cashOf(db); if (!cash?.statements) throw unprocessable('Bank reconciliation (23.06) is not installed.');
      const acct = db.prepare('SELECT * FROM fin_bank_accounts WHERE id = ? AND company_id = ?').get(Number(bankAccountId), actor.companyId); if (!acct) throw notFound('That bank account does not exist.');
      const id = startRun(actor, c.code, 'BANK_STATEMENT', 'INBOUND', { bankAccountId, from, to });
      try {
        const out = await hub().call(c.code, 'fetchStatement', { accountRef: acct.code, ifsc: acct.ifsc, last4: acct.account_last4, from, to }, { companyId: actor.companyId, actor, idempotencyKey: `stmt:${c.code}:${acct.id}:${from}:${to}` });
        const res = cash.statements.import(actor, { bankAccountId: acct.id, fileName: `${c.code}-${from}-${to}.${out.data.format === 'CSV' ? 'csv' : 'sta'}`, format: out.data.format, content: out.data.content });
        return finishRun(actor, id, { records: res.lines, errors: [], detail: { importId: res.importId, lines: res.lines, duplicates: res.duplicates, matched: res.matched, unmatched: res.unmatched, route: `/finance/bank-reconciliation?accountId=${acct.id}` } });
      } catch (e) { return failRun(actor, id, e); }
    },
    /** FR-01: validate a bank account (penny-drop) before it is used for payments; the name at the bank is compared with the expected one. */
    async validateAccount(actor, { connector: code, ifsc, accountNo, name }) {
      guard(actor, 'adm.connector.run');
      const c = connector(actor.companyId, code, 'bank');
      const id = startRun(actor, c.code, 'PENNY_DROP', 'OUTBOUND', { ifsc, account: `••••${String(accountNo).slice(-4)}` });
      try {
        const out = await hub().call(c.code, 'validateAccount', { ifsc, accountNo, name }, { companyId: actor.companyId, actor, idempotencyKey: `pd:${c.code}:${ifsc}:${accountNo}` });
        const words = (s) => new Set(String(s ?? '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['PVT', 'LTD', 'PRIVATE', 'LIMITED', 'THE', 'AND'].includes(w)));
        const a = words(name); const b = words(out.data.nameAtBank); const common = [...a].filter((w) => b.has(w)).length; const score = a.size ? Math.round((common / a.size) * 100) : 0;
        const ok = out.data.valid && score >= 60;
        return finishRun(actor, id, { records: 1, errors: ok ? [] : [{ message: out.data.valid ? `The name at the bank (${out.data.nameAtBank}) does not match ${name}.` : 'The bank says the account is not valid.' }], detail: { valid: out.data.valid, nameAtBank: out.data.nameAtBank, nameScore: score, utr: out.data.utr }, status: ok ? 'SUCCEEDED' : 'FAILED' });
      } catch (e) { return failRun(actor, id, e); }
    },
    /** FR-03 / T-01: punches pulled from the devices into the 07.05 device punch; a punch pulled again is a replay; the punch rules apply. */
    async biometric(actor, { connector: code, since }) {
      guard(actor, 'adm.connector.run');
      const c = connector(actor.companyId, code, 'biometric');
      const punches = punchesOf(db); if (!punches?.punches?.device) throw unprocessable('Attendance (07.05) is not installed.');
      const cfg = JSON.parse(c.config_json); const map = active(actor.companyId, c.code, 'biometric_user');
      const id = startRun(actor, c.code, 'BIOMETRIC', 'INBOUND', { since });
      try {
        const out = await hub().call(c.code, 'pullPunches', { since }, { companyId: actor.companyId, actor, idempotencyKey: `bio:${c.code}:${since}:${Date.now()}` });
        const errors = []; let stored = 0; let replayed = 0; let refused = 0;
        for (const p of out.data.punches) {
          const code2 = map.get(String(p.userCode)) ?? String(p.userCode);
          try {
            const r = await punches.punches.device(actor, { siteId: Number(cfg.siteId), employeeCode: code2, punchType: String(p.direction).toUpperCase() === 'OUT' ? 'OUT' : 'IN', deviceTime: p.time, deviceSerial: String(p.deviceSerial ?? c.code), clientUuid: `bio-${c.code}-${p.deviceSerial ?? 'd'}-${p.logId}` });
            if (r.replayed) replayed += 1; else if (r.result && r.result !== 'ACCEPTED') refused += 1; else stored += 1;
          } catch (e) { errors.push({ ref: String(p.logId), userCode: String(p.userCode), message: String(e?.message ?? e).slice(0, 300) }); }
        }
        return finishRun(actor, id, { records: stored, errors, detail: { pulled: out.data.punches.length, stored, replayed, refusedByRules: refused, route: '/att/daily' } });
      } catch (e) { return failRun(actor, id, e); }
    },
    /** FR-05: positions and engine hours into the 17.07 telematics ingest (stored as they come; duplicates left out by the owner). */
    async telematics(actor, { connector: code, since }) {
      guard(actor, 'adm.connector.run');
      const c = connector(actor.companyId, code, 'maps');
      const fleet = plantOf(db)?.fleetsvc?.telematics; if (!fleet) throw unprocessable('Fleet control (17.07) is not installed.');
      const map = active(actor.companyId, c.code, 'equipment');
      const id = startRun(actor, c.code, 'TELEMATICS', 'INBOUND', { since });
      try {
        const out = await hub().call(c.code, 'readings', { since }, { companyId: actor.companyId, actor, idempotencyKey: `tel:${c.code}:${since}:${Date.now()}` });
        const readings = out.data.readings.map((r) => ({ ...r, assetCode: map.get(String(r.trackerId ?? r.assetCode)) ?? r.assetCode }));
        const res = fleet.ingest(actor, { source: c.code, readings });
        return finishRun(actor, id, { records: res.stored ?? 0, errors: [], detail: { pulled: readings.length, ...res, route: '/plant/fleet' } });
      } catch (e) { return failRun(actor, id, e); }
    },
    /** FR-02: Tally XML of the approved journals of a period and the ledgers they use, through the account mappings; reconciled. */
    accountingExport(actor, { from, to, companyName }) {
      guard(actor, 'adm.connector.export');
      if (!hasPermissionAnywhere(actor, 'fin.journal.export')) throw forbidden('You may not export journals (permission fin.journal.export).');
      const ledgerOf = active(actor.companyId, 'ACCOUNTING_EXPORT', 'gl_account');
      const id = startRun(actor, 'ACCOUNTING_EXPORT', 'ACCOUNTING_EXPORT', 'OUTBOUND', { from, to, target: 'TALLY' });
      const journals = db.prepare("SELECT * FROM fin_journals WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND voucher_date BETWEEN ? AND ? ORDER BY voucher_date, id").all(actor.companyId, from, to);
      const lineQ = db.prepare('SELECT l.*, a.code, a.name FROM fin_journal_lines l JOIN fin_accounts a ON a.id = l.account_id WHERE l.journal_id = ? AND l.deleted_at IS NULL ORDER BY l.line_no');
      const VT = { JV: 'Journal', OB: 'Journal', PV: 'Payment', RV: 'Receipt', CV: 'Contra', PJ: 'Purchase', SJ: 'Sales', DN: 'Debit Note', CN: 'Credit Note' };
      const errors = []; const ledgers = new Map(); let dr = 0; let cr = 0; const vouchers = [];
      for (const j of journals) {
        const lines = lineQ.all(j.id); let ok = true; const entries = [];
        for (const l of lines) {
          const name = ledgerOf.get(l.code);
          if (!name) { ok = false; errors.push({ ref: j.doc_no, message: `Account ${l.code} ${l.name} has no approved Tally ledger mapping.` }); continue; }
          ledgers.set(name, l.name); const debit = l.debit_paise > 0;
          entries.push(`<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(name)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${debit ? '-' : ''}${rs(debit ? l.debit_paise : l.credit_paise)}</AMOUNT></ALLLEDGERENTRIES.LIST>`);
        }
        if (!ok) continue;
        const jd = lines.reduce((s, l) => s + l.debit_paise, 0); const jc = lines.reduce((s, l) => s + l.credit_paise, 0);
        if (jd !== jc) { errors.push({ ref: j.doc_no, message: `The voucher does not balance (debit ${rs(jd)}, credit ${rs(jc)}).` }); continue; }
        dr += jd; cr += jc;
        vouchers.push(`<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${xml(VT[j.voucher_type] ?? 'Journal')}" ACTION="Create"><DATE>${j.voucher_date.replace(/-/g, '')}</DATE><VOUCHERTYPENAME>${xml(VT[j.voucher_type] ?? 'Journal')}</VOUCHERTYPENAME><VOUCHERNUMBER>${xml(j.voucher_no ?? j.doc_no)}</VOUCHERNUMBER><NARRATION>${xml(j.narration)}</NARRATION>${entries.join('')}</VOUCHER></TALLYMESSAGE>`);
      }
      const masters = [...ledgers.entries()].map(([name, ours]) => `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${xml(name)}" ACTION="Create"><NAME.LIST><NAME>${xml(name)}</NAME></NAME.LIST><NARRATION>${xml(ours)}</NARRATION></LEDGER></TALLYMESSAGE>`);
      const body = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xml(companyName ?? '')}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>${masters.join('')}${vouchers.join('')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
      return finishRun(actor, id, { records: vouchers.length, errors, output: body, detail: { journals: journals.length, exported: vouchers.length, skipped: journals.length - vouchers.length, ledgers: ledgers.size, debit: rs(dr), credit: rs(cr), balanced: dr === cr } });
    },
  };

  const runView = (r) => ({ id: r.id, connector: r.connector_code, kind: r.kind, direction: r.direction, startedAt: r.started_at, finishedAt: r.finished_at, records: r.records, errors: r.errors, status: r.status, params: JSON.parse(r.params_json ?? '{}'),
    detail: JSON.parse(r.detail_json ?? '{}'), problems: JSON.parse(r.errors_json ?? '[]'), hasOutput: Boolean(r.output_text), by: r.created_by });
  const runs = {
    list(actor, { connector: code = null, status = null, page = 1, pageSize = 25 } = {}) {
      guard(actor, 'adm.connector.view');
      const where = ['company_id = ?', 'deleted_at IS NULL']; const p = [actor.companyId];
      if (code) { where.push('connector_code = ?'); p.push(code); } if (status) { where.push('status = ?'); p.push(status); }
      const sql = where.join(' AND ');
      return { rows: db.prepare(`SELECT * FROM int_sync_runs WHERE ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, pageSize, (page - 1) * pageSize).map(runView), total: db.prepare(`SELECT COUNT(*) AS n FROM int_sync_runs WHERE ${sql}`).get(...p).n, page, pageSize };
    },
    get(actor, id) { guard(actor, 'adm.connector.view'); const r = db.prepare('SELECT * FROM int_sync_runs WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!r) throw notFound('That run does not exist.'); return runView(r); },
    output(actor, id) {
      guard(actor, 'adm.connector.export');
      const r = db.prepare('SELECT * FROM int_sync_runs WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId); if (!r?.output_text) throw notFound('That run has no file.');
      writeAudit(db, { companyId: actor.companyId, entity: 'int_sync_runs', entityId: String(r.id), action: 'download', actor: actor.user });
      return { buffer: Buffer.from(r.output_text), contentType: 'application/xml', fileName: `tally-${JSON.parse(r.params_json).from}-${JSON.parse(r.params_json).to}.xml` };
    },
    exportList(actor, q, format) {
      const l = runs.list(actor, { ...q, page: 1, pageSize: 1000 });
      const columns = [['startedAt', 'Started'], ['connector', 'Connector'], ['kind', 'Kind'], ['status', 'Status'], ['records', 'Records'], ['errors', 'Errors'], ['first', 'First error'], ['by', 'By']].map(([key, label]) => ({ key, label }));
      const rows = l.rows.map((r) => ({ ...r, records: String(r.records ?? 0), errors: String(r.errors ?? 0), first: r.problems[0]?.message ?? '' }));
      writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'int_sync_runs', action: 'export', actor: actor.user, newValues: { format } });
      return { buffer: writeExport(format, { columns, rows, title: 'Connector sync runs', sheetName: 'Runs' }), contentType: FORMATS[format], fileName: `sync-runs.${format}` };
    },
  };

  /** FR-07: the business connectors with their health: hub state (breaker, last call), the last run and the mappings waiting. */
  function list(actor) {
    guard(actor, 'adm.connector.view');
    const rows = db.prepare("SELECT * FROM core_connectors WHERE company_id = ? AND type IN ('bank', 'biometric', 'maps', 'gsp', 'sms', 'whatsapp', 'email') AND is_active = 1 AND deleted_at IS NULL ORDER BY type, code").all(actor.companyId);
    const last = db.prepare('SELECT status, created_at, error FROM core_integration_logs WHERE connector_id = ? ORDER BY id DESC LIMIT 1');
    const lastRun = db.prepare('SELECT status, finished_at, records, errors FROM int_sync_runs WHERE company_id = ? AND connector_code = ? ORDER BY id DESC LIMIT 1');
    const fails = db.prepare("SELECT COUNT(*) AS n FROM core_integration_logs WHERE connector_id = ? AND status <> 'success' AND created_at >= ?");
    const day = new Date(Date.now() - 86_400_000).toISOString();
    return { rows: rows.map((c) => { const l = last.get(c.id); const lr = lastRun.get(actor.companyId, c.code); const b = hub().breakerState(c.id); const f = fails.get(c.id, day).n;
      const health = c.status !== 'ENABLED' ? 'NOT_ENABLED' : b.state === 'open' ? 'DOWN' : f ? 'DEGRADED' : l ? 'HEALTHY' : 'UNKNOWN';
      return { id: c.id, code: c.code, name: c.name, type: c.type, provider: c.provider, environment: c.environment, status: c.status, health, breaker: b.state, failures24h: f, lastCall: l ? { status: l.status, at: l.created_at, error: l.error } : null,
        lastRun: lr ? { status: lr.status, at: lr.finished_at, records: lr.records, errors: lr.errors } : null, kinds: Object.entries(KINDS).filter(([, t]) => t === c.type).map(([k]) => k), autoSync: Boolean(JSON.parse(c.config_json).autoSync) }; }),
      canRun: hasPermissionAnywhere(actor, 'adm.connector.run'), canConfigure: hasPermissionAnywhere(actor, 'adm.connector.configure'), canExport: hasPermissionAnywhere(actor, 'adm.connector.export'),
      bankAccounts: hasPermissionAnywhere(actor, 'adm.connector.run') ? db.prepare('SELECT id, name, account_last4 FROM fin_bank_accounts WHERE company_id = ? AND deleted_at IS NULL ORDER BY name').all(actor.companyId).map((b) => ({ id: b.id, label: `${b.name} ••••${b.account_last4}` })) : [] };
  }
  async function health(actor, code) {
    guard(actor, 'adm.connector.run');
    const c = db.prepare('SELECT * FROM core_connectors WHERE company_id = ? AND code = ? AND is_active = 1').get(actor.companyId, code); if (!c) throw notFound(`The connector ${code} does not exist.`);
    return hub().testConnection(c.id, { actor });
  }

  const svc = { list, health, mappings, sync, runs, engine };
  services.set(db, svc);
  if (jobs) {
    // the daily pull of the connectors set to sync on their own, as the role that owns their data (the same rules as a person's entry)
    jobs.register('admin.connectors.sync', async () => {
      let n = 0;
      for (const c of db.prepare("SELECT * FROM core_connectors WHERE status = 'ENABLED' AND is_active = 1 AND deleted_at IS NULL AND type IN ('biometric', 'maps')").all()) {
        const cfg = JSON.parse(c.config_json); if (!cfg.autoSync) continue;
        const since = db.prepare("SELECT MAX(started_at) AS t FROM int_sync_runs WHERE company_id = ? AND connector_code = ? AND status IN ('SUCCEEDED', 'PARTIAL')").get(c.company_id, c.code).t ?? new Date(Date.now() - 86_400_000).toISOString();
        const actor = { companyId: c.company_id, user: `connector:${c.code}`, roles: [c.type === 'biometric' ? 'HRMGR' : 'PLANTMGR', 'ITADM'] };
        try { if (!context.flags.isOn(actor, CONNECTORS_FLAG)) continue; await (c.type === 'biometric' ? sync.biometric(actor, { connector: c.code, since }) : c.provider === 'telematics_http' ? sync.telematics(actor, { connector: c.code, since }) : null); n += 1; } catch { /* the run records the failure */ }
      }
      return { connectors: n };
    }, { description: 'Pulls the business connectors set to sync automatically (part 29.02).' });
    scheduler?.define({ code: 'admin.connectors.sync', cron: '10 * * * *', jobType: 'admin.connectors.sync', description: 'Hourly pull of biometric and telematics connectors set to sync.' });
  }
  return svc;
}
