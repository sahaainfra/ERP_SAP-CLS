import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso, rid, same } from '../proc/base.js';
import { qrSvg } from '../inv/reorder.js';

// Equipment and vehicle register (part 17.01): the register (approval-controlled), the documents and statutory certificates with their expiry, the status and current location, the history of each machine, the fleet dashboard and the import of an existing fleet.
// A mandatory certificate that is missing or has expired blocks allocation and logging (BR-01, switchable by a parameter); `allocatable` is the one check that allocation (17.02) and logs (17.03) call. Money is paise, quantities thousandths.
export const PLANT_EQUIP_DOC = 'PLANT_EQUIPMENT';
export const EQUIP_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned for correction', APPROVED: 'Registered', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const EQUIP_STATE = { AVAILABLE: 'Available', DEPLOYED: 'Deployed', UNDER_MAINTENANCE: 'Under maintenance', BREAKDOWN: 'Breakdown', IDLE: 'Idle', DEMOBILISED: 'Demobilised', DISPOSED: 'Disposed of' };
export const OWNERSHIP = { OWNED: 'Owned', HIRED: 'Hired in', SUBCONTRACTOR: 'Provided by a subcontractor' };
export const DOC_TYPES = { RC: 'Registration certificate (RC)', INSURANCE: 'Insurance', FITNESS: 'Fitness certificate', PUC: 'Pollution under control (PUC)', ROAD_PERMIT: 'Road permit', LOAD_TEST: 'Load test (crane and lifting)', THIRD_PARTY_INSPECTION: 'Third-party inspection', OTHER: 'Other' };
export const FUEL_TYPES = { DIESEL: 'Diesel', PETROL: 'Petrol', CNG: 'CNG', ELECTRIC: 'Electric', NONE: 'No fuel' };
/** Where a machine may go from where it is. Disposal is final; deployment needs a project and passes the certificate check. */
export const TRANSITIONS = { AVAILABLE: ['DEPLOYED', 'UNDER_MAINTENANCE', 'BREAKDOWN', 'IDLE', 'DEMOBILISED', 'DISPOSED'], DEPLOYED: ['DEPLOYED', 'AVAILABLE', 'UNDER_MAINTENANCE', 'BREAKDOWN', 'IDLE', 'DEMOBILISED'], UNDER_MAINTENANCE: ['AVAILABLE', 'DEPLOYED', 'BREAKDOWN', 'IDLE', 'DISPOSED'], BREAKDOWN: ['AVAILABLE', 'UNDER_MAINTENANCE', 'IDLE', 'DISPOSED'], IDLE: ['AVAILABLE', 'DEPLOYED', 'UNDER_MAINTENANCE', 'BREAKDOWN', 'DEMOBILISED', 'DISPOSED'], DEMOBILISED: ['AVAILABLE', 'DEPLOYED', 'DISPOSED'], DISPOSED: [] };
const EDITABLE = ['DRAFT', 'RETURNED']; const UNIT = { HOURS: 'L_PER_HOUR', KM: 'KM_PER_L' };
const ROAD_TYPES = ['RC', 'INSURANCE', 'FITNESS', 'PUC']; const LIFT_TYPES = ['LOAD_TEST'];
const satisfiers = (type) => (type === 'LOAD_TEST' ? ['LOAD_TEST', 'THIRD_PARTY_INSPECTION'] : [type]);

for (const [key, def, description, min, max] of [
  ['plant.cert.block_on_expiry', 1, 'BR-01: 1 blocks allocation and logging of equipment with a mandatory certificate that is missing or has expired; 0 only warns.', 0, 1],
  ['plant.cert.alert_days', 30, 'FR-02: a certificate that expires within this many days is shown as expiring and told to the plant manager.', 1, 365],
  ['plant.dash.target_utilisation_pct', 70, 'The share (percent) of the working fleet that is deployed, below which the dashboard tile turns red.', 0, 100],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'integer', default: def, scopes: ['system', 'company'], description, min, max });

export const equipList = defineList({
  code: 'plant.equipment', label: 'Equipment register', permission: 'plant.equipment.view', from: 'plt_equipment x JOIN mdm_items i ON i.id = x.class_item_id LEFT JOIN org_projects p ON p.id = x.org_project_id LEFT JOIN mdm_partners o ON o.id = x.owner_partner_id', where: 'x.deleted_at IS NULL',
  searchable: ['x.asset_code', 'x.doc_no', 'x.reg_no', 'x.serial_no', 'x.chassis_no', 'x.make', 'x.model', 'i.name'], defaultSort: 'assetCode',
  columns: {
    assetCode: { sql: 'x.asset_code', type: 'text', label: 'Asset code' }, docNo: { sql: 'x.doc_no', type: 'text', label: 'Entry' }, class: { sql: "i.code || ' ' || i.name", type: 'text', label: 'Class' }, make: { sql: 'x.make', type: 'text', label: 'Make' }, model: { sql: 'x.model', type: 'text', label: 'Model' }, regNo: { sql: 'x.reg_no', type: 'text', label: 'Registration' },
    ownership: { sql: 'x.ownership', type: 'enum', label: 'Ownership', options: Object.entries(OWNERSHIP) }, state: { sql: 'x.equip_state', type: 'enum', label: 'Where', options: Object.entries(EQUIP_STATE) }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(EQUIP_STATUS) },
    project: { sql: 'p.code', type: 'text', label: 'Project' }, created: { sql: 'x.created_at', type: 'date', label: 'Registered' },
  },
});

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const t3 = (n) => Math.round(Number(n) * 1000); const p2 = (n) => Math.round(Number(n) * 100);
const LIMIT = 200;

export function createPlantService({ db, base, flags }) {
  const { authz, may, need, fail, audit, notify, number, param } = base;
  const evt = (type, actor, companyId, entityId, data, projectId) => publishEvent(db, { type, entity: 'plt_equipment', entityId, actorId: actor?.user ?? 'system', companyId, projectId: projectId ?? undefined, data });
  const taskOf = (actor, instanceId) => workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === instanceId)?.id ?? null;
  const classLabel = (id) => { const i = db.prepare('SELECT code, name FROM mdm_items WHERE id = ?').get(id); return i ? `${i.code} ${i.name}` : ''; };
  const partnerOf = (companyId, id) => db.prepare('SELECT id, code, legal_name AS name, partner_status FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId);
  const pcode = (id) => (id ? (db.prepare('SELECT code FROM org_projects WHERE id = ?').get(id)?.code ?? '') : '');
  const scode = (id) => (id ? (db.prepare('SELECT code FROM org_sites WHERE id = ?').get(id)?.code ?? '') : '');
  const alertDays = (companyId) => Number(param(companyId, 'plant.cert.alert_days') ?? 30);
  const blocks = (companyId) => Number(param(companyId, 'plant.cert.block_on_expiry') ?? 1) === 1;
  const holds = (actor, key) => authz.hasAnywhere(actor, key);
  const gate = (actor, key, what) => { if (!holds(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const timeline = (actor, e, event, { from = null, to = null, note = null } = {}) => db.prepare('INSERT INTO plt_timeline (company_id, equipment_id, event, from_state, to_state, org_project_id, org_site_id, note, done_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(e.company_id, e.id, event, from, to, e.org_project_id ?? null, e.org_site_id ?? null, note, actor?.user ?? 'system', actor?.user ?? 'system', 'api');

  // ---- certificates (FR-02, BR-01) -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const certState = (d, today, days) => (!d.valid_until ? 'NO_EXPIRY' : d.valid_until < today ? 'EXPIRED' : daysBetween(today, d.valid_until) <= days ? 'EXPIRING' : 'VALID');
  const requiredTypes = (e) => [...(e.road_vehicle ? ROAD_TYPES : []), ...(e.lifting ? LIFT_TYPES : [])];
  /** The certificates of a machine against what it needs: each required type and each mandatory document, with its state; `blocking` is what stops allocation. */
  function compliance(e, docs, today = todayIST()) {
    const days = alertDays(e.company_id); const items = []; const used = new Set();
    for (const type of requiredTypes(e)) {
      const cands = docs.filter((d) => satisfiers(type).includes(d.doc_type)).sort((a, b) => (b.valid_until ?? '9999').localeCompare(a.valid_until ?? '9999')); const d = cands[0];
      if (!d) { items.push({ docType: type, state: 'MISSING', mandatory: true, required: true }); continue; } used.add(d.id);
      items.push({ docType: type, docId: d.id, number: d.doc_number, validUntil: d.valid_until, state: certState(d, today, days), daysLeft: d.valid_until ? daysBetween(today, d.valid_until) : null, mandatory: true, required: true, fileId: d.file_id });
    }
    for (const d of docs) { if (used.has(d.id)) continue; items.push({ docType: d.doc_type, docId: d.id, number: d.doc_number, validUntil: d.valid_until, state: certState(d, today, days), daysLeft: d.valid_until ? daysBetween(today, d.valid_until) : null, mandatory: Boolean(d.mandatory), required: false, fileId: d.file_id }); }
    const blocking = items.filter((x) => x.mandatory && (x.state === 'MISSING' || x.state === 'EXPIRED')); const expiring = items.filter((x) => x.state === 'EXPIRING');
    return { items, blocking, expiring, ok: blocking.length === 0 };
  }
  const currentDocs = (id) => db.prepare("SELECT * FROM plt_documents WHERE equipment_id = ? AND doc_status = 'CURRENT' AND deleted_at IS NULL ORDER BY doc_type, id").all(id);
  const problemText = (x) => (x.state === 'MISSING' ? `${DOC_TYPES[x.docType]} is missing` : `${DOC_TYPES[x.docType]}${x.number ? ` ${x.number}` : ''} expired on ${x.validUntil}`);

  // ---- the register (FR-01, FR-03) --------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const scope = (actor, key = 'plant.equipment.view', alias = 'x') => { gate(actor, key, 'see the equipment register'); const f = authz.scopeFilter(actor, key, { project: `${alias}.org_project_id`, site: `${alias}.org_site_id` }); return { sql: `${alias}.company_id = :c AND ${f.sql}`, params: { c: actor.companyId }, unrestricted: Boolean(f.unrestricted) }; };
  const erow = (actor, id, key = 'plant.equipment.view') => {
    const e = db.prepare('SELECT * FROM plt_equipment WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!e) throw notFound('That equipment does not exist.');
    if (!may(actor, 'plant.equipment.view', e.org_project_id, e.org_site_id)) throw notFound('That equipment does not exist.'); if (key !== 'plant.equipment.view') need(actor, key, 'do this', e.org_project_id, e.org_site_id); return e;
  };
  const rawRow = (actor, id) => { const e = db.prepare('SELECT * FROM plt_equipment WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!e) throw notFound('That equipment does not exist.'); return e; };
  const photosOf = (id) => db.prepare("SELECT id, original_name AS name, mime FROM core_files WHERE linked_entity = 'plt_equipment' AND linked_id = ? AND deleted_at IS NULL ORDER BY id").all(id);
  const view = (actor, e, { detail = false } = {}) => {
    const can = (k) => may(actor, k, e.org_project_id, e.org_site_id); const own = same(e.requested_by, actor.user); const ok = e.status === 'APPROVED' || Boolean(e.approved_at); const docs = currentDocs(e.id); const comp = compliance(e, docs);
    const o = { id: e.id, docNo: e.doc_no, assetCode: e.asset_code, classItemId: e.class_item_id, class: classLabel(e.class_item_id), make: e.make, model: e.model, year: e.mfg_year, serialNo: e.serial_no, chassisNo: e.chassis_no, engineNo: e.engine_no, regNo: e.reg_no, capacity: e.capacity,
      ownership: e.ownership, ownershipLabel: OWNERSHIP[e.ownership], ownerPartnerId: e.owner_partner_id, owner: e.owner_partner_id ? (partnerOf(e.company_id, e.owner_partner_id)?.name ?? '') : null, purchaseValue: can('plant.equipment.values') ? e.purchase_value : null, purchaseDate: e.purchase_date,
      meterType: e.meter_type, fuelType: e.fuel_type, tankCapacity: e.tank_capacity / 1000, fuelNorm: e.fuel_norm / 1000, fuelNormUnit: e.fuel_norm_unit, gpsDeviceId: e.gps_device_id, roadVehicle: Boolean(e.road_vehicle), lifting: Boolean(e.lifting), operatorRequired: Boolean(e.operator_required), operatorLicenceClass: e.operator_licence_class,
      state: e.equip_state, stateLabel: EQUIP_STATE[e.equip_state], projectId: e.org_project_id, project: pcode(e.org_project_id), siteId: e.org_site_id, site: scode(e.org_site_id), stateSince: e.state_since, stateNote: e.state_note, status: e.status, statusLabel: EQUIP_STATUS[e.status], version: e.version, requestedBy: e.requested_by, approvedBy: e.approved_by, approvedAt: e.approved_at,
      compliance: { ok: comp.ok, blocking: comp.blocking.map(problemText), expiring: comp.expiring.length, blocks: blocks(e.company_id) }, qrCode: `ERP:E:${e.asset_code}`,
      can: { edit: can('plant.equipment.edit') && EDITABLE.includes(e.status), delete: can('plant.equipment.delete') && e.status === 'DRAFT', submit: can('plant.equipment.submit') && EDITABLE.includes(e.status), withdraw: e.status === 'SUBMITTED' && own, cancel: can('plant.equipment.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(e.status), amend: can('plant.equipment.amend') && e.status === 'APPROVED', print: can('plant.equipment.print'),
        setState: can('plant.equipment.status') && ok && e.equip_state !== 'DISPOSED' && e.status !== 'CANCELLED', manageDocuments: can('plant.document.manage') && e.status !== 'CANCELLED' } };
    if (detail) {
      o.approve = e.status === 'SUBMITTED' && !own && can('plant.equipment.approve'); if (o.approve && e.workflow_instance_id) o.taskId = taskOf(actor, e.workflow_instance_id); o.cancelReason = e.cancel_reason; o.allowedStates = ok ? TRANSITIONS[e.equip_state] : [];
      o.documents = docs.map((d) => docView(d, comp)); o.certificates = comp.items; o.photos = photosOf(e.id); o.timeline = db.prepare('SELECT id, event, from_state AS fromState, to_state AS toState, org_project_id AS projectId, org_site_id AS siteId, note, done_by AS doneBy, created_at AS at FROM plt_timeline WHERE equipment_id = ? ORDER BY id DESC').all(e.id).map((t) => ({ ...t, project: pcode(t.projectId), site: scode(t.siteId) }));
      o.superseded = db.prepare("SELECT id, doc_type AS docType, doc_number AS number, valid_until AS validUntil FROM plt_documents WHERE equipment_id = ? AND doc_status = 'SUPERSEDED' AND deleted_at IS NULL ORDER BY id DESC").all(e.id);
    }
    return o;
  };
  const docView = (d, comp) => { const it = comp?.items.find((x) => x.docId === d.id); return { id: d.id, docType: d.doc_type, docTypeLabel: DOC_TYPES[d.doc_type], number: d.doc_number, issuer: d.issuer, validFrom: d.valid_from, validUntil: d.valid_until, mandatory: Boolean(d.mandatory), fileId: d.file_id, fileName: d.file_id ? (db.prepare('SELECT original_name FROM core_files WHERE id = ?').get(d.file_id)?.original_name ?? null) : null, state: it?.state ?? 'VALID', daysLeft: it?.daysLeft ?? null }; };
  const checkFields = (actor, b, current = null) => {
    const problems = []; const g = (k, cur) => (k in b ? b[k] : cur);
    const it = db.prepare('SELECT * FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.classItemId ?? current?.class_item_id ?? 0), actor.companyId); if (!it || it.item_status !== 'ACTIVE' || it.item_type !== 'EQUIPMENT') problems.push({ field: 'classItemId', message: 'Choose an active equipment class from the item master' });
    const ownership = g('ownership', current?.ownership ?? 'OWNED'); const ownerId = g('ownerPartnerId', current?.owner_partner_id ?? null);
    if (ownership !== 'OWNED') { const p = ownerId ? partnerOf(actor.companyId, rid(ownerId)) : null; if (!p || p.partner_status !== 'ACTIVE') problems.push({ field: 'ownerPartnerId', message: 'Choose the active vendor or subcontractor that provides this equipment' }); }
    const meter = g('meterType', current?.meter_type ?? 'HOURS'); const unit = g('fuelNormUnit', current?.fuel_norm_unit ?? UNIT[meter]); if (unit !== UNIT[meter]) problems.push({ field: 'fuelNormUnit', message: meter === 'HOURS' ? 'A machine with an hour meter has a norm in litres per hour' : 'A vehicle with a km meter has a norm in km per litre' });
    const code = (g('assetCode', current?.asset_code) ?? '').trim(); if (code) { const dup = db.prepare('SELECT id FROM plt_equipment WHERE company_id = ? AND asset_code = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?').get(actor.companyId, code, current?.id ?? 0); if (dup) problems.push({ field: 'assetCode', message: 'This asset code is already used' }); }
    const reg = (g('regNo', current?.reg_no) ?? '').trim(); if (reg) { const dup = db.prepare('SELECT id FROM plt_equipment WHERE company_id = ? AND reg_no = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?').get(actor.companyId, reg, current?.id ?? 0); if (dup) problems.push({ field: 'regNo', message: 'This registration number is already on another machine' }); }
    const pid = g('projectId', current?.org_project_id ?? null); const sid = g('siteId', current?.org_site_id ?? null); let pj = null; let st = null;
    if (pid) { pj = db.prepare('SELECT id, company_id FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(rid(pid)); if (!pj || pj.company_id !== actor.companyId) problems.push({ field: 'projectId', message: 'Choose a project of your company' }); }
    if (sid) { st = db.prepare('SELECT id, org_project_id FROM org_sites WHERE id = ? AND deleted_at IS NULL').get(rid(sid)); if (!st || !pj || st.org_project_id !== pj.id) problems.push({ field: 'siteId', message: 'Choose a site of that project' }); }
    const state = g('state', current?.equip_state ?? 'AVAILABLE'); if (!current && (state === 'DISPOSED')) problems.push({ field: 'state', message: 'A machine is not registered as disposed of' }); if (state === 'DEPLOYED' && !pj) problems.push({ field: 'projectId', message: 'A deployed machine needs its project' });
    const year = g('year', current?.mfg_year); if (year != null && (year < 1950 || year > Number(todayIST().slice(0, 4)) + 1)) problems.push({ field: 'year', message: 'Give a year of manufacture' });
    fail(problems); return { it, ownership, ownerId: ownership === 'OWNED' ? (ownerId ? rid(ownerId) : null) : rid(ownerId), meter, unit, code, reg, pj, st, state };
  };
  const columns = (actor, b, f, cur = null) => {
    const g = (k, c) => (k in b ? b[k] : c);
    return { class_item_id: f.it.id, make: g('make', cur?.make) ?? null, model: g('model', cur?.model) ?? null, mfg_year: g('year', cur?.mfg_year) ?? null, serial_no: g('serialNo', cur?.serial_no) ?? null, chassis_no: g('chassisNo', cur?.chassis_no) ?? null, engine_no: g('engineNo', cur?.engine_no) ?? null, reg_no: f.reg || null, capacity: g('capacity', cur?.capacity) ?? null,
      ownership: f.ownership, owner_partner_id: f.ownerId, purchase_value: 'purchaseValue' in b ? p2(b.purchaseValue ?? 0) : (cur?.purchase_value ?? 0), purchase_date: g('purchaseDate', cur?.purchase_date) ?? null, meter_type: f.meter, fuel_type: g('fuelType', cur?.fuel_type ?? 'DIESEL'), tank_capacity: 'tankCapacity' in b ? t3(b.tankCapacity ?? 0) : (cur?.tank_capacity ?? 0),
      fuel_norm: 'fuelNorm' in b ? t3(b.fuelNorm ?? 0) : (cur?.fuel_norm ?? 0), fuel_norm_unit: f.unit, gps_device_id: g('gpsDeviceId', cur?.gps_device_id) ?? null, road_vehicle: 'roadVehicle' in b ? (b.roadVehicle ? 1 : 0) : (cur?.road_vehicle ?? 0), lifting: 'lifting' in b ? (b.lifting ? 1 : 0) : (cur?.lifting ?? 0), operator_required: 'operatorRequired' in b ? (b.operatorRequired ? 1 : 0) : (cur?.operator_required ?? 0),
      operator_licence_class: g('operatorLicenceClass', cur?.operator_licence_class) ?? null, org_project_id: f.pj?.id ?? null, org_site_id: f.st?.id ?? null };
  };
  const equipment = {
    list(actor, query) { const sc = scope(actor); return runList(db, equipList, parseListRequest(equipList, query), { select: 'x.*', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (e) => view(actor, e) }); },
    get: (actor, id) => view(actor, erow(actor, id), { detail: true }),
    options(actor) {
      gate(actor, 'plant.equipment.view', 'see the equipment options');
      return { classes: db.prepare("SELECT id, code, name FROM mdm_items WHERE company_id = ? AND deleted_at IS NULL AND item_status = 'ACTIVE' AND item_type = 'EQUIPMENT' ORDER BY code LIMIT 500").all(actor.companyId), partners: db.prepare("SELECT id, code, legal_name AS name FROM mdm_partners WHERE company_id = ? AND deleted_at IS NULL AND partner_status = 'ACTIVE' ORDER BY legal_name LIMIT 500").all(actor.companyId),
        projects: db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'plant.equipment.view', p.id)), sites: db.prepare("SELECT s.id, s.code, s.name, s.org_project_id AS projectId FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE p.company_id = ? AND s.deleted_at IS NULL AND s.status = 'ACTIVE' ORDER BY s.code").all(actor.companyId).filter((s) => may(actor, 'plant.equipment.view', s.projectId, s.id)),
        ownership: Object.entries(OWNERSHIP).map(([k, v]) => ({ id: k, label: v })), states: Object.entries(EQUIP_STATE).map(([k, v]) => ({ id: k, label: v })), docTypes: Object.entries(DOC_TYPES).map(([k, v]) => ({ id: k, label: v })), fuelTypes: Object.entries(FUEL_TYPES).map(([k, v]) => ({ id: k, label: v })) };
    },
    create(actor, b) {
      const f = checkFields(actor, b); if (!may(actor, 'plant.equipment.create', f.pj?.id ?? null, f.st?.id ?? null)) throw forbidden('You may not register equipment here (permission plant.equipment.create).');
      return transaction(db, () => {
        const no = number(actor.companyId, actor.user, PLANT_EQUIP_DOC, 'plt_equipment', 'EQ'); const code = f.code || number(actor.companyId, actor.user, 'PLANT_ASSET_CODE', 'plt_equipment', 'PL').replaceAll('/', '-'); const c = columns(actor, b, f);
        const names = Object.keys(c); const id = Number(db.prepare(`INSERT INTO plt_equipment (company_id, doc_no, asset_code, ${names.join(', ')}, equip_state, state_since, status, requested_by, created_by, source_type) VALUES (?, ?, ?, ${names.map(() => '?').join(', ')}, ?, ?, 'DRAFT', ?, ?, ?)`).run(actor.companyId, no, code, ...names.map((k) => c[k]), f.state, todayIST(), actor.user, actor.user, b.sourceType ?? 'api').lastInsertRowid);
        audit(actor, 'plt_equipment', id, 'create', actor.companyId); return equipment.get(actor, id);
      });
    },
    update(actor, id, b) {
      const e = erow(actor, id, 'plant.equipment.edit'); if (!EDITABLE.includes(e.status)) throw conflict('Only a draft or a returned entry is edited.'); if (b.rowVersion && b.rowVersion !== e.version) throw conflict('Someone changed this; reload it.'); const f = checkFields(actor, b, e); const c = columns(actor, b, f, e); const names = Object.keys(c);
      db.prepare(`UPDATE plt_equipment SET asset_code = ?, ${names.map((k) => `${k} = ?`).join(', ')}, equip_state = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(f.code || e.asset_code, ...names.map((k) => c[k]), e.approved_at ? e.equip_state : f.state, actor.user, nowIso(), e.id); audit(actor, 'plt_equipment', e.id, 'update', e.company_id); return equipment.get(actor, e.id);
    },
    remove(actor, id) { const e = erow(actor, id, 'plant.equipment.delete'); if (e.status !== 'DRAFT') throw conflict('Only a draft is deleted.'); db.prepare('UPDATE plt_equipment SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, e.id); audit(actor, 'plt_equipment', e.id, 'delete', e.company_id); return { id: e.id, deleted: true }; },
    /** The rules a machine meets before it is sent for approval. */
    ready(e) {
      const p = []; if (e.road_vehicle && !e.reg_no) p.push({ field: 'regNo', message: 'A road vehicle needs its registration number' }); if (e.lifting && !e.capacity) p.push({ field: 'capacity', message: 'Give the rated capacity of lifting equipment' }); if (e.fuel_type !== 'NONE' && e.fuel_type !== 'ELECTRIC' && e.fuel_norm <= 0) p.push({ field: 'fuelNorm', message: 'Give the standard fuel norm' });
      if (e.ownership === 'OWNED' && e.purchase_value <= 0) p.push({ field: 'purchaseValue', message: 'Give the purchase value of owned equipment' }); return p;
    },
    submit(actor, id) {
      const e = erow(actor, id, 'plant.equipment.submit'); if (!EDITABLE.includes(e.status)) throw unprocessable('Only a draft or a returned entry is sent for approval.'); fail(equipment.ready(e));
      return transaction(db, () => { const ctx = { projectId: e.org_project_id ?? undefined, siteId: e.org_site_id ?? undefined, needAcc: e.ownership === 'OWNED' ? 'yes' : 'no' };
        if (e.status === 'RETURNED' && e.workflow_instance_id && !db.prepare("SELECT 1 FROM wf_instances WHERE id = ? AND status IN ('APPROVED', 'REJECTED')").get(e.workflow_instance_id)) workflowOf(db).resubmit(actor, e.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: PLANT_EQUIP_DOC, docId: String(e.id), comment: `${e.doc_no} ${e.asset_code}: ${classLabel(e.class_item_id)}`.slice(0, 300), context: ctx }); db.prepare('UPDATE plt_equipment SET workflow_instance_id = ? WHERE id = ?').run(inst.id, e.id); }
        db.prepare("UPDATE plt_equipment SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), e.id); audit(actor, 'plt_equipment', e.id, 'submit', e.company_id); return equipment.get(actor, e.id); });
    },
    withdraw(actor, id, { reason }) { const e = erow(actor, id); if (e.status !== 'SUBMITTED') throw unprocessable('Only an entry waiting for approval is withdrawn.'); if (!same(e.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, e.workflow_instance_id, { comment: reason }); return equipment.get(actor, e.id); },
    cancel(actor, id, { reason }) {
      const e = erow(actor, id, 'plant.equipment.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(e.status)) throw unprocessable('Only an entry not yet approved is cancelled.');
      return transaction(db, () => { if (e.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, e.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE plt_equipment SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), e.id); audit(actor, 'plt_equipment', e.id, 'cancel', e.company_id, { reason }); return equipment.get(actor, e.id); });
    },
    /** An approved entry is locked; its particulars change only by amendment: it goes back for correction and is approved again. The machine stays in service meanwhile. */
    amend(actor, id, { reason }) { const e = erow(actor, id, 'plant.equipment.amend'); if (e.status !== 'APPROVED') throw unprocessable('Only a registered machine is amended.'); db.prepare("UPDATE plt_equipment SET status = 'RETURNED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), e.id); timeline(actor, e, 'AMENDMENT_STARTED', { note: reason }); audit(actor, 'plt_equipment', e.id, 'amend', e.company_id, { reason }); return equipment.get(actor, e.id); },
    history(actor, id) { const e = erow(actor, id); return { approvals: e.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(e.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity IN ('plt_equipment') AND entity_id = ? ORDER BY id").all(String(e.id)), timeline: view(actor, e, { detail: true }).timeline }; },
    print(actor, id) {
      const e = erow(actor, id, 'plant.equipment.print'); const v = view(actor, e, { detail: true }); audit(actor, 'plt_equipment', e.id, 'print', e.company_id); const columns2 = [['k', 'Particular'], ['v', 'Value']].map(([key, label]) => ({ key, label, type: 'text' }));
      const rows = [['Asset code', v.assetCode], ['Class', v.class], ['Make / model / year', `${v.make ?? '-'} / ${v.model ?? '-'} / ${v.year ?? '-'}`], ['Registration', v.regNo ?? '-'], ['Serial / chassis / engine', `${v.serialNo ?? '-'} / ${v.chassisNo ?? '-'} / ${v.engineNo ?? '-'}`], ['Ownership', `${v.ownershipLabel}${v.owner ? `: ${v.owner}` : ''}`], ['Where', `${v.stateLabel}${v.project ? ` (${v.project}${v.site ? `/${v.site}` : ''})` : ''}`],
        ...v.certificates.map((c) => [DOC_TYPES[c.docType], c.state === 'MISSING' ? 'MISSING' : `${c.number ?? '-'} valid until ${c.validUntil ?? '-'} (${c.state.toLowerCase()})`])].map(([k, val]) => ({ k, v: String(val) }));
      return { buffer: toPdf({ columns: columns2, rows, footer: [`Registered ${v.docNo}${v.approvedBy ? `, approved by ${v.approvedBy}` : ''}`], title: `Equipment ${v.assetCode}` }), contentType: 'application/pdf', fileName: `${v.assetCode.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    tag(actor, id) { const e = erow(actor, id, 'plant.equipment.print'); const code = `ERP:E:${e.asset_code}`; audit(actor, 'plt_equipment', e.id, 'print_tag', e.company_id); return { code, assetCode: e.asset_code, title: classLabel(e.class_item_id), lines: [e.reg_no ?? '', [e.make, e.model].filter(Boolean).join(' ')].filter(Boolean), svg: qrSvg(code) }; },
    /** The tag a person scans: the asset code gives the machine (inside the data scope). */
    scan(actor, code) { gate(actor, 'plant.equipment.view', 'scan equipment'); const m = /^ERP:E:(.+)$/.exec(String(code ?? '').trim()); const e = db.prepare('SELECT id FROM plt_equipment WHERE company_id = ? AND asset_code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, m ? m[1] : String(code ?? '').trim()); if (!e) throw notFound('That tag is not on any equipment.'); return equipment.get(actor, e.id); },
    /** FR-05: an existing fleet arrives as drafts (each goes through the approval) with its documents; nothing is approved by the import. */
    importRows(actor, { rows, submit = false }) {
      gate(actor, 'plant.equipment.import', 'import equipment'); const problems = []; const made = [];
      rows.forEach((x, i) => {
        const cls = db.prepare('SELECT id FROM mdm_items WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.classCode); if (!cls) problems.push({ field: `rows.${i}.classCode`, message: 'No such equipment class' });
        const owner = x.ownerCode ? db.prepare('SELECT id FROM mdm_partners WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.ownerCode) : null; if (x.ownerCode && !owner) problems.push({ field: `rows.${i}.ownerCode`, message: 'No such vendor or subcontractor' });
        const pj = x.projectCode ? db.prepare('SELECT id FROM org_projects WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.projectCode) : null; if (x.projectCode && !pj) problems.push({ field: `rows.${i}.projectCode`, message: 'No such project' });
        const st = x.siteCode && pj ? db.prepare('SELECT id FROM org_sites WHERE org_project_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(pj.id, x.siteCode) : null; if (x.siteCode && !st) problems.push({ field: `rows.${i}.siteCode`, message: 'No such site in that project' });
        if (cls) made.push({ b: { assetCode: x.assetCode, classItemId: cls.id, make: x.make, model: x.model, year: x.year, serialNo: x.serialNo, chassisNo: x.chassisNo, engineNo: x.engineNo, regNo: x.regNo, capacity: x.capacity, ownership: x.ownership ?? 'OWNED', ownerPartnerId: owner?.id ?? null, purchaseValue: x.purchaseValue ?? 0, purchaseDate: x.purchaseDate, meterType: x.meterType ?? 'HOURS', fuelType: x.fuelType ?? 'DIESEL', tankCapacity: x.tankCapacity ?? 0, fuelNorm: x.fuelNorm ?? 0, gpsDeviceId: x.gpsDeviceId, roadVehicle: Boolean(x.roadVehicle), lifting: Boolean(x.lifting), operatorRequired: Boolean(x.operatorRequired), projectId: pj?.id ?? null, siteId: st?.id ?? null, state: x.state ?? 'AVAILABLE', sourceType: 'import' }, docs: x.documents ?? [] });
      });
      fail(problems);
      return transaction(db, () => ({ created: made.map(({ b, docs }) => { const e = equipment.create(actor, b); for (const d of docs) documents.add(actor, e.id, d); if (submit) equipment.submit(actor, e.id); return e.docNo; }) }));
    },
    decide(instance, actor, outcome, comment) {
      const e = db.prepare('SELECT * FROM plt_equipment WHERE id = ?').get(rid(instance.docId)); if (!e || e.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        const first = !e.approved_at; db.prepare("UPDATE plt_equipment SET status = 'APPROVED', approved_by = ?, approved_at = COALESCE(approved_at, ?), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, e.id); audit(actor, 'plt_equipment', e.id, 'approve', e.company_id);
        timeline(actor, e, first ? 'REGISTERED' : 'AMENDED', { to: e.equip_state, note: `${e.doc_no} approved` });
        evt(first ? 'plant.equipment.registered' : 'plant.equipment.amended', actor, e.company_id, e.id, { equipmentId: e.id, docNo: e.doc_no, assetCode: e.asset_code, classItemId: e.class_item_id, ownership: e.ownership, ownerPartnerId: e.owner_partner_id, purchaseValue: e.purchase_value, capitalise: e.ownership === 'OWNED', meterType: e.meter_type, fuelType: e.fuel_type, fuelNorm: e.fuel_norm / 1000, fuelNormUnit: e.fuel_norm_unit, tankCapacity: e.tank_capacity / 1000, projectId: e.org_project_id, siteId: e.org_site_id, state: e.equip_state }, e.org_project_id);
        notify(e.company_id, 'plant.equipment.decided', [`user:${e.requested_by}`], e.asset_code, 'approved', `${e.doc_no} (${e.asset_code}) is registered.`, `/plant/equipment?id=${e.id}`, e.id, { projectId: e.org_project_id ?? undefined }); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE plt_equipment SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : e.workflow_instance_id, actor.user, now, e.id); audit(actor, 'plt_equipment', e.id, outcome.toLowerCase(), e.company_id, { reason: comment });
      notify(e.company_id, 'plant.equipment.decided', [`user:${e.requested_by}`], e.asset_code, outcome.toLowerCase(), `${e.doc_no} is ${outcome === 'RETURNED' ? 'returned to you for correction' : outcome === 'REJECTED' ? 'rejected' : 'closed'}${comment ? `: ${comment}` : ''}.`, `/plant/equipment?id=${e.id}`, e.id, { projectId: e.org_project_id ?? undefined });
    },
    /** The one check allocation (17.02) and the logs (17.03) call: may this machine be put to work? BR-01. */
    allocatable(actor, id, /** @type {{ date?: string, planning?: boolean, internal?: boolean }} */ opts = {}) {
      const e = opts.internal ? rawRow(actor, id) : erow(actor, id); const today = opts.date ?? todayIST(); const problems = []; const comp = compliance(e, currentDocs(e.id), today);
      if (!e.approved_at || ['REJECTED', 'CANCELLED'].includes(e.status)) problems.push({ code: 'NOT_REGISTERED', message: 'This equipment is not registered (approved) yet.' });
      if (['DISPOSED', ...(opts.planning ? [] : ['DEMOBILISED'])].includes(e.equip_state)) problems.push({ code: 'STATE', message: `This equipment is ${EQUIP_STATE[e.equip_state].toLowerCase()}.` }); else if (['BREAKDOWN', 'UNDER_MAINTENANCE'].includes(e.equip_state)) problems.push({ code: 'STATE', message: `This equipment is ${EQUIP_STATE[e.equip_state].toLowerCase()}.` });
      const certs = comp.blocking.map((x) => ({ code: x.state === 'MISSING' ? 'CERT_MISSING' : 'CERT_EXPIRED', docType: x.docType, message: problemText(x) }));
      return { allowed: problems.length === 0 && (certs.length === 0 || !blocks(e.company_id)), blockedByCertificate: certs.length > 0 && blocks(e.company_id), warnings: certs.length && !blocks(e.company_id) ? certs : [], problems: [...problems, ...(blocks(e.company_id) ? certs : [])], equipmentId: e.id, assetCode: e.asset_code, state: e.equip_state };
    },
    assertAllocatable(actor, id, opts) { const r = equipment.allocatable(actor, id, opts); if (!r.allowed) throw unprocessable(`${r.assetCode} cannot be put to work: ${r.problems.map((p) => p.message).join('; ')}.`, r.problems); return r; },
    /** FR-03: the status and the current project and site. Deployment needs a project and passes the certificate check (BR-01). */
    /** `internal`: called by allocation (17.02) after its own rights and workflow were checked: the place changes, the rules of status and certificates still apply. */
    setState(actor, id, b, internal = false) {
      const e = internal ? rawRow(actor, id) : erow(actor, id, 'plant.equipment.status'); if (!e.approved_at) throw unprocessable('Only a registered machine changes status.'); if (b.rowVersion && b.rowVersion !== e.version) throw conflict('Someone changed this; reload it.');
      if (!TRANSITIONS[e.equip_state].includes(b.state)) throw unprocessable(`A machine that is ${EQUIP_STATE[e.equip_state].toLowerCase()} cannot become ${EQUIP_STATE[b.state]?.toLowerCase() ?? 'that'}.`);
      let pj = null; let st = null; if (b.state === 'DEPLOYED') { pj = b.projectId ? db.prepare('SELECT id, company_id FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(rid(b.projectId)) : null; if (!pj || pj.company_id !== actor.companyId) fail([{ field: 'projectId', message: 'A deployed machine needs its project' }]); if (!internal && !may(actor, 'plant.equipment.status', pj.id)) throw forbidden('You may not deploy equipment to that project.'); if (b.siteId) { st = db.prepare('SELECT id, org_project_id FROM org_sites WHERE id = ? AND deleted_at IS NULL').get(rid(b.siteId)); if (!st || st.org_project_id !== pj.id) fail([{ field: 'siteId', message: 'Choose a site of that project' }]); } const r = equipment.allocatable(actor, e.id, { planning: true, internal }); if (!r.allowed) throw unprocessable(`${e.asset_code} cannot be deployed: ${r.problems.map((p) => p.message).join('; ')}.`, r.problems); }
      else if (['UNDER_MAINTENANCE', 'BREAKDOWN', 'IDLE'].includes(b.state)) { pj = e.org_project_id ? { id: e.org_project_id } : null; st = e.org_site_id ? { id: e.org_site_id } : null; }
      if (['BREAKDOWN', 'DISPOSED'].includes(b.state) && !(b.note ?? '').trim()) fail([{ field: 'note', message: 'Say what happened' }]);
      return transaction(db, () => { db.prepare('UPDATE plt_equipment SET equip_state = ?, org_project_id = ?, org_site_id = ?, state_since = ?, state_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.state, pj?.id ?? null, st?.id ?? null, todayIST(), b.note ?? null, actor.user, nowIso(), e.id);
        const after = db.prepare('SELECT * FROM plt_equipment WHERE id = ?').get(e.id); timeline(actor, after, 'STATE', { from: e.equip_state, to: b.state, note: b.note ?? null }); audit(actor, 'plt_equipment', e.id, 'status', e.company_id, { reason: `${e.equip_state} to ${b.state}${b.note ? `: ${b.note}` : ''}` });
        evt('plant.equipment.status_changed', actor, e.company_id, e.id, { equipmentId: e.id, assetCode: e.asset_code, from: e.equip_state, to: b.state, projectId: pj?.id ?? null, siteId: st?.id ?? null, note: b.note ?? null }, pj?.id ?? e.org_project_id); return equipment.get(actor, e.id); });
    },
  };

  // ---- documents and certificates (FR-02, FR-04) --------------------------------------------------------------------------------------------------------------------------------------------------------
  const fileOk = (actor, fileId, entity, entityId) => { const f = db.prepare('SELECT id FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = ? AND linked_id = ? AND deleted_at IS NULL').get(rid(fileId), actor.companyId, entity, entityId); if (!f) throw unprocessable('That file is not attached to this record. Upload it to the record first.'); return f; };
  const docRow = (actor, id) => { const d = db.prepare('SELECT * FROM plt_documents WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!d) throw notFound('That document does not exist.'); return { d, e: erow(actor, d.equipment_id, 'plant.document.manage') }; };
  const docChecks = (b) => { const p = []; if (b.validFrom && b.validUntil && b.validUntil < b.validFrom) p.push({ field: 'validUntil', message: 'The certificate cannot end before it starts' }); if (!b.validUntil && b.docType !== 'OTHER' && b.docType !== 'RC') p.push({ field: 'validUntil', message: 'Give the date this certificate is valid until' }); fail(p); };
  const documents = {
    list(actor, equipmentId) { const e = erow(actor, equipmentId); const docs = currentDocs(e.id); const comp = compliance(e, docs); return { documents: docs.map((d) => docView(d, comp)), certificates: comp.items, ok: comp.ok }; },
    /** A new certificate of a type replaces the current one of that type (kept as history): a renewal. */
    add(actor, equipmentId, b) {
      const e = erow(actor, equipmentId, 'plant.document.manage'); if (e.status === 'CANCELLED') throw unprocessable('A cancelled entry takes no documents.'); docChecks(b);
      return transaction(db, () => {
        const id = Number(db.prepare('INSERT INTO plt_documents (company_id, equipment_id, doc_type, doc_number, issuer, valid_from, valid_until, mandatory, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, e.id, b.docType, b.number ?? null, b.issuer ?? null, b.validFrom ?? null, b.validUntil ?? null, b.mandatory === false ? 0 : 1, actor.user, 'api').lastInsertRowid);
        const older = db.prepare("SELECT id FROM plt_documents WHERE equipment_id = ? AND doc_type = ? AND doc_status = 'CURRENT' AND deleted_at IS NULL AND id <> ?").all(e.id, b.docType, id); for (const o of older) db.prepare("UPDATE plt_documents SET doc_status = 'SUPERSEDED', superseded_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(id, actor.user, nowIso(), o.id);
        timeline(actor, e, older.length ? 'CERTIFICATE_RENEWED' : 'CERTIFICATE_ADDED', { note: `${DOC_TYPES[b.docType]}${b.number ? ` ${b.number}` : ''}${b.validUntil ? ` valid until ${b.validUntil}` : ''}` }); audit(actor, 'plt_documents', id, 'create', e.company_id, { reason: `${b.docType} for ${e.asset_code}` });
        if (older.length) evt('plant.certificate.renewed', actor, e.company_id, e.id, { equipmentId: e.id, assetCode: e.asset_code, docType: b.docType, validUntil: b.validUntil ?? null }, e.org_project_id);
        return documents.list(actor, e.id);
      });
    },
    update(actor, id, b) { const { d, e } = docRow(actor, id); if (b.rowVersion && b.rowVersion !== d.version) throw conflict('Someone changed this; reload it.'); const m = { docType: d.doc_type, validFrom: d.valid_from, validUntil: d.valid_until, ...b }; docChecks(m); db.prepare('UPDATE plt_documents SET doc_number = ?, issuer = ?, valid_from = ?, valid_until = ?, mandatory = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run('number' in b ? b.number : d.doc_number, 'issuer' in b ? b.issuer : d.issuer, m.validFrom ?? null, m.validUntil ?? null, 'mandatory' in b ? (b.mandatory ? 1 : 0) : d.mandatory, actor.user, nowIso(), d.id); audit(actor, 'plt_documents', d.id, 'update', d.company_id); return documents.list(actor, e.id); },
    attach(actor, id, { fileId }) { const { d, e } = docRow(actor, id); fileOk(actor, fileId, 'plt_documents', d.id); db.prepare('UPDATE plt_documents SET file_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(rid(fileId), actor.user, nowIso(), d.id); audit(actor, 'plt_documents', d.id, 'attach', d.company_id); return documents.list(actor, e.id); },
    remove(actor, id, { reason }) { const { d, e } = docRow(actor, id); db.prepare('UPDATE plt_documents SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, d.id); timeline(actor, e, 'CERTIFICATE_REMOVED', { note: `${DOC_TYPES[d.doc_type]}: ${reason}` }); audit(actor, 'plt_documents', d.id, 'delete', d.company_id, { reason }); return documents.list(actor, e.id); },
    /** Every morning: certificates that have expired or expire within the alert days are told to the plant managers (FR-02). */
    sweep() {
      let n = 0; const today = todayIST();
      for (const c of db.prepare('SELECT id FROM org_companies').all()) {
        if (!flags.isOn({ companyId: c.id }, 'ff.plant.p1701')) continue; const days = alertDays(c.id); const rows = db.prepare("SELECT d.*, e.asset_code, e.org_project_id AS pid FROM plt_documents d JOIN plt_equipment e ON e.id = d.equipment_id WHERE d.company_id = ? AND d.doc_status = 'CURRENT' AND d.deleted_at IS NULL AND e.deleted_at IS NULL AND e.equip_state <> 'DISPOSED' AND e.approved_at IS NOT NULL AND d.valid_until IS NOT NULL AND d.valid_until <= ?").all(c.id, addDays(today, days));
        for (const d of rows) { const expired = d.valid_until < today; const left = daysBetween(today, d.valid_until); if (!expired && ![days, 14, 7, 3, 1, 0].includes(left)) continue;
          notify(c.id, 'plant.certificate.due', ['role:PLANTMGR|PMSUP'], d.asset_code, expired ? 'certificate expired' : 'certificate expiring', `${DOC_TYPES[d.doc_type]}${d.doc_number ? ` ${d.doc_number}` : ''} of ${d.asset_code} ${expired ? `expired on ${d.valid_until}: it cannot be put to work until renewed` : `expires on ${d.valid_until}`}.`, `/plant/equipment?id=${d.equipment_id}`, `${d.id}.${d.valid_until}.${today}`, { projectId: d.pid ?? undefined });
          if (expired && d.valid_until === addDays(today, -1)) evt('plant.certificate.expired', { user: 'system' }, c.id, d.equipment_id, { equipmentId: d.equipment_id, assetCode: d.asset_code, docType: d.doc_type, validUntil: d.valid_until }, d.pid); else if (!expired) evt('plant.certificate.expiring', { user: 'system' }, c.id, d.equipment_id, { equipmentId: d.equipment_id, assetCode: d.asset_code, docType: d.doc_type, validUntil: d.valid_until, daysLeft: left }, d.pid);
          n += 1; }
      }
      return n;
    },
  };

  // ---- the dashboard (FR-03, section 10) ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** The working fleet in scope (registered, not disposed) with its certificates. */
  function fleet(actor, q = {}) {
    const sc = scope(actor); let sql = `${sc.sql} AND x.deleted_at IS NULL AND x.approved_at IS NOT NULL AND x.equip_state <> 'DISPOSED'`; /** @type {Record<string, any>} */ const P = /** @type {Record<string, any>} */ ({ ...sc.params });
    let pj = null; if (q.projectId) { pj = db.prepare('SELECT id, code, name, company_id FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(rid(q.projectId)); if (!pj || pj.company_id !== actor.companyId || !may(actor, 'plant.equipment.view', pj.id)) throw notFound('That project does not exist.'); sql += ' AND x.org_project_id = :pj'; P.pj = pj.id; }
    if (q.siteId) { const s = db.prepare('SELECT id, org_project_id FROM org_sites WHERE id = ? AND deleted_at IS NULL').get(rid(q.siteId)); if (!s || (pj && s.org_project_id !== pj.id) || !may(actor, 'plant.equipment.view', s.org_project_id, s.id)) throw notFound('That site does not exist.'); sql += ' AND x.org_site_id = :st'; P.st = s.id; }
    const rows = db.prepare(`SELECT x.* FROM plt_equipment x WHERE ${sql} ORDER BY x.asset_code`).all(P); const today = todayIST(); const docs = new Map();
    for (const d of db.prepare(`SELECT d.* FROM plt_documents d JOIN plt_equipment x ON x.id = d.equipment_id WHERE ${sql} AND d.doc_status = 'CURRENT' AND d.deleted_at IS NULL`).all(P)) { if (!docs.has(d.equipment_id)) docs.set(d.equipment_id, []); docs.get(d.equipment_id).push(d); }
    const withC = rows.map((e) => ({ e, comp: compliance(e, docs.get(e.id) ?? [], today) })); return { pj, rows: withC, today, scope: sc };
  }
  const drow = (e, extra = {}) => /** @type {Record<string, any>} */ ({ id: e.id, docNo: e.asset_code, label: `${classLabel(e.class_item_id)}${e.make ? ` · ${e.make} ${e.model ?? ''}`.trimEnd() : ''}`, project: pcode(e.org_project_id), site: scode(e.org_site_id), state: e.equip_state, status: EQUIP_STATE[e.equip_state], ownership: OWNERSHIP[e.ownership], link: `/plant/equipment?id=${e.id}`, ...extra });
  function figures(actor, q = {}) {
    const f = fleet(actor, q); const { rows, today } = f; const cid = actor.companyId; const days = alertDays(cid);
    const byState = Object.fromEntries(Object.keys(EQUIP_STATE).filter((k) => k !== 'DISPOSED').map((k) => [k, rows.filter((r) => r.e.equip_state === k)]));
    const working = rows.filter((r) => !['DEMOBILISED'].includes(r.e.equip_state)); const deployed = byState.DEPLOYED.length; const target = Number(param(cid, 'plant.dash.target_utilisation_pct') ?? 70); const util = working.length ? Math.round((deployed / working.length) * 1000) / 10 : null;
    const certs = []; for (const r of rows) for (const it of r.comp.items) if (it.state === 'EXPIRED' || it.state === 'EXPIRING' || it.state === 'MISSING') certs.push({ e: r.e, it });
    const sc2 = scope(actor); const pending = db.prepare(`SELECT x.* FROM plt_equipment x WHERE ${sc2.sql} AND x.deleted_at IS NULL AND x.status = 'SUBMITTED' ORDER BY x.id`).all(sc2.params);
    return { f, rows, today, days, byState, working, deployed, util, target, certs, pending };
  }
  function dashboard(actor, q = {}) {
    const g = figures(actor, q); const { rows, byState, certs } = g; const expired = certs.filter((c) => c.it.state === 'EXPIRED'); const expiring = certs.filter((c) => c.it.state === 'EXPIRING'); const missing = certs.filter((c) => c.it.state === 'MISSING'); const nonCompliant = rows.filter((r) => !r.comp.ok);
    const tally = (keyFn) => { const m = new Map(); for (const r of rows) { const k = keyFn(r.e); m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].map(([label, value]) => ({ key: label, label, value })).sort((a, b) => b.value - a.value); };
    const months = []; for (let i = 0; i < 6; i += 1) { const d = new Date(`${g.today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + i); const m = d.toISOString().slice(0, 7); months.push({ key: m, label: m, value: certs.filter((c) => c.it.validUntil?.slice(0, 7) === m && c.it.state !== 'EXPIRED').length }); }
    const kpis = {
      fleet: { count: rows.length, owned: rows.filter((r) => r.e.ownership === 'OWNED').length, hired: rows.filter((r) => r.e.ownership === 'HIRED').length, subcontractor: rows.filter((r) => r.e.ownership === 'SUBCONTRACTOR').length, route: '/plant/equipment', drill: 'fleet' },
      utilisation: { pct: g.util, deployed: g.deployed, working: g.working.length, target: g.target, status: g.util == null ? 'neutral' : g.util < g.target ? 'bad' : 'ok', drill: 'DEPLOYED' },
      breakdown: { count: byState.BREAKDOWN.length, status: byState.BREAKDOWN.length ? 'bad' : 'ok', drill: 'BREAKDOWN' }, maintenance: { count: byState.UNDER_MAINTENANCE.length, drill: 'UNDER_MAINTENANCE' }, idle: { count: byState.IDLE.length, drill: 'IDLE' }, available: { count: byState.AVAILABLE.length, drill: 'AVAILABLE' },
      expired: { count: expired.length, status: expired.length ? 'bad' : 'ok', drill: 'expired' }, expiring: { count: expiring.length, days: g.days, status: expiring.length ? 'warn' : 'ok', drill: 'expiring' }, nonCompliant: { count: nonCompliant.length, missing: missing.length, blocks: blocks(actor.companyId), status: nonCompliant.length ? 'bad' : 'ok', drill: 'nonCompliant' },
      pendingApprovals: { count: g.pending.length, status: 'neutral', drill: 'pending' },
    };
    const certRow = (c, label) => drow(c.e, { label: `${DOC_TYPES[c.it.docType]}${c.it.number ? ` ${c.it.number}` : ''}`, date: c.it.validUntil ?? null, ageDays: c.it.daysLeft == null ? null : c.it.daysLeft, note: label, status: c.it.state });
    const queues = {
      expiring: { label: 'Certificates expired or expiring', count: expired.length + expiring.length, drill: 'expiring', records: [...expired, ...expiring].sort((a, b) => (a.it.validUntil ?? '').localeCompare(b.it.validUntil ?? '')).slice(0, 8).map((c) => certRow(c, c.it.state === 'EXPIRED' ? 'expired' : 'expiring')) },
      nonCompliant: { label: 'Equipment that cannot be put to work (certificates)', count: nonCompliant.length, drill: 'nonCompliant', records: nonCompliant.slice(0, 8).map((r) => drow(r.e, { note: r.comp.blocking.map(problemText).join('; ') })) },
      breakdowns: { label: 'Breakdowns', count: byState.BREAKDOWN.length, drill: 'BREAKDOWN', records: byState.BREAKDOWN.slice(0, 8).map((r) => drow(r.e, { date: r.e.state_since, note: r.e.state_note })) },
      pending: { label: 'Registrations awaiting approval', count: g.pending.length, drill: 'pending', records: g.pending.slice(0, 8).map((e) => drow(e, { status: EQUIP_STATUS[e.status] })) },
    };
    const alerts = [];
    if (expired.length) alerts.push({ code: 'EXPIRED', level: 'bad', text: `${expired.length} certificate(s) have expired${blocks(actor.companyId) ? ': those machines cannot be allocated or logged' : ''}.`, drill: 'expired' });
    if (missing.length) alerts.push({ code: 'MISSING', level: 'bad', text: `${missing.length} mandatory certificate(s) are missing.`, drill: 'nonCompliant' });
    if (expiring.length) alerts.push({ code: 'EXPIRING', level: 'warn', text: `${expiring.length} certificate(s) expire within ${g.days} days.`, drill: 'expiring' });
    if (byState.BREAKDOWN.length) alerts.push({ code: 'BREAKDOWN', level: 'bad', text: `${byState.BREAKDOWN.length} machine(s) are in breakdown.`, drill: 'BREAKDOWN' });
    if (kpis.utilisation.status === 'bad') alerts.push({ code: 'UTILISATION', level: 'warn', text: `Only ${g.util}% of the working fleet is deployed (target ${g.target}%).`, drill: 'AVAILABLE' });
    return { view: g.f.pj ? 'project' : 'company', project: g.f.pj ? { id: g.f.pj.id, code: g.f.pj.code, name: g.f.pj.name } : null, today: g.today, canValues: holds(actor, 'plant.equipment.values'), canExport: holds(actor, 'plant.equipment.export'), kpis, queues, alerts, charts: { byState: Object.entries(byState).map(([k, v]) => ({ key: k, label: EQUIP_STATE[k], value: v.length })), byOwnership: tally((e) => OWNERSHIP[e.ownership]), byClass: tally((e) => classLabel(e.class_item_id)).slice(0, 10), byProject: tally((e) => pcode(e.org_project_id) || 'Yard'), expiryByMonth: months } };
  }
  const TITLES = { fleet: 'Working fleet', expired: 'Certificates that have expired', expiring: 'Certificates expired or expiring', nonCompliant: 'Equipment that cannot be put to work', pending: 'Registrations awaiting approval', ...Object.fromEntries(Object.entries(EQUIP_STATE).map(([k, v]) => [k, `Equipment: ${v.toLowerCase()}`])) };
  function drill(actor, q = {}) {
    if (!TITLES[q.kind]) fail([{ field: 'kind', message: 'Choose what to open' }]); const g = figures(actor, q); let rows;
    if (q.kind === 'fleet') rows = g.rows.map((r) => drow(r.e)); else if (q.kind === 'nonCompliant') rows = g.rows.filter((r) => !r.comp.ok).map((r) => drow(r.e, { note: r.comp.blocking.map(problemText).join('; ') })); else if (q.kind === 'pending') rows = g.pending.map((e) => drow(e, { status: EQUIP_STATUS[e.status] }));
    else if (q.kind === 'expired' || q.kind === 'expiring') rows = g.certs.filter((c) => (q.kind === 'expired' ? c.it.state === 'EXPIRED' : ['EXPIRED', 'EXPIRING'].includes(c.it.state))).sort((a, b) => (a.it.validUntil ?? '').localeCompare(b.it.validUntil ?? '')).map((c) => drow(c.e, { label: `${DOC_TYPES[c.it.docType]}${c.it.number ? ` ${c.it.number}` : ''}`, date: c.it.validUntil, ageDays: c.it.daysLeft, status: c.it.state }));
    else rows = (g.byState[q.kind] ?? []).map((r) => drow(r.e, { date: r.e.state_since, note: r.e.state_note }));
    return { kind: q.kind, title: TITLES[q.kind], project: g.f.pj ? { id: g.f.pj.id, code: g.f.pj.code } : null, total: rows.length, rows: rows.slice(0, LIMIT), truncated: rows.length > LIMIT };
  }
  function exportCsv(actor, q = {}) {
    gate(actor, 'plant.equipment.export', 'export the equipment register'); const v = holds(actor, 'plant.equipment.values'); const kind = q.kind ?? 'register'; let headers; let rows; let name;
    if (kind === 'register') { const g = fleet(actor, q); headers = ['Asset code', 'Class', 'Make', 'Model', 'Year', 'Registration', 'Ownership', 'Where', 'Project', 'Site', 'Purchase value (Rs)', 'Certificates blocking']; name = 'equipment-register'; rows = g.rows.map(({ e, comp }) => [e.asset_code, classLabel(e.class_item_id), e.make ?? '', e.model ?? '', e.mfg_year ?? '', e.reg_no ?? '', OWNERSHIP[e.ownership], EQUIP_STATE[e.equip_state], pcode(e.org_project_id), scode(e.org_site_id), v ? e.purchase_value / 100 : '', comp.blocking.map(problemText).join('; ')]); }
    else { const d = drill(actor, q); headers = ['Asset code', 'Description', 'Project', 'Site', 'Where', 'Date', 'Days left', 'Note']; name = `plant-${q.kind}`; rows = d.rows.map((r) => [r.docNo, r.label, r.project ?? '', r.site ?? '', r.status ?? '', r.date ?? '', r.ageDays ?? '', r.note ?? '']); }
    audit(actor, 'plt_equipment', 0, 'export', actor.companyId, { reason: `${kind} ${rows.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `${name}-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(headers, rows)}`, 'utf8') };
  }
  /** The small figure set of the plant slot of Project 360 (10.08). */
  function projectWidget(actor, projectId) {
    const d = dashboard(actor, { projectId }); const k = d.kpis;
    return { figures: [{ key: 'fleet', label: 'Equipment at the project', value: k.fleet.count, drill: '/plant/equipment' }, { key: 'deployed', label: 'Deployed', value: k.utilisation.deployed, drill: '/plant/dashboard' }, { key: 'breakdown', label: 'In breakdown', value: k.breakdown.count, drill: '/plant/dashboard' }, { key: 'certs', label: 'Certificates expired or expiring', value: k.expired.count + k.expiring.count, drill: '/plant/dashboard' }],
      rows: d.queues.expiring.records.slice(0, 3).map((r) => ({ label: `${r.docNo} ${r.label}`, value: r.ageDays, drill: r.link })) };
  }
  return { equipment, documents, rawRow, certsOf: (e, date) => compliance(e, currentDocs(e.id), date), dashboard, drill, exportCsv, projectWidget, compliance, view, fleet };
}
