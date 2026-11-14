import { transaction } from '../../platform/db/index.js';
import { toPdf } from '../../platform/export/index.js';
import { conflict, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso, rid } from '../proc/base.js';
import { qaHelpers } from '../qa/common.js';
import { STATUS, createFlow } from '../qa/flow.js';
import { GRADES } from './validators.js';

// Mix designs (part 20.01): a recipe for one grade at one plant, the quantities of each material for 1 m3 of concrete, the water-cement ratio, slump and the trial results. The proportions are checked on the server (T-01): the absolute volumes of the materials plus
// the entrapped air must add up to 1 m3 within a tolerance, the water-binder ratio must not exceed the limit and the mean 28-day trial strength must reach the target mean of IS 456 (fck + 1.65 s). A mix design goes through the plant quality engineer and the
// quality control manager (and the consultant when the company asks); only an approved mix design inside its effective dates can be used for production (BR-01). A change is a new version that takes over on its effective date.
for (const [key, type, def, description, min, max] of [
  ['rmc.mix.volume_tolerance_pct', 'decimal', 2, 'How far the total absolute volume of a mix (materials plus air) may be from 1 m3, in percent (part 20.01 T-01).', 0, 20],
  ['rmc.mix.entrapped_air_pct', 'decimal', 1, 'Entrapped air allowed for in the volume of a mix, in percent of 1 m3.', 0, 10],
  ['rmc.mix.max_wc', 'decimal', 0.6, 'The highest water-binder ratio a mix design may have.', 0.2, 1],
  ['rmc.mix.min_trials', 'integer', 1, 'Trial mixes with a 28-day result needed before a mix design is sent for approval.', 0, 20],
  ['rmc.mix.consultant_approval', 'boolean', false, 'Whether the consultant also approves a mix design through the portal (after the quality control manager).', null, null]]) {
  if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: type, default: def, scopes: ['system', 'company'], description, ...(min == null ? {} : { min, max }) });
}
export const COMPONENT_LABEL = { CEMENT: 'Cement', FLY_ASH: 'Fly ash', GGBS: 'GGBS', SAND: 'Sand', AGG_10: '10 mm aggregate', AGG_20: '20 mm aggregate', WATER: 'Water', ADMIXTURE: 'Admixture' };
export const SG = { CEMENT: 3.15, FLY_ASH: 2.2, GGBS: 2.9, SAND: 2.65, AGG_10: 2.7, AGG_20: 2.7, WATER: 1, ADMIXTURE: 1.1 };
const STD_DEV = { M10: 3.5, M15: 3.5, M20: 4, M25: 4, M30: 5, M35: 5, M40: 5, M45: 5, M50: 5, M55: 5, M60: 5 };
export const fckOf = (grade) => Number(String(grade).slice(1)); export const targetMean = (grade) => Math.round((fckOf(grade) + 1.65 * (STD_DEV[grade] ?? 5)) * 100) / 100;
const json = (s, d) => { try { return JSON.parse(s); } catch { return d; } }; const f3 = (n) => (n ?? 0) / 1000;

/** T-01: the quantities for 1 m3 turned into absolute volumes, the binder, the water-binder ratio and the total with the air, worked out once for the server and for the live check of the form. */
export function computeMix(proportions, { airPct = 1, tolerancePct = 2 } = {}) {
  const lines = proportions.map((p) => { const qtyMilli = Math.round(Number(p.qty) * 1000); const sg = Number(p.sg ?? SG[p.component]); return { component: p.component, itemId: p.itemId ?? null, qtyMilli, sgMilli: Math.round(sg * 1000), volumePpm: Math.round((Number(p.qty) / sg) * 1000) }; });
  const q = (c) => lines.filter((l) => l.component === c).reduce((n, l) => n + l.qtyMilli, 0); const binderMilli = q('CEMENT') + q('FLY_ASH') + q('GGBS');
  const wcMilli = binderMilli > 0 ? Math.round((q('WATER') * 1000) / binderMilli) : 0; const airPpm = Math.round(airPct * 10000); const totalPpm = lines.reduce((n, l) => n + l.volumePpm, 0) + airPpm; const deviationPct = Math.round((Math.abs(totalPpm - 1_000_000) / 10_000) * 100) / 100;
  return { lines, binderMilli, wcMilli, airPpm, totalPpm, deviationPct, withinTolerance: deviationPct <= tolerancePct };
}
export const mixList = defineList({ code: 'rmc.mix_designs', label: 'Mix designs', permission: 'rmc.mix_design.view', from: 'bp_mix_designs x JOIN bp_plants p ON p.id = x.plant_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.code', 'x.grade', 'p.code'], defaultSort: 'code',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Mix design' }, code: { sql: 'x.code', type: 'text', label: 'Code' }, plant: { sql: 'p.code', type: 'text', label: 'Plant' }, grade: { sql: 'x.grade', type: 'enum', label: 'Grade', options: GRADES.map((g) => [g, g]) }, version: { sql: 'x.version_no', type: 'number', label: 'Version' }, wc: { sql: 'x.wc_ratio_milli', type: 'number', label: 'w/c x 1000' }, slump: { sql: 'x.slump_mm', type: 'number', label: 'Slump mm' }, effectiveFrom: { sql: "COALESCE(x.effective_from, '')", type: 'date', label: 'Effective from' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS) } } });

export function createMixService({ db, base, flags, plants }) {
  const { audit, fail, may, param } = base; void flags; const { evt, gate, scopeOf } = qaHelpers({ db, base }); const today = () => todayIST();
  const cfg = (companyId) => ({ airPct: Number(param(companyId, 'rmc.mix.entrapped_air_pct') ?? 1), tolerancePct: Number(param(companyId, 'rmc.mix.volume_tolerance_pct') ?? 2) });
  const flow = createFlow({ db, base, docType: 'RMC_MIX', table: 'bp_mix_designs', perm: 'rmc.mix_design', label: 'mix design', route: '/rmc/mix-designs?id=', title: (r) => `${r.code} v${r.version_no} ${r.grade}`, notifyCode: 'rmc.mix_design.decided', numberKey: 'RMC_MIX', prefix: 'MXD',
    ctx: (r) => ({ consultant: param(r.company_id, 'rmc.mix.consultant_approval') ? 'yes' : 'no', grade: r.grade }),
    beforeSubmit: (_a, r) => { const p = problemsOf(r); if (p.length) fail(p); },
    onApproved: (actor, r) => {
      if (r.source_type === 'amend' && r.source_id && r.effective_from) db.prepare("UPDATE bp_mix_designs SET effective_to = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED' AND (effective_to IS NULL OR effective_to >= ?)").run(new Date(Date.parse(`${r.effective_from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10), nowIso(), Number(r.source_id), r.effective_from);
      evt('rmc.mix_design.approved', actor, r.company_id, 'bp_mix_designs', r.id, { mixDesignId: r.id, docNo: r.doc_no, code: r.code, plantId: r.plant_id, grade: r.grade, versionNo: r.version_no, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, projectId: r.org_project_id, siteId: r.org_site_id, wcRatio: f3(r.wc_ratio_milli), lines: json(r.proportions_json, []).map((l) => ({ component: l.component, itemId: l.itemId, kgPerM3: f3(l.qtyMilli) })) }, r.org_project_id);
    } });
  /** What stops a mix design from being sent: the rules of the proportions, the item links (FR-04), the trials and the dates. */
  function problemsOf(r) {
    const p = []; const lines = json(r.proportions_json, []); const has = (c) => lines.some((l) => l.component === c && l.qtyMilli > 0); const co = cfg(r.company_id);
    for (const [c, label] of [['CEMENT', 'cement'], ['SAND', 'sand'], ['WATER', 'water']]) if (!has(c)) p.push({ field: 'proportions', message: `The mix needs ${label}` });
    if (!has('AGG_10') && !has('AGG_20')) p.push({ field: 'proportions', message: 'The mix needs coarse aggregate (10 mm or 20 mm)' });
    for (const l of lines) if (l.component !== 'WATER' && !l.itemId) p.push({ field: 'proportions', message: `Link ${COMPONENT_LABEL[l.component]} to an item of the item master so that consumption can be worked out` });
    const m = computeMix(lines.map((l) => ({ component: l.component, itemId: l.itemId, qty: f3(l.qtyMilli), sg: f3(l.sgMilli) })), co);
    if (!m.withinTolerance) p.push({ field: 'proportions', message: `The volumes add up to ${(m.totalPpm / 1_000_000).toFixed(3)} m3 with the air; they must be 1 m3 within ${co.tolerancePct}% (now ${m.deviationPct}% off)` });
    const maxWc = Number(param(r.company_id, 'rmc.mix.max_wc') ?? 0.6); if (m.wcMilli > Math.round(maxWc * 1000)) p.push({ field: 'proportions', message: `The water-binder ratio ${(m.wcMilli / 1000).toFixed(3)} is above the limit ${maxWc}` });
    const trials = json(r.trial_results_json, []).filter((t) => t.cube28 != null); const need = Number(param(r.company_id, 'rmc.mix.min_trials') ?? 1);
    if (trials.length < need) p.push({ field: 'trials', message: `At least ${need} trial mix(es) with a 28-day result are needed` });
    else { const mean = trials.reduce((n, t) => n + t.cube28, 0) / trials.length; if (mean < targetMean(r.grade)) p.push({ field: 'trials', message: `The mean 28-day strength ${Math.round(mean * 10) / 10} N/mm2 is below the target mean ${targetMean(r.grade)} N/mm2 of grade ${r.grade}` }); }
    if (!r.effective_from) p.push({ field: 'effectiveFrom', message: 'Give the date the mix design takes effect' }); if (r.effective_from && r.effective_to && r.effective_to < r.effective_from) p.push({ field: 'effectiveTo', message: 'The end is before the start' });
    return p;
  }
  const norm = (b) => { const seen = new Set(); for (const l of b.proportions) { if (seen.has(l.component)) fail([{ field: 'proportions', message: `${COMPONENT_LABEL[l.component]} appears twice` }]); seen.add(l.component); } return b; };
  const itemsOk = (actor, props) => { for (const l of props) if (l.itemId && !db.prepare("SELECT 1 FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(rid(l.itemId), actor.companyId)) fail([{ field: 'proportions', message: `${COMPONENT_LABEL[l.component]}: not an item of the item master` }]); };
  const view = (actor, r, detail = false) => {
    const can = flow.can(actor, r); const lines = json(r.proportions_json, []); const co = cfg(r.company_id); const m = computeMix(lines.map((l) => ({ component: l.component, itemId: l.itemId, qty: f3(l.qtyMilli), sg: f3(l.sgMilli) })), co); const t = today();
    const o = { id: r.id, docNo: r.doc_no, code: r.code, plantId: r.plant_id, plant: db.prepare('SELECT code FROM bp_plants WHERE id = ?').get(r.plant_id)?.code, projectId: r.org_project_id, siteId: r.org_site_id, grade: r.grade, fck: fckOf(r.grade), targetMean: targetMean(r.grade), versionNo: r.version_no, wcRatio: f3(r.wc_ratio_milli), binder: f3(r.binder_milli), slumpMm: r.slump_mm, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, status: r.status, statusLabel: STATUS[r.status], version: r.version, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at,
      usable: r.status === 'APPROVED' && Boolean(r.effective_from) && r.effective_from <= t && (!r.effective_to || r.effective_to >= t), can };
    if (detail) Object.assign(o, flow.approveInfo(actor, r), { cancelReason: r.cancel_reason, amendedFrom: r.source_type === 'amend' ? Number(r.source_id) : null, trials: json(r.trial_results_json, []), problems: ['DRAFT', 'RETURNED'].includes(r.status) ? problemsOf(r) : [],
      components: m.lines.map((l) => ({ component: l.component, label: COMPONENT_LABEL[l.component], itemId: l.itemId, item: l.itemId ? db.prepare('SELECT code, name FROM mdm_items WHERE id = ?').get(l.itemId) : null, qty: f3(l.qtyMilli), sg: f3(l.sgMilli), volume: l.volumePpm / 1_000_000 })), totalVolume: m.totalPpm / 1_000_000, airVolume: m.airPpm / 1_000_000, deviationPct: m.deviationPct, withinTolerance: m.withinTolerance });
    return o;
  };
  const saveCols = (b, grade, companyId) => { const m = computeMix(b.proportions.map((l) => ({ component: l.component, itemId: l.itemId, qty: l.qty, sg: l.sg })), cfg(companyId)); void grade; return { lines: JSON.stringify(m.lines), binder: m.binderMilli, wc: m.wcMilli }; };
  const mixes = {
    ...flow,
    list(actor, query) { return runList(db, mixList, parseListRequest(mixList, query), { select: 'x.*', scopeSql: scopeOf(actor, 'rmc.mix_design.view'), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get: (actor, id) => view(actor, flow.row(actor, id), true),
    options(actor) { gate(actor, 'rmc.mix_design.create', 'make mix designs'); return { plants: db.prepare("SELECT COALESCE(root_id, id) AS id, code, name, id AS rowId, org_project_id AS projectId, org_site_id AS siteId FROM bp_plants WHERE company_id = ? AND deleted_at IS NULL AND status = 'APPROVED' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'rmc.mix_design.create', p.projectId, p.siteId)), grades: GRADES.map((g) => ({ id: g, fck: fckOf(g), targetMean: targetMean(g) })), components: Object.entries(COMPONENT_LABEL).map(([id, label]) => ({ id, label, sg: SG[id] })), items: db.prepare("SELECT id, code, name, base_uom AS uom FROM mdm_items WHERE company_id = ? AND deleted_at IS NULL AND item_status = 'ACTIVE' ORDER BY code LIMIT 1500").all(actor.companyId), ...cfg(actor.companyId), maxWc: Number(param(actor.companyId, 'rmc.mix.max_wc') ?? 0.6) }; },
    /** The live check of the form: the same arithmetic the server applies on save and submit. */
    check(actor, b) { gate(actor, 'rmc.mix_design.view', 'check mix proportions'); const co = cfg(actor.companyId); const m = computeMix(b.proportions, co); return { lines: m.lines.map((l) => ({ component: l.component, qty: f3(l.qtyMilli), volume: l.volumePpm / 1_000_000 })), binder: f3(m.binderMilli), wcRatio: f3(m.wcMilli), airVolume: m.airPpm / 1_000_000, totalVolume: m.totalPpm / 1_000_000, deviationPct: m.deviationPct, withinTolerance: m.withinTolerance, tolerancePct: co.tolerancePct, targetMean: b.grade ? targetMean(b.grade) : null }; },
    create(actor, b) {
      norm(b); const p = plants.plantAt(actor, b.plantId, 'rmc.mix_design.create'); itemsOk(actor, b.proportions); const root = plants.rootOf(p); const s = saveCols(b, b.grade, actor.companyId);
      const code = b.code ?? `${p.code}-${b.grade}-${String(db.prepare("SELECT COUNT(DISTINCT code) AS n FROM bp_mix_designs WHERE company_id = ? AND plant_id = ? AND grade = ? AND deleted_at IS NULL").get(actor.companyId, root, b.grade).n + 1).padStart(2, '0')}`;
      if (db.prepare("SELECT 1 FROM bp_mix_designs WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL AND status <> 'CANCELLED'").get(actor.companyId, code)) throw conflict('A mix design with this code exists; amend it for a new version.');
      return transaction(db, () => { const no = flow.next(actor); const id = Number(db.prepare('INSERT INTO bp_mix_designs (company_id, doc_no, code, plant_id, org_project_id, org_site_id, grade, proportions_json, binder_milli, wc_ratio_milli, slump_mm, trial_results_json, effective_from, effective_to, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, no, code, root, p.org_project_id, p.org_site_id, b.grade, s.lines, s.binder, s.wc, b.slumpMm, JSON.stringify(b.trials), b.effectiveFrom, b.effectiveTo, actor.user, 'manual').lastInsertRowid); audit(actor, 'bp_mix_designs', id, 'create', actor.companyId); return mixes.get(actor, id); });
    },
    update(actor, id, b) {
      const r = flow.row(actor, id, 'rmc.mix_design.edit'); if (!flow.EDITABLE.includes(r.status)) throw conflict('Only a draft or a returned mix design is changed; an approved one is amended.'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this; reload it.');
      let cols = { lines: r.proportions_json, binder: r.binder_milli, wc: r.wc_ratio_milli }; if (b.proportions) { norm(b); itemsOk(actor, b.proportions); cols = saveCols(b, b.grade ?? r.grade, r.company_id); }
      db.prepare('UPDATE bp_mix_designs SET grade = ?, proportions_json = ?, binder_milli = ?, wc_ratio_milli = ?, slump_mm = ?, trial_results_json = ?, effective_from = ?, effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.grade ?? r.grade, cols.lines, cols.binder, cols.wc, b.slumpMm ?? r.slump_mm, b.trials ? JSON.stringify(b.trials) : r.trial_results_json, 'effectiveFrom' in b ? b.effectiveFrom : r.effective_from, 'effectiveTo' in b ? b.effectiveTo : r.effective_to, actor.user, nowIso(), r.id); audit(actor, 'bp_mix_designs', r.id, 'update', r.company_id); return mixes.get(actor, r.id);
    },
    remove: (actor, id) => flow.remove(actor, id),
    submit(actor, id) { flow.submit(actor, id); return mixes.get(actor, id); },
    withdraw: (actor, id, b) => { flow.withdraw(actor, id, b); return mixes.get(actor, id); }, cancel: (actor, id, b) => { flow.cancel(actor, id, b); return mixes.get(actor, id); },
    /** A new version of an approved mix design: the old one stays usable until the new one takes effect. */
    amend(actor, id, { reason }) {
      const r = flow.row(actor, id, 'rmc.mix_design.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved mix design is amended.'); if (db.prepare("SELECT 1 FROM bp_mix_designs WHERE company_id = ? AND code = ? COLLATE NOCASE AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.company_id, r.code)) throw conflict('A newer version of this mix design is already being prepared.');
      const top = db.prepare('SELECT MAX(version_no) AS v FROM bp_mix_designs WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(r.company_id, r.code).v;
      return transaction(db, () => { const no = flow.next(actor); const nid = Number(db.prepare('INSERT INTO bp_mix_designs (company_id, doc_no, code, plant_id, org_project_id, org_site_id, grade, version_no, proportions_json, binder_milli, wc_ratio_milli, slump_mm, trial_results_json, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(r.company_id, no, r.code, r.plant_id, r.org_project_id, r.org_site_id, r.grade, top + 1, r.proportions_json, r.binder_milli, r.wc_ratio_milli, r.slump_mm, r.trial_results_json, actor.user, 'amend', String(r.id), reason).lastInsertRowid); audit(actor, 'bp_mix_designs', nid, 'amend', r.company_id, { reason }); return mixes.get(actor, nid); });
    },
    history: (actor, id) => flow.history(actor, id),
    /** BR-01: the mix designs a plant may produce today: approved and inside the effective dates. */
    forProduction(companyId, plantRootId, grade = null, onDate = today()) { return db.prepare("SELECT * FROM bp_mix_designs WHERE company_id = ? AND plant_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND effective_from IS NOT NULL AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) AND (? IS NULL OR grade = ?) ORDER BY version_no DESC, id DESC").all(companyId, rid(plantRootId), onDate, onDate, grade, grade); },
    usable(companyId, mixId, onDate = today()) { const r = db.prepare('SELECT * FROM bp_mix_designs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(mixId), companyId); if (!r) return { ok: false, reason: 'That mix design does not exist.' }; if (r.status !== 'APPROVED') return { ok: false, reason: `Mix design ${r.code} is not approved (${STATUS[r.status]}).`, row: r }; if (!r.effective_from || r.effective_from > onDate) return { ok: false, reason: `Mix design ${r.code} takes effect on ${r.effective_from ?? 'no date'}.`, row: r }; if (r.effective_to && r.effective_to < onDate) return { ok: false, reason: `Mix design ${r.code} ended on ${r.effective_to}; a newer version is in force.`, row: r }; return { ok: true, row: r }; },
    /** The theoretical quantities of each material for a volume of concrete (20.02 compares the batch weights with them). */
    theoretical(mixRow, qtyM3) { return json(mixRow.proportions_json, []).map((l) => ({ component: l.component, itemId: l.itemId, kg: Math.round((l.qtyMilli * Number(qtyM3)) ) / 1000 })); },
    print(actor, id) {
      const r = flow.row(actor, id, 'rmc.mix_design.print'); const v = view(actor, r, true); audit(actor, 'bp_mix_designs', r.id, 'print', r.company_id);
      const rows = [['Mix design', `${v.code} version ${v.versionNo}, grade ${v.grade} (fck ${v.fck} N/mm2)`], ['Plant', v.plant], ...v.components.map((c) => [c.label, `${c.qty} per m3 (SG ${c.sg}) ${c.item ? `- ${c.item.code}` : ''}`]), ['Water-binder ratio', String(v.wcRatio)], ['Slump', `${v.slumpMm} mm`], ['Total volume with air', `${v.totalVolume} m3`], ['Target mean strength', `${v.targetMean} N/mm2`], ...v.trials.map((t) => [`Trial ${t.date}`, `slump ${t.slumpMm ?? '-'}, 7-day ${t.cube7 ?? '-'}, 28-day ${t.cube28 ?? '-'} N/mm2`]), ['Effective', `${v.effectiveFrom ?? '-'} to ${v.effectiveTo ?? 'open'}`], ['Status', v.statusLabel]].map(([k, val]) => ({ k, v: String(val) }));
      return { buffer: toPdf({ columns: [{ key: 'k', label: 'Particular', type: 'text' }, { key: 'v', label: 'Value', type: 'text' }], rows, footer: [v.docNo], title: `Mix design ${v.code}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    exportCsv(actor) { gate(actor, 'rmc.mix_design.export', 'export mix designs'); const l = mixes.list(actor, { page: 1, pageSize: 100 }); const headers = ['Mix design', 'Plant', 'Grade', 'Version', 'w/c', 'Slump mm', 'Effective from', 'Effective to', 'Status']; const rows = l.data.map((x) => [x.code, x.plant, x.grade, x.versionNo, x.wcRatio, x.slumpMm, x.effectiveFrom ?? '', x.effectiveTo ?? '', x.statusLabel]); audit(actor, 'bp_mix_designs', 0, 'export', actor.companyId, { reason: `${rows.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `mix-designs-${today()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(headers, rows)}`, 'utf8') }; },
    /** Import: one row per mix with the kg per m3 of each material (the item links are taken from the item codes); each good row becomes a draft. */
    importRows(actor, { rows }) {
      gate(actor, 'rmc.mix_design.create', 'import mix designs'); const out = []; const col = { cement: 'CEMENT', flyAsh: 'FLY_ASH', ggbs: 'GGBS', sand: 'SAND', agg10: 'AGG_10', agg20: 'AGG_20', water: 'WATER', admixture: 'ADMIXTURE' };
      for (const [i, x] of rows.entries()) { try { const pl = db.prepare("SELECT COALESCE(root_id, id) AS id FROM bp_plants WHERE company_id = ? AND code = ? COLLATE NOCASE AND status = 'APPROVED' AND deleted_at IS NULL").get(actor.companyId, x.plantCode ?? ''); if (!pl) throw new Error('Plant code not found or not approved'); const proportions = []; for (const [k, c] of Object.entries(col)) if (Number(x[k]) > 0) { const code = x[`${k}Item`]; const it = code ? db.prepare('SELECT id FROM mdm_items WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, String(code)) : null; if (code && !it) throw new Error(`Item ${code} not found`); proportions.push({ component: c, itemId: it?.id ?? null, qty: Number(x[k]) }); } if (!GRADES.includes(x.grade)) throw new Error('Unknown grade'); const r = mixes.create(actor, { plantId: pl.id, grade: x.grade, slumpMm: Number(x.slumpMm ?? 100), proportions, trials: [], effectiveFrom: x.effectiveFrom ?? null, effectiveTo: null }); out.push({ row: i + 1, ok: true, id: r.id, docNo: r.docNo }); } catch (e) { out.push({ row: i + 1, ok: false, error: e.message }); } }
      audit(actor, 'bp_mix_designs', 0, 'import', actor.companyId, { reason: `${out.filter((x) => x.ok).length} of ${rows.length} row(s)` }); return { created: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok).length, rows: out };
    },
  };
  return mixes;
}
