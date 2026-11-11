import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toPdf } from '../../platform/export/index.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { parameterRegistry, createParameterStore } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { isoOf, ordOf } from '../plan/cpm.js';

// Site diary, weather, hindrances and site conditions (part 14.03).
// - Weather (FR-01): one record a site and day, typed or fetched through the integration hub; the condition, the concrete-pour restriction and the shutdown are worked out on the server.
//   A shutdown with hours lost at or above `site.weather.shutdown_delay_hours` publishes `site.weather.shutdown`, from which planning (13.05) drafts a delay (FR-05).
// - Hindrances (FR-02): approval-controlled (site engineer, then the construction manager, then the project manager); approved they are locked and feed delay drafts and claims; closing needs an end
//   date and evidence (BR-01); the ones open too long are escalated (`site.hindrance.escalate_days`).
// - Diary (FR-03): notes by category with attachments; the construction manager signs them off and a signed note is locked. Visitors (FR-04): the visits with purpose and instructions.
export const HIN_DOC = 'SITE_HINDRANCE';
export const HIN_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved (open)', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', CLOSED: 'Closed', SUPERSEDED: 'Superseded by an amendment' };
export const HIN_TYPES = { SITE_NOT_HANDED_OVER: 'Site not handed over', DRAWINGS_PENDING: 'Drawings pending', UTILITY_SHIFTING: 'Utility shifting', LOCAL_ISSUES: 'Local issues', APPROVALS: 'Approvals pending', OTHER: 'Other' };
export const PARTIES = { CLIENT: 'Client', CONSULTANT: 'Consultant', THIRD_PARTY: 'Third party', AUTHORITY: 'Statutory authority', CONTRACTOR: 'Contractor' };
export const DIARY_CATEGORIES = { GENERAL: 'General', PROGRESS: 'Progress', INSTRUCTION: 'Instruction received', HINDRANCE: 'Hindrance', QUALITY: 'Quality', SAFETY: 'Safety', MATERIAL: 'Material', VISITOR: 'Visitor' };
export const VISITOR_TYPES = { OFFICIAL: 'Official', CLIENT: 'Client', CONSULTANT: 'Consultant', AUTHORITY: 'Statutory authority', OTHER: 'Other' };
export const CONDITIONS = { CLEAR: 'Clear', CLOUDY: 'Cloudy', RAIN: 'Rain', HEAVY_RAIN: 'Heavy rain', STORM: 'Storm', FOG: 'Fog', HOT: 'Very hot', COLD: 'Cold' };
const OPEN = ['SUBMITTED', 'APPROVED'];
const nowIso = () => new Date().toISOString();
const rid = (v) => parseInt(String(v), 10);
const lower = (s) => String(s ?? '').toLowerCase();
const same = (a, b) => Boolean(a && b && lower(a) === lower(b));
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const q3 = (n) => (n == null ? null : Math.round(Number(n) * 1000));
const d3 = (n) => (n == null ? null : n / 1000);
const daysBetween = (a, b) => ordOf(b) - ordOf(a) + 1;

for (const [key, dataType, def, description, extra] of [
  ['site.weather.pour_rain_mm', 'integer', 10, 'FR-01: the rainfall of a day, in millimetres, at or above which concrete is not poured.', { min: 0, max: 500 }],
  ['site.weather.pour_temp_max', 'integer', 40, 'FR-01: the highest temperature of a day, in degrees Celsius, at or above which concrete is not poured.', { min: 20, max: 70 }],
  ['site.weather.pour_temp_min', 'integer', 5, 'FR-01: the lowest temperature of a day, in degrees Celsius, at or below which concrete is not poured.', { min: -40, max: 20 }],
  ['site.weather.shutdown_delay_hours', 'integer', 8, 'FR-05: the hours lost in a weather shutdown at or above which a delay draft is made (and the length of a working day for the days of the draft).', { min: 1, max: 24 }],
  ['site.weather.connector', 'string', 'weather.main', 'FR-01: the code of the connector (integration hub) the weather is fetched through.', {}],
  ['site.hindrance.escalate_days', 'integer', 7, 'BR-01: the days a hindrance may stay open before it is escalated to the construction manager and the project manager, and again after each period.', { min: 1, max: 365 }],
  ['site.hindrance.delay_threshold_days', 'integer', 1, 'FR-05: the days a hindrance must last, from its start to its end or today, before a delay draft is made.', { min: 1, max: 365 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

const scopeCols = (alias, p, s) => ({ project: `${alias}.${p}`, site: `${alias}.${s}` });
export const weatherList = defineList({
  code: 'site.weather', label: 'Weather log', permission: 'site.weather.view', from: 'site_weather x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.wx_site_id', where: 'x.deleted_at IS NULL', searchable: ['p.code', 's.code', 'x.notes'], defaultSort: '-date',
  columns: {
    date: { sql: 'x.wx_date', type: 'date', label: 'Date' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, site: { sql: 's.code', type: 'text', label: 'Site' }, siteId: { sql: 'x.wx_site_id', type: 'number', label: 'Site id' },
    rainfall: { sql: 'x.rainfall_mm', type: 'number', label: 'Rainfall mm' }, hoursLost: { sql: 'x.hours_lost', type: 'number', label: 'Hours lost' }, shutdown: { sql: 'x.shutdown', type: 'enum', label: 'Shutdown', options: [['1', 'Shutdown'], ['0', 'Working']] },
    pour: { sql: 'x.pour_restricted', type: 'enum', label: 'Concrete pour', options: [['1', 'Restricted'], ['0', 'Allowed']] }, source: { sql: 'x.source', type: 'enum', label: 'Source', options: [['MANUAL', 'Entered'], ['API', 'Fetched']] },
    condition: { sql: 'x.condition_code', type: 'enum', label: 'Condition', options: Object.entries(CONDITIONS) },
  },
});
export const hindranceList = defineList({
  code: 'site.hindrances', label: 'Hindrance register', permission: 'site.hindrance.view', from: 'site_hindrances x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.hin_site_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.title', 'p.code', 's.code', 'x.responsible_name'], defaultSort: '-startDate',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Hindrance no.' }, title: { sql: 'x.title', type: 'text', label: 'Title' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, site: { sql: 's.code', type: 'text', label: 'Site' }, siteId: { sql: 'x.hin_site_id', type: 'number', label: 'Site id' },
    type: { sql: 'x.hin_type', type: 'enum', label: 'Type', options: Object.entries(HIN_TYPES) }, party: { sql: 'x.responsible_party', type: 'enum', label: 'Responsible party', options: Object.entries(PARTIES) }, startDate: { sql: 'x.start_date', type: 'date', label: 'Start' }, endDate: { sql: 'x.end_date', type: 'date', label: 'End' },
    ageDays: { sql: "CAST(julianday(COALESCE(x.end_date, date('now', '+5 hours', '+30 minutes'))) - julianday(x.start_date) AS INTEGER) + 1", type: 'number', label: 'Days' }, escalation: { sql: 'x.escalation_level', type: 'number', label: 'Escalation' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(HIN_STATUS) },
  },
});
export const diaryList = defineList({
  code: 'site.diary', label: 'Site diary', permission: 'site.diary.view', from: 'site_diary x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.dy_site_id', where: 'x.deleted_at IS NULL', searchable: ['x.entry_text', 'p.code', 's.code', 'x.created_by'], defaultSort: '-date',
  columns: {
    date: { sql: 'x.diary_date', type: 'date', label: 'Date' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, site: { sql: 's.code', type: 'text', label: 'Site' }, siteId: { sql: 'x.dy_site_id', type: 'number', label: 'Site id' },
    category: { sql: 'x.category', type: 'enum', label: 'Category', options: Object.entries(DIARY_CATEGORIES) }, text: { sql: 'x.entry_text', type: 'text', label: 'Note' }, enteredBy: { sql: 'x.created_by', type: 'text', label: 'Entered by' }, signed: { sql: 'CASE WHEN x.signed_at IS NULL THEN 0 ELSE 1 END', type: 'enum', label: 'Signed off', options: [['1', 'Signed off'], ['0', 'Not signed']] },
  },
});
export const visitorList = defineList({
  code: 'site.visitors', label: 'Visitor log', permission: 'site.visitor.view', from: 'site_visitors x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.vis_site_id', where: 'x.deleted_at IS NULL', searchable: ['x.visitor_name', 'x.organisation', 'x.purpose', 'p.code', 's.code'], defaultSort: '-date',
  columns: {
    date: { sql: 'x.visit_date', type: 'date', label: 'Date' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, site: { sql: 's.code', type: 'text', label: 'Site' }, siteId: { sql: 'x.vis_site_id', type: 'number', label: 'Site id' },
    visitor: { sql: 'x.visitor_name', type: 'text', label: 'Visitor' }, organisation: { sql: 'x.organisation', type: 'text', label: 'Organisation' }, type: { sql: 'x.visitor_type', type: 'enum', label: 'Type', options: Object.entries(VISITOR_TYPES) }, purpose: { sql: 'x.purpose', type: 'text', label: 'Purpose' },
  },
});

export function createConditionsService({ db, integrations = null }) {
  const authz = authzOf(db);
  const store = createParameterStore(db);
  const param = (companyId, key) => store.get(key, { companyId, date: todayIST() });
  const may = (actor, key, pid, sid = null) => authz.check(actor, key, { companyId: actor.companyId, projectId: pid, siteId: sid }).allowed;
  const need = (actor, key, what, pid, sid = null) => { if (!may(actor, key, pid, sid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor.user, companyId, ...extra });
  const notify = (companyId, code, recipients, ref, subject, detail, link, sourceId, scope = {}) => { if (!recipients.length) return; try { notificationsOf(db).notify({ companyId, templateCode: code, recipients, data: { ref, subject, detail, link }, link, sourceType: `${code}.${sourceId}`, sourceId, ...scope }); } catch { /* saved anyway */ } };
  const number = (companyId, user) => {
    try { return issueNumber(db, { companyId, docType: HIN_DOC, actor: user, refType: 'site_hindrances' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const n = (db.prepare('SELECT COUNT(*) AS n FROM site_hindrances WHERE company_id = ?').get(companyId).n ?? 0) + 1; let no = `HIN/${String(n).padStart(6, '0')}`;
    for (let k = n + 1; db.prepare('SELECT 1 FROM site_hindrances WHERE company_id = ? AND doc_no = ?').get(companyId, no); k += 1) no = `HIN/${String(k).padStart(6, '0')}`; return no;
  };
  /** A site the person may see for a record kind; with `key` also the right to do something there. A site of another company, or out of the person's scope, does not exist for them. */
  const siteRow = (actor, siteId, viewKey, key = viewKey) => {
    const s = db.prepare('SELECT s.id, s.code, s.name, s.org_project_id, s.company_id, s.latitude, s.longitude, p.code AS pcode, p.name AS pname FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ? AND s.deleted_at IS NULL').get(rid(siteId));
    if (!s || s.company_id !== actor.companyId || !may(actor, viewKey, s.org_project_id, s.id)) throw notFound('That site does not exist.');
    if (key !== viewKey) need(actor, key, 'do that for this site', s.org_project_id, s.id); return s;
  };
  const notFuture = (date, field = 'date') => { if (date > todayIST()) fail([{ field, message: 'Use today or an earlier day' }]); };
  const scopeOf = (actor, key, cols) => { const f = authz.scopeFilter(actor, key, cols); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const sitesOf = (actor, key) => db.prepare('SELECT s.id, s.code, s.name, s.org_project_id, p.code AS pcode FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.company_id = ? AND s.deleted_at IS NULL AND s.status = \'ACTIVE\' ORDER BY p.code, s.code').all(actor.companyId).filter((s) => may(actor, key, s.org_project_id, s.id));
  const fileCount = (companyId, entity, id) => db.prepare("SELECT COUNT(*) AS n FROM core_files WHERE company_id = ? AND linked_entity = ? AND linked_id = ? AND deleted_at IS NULL AND scan_status <> 'INFECTED'").get(companyId, entity, id).n;
  const letterOf = (companyId, projectId, letterId, field) => {
    if (!letterId) return null; const l = db.prepare('SELECT id, letter_no, subject, org_project_id FROM engg_letters WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(letterId, companyId);
    if (!l || l.org_project_id !== projectId) fail([{ field, message: 'Choose a letter of this project' }]); return l;
  };
  /** The shape every list shares: the list definition, the scope and the export source. */
  const listing = ({ def, view, exp, pcol, scol, select, row, exportColumns, exportRow, describe }) => ({
    list(actor, query) { if (!authz.check(actor, view).allowed) throw forbidden(`You may not see ${lower(def.label)} (permission ${view}).`); const sc = scopeOf(actor, view, scopeCols('x', pcol, scol)); return runList(db, def, parseListRequest(def, query), { select, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: row }); },
    exportSource(actor, req) {
      if (!authz.check(actor, exp).allowed) throw forbidden(`You may not export ${lower(def.label)} (permission ${exp}).`); const sc = scopeOf(actor, view, scopeCols('x', pcol, scol)); const opts = { select, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id' };
      return { title: def.label, permission: exp, personal: false, columns: exportColumns.map((k) => ({ key: k, label: def.columns[k]?.label ?? k, type: 'text' })), rows: () => runList(db, def, req, { ...opts, limit: null, map: (x) => exportRow(row(x)) }).data, describe: (r) => [r.q ? `Search: ${r.q}` : describe], count: () => countList(db, def, req, opts) };
    },
  });

  // ---- weather (FR-01) ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** The condition of the day from the measures (thousandths), the way a site diary names it. */
  function conditionOf(w) {
    const rain = (w.rainfall_mm ?? 0) / 1000; const wind = (w.wind_kmh ?? 0) / 1000; const tmax = w.temp_max == null ? null : w.temp_max / 1000; const tmin = w.temp_min == null ? null : w.temp_min / 1000;
    if (wind >= 62) return 'STORM'; if (rain >= 64.5) return 'HEAVY_RAIN'; if (rain > 2.5) return 'RAIN'; if (tmax != null && tmax >= 40) return 'HOT'; if (tmin != null && tmin <= 5) return 'COLD';
    if (w.humidity_pct != null && w.humidity_pct >= 95 && rain === 0) return 'FOG'; if (w.humidity_pct != null && w.humidity_pct >= 75) return 'CLOUDY';
    return w.rainfall_mm == null && w.temp_max == null && w.humidity_pct == null ? null : 'CLEAR';
  }
  /** FR-01: concrete is not poured in the rain or at an extreme temperature; the thresholds are parameters. */
  function pourOf(companyId, w) {
    const rain = (w.rainfall_mm ?? 0) / 1000; const reasons = [];
    const lim = { rain: Number(param(companyId, 'site.weather.pour_rain_mm') ?? 10), max: Number(param(companyId, 'site.weather.pour_temp_max') ?? 40), min: Number(param(companyId, 'site.weather.pour_temp_min') ?? 5) };
    if (w.rainfall_mm != null && rain >= lim.rain && lim.rain > 0) reasons.push(`rainfall ${rain} mm is at or above ${lim.rain} mm`);
    if (w.temp_max != null && w.temp_max / 1000 >= lim.max) reasons.push(`highest temperature ${w.temp_max / 1000} °C is at or above ${lim.max} °C`);
    if (w.temp_min != null && w.temp_min / 1000 <= lim.min) reasons.push(`lowest temperature ${w.temp_min / 1000} °C is at or below ${lim.min} °C`);
    return { restricted: reasons.length ? 1 : 0, reason: reasons.length ? reasons.join('; ') : null };
  }
  const delayOf = (src, id) => { try { return db.prepare("SELECT id, doc_no, status, delay_days FROM plan_delays WHERE src_entity = ? AND src_id = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') ORDER BY id DESC").get(src, String(id)) ?? null; } catch { return null; } };
  const wfresh = (id) => db.prepare('SELECT * FROM site_weather WHERE id = ?').get(id);
  function wview(actor, r) {
    const s = db.prepare('SELECT s.code, s.name, p.code AS pcode FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ?').get(r.wx_site_id); const can = (k) => may(actor, k, r.org_project_id, r.wx_site_id); const dl = delayOf('site_weather', r.id);
    return { id: r.id, projectId: r.org_project_id, projectCode: s?.pcode, siteId: r.wx_site_id, siteCode: s?.code, siteName: s?.name, date: r.wx_date, rainfallMm: d3(r.rainfall_mm), tempMin: d3(r.temp_min), tempMax: d3(r.temp_max), humidityPct: r.humidity_pct, windKmh: d3(r.wind_kmh),
      condition: r.condition_code, conditionLabel: r.condition_code ? CONDITIONS[r.condition_code] : null, source: r.source, connector: r.connector_code, hoursLost: d3(r.hours_lost), shutdown: Boolean(r.shutdown), shutdownReason: r.shutdown_reason, pourRestricted: Boolean(r.pour_restricted), pourReason: r.pour_reason,
      notes: r.notes, delay: dl ? { id: dl.id, docNo: dl.doc_no, status: dl.status, days: dl.delay_days } : null, createdBy: r.created_by, rowVersion: r.version, can: { edit: can('site.weather.edit'), delete: can('site.weather.delete') } };
  }
  const wrow = (actor, id, key = 'site.weather.view') => {
    const r = db.prepare('SELECT * FROM site_weather WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'site.weather.view', r.org_project_id, r.wx_site_id)) throw notFound('That weather record does not exist.'); if (key !== 'site.weather.view') need(actor, key, 'do that with a weather record', r.org_project_id, r.wx_site_id); return r;
  };
  const wcols = { rainfall_mm: 'rainfallMm', temp_min: 'tempMin', temp_max: 'tempMax', humidity_pct: 'humidityPct', wind_kmh: 'windKmh' };
  /** The measures of the input as the row keeps them (thousandths, whole percent), with the derived columns; a field not in the input keeps what the row has. */
  function wmerge(companyId, base, b) {
    const m = { ...base };
    for (const [c, k] of Object.entries(wcols)) if (k in b) m[c] = c === 'humidity_pct' ? b[k] : q3(b[k]);
    if ('hoursLost' in b) m.hours_lost = q3(b.hoursLost ?? 0); if ('shutdown' in b) m.shutdown = b.shutdown ? 1 : 0; if ('shutdownReason' in b) m.shutdown_reason = b.shutdownReason; if ('notes' in b) m.notes = b.notes;
    const p = [];
    if (m.temp_min != null && m.temp_max != null && m.temp_min > m.temp_max) p.push({ field: 'tempMin', message: 'The lowest temperature is not above the highest' });
    if (m.shutdown && !(m.hours_lost > 0)) p.push({ field: 'hoursLost', message: 'A shutdown loses hours: give them' });
    if (m.shutdown && String(m.shutdown_reason ?? '').trim().length < 5) p.push({ field: 'shutdownReason', message: 'Say why the site was shut down (at least 5 characters)' });
    if (!m.shutdown) m.shutdown_reason = null;
    fail(p); m.condition_code = conditionOf(m); const pour = pourOf(companyId, m); m.pour_restricted = pour.restricted; m.pour_reason = pour.reason; return m;
  }
  /** FR-05: a shutdown with enough hours lost goes to planning, which makes (or updates) a delay draft from it. The event is published in the same transaction. */
  function shutdownEvent(actor, r) {
    const threshold = Number(param(r.company_id, 'site.weather.shutdown_delay_hours') ?? 8); if (!r.shutdown || r.hours_lost < threshold * 1000) return false;
    const site = db.prepare('SELECT code FROM org_sites WHERE id = ?').get(r.wx_site_id)?.code; const days = Math.max(1, Math.ceil(r.hours_lost / (threshold * 1000)));
    publishEvent(db, { type: 'site.weather.shutdown', entity: 'site_weather', entityId: r.id, actorId: actor.user, companyId: r.company_id, projectId: r.org_project_id, siteId: r.wx_site_id, data: { weatherId: r.id, projectId: r.org_project_id, siteId: r.wx_site_id, siteCode: site, date: r.wx_date, hoursLost: d3(r.hours_lost), delayDays: days, condition: r.condition_code, rainfallMm: d3(r.rainfall_mm), reason: r.shutdown_reason } });
    notify(r.company_id, 'site.weather.shutdown', ['role:CM|PM'], `${site} ${r.wx_date}`, String(site), `${d3(r.hours_lost)} hours lost to weather at ${site} on ${r.wx_date}: ${r.shutdown_reason}. A delay draft is made for planning.`, `/site/weather?id=${r.id}`, r.id, { projectId: r.org_project_id, siteId: r.wx_site_id });
    return true;
  }
  const WSELECT = 'x.id, x.wx_date, x.org_project_id, x.wx_site_id, x.rainfall_mm, x.temp_min, x.temp_max, x.humidity_pct, x.wind_kmh, x.condition_code, x.source, x.hours_lost, x.shutdown, x.pour_restricted, x.pour_reason, p.code AS pcode, s.code AS scode';
  const wlist = (x) => ({ id: x.id, date: x.wx_date, project: x.pcode, projectId: x.org_project_id, site: x.scode, siteId: x.wx_site_id, rainfall: d3(x.rainfall_mm), tempMin: d3(x.temp_min), tempMax: d3(x.temp_max), humidity: x.humidity_pct, wind: d3(x.wind_kmh), condition: x.condition_code ? CONDITIONS[x.condition_code] : '', source: x.source === 'API' ? 'Fetched' : 'Entered', hoursLost: d3(x.hours_lost), shutdown: x.shutdown ? 'Shutdown' : 'Working', pour: x.pour_restricted ? 'Restricted' : 'Allowed', pourReason: x.pour_reason });
  const wl = listing({ def: weatherList, view: 'site.weather.view', exp: 'site.weather.export', pcol: 'org_project_id', scol: 'wx_site_id', select: WSELECT, row: wlist, exportColumns: ['date', 'project', 'site', 'rainfall', 'hoursLost', 'shutdown', 'pour', 'source', 'condition'], exportRow: (v) => ({ ...v, rainfall: String(v.rainfall ?? ''), hoursLost: String(v.hoursLost) }), describe: 'All weather records you may see' });
  const weather = {
    list: wl.list, exportSource: wl.exportSource,
    sites: (actor) => sitesOf(actor, 'site.weather.view').map((s) => ({ id: s.id, code: s.code, name: s.name, projectId: s.org_project_id, projectCode: s.pcode, canCreate: may(actor, 'site.weather.create', s.org_project_id, s.id) })),
    get: (actor, id) => wview(actor, wrow(actor, id)),
    /** The weather of a site and day, or null (for the report entry and the DPR). */
    lookup(actor, { siteId, date }) { const s = siteRow(actor, siteId, 'site.weather.view'); const r = db.prepare('SELECT * FROM site_weather WHERE wx_site_id = ? AND wx_date = ? AND deleted_at IS NULL').get(s.id, date); return r ? wview(actor, r) : null; },
    create(actor, b, extra = {}) {
      const s = siteRow(actor, b.siteId, 'site.weather.view', 'site.weather.create'); notFuture(b.date);
      if (db.prepare('SELECT 1 FROM site_weather WHERE wx_site_id = ? AND wx_date = ? AND deleted_at IS NULL').get(s.id, b.date)) throw conflict(`The weather of ${s.code} for ${b.date} is already recorded: change that record.`);
      return transaction(db, () => {
        const m = wmerge(actor.companyId, { rainfall_mm: null, temp_min: null, temp_max: null, humidity_pct: null, wind_kmh: null, hours_lost: 0, shutdown: 0 }, b);
        const id = Number(db.prepare('INSERT INTO site_weather (company_id, org_project_id, wx_site_id, wx_date, rainfall_mm, temp_min, temp_max, humidity_pct, wind_kmh, condition_code, source, connector_code, hours_lost, shutdown, shutdown_reason, pour_restricted, pour_reason, notes, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(actor.companyId, s.org_project_id, s.id, b.date, m.rainfall_mm, m.temp_min, m.temp_max, m.humidity_pct, m.wind_kmh, m.condition_code, extra.source ?? 'MANUAL', extra.connector ?? null, m.hours_lost, m.shutdown, m.shutdown_reason ?? null, m.pour_restricted, m.pour_reason, m.notes ?? null, s.org_project_id, s.id, actor.user, extra.sourceType ?? 'api').lastInsertRowid);
        const r = wfresh(id); audit(actor, 'site_weather', id, 'create', actor.companyId, { newValues: { date: b.date, rainfall: d3(r.rainfall_mm), hoursLost: d3(r.hours_lost), shutdown: Boolean(r.shutdown), source: r.source } });
        publishEvent(db, { type: 'site.weather.recorded', entity: 'site_weather', entityId: id, actorId: actor.user, companyId: actor.companyId, projectId: s.org_project_id, siteId: s.id, data: { weatherId: id, projectId: s.org_project_id, siteId: s.id, date: b.date, condition: r.condition_code, rainfallMm: d3(r.rainfall_mm), hoursLost: d3(r.hours_lost), shutdown: Boolean(r.shutdown), pourRestricted: Boolean(r.pour_restricted) } });
        const drafting = shutdownEvent(actor, r); return { ...wview(actor, r), delayDrafting: drafting };
      });
    },
    update(actor, id, b, extra = {}) {
      const r = wrow(actor, id, 'site.weather.edit'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this record; reload it.');
      return transaction(db, () => {
        const m = wmerge(r.company_id, r, b);
        db.prepare("UPDATE site_weather SET rainfall_mm = ?, temp_min = ?, temp_max = ?, humidity_pct = ?, wind_kmh = ?, condition_code = ?, hours_lost = ?, shutdown = ?, shutdown_reason = ?, pour_restricted = ?, pour_reason = ?, notes = ?, source = ?, connector_code = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
          .run(m.rainfall_mm, m.temp_min, m.temp_max, m.humidity_pct, m.wind_kmh, m.condition_code, m.hours_lost, m.shutdown, m.shutdown_reason ?? null, m.pour_restricted, m.pour_reason, m.notes ?? null, extra.source ?? r.source, extra.connector ?? r.connector_code, actor.user, nowIso(), r.id);
        const n = wfresh(r.id); const changed = { ...b }; delete changed.rowVersion; audit(actor, 'site_weather', r.id, 'update', r.company_id, { oldValues: { rainfall: d3(r.rainfall_mm), hoursLost: d3(r.hours_lost), shutdown: Boolean(r.shutdown) }, newValues: changed });
        const drafting = shutdownEvent(actor, n); return { ...wview(actor, n), delayDrafting: drafting };
      });
    },
    remove(actor, id) {
      const r = wrow(actor, id, 'site.weather.delete'); const dl = delayOf('site_weather', r.id); if (dl && dl.status !== 'DRAFT') throw unprocessable(`${dl.doc_no} (a delay) rests on this record: change the record instead.`);
      transaction(db, () => { db.prepare('UPDATE site_weather SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'site_weather', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true };
    },
    /** FR-01: fetch the weather of a site and day through the integration hub (the connector named in `site.weather.connector`) and record it; the hours lost and the shutdown the site entered are kept. */
    async fetch(actor, { siteId, date }) {
      const s = siteRow(actor, siteId, 'site.weather.view', 'site.weather.create'); notFuture(date); const code = String(param(actor.companyId, 'site.weather.connector') ?? 'weather.main');
      if (!integrations) throw unprocessable('The integration hub is not available.');
      let out; try { out = await integrations.hub.call(code, 'weather', { siteId: s.id, siteCode: s.code, lat: s.latitude ?? null, lng: s.longitude ?? null, date }, { companyId: actor.companyId, actor, idempotencyKey: `weather-${s.id}-${date}-${Date.now().toString(36)}` }); } catch (e) {
        throw unprocessable(`The weather could not be fetched through the connector "${code}": ${e?.message ?? 'it did not answer'}. Enter it by hand, or ask an administrator to set the connector up.`);
      }
      const d = out?.data ?? {}; const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
      const b = { rainfallMm: num(d.rainfallMm, 0, 2000), tempMin: num(d.tempMin, -80, 70), tempMax: num(d.tempMax, -80, 70), humidityPct: num(d.humidityPct, 0, 100) == null ? null : Math.round(d.humidityPct), windKmh: num(d.windKmh, 0, 500) };
      if (Object.values(b).every((v) => v == null)) throw unprocessable(`The connector "${code}" answered without any weather for ${date}.`);
      const ex = db.prepare('SELECT * FROM site_weather WHERE wx_site_id = ? AND wx_date = ? AND deleted_at IS NULL').get(s.id, date);
      if (ex) { need(actor, 'site.weather.edit', 'change the weather of this site', s.org_project_id, s.id); return weather.update(actor, ex.id, b, { source: 'API', connector: code }); }
      return weather.create(actor, { siteId: s.id, date, ...b }, { source: 'API', connector: code, sourceType: 'weather_connector' });
    },
    /** The rainfall by month of a year for the chart (FR-01) and the totals: rainy days are days with more than 2.5 mm. */
    monthly(actor, q) {
      if (!authz.check(actor, 'site.weather.view').allowed) throw forbidden('You may not see the weather log (permission site.weather.view).');
      const year = q.year ?? Number(todayIST().slice(0, 4)); const sc = scopeOf(actor, 'site.weather.view', scopeCols('x', 'org_project_id', 'wx_site_id'));
      const rows = db.prepare(`SELECT substr(x.wx_date, 6, 2) AS m, SUM(COALESCE(x.rainfall_mm, 0)) AS rain, SUM(CASE WHEN x.rainfall_mm > 2500 THEN 1 ELSE 0 END) AS rainy, SUM(x.hours_lost) AS lost, SUM(x.shutdown) AS shut, SUM(x.pour_restricted) AS pour, COUNT(*) AS n FROM site_weather x WHERE x.deleted_at IS NULL AND ${sc.sql} AND substr(x.wx_date, 1, 4) = :y${q.siteId ? ' AND x.wx_site_id = :s' : ''}${q.projectId ? ' AND x.org_project_id = :p' : ''} GROUP BY m`)
        .all({ ...sc.params, y: String(year), ...(q.siteId ? { s: q.siteId } : {}), ...(q.projectId ? { p: q.projectId } : {}) });
      const by = new Map(rows.map((r) => [r.m, r]));
      const months = Array.from({ length: 12 }, (_, i) => { const k = String(i + 1).padStart(2, '0'); const r = by.get(k); return { month: `${year}-${k}`, rainfallMm: d3(r?.rain ?? 0), rainyDays: r?.rainy ?? 0, hoursLost: d3(r?.lost ?? 0), shutdownDays: r?.shut ?? 0, pourRestrictedDays: r?.pour ?? 0, days: r?.n ?? 0 }; });
      return { year, months, totals: { rainfallMm: months.reduce((n, m) => n + m.rainfallMm, 0), hoursLost: months.reduce((n, m) => n + m.hoursLost, 0), shutdownDays: months.reduce((n, m) => n + m.shutdownDays, 0), days: months.reduce((n, m) => n + m.days, 0) } };
    },
  };

  // ---- hindrances (FR-02, FR-05, BR-01) -----------------------------------------------------------------------------------------------------------------------------------------------
  const hfresh = (id) => db.prepare('SELECT * FROM site_hindrances WHERE id = ?').get(id);
  const editable = (r) => ['DRAFT', 'RETURNED'].includes(r.status);
  const mustEdit = (r) => { if (!editable(r)) throw conflict(r.status === 'APPROVED' ? `${r.doc_no} is approved: it is locked; a change is an amendment.` : `${r.doc_no} is ${lower(HIN_STATUS[r.status])}: it is not changed now.`); };
  const rootOf = (r) => { let x = r; for (let i = 0; i < 50 && x.parent_hindrance_id; i += 1) x = hfresh(x.parent_hindrance_id) ?? x; return x.id; };
  const hrow = (actor, id, key = 'site.hindrance.view') => {
    const r = db.prepare('SELECT * FROM site_hindrances WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'site.hindrance.view', r.org_project_id, r.hin_site_id)) throw notFound('That hindrance does not exist.'); if (key !== 'site.hindrance.view') need(actor, key, 'do that with a hindrance', r.org_project_id, r.hin_site_id); return r;
  };
  /** The activities and locations a hindrance touches, checked against the project and kept with their codes. */
  function affectedOf(projectId, companyId, a) {
    const p = []; const out = { activities: [], locations: [], text: a?.text ?? null };
    for (const [i, aid] of (a?.activityIds ?? []).entries()) { const x = db.prepare('SELECT a.id, a.code, a.name FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE a.id = ? AND a.company_id = ? AND s.org_project_id = ? AND a.deleted_at IS NULL').get(aid, companyId, projectId); if (!x) p.push({ field: `affected.activityIds.${i}`, message: 'Choose an activity of this project' }); else out.activities.push({ id: x.id, code: x.code, name: x.name }); }
    for (const [i, lid] of (a?.locationIds ?? []).entries()) { const x = db.prepare('SELECT id, code, name FROM proj_locations WHERE id = ? AND company_id = ? AND project_id = ? AND deleted_at IS NULL').get(lid, companyId, projectId); if (!x) p.push({ field: `affected.locationIds.${i}`, message: 'Choose a location of this project' }); else out.locations.push({ id: x.id, code: x.code, name: x.name }); }
    fail(p); return out;
  }
  /** The ids of a hindrance and of the revisions it amends: the evidence attached to any of them counts (an amendment starts with the files of the record it replaces). */
  const chainIds = (r) => { const ids = [r.id]; let x = r; for (let i = 0; i < 50 && x.parent_hindrance_id; i += 1) { x = hfresh(x.parent_hindrance_id); if (!x) break; ids.push(x.id); } return ids; };
  const evidenceOf = (r) => { const files = chainIds(r).reduce((n, id) => n + fileCount(r.company_id, 'site_hindrance', id), 0); const letter = r.letter_id ? db.prepare('SELECT id, letter_no, subject FROM engg_letters WHERE id = ?').get(r.letter_id) : null; return { files, letter: letter ? { id: letter.id, letterNo: letter.letter_no, subject: letter.subject } : null, ok: files > 0 || Boolean(letter) }; };
  const ageDays = (r) => (r.status === 'CLOSED' || r.end_date ? daysBetween(r.start_date, r.end_date ?? todayIST()) : Math.max(1, daysBetween(r.start_date, todayIST())));
  function hview(actor, r, { detail = false } = {}) {
    const s = db.prepare('SELECT s.code, s.name, p.code AS pcode, p.name AS pname FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ?').get(r.hin_site_id); const can = (k) => may(actor, k, r.org_project_id, r.hin_site_id); const own = same(r.requested_by, actor.user);
    const open = OPEN.includes(r.status) && !r.end_date; const escalateDays = Number(param(r.company_id, 'site.hindrance.escalate_days') ?? 7);
    const v = { id: r.id, docNo: r.doc_no, title: r.title, description: r.description, projectId: r.org_project_id, projectCode: s?.pcode, projectName: s?.pname, siteId: r.hin_site_id, siteCode: s?.code, siteName: s?.name, type: r.hin_type, typeLabel: HIN_TYPES[r.hin_type], startDate: r.start_date, endDate: r.end_date,
      responsibleParty: r.responsible_party, responsiblePartyLabel: PARTIES[r.responsible_party], responsibleName: r.responsible_name, letterId: r.letter_id, status: r.status, statusLabel: HIN_STATUS[r.status], revisionNo: r.revision_no, parentHindranceId: r.parent_hindrance_id,
      open, ageDays: ageDays(r), overdue: open && daysBetween(r.start_date, todayIST()) > escalateDays, escalationLevel: r.escalation_level, escalatedAt: r.escalated_at, closureNotes: r.closure_notes, closedAt: r.closed_at, closedBy: r.closed_by, reason: r.reason, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at,
      workflowInstanceId: r.workflow_instance_id, rowVersion: r.version, affected: json(r.affected_json, {}),
      can: { edit: can('site.hindrance.edit') && editable(r), submit: can('site.hindrance.submit') && editable(r), withdraw: r.status === 'SUBMITTED' && own, cancel: can('site.hindrance.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status), delete: can('site.hindrance.delete') && r.status === 'DRAFT' && !r.workflow_instance_id,
        amend: can('site.hindrance.amend') && r.status === 'APPROVED' && !db.prepare("SELECT 1 FROM site_hindrances WHERE parent_hindrance_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id), close: can('site.hindrance.close') && r.status === 'APPROVED' && !db.prepare("SELECT 1 FROM site_hindrances WHERE parent_hindrance_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id),
        approve: can('site.hindrance.approve') && r.status === 'SUBMITTED' && !own, print: can('site.hindrance.print'), export: can('site.hindrance.export') } };
    if (detail) {
      const ev = evidenceOf(r); const dl = delayOf('site_hindrance', rootOf(r)); const p = r.parent_hindrance_id ? hfresh(r.parent_hindrance_id) : null;
      v.evidence = ev; v.delay = dl ? { id: dl.id, docNo: dl.doc_no, status: dl.status, days: dl.delay_days } : null; v.previous = p ? { id: p.id, docNo: p.doc_no, revisionNo: p.revision_no } : null;
      v.revisions = db.prepare('SELECT id, doc_no, revision_no, status FROM site_hindrances WHERE (parent_hindrance_id = ? OR id = ?) AND id <> ? AND deleted_at IS NULL ORDER BY revision_no').all(r.id, r.parent_hindrance_id ?? 0, r.id).map((x) => ({ id: x.id, docNo: x.doc_no, revisionNo: x.revision_no, status: x.status }));
      v.dprs = db.prepare("SELECT d.id, d.doc_no, d.dpr_date FROM site_dpr_notes n JOIN site_dprs d ON d.id = n.dpr_id WHERE n.linked_entity = 'site_hindrance' AND n.linked_id = ? AND n.deleted_at IS NULL AND d.deleted_at IS NULL ORDER BY d.dpr_date DESC LIMIT 20").all(String(rootOf(r))).map((x) => ({ id: x.id, docNo: x.doc_no, date: x.dpr_date }));
    }
    return v;
  }
  const HSELECT = 'x.id, x.doc_no, x.title, x.org_project_id, x.hin_site_id, x.hin_type, x.responsible_party, x.start_date, x.end_date, x.escalation_level, x.status, x.letter_id, p.code AS pcode, s.code AS scode';
  const hlist = (x) => ({ id: x.id, docNo: x.doc_no, title: x.title, project: x.pcode, projectId: x.org_project_id, site: x.scode, siteId: x.hin_site_id, type: x.hin_type, typeLabel: HIN_TYPES[x.hin_type], party: x.responsible_party, partyLabel: PARTIES[x.responsible_party], startDate: x.start_date, endDate: x.end_date, ageDays: ageDays({ ...x, end_date: x.end_date }), escalation: x.escalation_level, letter: Boolean(x.letter_id), status: x.status, statusLabel: HIN_STATUS[x.status] });
  const hl = listing({ def: hindranceList, view: 'site.hindrance.view', exp: 'site.hindrance.export', pcol: 'org_project_id', scol: 'hin_site_id', select: HSELECT, row: hlist, exportColumns: ['docNo', 'title', 'project', 'site', 'type', 'party', 'startDate', 'endDate', 'status'], exportRow: (v) => ({ ...v, type: v.typeLabel, party: v.partyLabel, endDate: v.endDate ?? '', status: v.statusLabel }), describe: 'All hindrances you may see' });
  const hindrances = {
    list: hl.list, exportSource: hl.exportSource,
    sites: (actor) => sitesOf(actor, 'site.hindrance.view').map((s) => ({ id: s.id, code: s.code, name: s.name, projectId: s.org_project_id, projectCode: s.pcode, canCreate: may(actor, 'site.hindrance.create', s.org_project_id, s.id) })),
    /** What the form offers besides the site: the activities and locations of the project, the letters of the project, the types and parties. */
    options(actor, siteId) {
      const s = siteRow(actor, siteId, 'site.hindrance.view');
      return { siteId: s.id, activities: db.prepare("SELECT a.id, a.code, a.name FROM plan_activities a JOIN plan_schedules sc ON sc.id = a.schedule_id WHERE a.company_id = ? AND sc.org_project_id = ? AND a.deleted_at IS NULL AND sc.status IN ('APPROVED', 'DRAFT', 'SUBMITTED', 'RETURNED') ORDER BY a.code LIMIT 1000").all(actor.companyId, s.org_project_id),
        locations: db.prepare('SELECT id, code, name FROM proj_locations WHERE company_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 1000').all(actor.companyId, s.org_project_id),
        letters: db.prepare("SELECT id, letter_no, subject FROM engg_letters WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND letter_no IS NOT NULL ORDER BY id DESC LIMIT 300").all(actor.companyId, s.org_project_id).map((l) => ({ id: l.id, letterNo: l.letter_no, subject: l.subject })),
        types: Object.entries(HIN_TYPES).map(([code, label]) => ({ code, label })), parties: Object.entries(PARTIES).map(([code, label]) => ({ code, label })) };
    },
    get(actor, id) {
      const v = hview(actor, hrow(actor, id), { detail: true });
      if (v.can.approve && v.workflowInstanceId) v.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === v.workflowInstanceId)?.id ?? null;
      return v;
    },
    /** The hindrances open at a site on a day, for the DPR and the diary: started by then and not ended before it. */
    activeOn(actor, siteId, date) {
      const s = siteRow(actor, siteId, 'site.hindrance.view');
      return db.prepare("SELECT * FROM site_hindrances WHERE hin_site_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) AND status IN ('SUBMITTED', 'APPROVED', 'CLOSED') AND deleted_at IS NULL ORDER BY start_date, id").all(s.id, date, date).map((r) => ({ id: r.id, docNo: r.doc_no, title: r.title, type: r.hin_type, typeLabel: HIN_TYPES[r.hin_type], startDate: r.start_date, endDate: r.end_date, status: r.status }));
    },
    create(actor, b) {
      const s = siteRow(actor, b.siteId, 'site.hindrance.view', 'site.hindrance.create'); const aff = affectedOf(s.org_project_id, actor.companyId, b.affected); letterOf(actor.companyId, s.org_project_id, b.letterId, 'letterId');
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO site_hindrances (company_id, doc_no, org_project_id, hin_site_id, title, description, hin_type, start_date, end_date, affected_json, responsible_party, responsible_name, letter_id, status, requested_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'api')")
          .run(actor.companyId, number(actor.companyId, actor.user), s.org_project_id, s.id, b.title, b.description ?? null, b.type, b.startDate, b.endDate ?? null, JSON.stringify(aff), b.responsibleParty, b.responsibleName ?? null, b.letterId ?? null, actor.user, s.org_project_id, s.id, actor.user).lastInsertRowid);
        audit(actor, 'site_hindrances', id, 'create', actor.companyId, { newValues: { type: b.type, party: b.responsibleParty, start: b.startDate } }); return hindrances.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = hrow(actor, id, 'site.hindrance.edit'); mustEdit(r); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this hindrance; reload it.');
      const start = b.startDate ?? r.start_date; const end = 'endDate' in b ? b.endDate : r.end_date; if (end && end < start) fail([{ field: 'endDate', message: 'The end is not before the start' }]);
      if ('letterId' in b) letterOf(r.company_id, r.org_project_id, b.letterId, 'letterId'); const aff = 'affected' in b ? affectedOf(r.org_project_id, r.company_id, b.affected) : null;
      return transaction(db, () => {
        const set = []; const vals = []; for (const [k, c] of [['title', 'title'], ['description', 'description'], ['type', 'hin_type'], ['startDate', 'start_date'], ['endDate', 'end_date'], ['responsibleParty', 'responsible_party'], ['responsibleName', 'responsible_name'], ['letterId', 'letter_id']]) if (k in b) { set.push(`${c} = ?`); vals.push(b[k]); }
        if (aff) { set.push('affected_json = ?'); vals.push(JSON.stringify(aff)); }
        db.prepare(`UPDATE site_hindrances SET ${[...set, 'updated_by = ?', 'updated_at = ?', 'version = version + 1'].join(', ')} WHERE id = ?`).run(...vals, actor.user, nowIso(), r.id);
        const changed = { ...b }; delete changed.rowVersion; audit(actor, 'site_hindrances', r.id, 'update', r.company_id, { newValues: changed }); return hindrances.get(actor, r.id);
      });
    },
    remove(actor, id) { const r = hrow(actor, id, 'site.hindrance.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); transaction(db, () => { db.prepare('UPDATE site_hindrances SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'site_hindrances', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true }; },
    submit(actor, id) {
      const r = hrow(actor, id, 'site.hindrance.submit'); if (!editable(r)) throw unprocessable('Only a draft or a returned hindrance is sent for approval.');
      const p = []; if (String(r.description ?? '').trim().length < 5) p.push({ field: 'description', message: 'Describe the hindrance (at least 5 characters)' }); fail(p);
      return transaction(db, () => {
        const ctx = { projectId: r.org_project_id, siteId: r.hin_site_id, type: r.hin_type, party: r.responsible_party, amendment: r.parent_hindrance_id ? 'yes' : 'no' };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: HIN_DOC, docId: String(r.id), comment: `${r.doc_no}: ${r.title}`.slice(0, 300), context: ctx }); db.prepare('UPDATE site_hindrances SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE site_hindrances SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id);
        audit(actor, 'site_hindrances', r.id, 'submit', r.company_id); return hindrances.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = hrow(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a hindrance waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return hindrances.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = hrow(actor, id, 'site.hindrance.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a hindrance that is not approved is cancelled; an approved one is changed by an amendment or closed.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE site_hindrances SET status = 'CANCELLED', reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'site_hindrances', r.id, 'cancel', r.company_id, { reason }); return hindrances.get(actor, r.id); });
    },
    /** An approved hindrance is locked; a change is an amendment that goes through the same chain and replaces it. */
    amend(actor, id, { reason }) {
      const r = hrow(actor, id, 'site.hindrance.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved hindrance is amended.'); if (db.prepare("SELECT 1 FROM site_hindrances WHERE parent_hindrance_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id)) throw conflict('An amendment of this hindrance is open.');
      return transaction(db, () => {
        const cols = ['org_project_id', 'hin_site_id', 'title', 'description', 'hin_type', 'start_date', 'end_date', 'affected_json', 'responsible_party', 'responsible_name', 'letter_id', 'project_id', 'site_id'];
        const nid = Number(db.prepare(`INSERT INTO site_hindrances (company_id, doc_no, ${cols.join(', ')}, revision_no, parent_hindrance_id, status, reason, requested_by, created_by, source_type, source_id) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, 'DRAFT', ?, ?, ?, 'site_hindrance', ?)`)
          .run(r.company_id, number(r.company_id, actor.user), ...cols.map((c) => r[c]), r.revision_no + 1, r.id, reason, actor.user, actor.user, String(r.id)).lastInsertRowid);
        audit(actor, 'site_hindrances', nid, 'amend', r.company_id, { reason, newValues: { from: r.doc_no } }); return hindrances.get(actor, nid);
      });
    },
    /** BR-01: closing needs the end date and evidence (a file or the letter), and the hindrance must be approved. The closure is a step of the life of an approved record, not a change to what was approved. */
    close(actor, id, b) {
      const r = hrow(actor, id, 'site.hindrance.close'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved hindrance is closed.');
      if (db.prepare("SELECT 1 FROM site_hindrances WHERE parent_hindrance_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(r.id)) throw conflict('An amendment of this hindrance is open: decide it first.');
      const p = []; if (b.endDate < r.start_date) p.push({ field: 'endDate', message: `The end is not before the start (${r.start_date})` }); if (b.endDate > todayIST()) p.push({ field: 'endDate', message: 'The end is today or an earlier day' });
      const ev = evidenceOf(r);
      if (!ev.ok) p.push({ field: 'evidence', message: 'Attach the evidence of the end (a letter, a photograph or a minute) or link the letter, then close it' }); fail(p);
      return transaction(db, () => {
        const now = nowIso(); db.prepare("UPDATE site_hindrances SET status = 'CLOSED', end_date = ?, closure_notes = ?, closed_at = ?, closed_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.endDate, b.closureNotes, now, actor.user, actor.user, now, r.id);
        audit(actor, 'site_hindrances', r.id, 'close', r.company_id, { newValues: { endDate: b.endDate, evidenceFiles: ev.files, letter: Boolean(ev.letter) } });
        const n = hfresh(r.id); publishEvent(db, { type: 'site.hindrance.closed', entity: 'site_hindrance', entityId: r.id, actorId: actor.user, companyId: r.company_id, projectId: r.org_project_id, siteId: r.hin_site_id, data: hindranceEvent(n) });
        return hindrances.get(actor, r.id);
      });
    },
    history(actor, id) { const r = hrow(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'site_hindrances' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    print(actor, id) {
      const r = hrow(actor, id, 'site.hindrance.print'); const v = hview(actor, r, { detail: true }); const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(r.company_id)?.legal_name ?? ''; audit(actor, 'site_hindrances', r.id, 'print', r.company_id);
      const aff = v.affected; return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title></head><body>${v.status === 'APPROVED' || v.status === 'CLOSED' ? '' : `<p><strong>${esc(v.statusLabel.toUpperCase())}: NOT AN APPROVED HINDRANCE</strong></p>`}<h1>${esc(co)}</h1><h2>Hindrance ${esc(v.docNo)}${v.revisionNo > 1 ? ` · amendment ${v.revisionNo - 1}` : ''}: ${esc(v.title)}</h2>`
        + `<p>${esc(v.projectCode)} ${esc(v.projectName)} · site ${esc(v.siteCode)} ${esc(v.siteName)} · ${esc(v.typeLabel)} · responsible: ${esc(v.responsiblePartyLabel)}${v.responsibleName ? ` (${esc(v.responsibleName)})` : ''}</p><p>From ${esc(v.startDate)} ${v.endDate ? `to ${esc(v.endDate)}` : '(still open)'} · ${v.ageDays} day(s)</p>`
        + `<p>${esc(v.description ?? '')}</p><p>Affected activities: ${esc((aff.activities ?? []).map((a) => `${a.code} ${a.name}`).join('; ') || '—')}. Locations: ${esc((aff.locations ?? []).map((a) => `${a.code} ${a.name}`).join('; ') || '—')}. ${esc(aff.text ?? '')}</p>`
        + `<p>Notified by letter: ${esc(v.evidence.letter ? `${v.evidence.letter.letterNo} ${v.evidence.letter.subject}` : 'no letter linked')} · evidence files: ${v.evidence.files}</p>${v.closureNotes ? `<p>Closed ${esc(String(v.closedAt).slice(0, 10))} by ${esc(v.closedBy)}: ${esc(v.closureNotes)}</p>` : ''}<p>${v.approvedAt ? `Approved by ${esc(v.approvedBy)} on ${esc(v.approvedAt.slice(0, 10))}` : `Prepared by ${esc(v.requestedBy ?? '')}`}</p></body></html>`;
    },
    pdf(actor, id) {
      const r = hrow(actor, id, 'site.hindrance.print'); const v = hview(actor, r, { detail: true }); const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(r.company_id)?.legal_name ?? ''; audit(actor, 'site_hindrances', r.id, 'pdf', r.company_id);
      const rows = [['Title', v.title], ['Type', v.typeLabel], ['Responsible', `${v.responsiblePartyLabel}${v.responsibleName ? ` (${v.responsibleName})` : ''}`], ['Start', v.startDate], ['End', v.endDate ?? 'still open'], ['Days', String(v.ageDays)], ['Description', v.description ?? ''], ['Letter', v.evidence.letter ? `${v.evidence.letter.letterNo} ${v.evidence.letter.subject}` : 'none'], ['Evidence files', String(v.evidence.files)], ['Closure', v.closureNotes ?? '']].map(([item, detail]) => ({ item, detail }));
      const footer = [`${co}: hindrance ${v.docNo}${v.revisionNo > 1 ? ` (amendment ${v.revisionNo - 1})` : ''}`, `${v.projectCode} ${v.siteCode} · ${v.statusLabel}`, v.approvedAt ? `Approved by ${v.approvedBy} on ${v.approvedAt.slice(0, 10)}` : 'Not an approved hindrance'];
      return { buffer: toPdf({ columns: [{ key: 'item', label: 'Item', type: 'text' }, { key: 'detail', label: 'Detail', type: 'text' }], rows, footer, title: footer[0] }), contentType: 'application/pdf', fileName: `${String(v.docNo).replace(/\W+/g, '-')}.pdf` };
    },
    /** The approval engine's decision (its hook runs in the same transaction). */
    decide(instance, actor, outcome, comment) {
      const r = hfresh(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE site_hindrances SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id);
        if (r.parent_hindrance_id) db.prepare("UPDATE site_hindrances SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(actor.user, now, r.parent_hindrance_id);
        audit(actor, 'site_hindrances', r.id, r.parent_hindrance_id ? 'approve_amendment' : 'approve', r.company_id);
        publishEvent(db, { type: 'site.hindrance.approved', entity: 'site_hindrance', entityId: r.id, actorId: actor.user, companyId: r.company_id, projectId: r.org_project_id, siteId: r.hin_site_id, data: hindranceEvent(hfresh(r.id)) });
        notify(r.company_id, 'site.hindrance.approved', [`user:${r.requested_by}`], r.doc_no, r.title, `${r.doc_no} is approved${r.parent_hindrance_id ? ' as an amendment' : ''} and is evidence for delays and claims.`, `/site/hindrances?id=${r.id}`, r.id);
        return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE site_hindrances SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'site_hindrances', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'site.hindrance.rejected', [`user:${r.requested_by}`], r.doc_no, r.title, `${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/site/hindrances?id=${r.id}`, r.id);
    },
    /** BR-01: a hindrance open longer than `site.hindrance.escalate_days` is escalated to the construction manager and the project manager of its project, and again after each such period. */
    escalate(on = todayIST()) {
      const sys = { user: 'system' }; let n = 0;
      for (const c of db.prepare('SELECT DISTINCT company_id FROM site_hindrances WHERE end_date IS NULL AND deleted_at IS NULL').all()) {
        const days = Number(param(c.company_id, 'site.hindrance.escalate_days') ?? 7); const limit = isoOf(ordOf(on) - days);
        const rows = db.prepare(`SELECT * FROM site_hindrances WHERE company_id = ? AND end_date IS NULL AND deleted_at IS NULL AND status IN ('SUBMITTED', 'APPROVED') AND start_date <= ? AND (escalated_at IS NULL OR substr(escalated_at, 1, 10) <= ?)`).all(c.company_id, limit, limit);
        for (const r of rows) transaction(db, () => {
          const level = r.escalation_level + 1; db.prepare('UPDATE site_hindrances SET escalation_level = ?, escalated_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(level, `${on}T00:00:00.000Z`, 'system', nowIso(), r.id);
          writeAudit(db, { entity: 'site_hindrances', entityId: r.id, action: 'escalate', actor: 'system', companyId: r.company_id, reason: `Open ${daysBetween(r.start_date, on)} days`, newValues: { level } });
          publishEvent(db, { type: 'site.hindrance.escalated', entity: 'site_hindrance', entityId: r.id, actorId: 'system', companyId: r.company_id, projectId: r.org_project_id, siteId: r.hin_site_id, data: { hindranceId: r.id, docNo: r.doc_no, projectId: r.org_project_id, siteId: r.hin_site_id, level, openDays: daysBetween(r.start_date, on) } });
          notify(r.company_id, 'site.hindrance.escalated', ['role:CM|PM'], r.doc_no, r.title, `${r.doc_no} has been open for ${daysBetween(r.start_date, on)} days (escalation ${level}). Get it resolved, or record the claim.`, `/site/hindrances?id=${r.id}`, `${r.id}-${level}`, { projectId: r.org_project_id, siteId: r.hin_site_id }); n += 1;
        });
      }
      void sys; return n;
    },
  };
  /** What planning (13.05) and the claims (21.06) read: the hindrance as approved or closed. */
  function hindranceEvent(r) {
    const aff = json(r.affected_json, {}); const root = rootOf(r);
    return { hindranceId: r.id, rootId: root, docNo: r.doc_no, projectId: r.org_project_id, siteId: r.hin_site_id, title: r.title, type: r.hin_type, responsibleParty: r.responsible_party, responsibleName: r.responsible_name, startDate: r.start_date, endDate: r.end_date, status: r.status,
      letterId: r.letter_id, supersedes: r.parent_hindrance_id ?? null, activities: (aff.activities ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name })), locations: (aff.locations ?? []).map((a) => ({ id: a.id, code: a.code })), thresholdDays: Number(param(r.company_id, 'site.hindrance.delay_threshold_days') ?? 1) };
  }

  // ---- the diary (FR-03) ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  const dfresh = (id) => db.prepare('SELECT * FROM site_diary WHERE id = ?').get(id);
  const drow = (actor, id, key = 'site.diary.view') => {
    const r = db.prepare('SELECT * FROM site_diary WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'site.diary.view', r.org_project_id, r.dy_site_id)) throw notFound('That diary entry does not exist.'); if (key !== 'site.diary.view') need(actor, key, 'do that with a diary entry', r.org_project_id, r.dy_site_id); return r;
  };
  function dview(actor, r) {
    const s = db.prepare('SELECT s.code, s.name, p.code AS pcode FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ?').get(r.dy_site_id); const can = (k) => may(actor, k, r.org_project_id, r.dy_site_id); const signed = Boolean(r.signed_at);
    return { id: r.id, projectId: r.org_project_id, projectCode: s?.pcode, siteId: r.dy_site_id, siteCode: s?.code, siteName: s?.name, date: r.diary_date, category: r.category, categoryLabel: DIARY_CATEGORIES[r.category], text: r.entry_text, enteredBy: r.created_by, signed, signedBy: r.signed_by, signedAt: r.signed_at, attachments: fileCount(r.company_id, 'site_diary', r.id), rowVersion: r.version,
      can: { edit: can('site.diary.edit') && !signed, delete: can('site.diary.delete') && !signed, sign: can('site.diary.sign') && !signed && !same(r.created_by, actor.user), attach: can('site.diary.edit') && !signed } };
  }
  const DSELECT = 'x.id, x.diary_date, x.org_project_id, x.dy_site_id, x.category, x.entry_text, x.created_by, x.signed_by, x.signed_at, p.code AS pcode, s.code AS scode';
  const dlist = (x) => ({ id: x.id, date: x.diary_date, project: x.pcode, projectId: x.org_project_id, site: x.scode, siteId: x.dy_site_id, category: DIARY_CATEGORIES[x.category], categoryCode: x.category, text: x.entry_text, enteredBy: x.created_by, signed: x.signed_at ? 'Signed off' : 'Not signed', signedBy: x.signed_by });
  const dl = listing({ def: diaryList, view: 'site.diary.view', exp: 'site.diary.export', pcol: 'org_project_id', scol: 'dy_site_id', select: DSELECT, row: dlist, exportColumns: ['date', 'project', 'site', 'category', 'enteredBy', 'signed'], exportRow: (v) => ({ ...v, text: v.text }), describe: 'All diary entries you may see' });
  const diary = {
    list: dl.list, exportSource: dl.exportSource,
    sites: (actor) => sitesOf(actor, 'site.diary.view').map((s) => ({ id: s.id, code: s.code, name: s.name, projectId: s.org_project_id, projectCode: s.pcode, canCreate: may(actor, 'site.diary.create', s.org_project_id, s.id) })),
    get: (actor, id) => dview(actor, drow(actor, id)),
    create(actor, b) {
      const s = siteRow(actor, b.siteId, 'site.diary.view', 'site.diary.create'); notFuture(b.date);
      return transaction(db, () => { const id = Number(db.prepare("INSERT INTO site_diary (company_id, org_project_id, dy_site_id, diary_date, category, entry_text, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, s.org_project_id, s.id, b.date, b.category, b.text, s.org_project_id, s.id, actor.user).lastInsertRowid); audit(actor, 'site_diary', id, 'create', actor.companyId, { newValues: { date: b.date, category: b.category } }); return dview(actor, dfresh(id)); });
    },
    update(actor, id, b) {
      const r = drow(actor, id, 'site.diary.edit'); if (r.signed_at) throw conflict('This entry is signed off by the construction manager: it is locked. Add a new entry to correct it.'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this entry; reload it.');
      return transaction(db, () => { db.prepare('UPDATE site_diary SET category = ?, entry_text = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.category ?? r.category, b.text ?? r.entry_text, actor.user, nowIso(), r.id); audit(actor, 'site_diary', r.id, 'update', r.company_id, { oldValues: { category: r.category, text: r.entry_text }, newValues: { category: b.category ?? r.category, text: b.text ?? r.entry_text } }); return dview(actor, dfresh(r.id)); });
    },
    remove(actor, id) { const r = drow(actor, id, 'site.diary.delete'); if (r.signed_at) throw conflict('A signed-off entry is not deleted.'); transaction(db, () => { db.prepare('UPDATE site_diary SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'site_diary', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true }; },
    /** FR-03: the construction manager signs an entry off; the person who wrote it never signs it. */
    sign(actor, id) {
      const r = drow(actor, id, 'site.diary.sign'); if (r.signed_at) throw conflict('This entry is already signed off.'); if (same(r.created_by, actor.user)) throw forbidden('You wrote this entry: another person signs it off.');
      return transaction(db, () => { const now = nowIso(); db.prepare('UPDATE site_diary SET signed_by = ?, signed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, now, actor.user, now, r.id); audit(actor, 'site_diary', r.id, 'sign', r.company_id); return dview(actor, dfresh(r.id)); });
    },
    /** Sign off every entry of a site and day that the person did not write. */
    signDay(actor, { siteId, date }) {
      const s = siteRow(actor, siteId, 'site.diary.view', 'site.diary.sign'); const rows = db.prepare('SELECT * FROM site_diary WHERE dy_site_id = ? AND diary_date = ? AND signed_at IS NULL AND deleted_at IS NULL').all(s.id, date).filter((r) => !same(r.created_by, actor.user));
      return transaction(db, () => { const now = nowIso(); for (const r of rows) { db.prepare('UPDATE site_diary SET signed_by = ?, signed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, now, actor.user, now, r.id); audit(actor, 'site_diary', r.id, 'sign', r.company_id); } return { signed: rows.length }; });
    },
  };

  // ---- the visitors (FR-04) -------------------------------------------------------------------------------------------------------------------------------------------------------------
  const vfresh = (id) => db.prepare('SELECT * FROM site_visitors WHERE id = ?').get(id);
  const vrow = (actor, id, key = 'site.visitor.view') => {
    const r = db.prepare('SELECT * FROM site_visitors WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'site.visitor.view', r.org_project_id, r.vis_site_id)) throw notFound('That visit does not exist.'); if (key !== 'site.visitor.view') need(actor, key, 'do that with a visit', r.org_project_id, r.vis_site_id); return r;
  };
  function vview(actor, r) {
    const s = db.prepare('SELECT s.code, s.name, p.code AS pcode FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE s.id = ?').get(r.vis_site_id); const can = (k) => may(actor, k, r.org_project_id, r.vis_site_id); const l = r.linked_letter_id ? db.prepare('SELECT letter_no, subject FROM engg_letters WHERE id = ?').get(r.linked_letter_id) : null;
    return { id: r.id, projectId: r.org_project_id, projectCode: s?.pcode, siteId: r.vis_site_id, siteCode: s?.code, siteName: s?.name, date: r.visit_date, timeIn: r.time_in, timeOut: r.time_out, visitorName: r.visitor_name, organisation: r.organisation, visitorType: r.visitor_type, visitorTypeLabel: VISITOR_TYPES[r.visitor_type], purpose: r.purpose, instructions: r.instructions,
      linkedLetterId: r.linked_letter_id, linkedLetter: l ? `${l.letter_no} ${l.subject}` : null, enteredBy: r.created_by, rowVersion: r.version, can: { edit: can('site.visitor.edit'), delete: can('site.visitor.delete') } };
  }
  const VSELECT = 'x.id, x.visit_date, x.time_in, x.time_out, x.org_project_id, x.vis_site_id, x.visitor_name, x.organisation, x.visitor_type, x.purpose, x.instructions, x.linked_letter_id, p.code AS pcode, s.code AS scode';
  const vlist = (x) => ({ id: x.id, date: x.visit_date, timeIn: x.time_in, timeOut: x.time_out, project: x.pcode, projectId: x.org_project_id, site: x.scode, siteId: x.vis_site_id, visitor: x.visitor_name, organisation: x.organisation, type: VISITOR_TYPES[x.visitor_type], typeCode: x.visitor_type, purpose: x.purpose, instructions: x.instructions, letter: Boolean(x.linked_letter_id) });
  const vl = listing({ def: visitorList, view: 'site.visitor.view', exp: 'site.visitor.export', pcol: 'org_project_id', scol: 'vis_site_id', select: VSELECT, row: vlist, exportColumns: ['date', 'project', 'site', 'visitor', 'organisation', 'type', 'purpose'], exportRow: (v) => v, describe: 'All visits you may see' });
  const visitors = {
    list: vl.list, exportSource: vl.exportSource,
    sites: (actor) => sitesOf(actor, 'site.visitor.view').map((s) => ({ id: s.id, code: s.code, name: s.name, projectId: s.org_project_id, projectCode: s.pcode, canCreate: may(actor, 'site.visitor.create', s.org_project_id, s.id) })),
    get: (actor, id) => vview(actor, vrow(actor, id)),
    create(actor, b) {
      const s = siteRow(actor, b.siteId, 'site.visitor.view', 'site.visitor.create'); notFuture(b.date); letterOf(actor.companyId, s.org_project_id, b.linkedLetterId, 'linkedLetterId');
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO site_visitors (company_id, org_project_id, vis_site_id, visit_date, time_in, time_out, visitor_name, organisation, visitor_type, purpose, instructions, linked_letter_id, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')")
          .run(actor.companyId, s.org_project_id, s.id, b.date, b.timeIn ?? null, b.timeOut ?? null, b.visitorName, b.organisation ?? null, b.visitorType, b.purpose, b.instructions ?? null, b.linkedLetterId ?? null, s.org_project_id, s.id, actor.user).lastInsertRowid);
        audit(actor, 'site_visitors', id, 'create', actor.companyId, { newValues: { date: b.date, visitor: b.visitorName, type: b.visitorType } }); return vview(actor, vfresh(id));
      });
    },
    update(actor, id, b) {
      const r = vrow(actor, id, 'site.visitor.edit'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this visit; reload it.');
      const tin = 'timeIn' in b ? b.timeIn : r.time_in; const tout = 'timeOut' in b ? b.timeOut : r.time_out; if (tin && tout && tout < tin) fail([{ field: 'timeOut', message: 'The time out is not before the time in' }]); if ('linkedLetterId' in b) letterOf(r.company_id, r.org_project_id, b.linkedLetterId, 'linkedLetterId');
      return transaction(db, () => {
        const set = []; const vals = []; for (const [k, c] of [['visitorName', 'visitor_name'], ['organisation', 'organisation'], ['visitorType', 'visitor_type'], ['purpose', 'purpose'], ['instructions', 'instructions'], ['timeIn', 'time_in'], ['timeOut', 'time_out'], ['linkedLetterId', 'linked_letter_id']]) if (k in b) { set.push(`${c} = ?`); vals.push(b[k]); }
        db.prepare(`UPDATE site_visitors SET ${[...set, 'updated_by = ?', 'updated_at = ?', 'version = version + 1'].join(', ')} WHERE id = ?`).run(...vals, actor.user, nowIso(), r.id);
        const changed = { ...b }; delete changed.rowVersion; audit(actor, 'site_visitors', r.id, 'update', r.company_id, { newValues: changed }); return vview(actor, vfresh(r.id));
      });
    },
    remove(actor, id) { const r = vrow(actor, id, 'site.visitor.delete'); transaction(db, () => { db.prepare('UPDATE site_visitors SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'site_visitors', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true }; },
  };

  /** What the report of a day (14.02) reads in place: the weather of the site and day and the hindrances and visits of that day. Nothing here is typed again. */
  function dayContext(companyId, siteId, date) {
    const w = db.prepare('SELECT * FROM site_weather WHERE wx_site_id = ? AND wx_date = ? AND company_id = ? AND deleted_at IS NULL').get(siteId, date, companyId);
    const hin = db.prepare("SELECT id, doc_no, title, hin_type, start_date, end_date, status, parent_hindrance_id FROM site_hindrances WHERE hin_site_id = ? AND company_id = ? AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) AND status IN ('APPROVED', 'CLOSED') AND deleted_at IS NULL ORDER BY start_date, id").all(siteId, companyId, date, date);
    const vis = db.prepare('SELECT visitor_name, organisation, purpose, instructions FROM site_visitors WHERE vis_site_id = ? AND company_id = ? AND visit_date = ? AND deleted_at IS NULL ORDER BY id').all(siteId, companyId, date);
    return { weather: w ? { id: w.id, code: w.condition_code, rainMm: w.rainfall_mm == null ? null : Math.round(w.rainfall_mm / 1000), hoursLost: d3(w.hours_lost), shutdown: Boolean(w.shutdown), pourRestricted: Boolean(w.pour_restricted), ref: `weather:${w.id}` } : null,
      hindrances: hin.map((h) => ({ id: h.id, rootId: rootOf(h), docNo: h.doc_no, title: h.title, typeLabel: HIN_TYPES[h.hin_type], startDate: h.start_date, endDate: h.end_date })), visitors: vis.map((v) => ({ name: v.visitor_name, organisation: v.organisation, purpose: v.purpose, instructions: v.instructions })) };
  }
  return { weather, hindrances, diary, visitors, dayContext, hindranceDecide: hindrances.decide, base: { may, param, hasAnywhere: (actor, key) => authz.check(actor, key).allowed } };
}
