import { randomUUID } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { createBuiltinScanner, runScanners } from '../../platform/files/scan.js';
import { checkType } from '../../platform/files/types.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { testPoint, distanceM } from '../../platform/org/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { createHash } from 'node:crypto';
import { issueNumber } from '../core/numbering/service.js';
import { registerOfflineForm } from '../eng/offline.js';
import { attendanceOf } from './attendance.js';
import { deploymentsOf } from './deployments.js';

// Geo-fenced mobile attendance (part 07.05). A punch arrives from a phone (with GPS and, where the site asks, a selfie), from a supervisor for a crew without phones (with a group photo), from a kiosk tablet (a badge
// scanned) or from a biometric device (the placeholder interface of 29.02): all go through the same checks. The server decides, never the phone (BR-01): the person must be deployed at the site (or ask for a visit, approved by
// the manager and the site's project manager); the device clock may differ from the server's by only so much; the position is tested against the site's fence with the accuracy the phone reports; a mock location, a phone shared
// by two people, impossible travel and repeated poor accuracy raise anomalies for a person to review. A result is ACCEPTED, FLAGGED (it counts, and an anomaly waits), PENDING (a visit awaits approval) or REJECTED with its reason;
// a rejected punch is kept and never counts (BR-03). The same client id, or the same kind of punch within a few minutes, is one record (BR-02). Location is read at the moment of the punch only and removed after the retention period.
export const VISIT_DOC = 'HR_ATT_VISIT';
export const ANOMALY_DOC = 'HR_ATT_ANOMALY';
export const REASONS = {
  CLOCK_SKEW: 'The clock of the phone is too far from the server time', FUTURE_TIME: 'The punch time is in the future', TOO_OLD: 'The offline punch is older than allowed', LOW_ACCURACY: 'The location is too imprecise', OUTSIDE_FENCE: 'The position is outside the site fence',
  MOCK_LOCATION: 'A mock (fake) location was reported', NO_LOCATION: 'The phone gave no location', SELFIE_REQUIRED: 'A selfie is required at this site', NOT_DEPLOYED: 'The person is not deployed at this site', VISIT_REJECTED: 'The visit was not approved', ANOMALY_REJECTED: 'A reviewer rejected the punch',
  PHOTO_REQUIRED: 'A photo is required', NO_BADGE: 'The badge is not known',
};
export const ANOMALY_LABELS = { OUTSIDE_FENCE: 'Outside the fence', IMPOSSIBLE_TRAVEL: 'Impossible travel', LOW_ACCURACY: 'Low accuracy', REPEATED_LOW_ACCURACY: 'Repeated low accuracy', MOCK_LOCATION: 'Mock location', SHARED_DEVICE: 'Phone used by several people', SELFIE_MISMATCH: 'Selfie does not match', NEW_DEVICE: 'New phone', CLOCK_SKEW: 'Clock difference', LATE_SYNC: 'Late sync', NO_PRIOR_IN: 'Out without an in' };
const nowMs = () => Date.now();
const nowIso = () => new Date().toISOString();
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const istDate = (ms) => new Date(ms + 19_800_000).toISOString().slice(0, 10);
const SELFIE_MAX = 400 * 1024;

for (const [key, dataType, def, description, extra] of [
  ['att.punch.max_skew_seconds', 'integer', 300, 'FR-02: how far the clock of a phone may be from the server time for an online punch before the punch is rejected.', { min: 30, max: 3600 }],
  ['att.punch.late_sync_minutes', 'integer', 30, 'FR-06: an offline punch that reaches the server later than this after it was made is flagged as a late sync.', { min: 1, max: 1440 }],
  ['att.punch.max_offline_age_hours', 'integer', 96, 'FR-06: an offline punch older than this when it arrives is rejected.', { min: 1, max: 720 }],
  ['att.punch.flag_accuracy_m', 'integer', 50, 'FR-02: a punch whose reported accuracy is worse than this (metres) is accepted with a flag. A site may set its own.', { min: 5, max: 1000 }],
  ['att.punch.reject_accuracy_m', 'integer', 200, 'FR-02: a punch whose reported accuracy is worse than this (metres) is rejected. A site may set its own.', { min: 10, max: 5000 }],
  ['att.punch.fence_tolerance_m', 'integer', 10, 'FR-02: how far outside the edge of the fence a position may be and still count as inside (GPS error at the edge). A site may set its own.', { min: 0, max: 100 }],
  ['att.punch.duplicate_window_minutes', 'integer', 5, 'BR-02: a second punch of the same kind by the same person within this many minutes is the same punch.', { min: 0, max: 60 }],
  ['att.punch.max_speed_kmph', 'integer', 150, 'FR-08: travel between two punches faster than this (km/h) is impossible and raises an anomaly.', { min: 20, max: 1000 }],
  ['att.punch.mock_action', 'string', 'REJECT', 'FR-02: what a reported mock location does: REJECT the punch or FLAG it.', { allowed: ['REJECT', 'FLAG'] }],
  ['att.punch.require_location', 'boolean', true, 'FR-02: a mobile or supervisor punch without a location is rejected.', {}],
  ['att.punch.bind_device', 'boolean', true, 'FR-02: the first phone a person punches from is bound to them; another phone raises a low anomaly and a phone used by two people raises a high one.', {}],
  ['att.punch.selfie_roles', 'json', [], 'FR-01: role codes whose holders always give a selfie, whatever the site asks.', {}],
  ['att.punch.face_match_enabled', 'boolean', false, 'FR-08: compare the selfie with the person\'s photo. Off: no matcher is installed and no consent is recorded (D-338).', {}],
  ['att.punch.face_match_threshold', 'integer', 80, 'FR-08: a match score below this raises a selfie mismatch anomaly (only when face matching is on).', { min: 1, max: 100 }],
  ['att.punch.location_retention_months', 'integer', 24, 'FR-09: after this many months the coordinates and the selfie link of a punch are removed (the punch stays).', { min: 1, max: 120 }],
  ['att.anomaly.repeat_threshold', 'integer', 3, 'Accepting an outside-fence punch of a person who already had this many accepted in the period goes to the HR manager as well.', { min: 1, max: 20 }],
  ['att.anomaly.repeat_days', 'integer', 30, 'The period in days over which repeated outside-fence acceptances are counted.', { min: 1, max: 365 }],
  ['att.anomaly.sla_hours', 'integer', 48, 'A queued anomaly older than this shows red in the worklist (amber from half of it).', { min: 1, max: 720 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

const geofenceOf = (row) => ({ type: row.geofence_type, latitude: row.latitude, longitude: row.longitude, radiusM: row.geofence_radius_m, polygon: row.geofence_polygon_json ? JSON.parse(row.geofence_polygon_json) : undefined });

export function createPunchService({ db, storage }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const scanner = createBuiltinScanner();
  const may = (actor, key, scope) => (scope ? authz.check(actor, key, { companyId: actor.companyId, ...scope }) : authz.check(actor, key)).allowed;
  const need = (actor, key, what, scope) => { if (!may(actor, key, scope)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const myUserId = (actor) => actor.userId ?? db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(actor.companyId, actor.user)?.id ?? null;
  const myEmployee = (actor) => { const uid = myUserId(actor); return uid ? db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND user_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED'").get(actor.companyId, uid)?.id ?? null : null; };
  const siteRow = (companyId, id) => db.prepare('SELECT * FROM org_sites WHERE id = ? AND company_id = ? AND is_active = 1').get(id, companyId);
  const empRow = (companyId, id) => db.prepare("SELECT id, emp_code, full_name, user_id, employment_status, record_status FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(id, companyId);
  const event = (type, actor, entity, id, companyId, data, siteId = null, projectId = null) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, siteId: siteId ?? undefined, projectId: projectId ?? undefined, data });
  const tell = (companyId, to, what, ref, title, decision, comment, link) => to && notif.notify({ companyId, templateCode: 'att.punch.decided', recipients: [`user:${to}`], data: { what, ref, title, decision, comment: comment ? `: ${comment}` : '' }, link, sourceType: 'att_punch', sourceId: ref, eventKey: `att.punch.decided:${ref}:${decision}:${Date.now()}` });
  const usernameOf = (userId) => (userId ? db.prepare('SELECT username FROM iam_users WHERE id = ?').get(userId)?.username ?? null : null);
  const setting = (companyId, siteId) => {
    const s = db.prepare('SELECT * FROM att_site_settings WHERE company_id = ? AND setting_site_id = ? AND deleted_at IS NULL').get(companyId, siteId);
    return {
      selfieMode: s?.selfie_mode ?? 'OPTIONAL', flagAccuracy: s?.flag_accuracy_m ?? param(companyId, 'att.punch.flag_accuracy_m'), rejectAccuracy: s?.reject_accuracy_m ?? param(companyId, 'att.punch.reject_accuracy_m'),
      tolerance: s?.tolerance_m ?? param(companyId, 'att.punch.fence_tolerance_m'), kioskEnabled: s ? s.kiosk_enabled === 1 : true,
    };
  };

  // ---- the selfie: a small image sent with the punch, stored through the same checks as any attachment, readable only by those who review ----
  async function storeSelfie(actor, dataUrl, what) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
    if (!m) throw badRequest('Some fields are not valid.', [{ field: 'selfie', message: `The ${what} must be a JPEG, PNG or WebP image` }]);
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length > SELFIE_MAX) throw badRequest('Some fields are not valid.', [{ field: 'selfie', message: `The ${what} is too large (at most ${SELFIE_MAX / 1024} KB; the app reduces it)` }]);
    const type = checkType(`punch.${m[1] === 'jpeg' ? 'jpg' : m[1]}`, buffer.subarray(0, 4096), ['jpg', 'jpeg', 'png', 'webp']);
    if (!type.ok) throw badRequest('Some fields are not valid.', [{ field: 'selfie', message: type.problem }]);
    const verdict = await runScanners([scanner], async function* () { yield buffer; });
    if (verdict.status === 'INFECTED') throw unprocessable(`The ${what} was refused by the virus scan.`);
    const key = `c${actor.companyId}/att/${new Date().getUTCFullYear()}/${randomUUID()}.${type.extension}`;
    await storage.putBuffer(key, buffer);
    const f = db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, scanned_at, linked_entity, linked_id, version_no, retention_class, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CLEAN', ?, 'att_punch', 0, 1, 'standard', ?, 'att_punch')")
      .run(actor.companyId, key, `punch.${type.extension}`, type.extension, type.mime, type.category, buffer.length, createHash('sha256').update(buffer).digest('hex'), nowIso(), actor.user);
    return Number(f.lastInsertRowid);
  }
  const linkFile = (fileId, punchId) => { if (fileId) db.prepare('UPDATE core_files SET linked_id = ? WHERE id = ? AND linked_id = 0').run(punchId, fileId); };

  // ---- the decision on one punch ----
  /** Everything the server decides about a punch, without saving it. Returns { result, reason, flags[], anomalies[], inside, distance, effectiveMs, offline }. */
  function decide(actor, b, { site, method, deployed, visit }) {
    const cid = actor.companyId;
    const st = setting(cid, site.id);
    const flags = []; const anomalies = []; let reject = null;
    const add = (code, severity, detail, anomaly = true) => { flags.push(code); if (anomaly) anomalies.push({ type: code, severity, detail }); };
    const now = nowMs();
    const deviceMs = Date.parse(b.deviceTime);
    const offline = b.offline === true;
    let effectiveMs = deviceMs;
    const skew = (now - deviceMs) / 1000;
    if (!offline) {
      if (Math.abs(skew) > param(cid, 'att.punch.max_skew_seconds')) { reject = reject ?? 'CLOCK_SKEW'; add('CLOCK_SKEW', 'MEDIUM', `The phone clock is ${Math.round(skew)} s from the server time`); }
    } else {
      if (deviceMs > now + param(cid, 'att.punch.max_skew_seconds') * 1000) { reject = reject ?? 'FUTURE_TIME'; add('CLOCK_SKEW', 'MEDIUM', 'The offline punch is dated in the future'); }
      else if (b.imported === true) flags.push('IMPORTED'); // a device log loaded from a file is as old as the file: the age rules of a phone do not apply (part 07.06)
      else if (now - deviceMs > param(cid, 'att.punch.max_offline_age_hours') * 3_600_000) reject = reject ?? 'TOO_OLD';
      else if (now - deviceMs > param(cid, 'att.punch.late_sync_minutes') * 60_000) add('LATE_SYNC', 'LOW', `Made ${Math.round((now - deviceMs) / 60_000)} minutes before it reached the server`);
    }
    const hasLoc = Number.isFinite(b.lat) && Number.isFinite(b.lng);
    let inside = null; let distance = null;
    if (method === 'MOBILE' || method === 'SUPERVISOR' || (method === 'KIOSK' && hasLoc)) {
      if (!hasLoc) { if (param(cid, 'att.punch.require_location') && method !== 'KIOSK') reject = reject ?? 'NO_LOCATION'; }
      else {
        const acc = Number.isFinite(b.accuracyM) ? b.accuracyM : null;
        if (b.mockLocation === true || (acc !== null && acc <= 0)) { if (param(cid, 'att.punch.mock_action') === 'REJECT') reject = reject ?? 'MOCK_LOCATION'; add('MOCK_LOCATION', 'HIGH', b.mockLocation ? 'The phone reported a mock location' : 'The accuracy reported is zero, which a real GPS never gives'); }
        if (acc !== null && acc > st.rejectAccuracy) { reject = reject ?? 'LOW_ACCURACY'; add('LOW_ACCURACY', 'MEDIUM', `Accuracy ${Math.round(acc)} m is worse than ${st.rejectAccuracy} m`); }
        else if (acc !== null && acc > st.flagAccuracy) add('LOW_ACCURACY', 'LOW', `Accuracy ${Math.round(acc)} m is worse than ${st.flagAccuracy} m`);
        const fence = geofenceOf(site);
        if (fence.type === 'NONE') flags.push('NO_FENCE');
        else {
          const t = testPoint(fence, { lat: b.lat, lng: b.lng }, st.tolerance);
          distance = t.edgeDistanceM; inside = t.inside;
          if (!t.inside) {
            if (t.edgeDistanceM <= st.tolerance + (acc ?? 0)) flags.push('EDGE_UNCERTAIN'); // outside by less than the error of the position: it may well be inside
            else { reject = reject ?? 'OUTSIDE_FENCE'; add('OUTSIDE_FENCE', t.edgeDistanceM > 1000 ? 'HIGH' : 'MEDIUM', `${Math.round(t.edgeDistanceM)} m outside the fence of ${site.name}`); }
          }
        }
      }
    }
    // a selfie where the site, or the role of the person, asks for one
    const roles = param(cid, 'att.punch.selfie_roles');
    const needsSelfie = method === 'MOBILE' && !b.selfie && !b.selfiePending && (st.selfieMode === 'REQUIRED' || (Array.isArray(roles) && roles.some((r) => (actor.roles ?? []).includes(r))));
    if (b.selfiePending && !b.selfie) flags.push('SELFIE_PENDING'); // the photo of an offline punch follows through the media upload of the offline engine
    if (needsSelfie) reject = reject ?? 'SELFIE_REQUIRED';
    if (method === 'KIOSK' && st.selfieMode === 'REQUIRED' && !b.selfie) reject = reject ?? 'SELFIE_REQUIRED';
    if (param(cid, 'att.punch.face_match_enabled') && Number.isFinite(b.faceMatchScore) && b.faceMatchScore < param(cid, 'att.punch.face_match_threshold')) add('SELFIE_MISMATCH', 'HIGH', `Match score ${b.faceMatchScore}`);
    if (!deployed && !visit) reject = reject ?? 'NOT_DEPLOYED';
    const result = visit && visit.status === 'SUBMITTED' ? 'PENDING' : visit && ['REJECTED', 'CANCELLED'].includes(visit.status) ? 'REJECTED' : reject ? 'REJECTED' : flags.length ? 'FLAGGED' : 'ACCEPTED';
    return { result, reason: visit && ['REJECTED', 'CANCELLED'].includes(visit.status) ? 'VISIT_REJECTED' : reject, flags: [...new Set(flags)], anomalies, inside, distance, effectiveMs, offline };
  }

  const punchRow = (id) => db.prepare('SELECT * FROM att_punches WHERE id = ?').get(id);
  const nameOf = (id) => db.prepare('SELECT full_name AS n, emp_code AS c FROM hr_employees WHERE id = ?').get(id);
  const punchView = (r) => ({ id: r.id, personType: r.person_type, personId: r.person_id, person: r.person_name ?? nameOf(r.person_id)?.n, code: r.person_code ?? nameOf(r.person_id)?.c, siteId: r.punch_site_id, site: r.site_name ?? undefined, type: r.punch_type, workDate: r.work_date, deviceTime: r.device_time, serverTime: r.server_time, effectiveTime: r.effective_time,
    insideFence: r.inside_fence == null ? null : r.inside_fence === 1, distanceM: r.distance_m, accuracyM: r.accuracy_m, hasLocation: r.lat != null, hasSelfie: r.selfie_file_id != null, method: r.method, recordedBy: r.recorded_by, offline: r.offline === 1, result: r.result, reason: r.reason_code, reasonText: r.reason_code ? REASONS[r.reason_code] ?? r.reason_code : null, flags: json(r.flags_json, []), visitId: r.visit_id, groupId: r.group_id });

  /** Records one punch (the core of every way in). `input`: { personId, siteId, punchType, deviceTime, lat, lng, accuracyM, mockLocation, deviceId, clientUuid, selfie, offline, reason, faceMatchScore, groupId, selfieFileId }. */
  async function record(actor, input, opts) {
    // a replay is answered before anything is stored
    const replay = db.prepare('SELECT * FROM att_punches WHERE company_id = ? AND client_uuid = ?').get(actor.companyId, input.clientUuid);
    if (replay) return { ...punchView(replay), replayed: true };
    const selfieId = input.selfieFileId ?? (input.selfie ? await storeSelfie(actor, input.selfie, 'selfie') : null);
    return recordCore(actor, input, opts, selfieId);
  }
  function recordCore(actor, input, { method, personType = 'EMPLOYEE' }, selfieId) {
    const cid = actor.companyId;
    const site = siteRow(cid, input.siteId);
    if (!site) throw badRequest('Some fields are not valid.', [{ field: 'siteId', message: 'That site does not exist' }]);
    const person = personType === 'EMPLOYEE' ? empRow(cid, input.personId) : null;
    if (!person || person.record_status !== 'APPROVED' || !['ACTIVE', 'NOTICE'].includes(person.employment_status)) throw badRequest('Some fields are not valid.', [{ field: 'personId', message: 'The person is not an employee in service' }]);
    const deviceMs = Date.parse(input.deviceTime);
    if (!Number.isFinite(deviceMs)) throw badRequest('Some fields are not valid.', [{ field: 'deviceTime', message: 'Give the time of the punch as an ISO date and time' }]);
    // BR-02: the same client id is the same punch; the same kind of punch by the same person within a few minutes is too
    const prior = db.prepare('SELECT * FROM att_punches WHERE company_id = ? AND client_uuid = ?').get(cid, input.clientUuid);
    if (prior) return { ...punchView(prior), replayed: true };
    const win = param(cid, 'att.punch.duplicate_window_minutes') * 60_000;
    if (win > 0) {
      const dup = db.prepare("SELECT * FROM att_punches WHERE company_id = ? AND person_type = ? AND person_id = ? AND punch_type = ? AND result != 'REJECTED' AND deleted_at IS NULL AND effective_time >= ? AND effective_time <= ? ORDER BY id LIMIT 1")
        .get(cid, personType, input.personId, input.punchType, new Date(deviceMs - win).toISOString(), new Date(deviceMs + win).toISOString());
      if (dup) return { ...punchView(dup), replayed: true, duplicate: true };
    }
    const workDate = istDate(deviceMs);
    const dep = deploymentsOf(db)?.deployments.eligibility(cid, { personType, personId: input.personId, siteId: input.siteId, date: workDate }) ?? { eligible: false };
    let visit = db.prepare("SELECT * FROM att_visits WHERE company_id = ? AND employee_id = ? AND visit_site_id = ? AND work_date = ? AND deleted_at IS NULL AND status != 'CANCELLED' ORDER BY id DESC LIMIT 1").get(cid, input.personId, input.siteId, workDate);
    if (!dep.eligible && !visit && method === 'MOBILE') {
      if (!input.reason || String(input.reason).trim().length < 5) throw new HttpError(422, 'NOT_DEPLOYED', 'You are not deployed at this site on this day. To punch here as a visit, give the reason (at least 5 characters); your manager and the site project manager approve it.');
    }
    const wantsVisit = !dep.eligible && method === 'MOBILE';
    const d = decide(actor, input, { site, method, deployed: dep.eligible, visit: dep.eligible ? null : visit ?? (wantsVisit ? { status: 'SUBMITTED' } : null) });
    return transaction(db, () => {
      let visitId = null;
      if (wantsVisit) {
        if (!visit) {
          const no = nextVisitNo(actor);
          const vid = Number(db.prepare("INSERT INTO att_visits (company_id, doc_no, employee_id, visit_site_id, work_date, reason, status, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, 'att_punch')").run(cid, no, input.personId, input.siteId, workDate, String(input.reason).trim(), site.org_project_id, site.id, actor.user).lastInsertRowid);
          visit = db.prepare('SELECT * FROM att_visits WHERE id = ?').get(vid);
        }
        visitId = visit.id;
      }
      const id = Number(db.prepare(`INSERT INTO att_punches (company_id, person_type, person_id, punch_site_id, punch_type, work_date, device_time, server_time, effective_time, lat, lng, accuracy_m, inside_fence, distance_m, selfie_file_id, method, recorded_by, device_id, offline, client_uuid, group_id, deployment_id, visit_id, result, reason_code, flags_json, project_id, site_id, created_by, source_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'att_punch')`).run(cid, personType, input.personId, input.siteId, input.punchType, workDate, new Date(deviceMs).toISOString(), nowIso(), new Date(d.effectiveMs).toISOString(),
        Number.isFinite(input.lat) ? input.lat : null, Number.isFinite(input.lng) ? input.lng : null, Number.isFinite(input.accuracyM) ? input.accuracyM : null, d.inside == null ? null : d.inside ? 1 : 0, d.distance, selfieId, method, actor.user, input.deviceId ?? null, d.offline ? 1 : 0, input.clientUuid, input.groupId ?? null, dep.deploymentId ?? null, visitId, d.result, d.reason,
        JSON.stringify(d.flags), site.org_project_id, site.id, actor.user).lastInsertRowid);
      linkFile(selfieId, id);
      if (visit && visit.status === 'SUBMITTED' && !visit.workflow_instance_id) startVisitWorkflow(actor, visit, input);
      // checks that need the other punches of the person (they are read by the time of the punch, so an offline sync in any order gives the same answers)
      const extra = neighbours(actor, { id, personType, personId: input.personId, effectiveMs: d.effectiveMs, lat: input.lat, lng: input.lng, accuracyM: input.accuracyM, punchType: input.punchType, workDate, deviceId: input.deviceId, method, siteId: input.siteId, deviceMs, flagAccuracy: setting(cid, input.siteId).flagAccuracy, result: d.result });
      const anomalies = [...d.anomalies, ...extra.anomalies];
      const flags = [...new Set([...d.flags, ...extra.flags])];
      let result = d.result; if (result === 'ACCEPTED' && flags.length) result = 'FLAGGED';
      if (flags.length !== d.flags.length || result !== d.result) db.prepare('UPDATE att_punches SET flags_json = ?, result = ? WHERE id = ?').run(JSON.stringify(flags), result, id);
      for (const a of anomalies) raise(actor, id, input.personId, site, a);
      resequence(actor, personType, input.personId, workDate);
      writeAudit(db, { entity: 'att_punches', entityId: id, action: 'record', newValues: { type: input.punchType, siteId: input.siteId, method, result, reason: d.reason, flags }, actor: actor.user, companyId: cid });
      const row = punchRow(id);
      event('att.punch.recorded', actor, 'att_punch', id, cid, { personType, personId: input.personId, siteId: input.siteId, type: input.punchType, workDate, effectiveTime: row.effective_time, result: row.result, reason: row.reason_code, method, offline: d.offline, insideFence: d.inside, anomalies: anomalies.map((a) => a.type) }, site.id, site.org_project_id);
      return { ...punchView(row), replayed: false, visit: visit ? { id: visit.id, docNo: visit.doc_no, status: visit.status } : null };
    });
  }
  /** A punch from a device file (part 07.06): the same core as every other way in, without a selfie; a punch whose client id was recorded before is answered as a replay and stored once. */
  const recordDeviceSync = (actor, input) => {
    const replay = db.prepare('SELECT * FROM att_punches WHERE company_id = ? AND client_uuid = ?').get(actor.companyId, input.clientUuid);
    if (replay) return { id: replay.id, replayed: true, result: replay.result };
    const r = recordCore(actor, input, { method: 'DEVICE' }, null);
    return { id: r.id, replayed: false, result: r.result };
  };
  const recordSync = (actor, input) => { const r = recordCore(actor, input, { method: 'MOBILE' }, null); return { entityId: r.id, version: 1, projectId: db.prepare('SELECT project_id FROM att_punches WHERE id = ?').get(r.id)?.project_id ?? null }; };
  const nextVisitNo = (actor) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType: 'ATT_VISIT', actor: actor.user, refType: 'att_visits' }).number; } catch (e) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(e?.code)) throw e; }
    let n = db.prepare('SELECT COUNT(*) AS n FROM att_visits WHERE company_id = ?').get(actor.companyId).n + 1;
    while (db.prepare('SELECT 1 FROM att_visits WHERE company_id = ? AND doc_no = ?').get(actor.companyId, `VST-${String(n).padStart(5, '0')}`)) n += 1;
    return `VST-${String(n).padStart(5, '0')}`;
  };
  function startVisitWorkflow(actor, visit, input) {
    const emp = empRow(actor.companyId, visit.employee_id);
    const submitter = { ...actor, user: usernameOf(emp.user_id) ?? actor.user };
    const inst = workflowOf(db).submit(submitter, { docType: VISIT_DOC, docId: visit.id, comment: input.reason ?? visit.reason, context: { siteId: visit.visit_site_id } });
    db.prepare('UPDATE att_visits SET workflow_instance_id = ? WHERE id = ?').run(inst.id, visit.id);
  }
  /** Checks against the other punches of the person: impossible travel (before and after in time), repeated low accuracy, a phone used by two people, a new phone, an out punch with no in. */
  function neighbours(actor, p) {
    const cid = actor.companyId; const anomalies = []; const flags = [];
    if (Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.result !== 'REJECTED') {
      const maxKmph = param(cid, 'att.punch.max_speed_kmph');
      const near = [
        db.prepare("SELECT effective_time, lat, lng FROM att_punches WHERE company_id = ? AND person_type = ? AND person_id = ? AND id != ? AND lat IS NOT NULL AND result IN ('ACCEPTED', 'FLAGGED') AND effective_time <= ? AND deleted_at IS NULL ORDER BY effective_time DESC LIMIT 1").get(cid, p.personType, p.personId, p.id, new Date(p.effectiveMs).toISOString()),
        db.prepare("SELECT effective_time, lat, lng FROM att_punches WHERE company_id = ? AND person_type = ? AND person_id = ? AND id != ? AND lat IS NOT NULL AND result IN ('ACCEPTED', 'FLAGGED') AND effective_time > ? AND deleted_at IS NULL ORDER BY effective_time ASC LIMIT 1").get(cid, p.personType, p.personId, p.id, new Date(p.effectiveMs).toISOString()),
      ].filter(Boolean);
      for (const o of near) {
        const metres = distanceM({ lat: o.lat, lng: o.lng }, { lat: p.lat, lng: p.lng });
        const hours = Math.abs(p.effectiveMs - Date.parse(o.effective_time)) / 3_600_000;
        if (metres > 500 && hours > 0 && metres / 1000 / hours > maxKmph) { flags.push('IMPOSSIBLE_TRAVEL'); anomalies.push({ type: 'IMPOSSIBLE_TRAVEL', severity: 'HIGH', detail: `${Math.round(metres / 100) / 10} km in ${Math.round(hours * 60)} minutes (${Math.round(metres / 1000 / hours)} km/h)` }); break; }
      }
    }
    if (Number.isFinite(p.accuracyM) && p.accuracyM > p.flagAccuracy) {
      const last = db.prepare("SELECT accuracy_m FROM att_punches WHERE company_id = ? AND person_type = ? AND person_id = ? AND id != ? AND accuracy_m IS NOT NULL AND deleted_at IS NULL AND effective_time <= ? ORDER BY effective_time DESC LIMIT 2").all(cid, p.personType, p.personId, p.id, new Date(p.effectiveMs).toISOString());
      if (last.length === 2 && last.every((x) => x.accuracy_m > p.flagAccuracy)) { flags.push('REPEATED_LOW_ACCURACY'); anomalies.push({ type: 'REPEATED_LOW_ACCURACY', severity: 'MEDIUM', detail: 'The last three punches were all below the accuracy asked for' }); }
    }
    if (p.method === 'MOBILE' && p.deviceId && param(cid, 'att.punch.bind_device') && p.personType === 'EMPLOYEE') {
      const now = nowIso();
      const mine = db.prepare('SELECT * FROM att_device_bindings WHERE company_id = ? AND device_id = ? AND employee_id = ? AND deleted_at IS NULL').get(cid, p.deviceId, p.personId);
      if (mine) db.prepare('UPDATE att_device_bindings SET last_seen_at = ?, punches = punches + 1, version = version + 1 WHERE id = ?').run(now, mine.id);
      else {
        const has = db.prepare("SELECT 1 FROM att_device_bindings WHERE company_id = ? AND employee_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL").get(cid, p.personId);
        db.prepare("INSERT INTO att_device_bindings (company_id, device_id, employee_id, first_seen_at, last_seen_at, punches, created_by, source_type) VALUES (?, ?, ?, ?, ?, 1, ?, 'att_punch')").run(cid, p.deviceId, p.personId, now, now, actor.user);
        if (has) { flags.push('NEW_DEVICE'); anomalies.push({ type: 'NEW_DEVICE', severity: 'LOW', detail: 'The person punched from a phone that is not the one bound to them' }); }
      }
      const other = db.prepare("SELECT 1 FROM att_punches WHERE company_id = ? AND device_id = ? AND person_id != ? AND person_type = 'EMPLOYEE' AND work_date = ? AND deleted_at IS NULL LIMIT 1").get(cid, p.deviceId, p.personId, p.workDate);
      if (other) { flags.push('SHARED_DEVICE'); anomalies.push({ type: 'SHARED_DEVICE', severity: 'HIGH', detail: 'The same phone was used by another person today' }); }
    }
    return { anomalies, flags };
  }
  function raise(actor, punchId, personId, site, a) {
    const r = db.prepare("INSERT OR IGNORE INTO att_anomalies (company_id, punch_id, anomaly_type, severity, detail, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'att_punch')").run(actor.companyId, punchId, a.type, a.severity, a.detail ?? null, site.org_project_id, site.id, actor.user);
    if (r.changes) event('att.anomaly.raised', actor, 'att_anomaly', Number(r.lastInsertRowid), actor.companyId, { punchId, personId, type: a.type, severity: a.severity }, site.id, site.org_project_id);
  }
  /** An out punch with no in earlier the same day is flagged; when the in punch arrives later (an offline sync in any order) the flag goes away. */
  function resequence(actor, personType, personId, workDate) {
    const rows = db.prepare("SELECT * FROM att_punches WHERE company_id = ? AND person_type = ? AND person_id = ? AND work_date = ? AND result IN ('ACCEPTED', 'FLAGGED', 'PENDING') AND deleted_at IS NULL ORDER BY effective_time, id").all(actor.companyId, personType, personId, workDate);
    let seenIn = false;
    for (const r of rows) {
      if (r.punch_type === 'IN') { seenIn = true; continue; }
      const flags = json(r.flags_json, []);
      const has = flags.includes('NO_PRIOR_IN');
      if (!seenIn && !has) {
        const nf = [...flags, 'NO_PRIOR_IN'];
        db.prepare("UPDATE att_punches SET flags_json = ?, result = CASE WHEN result = 'ACCEPTED' THEN 'FLAGGED' ELSE result END WHERE id = ?").run(JSON.stringify(nf), r.id);
        raise(actor, r.id, personId, { id: r.punch_site_id, org_project_id: r.project_id }, { type: 'NO_PRIOR_IN', severity: 'LOW', detail: 'An out punch with no in punch before it' });
      } else if (seenIn && has) {
        const nf = flags.filter((f) => f !== 'NO_PRIOR_IN');
        db.prepare("UPDATE att_punches SET flags_json = ?, result = CASE WHEN result = 'FLAGGED' AND ? = 0 THEN 'ACCEPTED' ELSE result END WHERE id = ?").run(JSON.stringify(nf), nf.length, r.id);
        db.prepare("UPDATE att_anomalies SET status = 'ACCEPTED', reviewed_by = 'system', reviewed_at = ?, review_note = 'The in punch arrived later: nothing is missing', updated_at = ?, version = version + 1 WHERE punch_id = ? AND anomaly_type = 'NO_PRIOR_IN' AND status = 'OPEN'").run(nowIso(), nowIso(), r.id);
      }
    }
  }

  // ---- the ways in ----
  const punches = {
    /** FR-01: the person's own punch from the phone. */
    async mobile(actor, b) {
      need(actor, 'att.punch.own', 'punch');
      const me = myEmployee(actor);
      if (!me) throw new HttpError(422, 'NO_EMPLOYEE', 'Your user account is not linked to an employee record, so there is no one to punch for.');
      return record(actor, { ...b, personId: me }, { method: 'MOBILE' });
    },
    /** FR-03: a supervisor marks the members of their crew, with a group photo and their own position; each punch names the supervisor as the recorder. */
    async crew(actor, b) {
      const crew = db.prepare('SELECT * FROM hr_crews WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.crewId, actor.companyId);
      if (!crew) throw notFound('That crew does not exist.');
      const site = siteRow(actor.companyId, crew.crew_site_id);
      need(actor, 'att.punch.crew', 'punch a crew', { projectId: site.org_project_id, siteId: site.id });
      const mine = myEmployee(actor);
      if (!(crew.supervisor_id && crew.supervisor_id === mine)) throw forbidden('Only the supervisor of the crew punches for it.');
      if (!b.photo) throw badRequest('Some fields are not valid.', [{ field: 'photo', message: 'A group photo is required' }]);
      const members = db.prepare("SELECT m.person_id FROM hr_crew_members m WHERE m.crew_id = ? AND m.person_type = 'EMPLOYEE' AND m.deleted_at IS NULL AND m.from_date <= ? AND (m.to_date IS NULL OR m.to_date >= ?)").all(crew.id, istDate(Date.parse(b.deviceTime)), istDate(Date.parse(b.deviceTime))).map((x) => x.person_id);
      for (const id of b.personIds) if (!members.includes(id)) throw badRequest('Some fields are not valid.', [{ field: 'personIds', message: `Employee ${id} is not in this crew` }]);
      const photoId = await storeSelfie(actor, b.photo, 'group photo');
      const groupId = b.groupUuid;
      const out = [];
      for (const personId of b.personIds) {
        out.push(await record(actor, { personId, siteId: site.id, punchType: b.punchType, deviceTime: b.deviceTime, lat: b.lat, lng: b.lng, accuracyM: b.accuracyM, mockLocation: b.mockLocation, deviceId: b.deviceId, clientUuid: `${groupId}:${personId}:${b.punchType}`, offline: b.offline, groupId, selfieFileId: photoId }, { method: 'SUPERVISOR' }));
      }
      return { groupId, crewId: crew.id, count: out.length, accepted: out.filter((x) => ['ACCEPTED', 'FLAGGED'].includes(x.result)).length, rejected: out.filter((x) => x.result === 'REJECTED').length, replayed: out.filter((x) => x.replayed).length, punches: out };
    },
    /** FR-04: the worker scans the ID card at the site kiosk tablet: the badge is the employee code. */
    async kiosk(actor, b) {
      const site = siteRow(actor.companyId, b.siteId);
      if (!site) throw badRequest('Some fields are not valid.', [{ field: 'siteId', message: 'That site does not exist' }]);
      need(actor, 'att.punch.kiosk', 'run the kiosk', { projectId: site.org_project_id, siteId: site.id });
      if (!setting(actor.companyId, site.id).kioskEnabled) throw unprocessable('The kiosk is switched off for this site.');
      const emp = db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND emp_code = ? COLLATE NOCASE AND deleted_at IS NULL AND record_status = 'APPROVED'").get(actor.companyId, String(b.badge).trim());
      if (!emp) throw new HttpError(404, 'NO_BADGE', 'That badge is not known. Ask the supervisor.');
      return record(actor, { ...b, personId: emp.id }, { method: 'KIOSK' });
    },
    /** FR-05: the interface of a biometric device (implemented in 29.02): the device names the person by code and the site it stands at, and the punch goes through the same checks. */
    async device(actor, b) {
      const site = siteRow(actor.companyId, b.siteId);
      if (!site) throw badRequest('Some fields are not valid.', [{ field: 'siteId', message: 'That site does not exist' }]);
      need(actor, 'att.punch.device', 'send device punches', { projectId: site.org_project_id, siteId: site.id });
      const emp = db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND emp_code = ? COLLATE NOCASE AND deleted_at IS NULL AND record_status = 'APPROVED'").get(actor.companyId, b.employeeCode);
      if (!emp) throw new HttpError(404, 'NO_BADGE', 'That person code is not known.');
      return record(actor, { personId: emp.id, siteId: site.id, punchType: b.punchType, deviceTime: b.deviceTime, deviceId: b.deviceSerial, clientUuid: b.clientUuid, offline: b.offline === true }, { method: 'DEVICE' });
    },
    /** What the punch screen needs: the sites the person is deployed at (with their fences, to draw), the next punch, today's punches, the notice about location. */
    context(actor) {
      need(actor, 'att.punch.own', 'punch');
      const me = myEmployee(actor);
      if (!me) throw new HttpError(422, 'NO_EMPLOYEE', 'Your user account is not linked to an employee record, so there is no one to punch for.');
      const today = istDate(nowMs());
      const sites = db.prepare("SELECT DISTINCT s.* FROM hr_deployments d JOIN org_sites s ON s.id = d.dep_site_id WHERE d.company_id = ? AND d.person_type = 'EMPLOYEE' AND d.person_id = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND d.from_date <= ? AND (d.to_date IS NULL OR d.to_date >= ?) AND s.is_active = 1").all(actor.companyId, me, today, today);
      const mine = db.prepare("SELECT p.*, s.name AS site_name FROM att_punches p JOIN org_sites s ON s.id = p.punch_site_id WHERE p.company_id = ? AND p.person_type = 'EMPLOYEE' AND p.person_id = ? AND p.deleted_at IS NULL ORDER BY p.effective_time DESC LIMIT 10").all(actor.companyId, me);
      const todays = mine.filter((p) => p.work_date === today && p.result !== 'REJECTED');
      const nextType = todays.length && todays[0].punch_type === 'IN' ? 'OUT' : 'IN';
      return {
        employeeId: me, today, nextType, serverTime: nowIso(), maxSkewSeconds: param(actor.companyId, 'att.punch.max_skew_seconds'),
        sites: sites.map((s) => { const st = setting(actor.companyId, s.id); const g = geofenceOf(s); return { id: s.id, name: s.name, code: s.code, geofence: g.type === 'NONE' ? { type: 'NONE', latitude: s.latitude, longitude: s.longitude } : g, selfieMode: st.selfieMode, tolerance: st.tolerance, flagAccuracy: st.flagAccuracy }; }),
        selfieRoles: param(actor.companyId, 'att.punch.selfie_roles'),
        last: mine.map((p) => punchView(p)),
        notice: 'Your location is read only at the moment you punch, to check that you are at the site. It is not tracked in the background, and it is removed after the retention period.',
      };
    },
    /** Today's punches (or those of a date) at a site: all of them for those who see the site, only their own for everyone else. */
    today(actor, { siteId, date = istDate(nowMs()) }) {
      const site = siteRow(actor.companyId, siteId);
      if (!site) throw notFound('That site does not exist.');
      const all = may(actor, 'att.punch.view', { projectId: site.org_project_id, siteId: site.id });
      const me = myEmployee(actor);
      if (!all && !me) throw forbidden('You may not see punches (permission att.punch.view).');
      const rows = db.prepare(`SELECT p.*, e.full_name AS person_name, e.emp_code AS person_code, s.name AS site_name FROM att_punches p JOIN hr_employees e ON e.id = p.person_id JOIN org_sites s ON s.id = p.punch_site_id WHERE p.company_id = ? AND p.punch_site_id = ? AND p.work_date = ? AND p.deleted_at IS NULL ${all ? '' : 'AND p.person_id = ?'} ORDER BY p.effective_time DESC LIMIT 500`).all(...(all ? [actor.companyId, siteId, date] : [actor.companyId, siteId, date, me]));
      return rows.map(punchView);
    },
    list(actor, { siteId, date, personId, result, limit = 100, offset = 0 }) {
      need(actor, 'att.punch.view', 'see punches');
      const scope = authz.scopeFilter(actor, 'att.punch.view', { project: 'p.project_id', site: 'p.site_id' }).sql;
      const where = ['p.company_id = ?', 'p.deleted_at IS NULL', scope]; const args = [actor.companyId];
      for (const [col, v] of [['p.punch_site_id', siteId], ['p.work_date', date], ['p.person_id', personId], ['p.result', result]]) if (v) { where.push(`${col} = ?`); args.push(v); }
      const rows = db.prepare(`SELECT p.*, e.full_name AS person_name, e.emp_code AS person_code, s.name AS site_name FROM att_punches p JOIN hr_employees e ON e.id = p.person_id JOIN org_sites s ON s.id = p.punch_site_id WHERE ${where.join(' AND ')} ORDER BY p.effective_time DESC, p.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
      const total = db.prepare(`SELECT COUNT(*) AS n FROM att_punches p WHERE ${where.join(' AND ')}`).get(...args).n;
      return { rows: rows.map(punchView), total };
    },
    /** The selfie of a punch: for the person it belongs to and for those who review anomalies. */
    async selfie(actor, id) {
      const p = punchRow(id);
      if (!p || p.company_id !== actor.companyId || !p.selfie_file_id) throw notFound('There is no selfie for that punch.');
      const site = siteRow(actor.companyId, p.punch_site_id);
      const own = myEmployee(actor) === p.person_id;
      if (!own && !may(actor, 'att.anomaly.review', { projectId: site.org_project_id, siteId: site.id })) throw notFound('There is no selfie for that punch.');
      const f = db.prepare('SELECT storage_key, mime FROM core_files WHERE id = ? AND deleted_at IS NULL').get(p.selfie_file_id);
      if (!f) throw notFound('The selfie has been removed.');
      const chunks = []; for await (const c of storage.createReadStream(f.storage_key)) chunks.push(c);
      writeAudit(db, { entity: 'att_punches', entityId: id, action: 'view_selfie', actor: actor.user, companyId: actor.companyId });
      return { mime: f.mime, buffer: Buffer.concat(chunks) };
    },
  };

  // ---- anomalies (FR-08) ----
  const ageHours = (at) => (nowMs() - Date.parse(at)) / 3_600_000;
  const anomalyView = (actor, a) => {
    const p = punchRow(a.punch_id);
    const sla = param(actor.companyId, 'att.anomaly.sla_hours');
    const age = ageHours(a.created_at);
    const e = empRow(actor.companyId, p.person_id);
    return { id: a.id, type: a.anomaly_type, typeLabel: ANOMALY_LABELS[a.anomaly_type], severity: a.severity, status: a.status, detail: a.detail, band: a.band, punchId: a.punch_id, personId: p.person_id, person: e?.full_name, code: e?.emp_code, siteId: p.punch_site_id, site: db.prepare('SELECT name FROM org_sites WHERE id = ?').get(p.punch_site_id)?.name,
      punchType: p.punch_type, effectiveTime: p.effective_time, workDate: p.work_date, method: p.method, result: p.result, reason: p.reason_code, ageHours: Math.round(age), colour: a.status !== 'OPEN' ? 'grey' : age > sla ? 'red' : age > sla / 2 ? 'amber' : 'green', hasSelfie: p.selfie_file_id != null,
      reviewedBy: a.reviewed_by, reviewedAt: a.reviewed_at, reviewNote: a.review_note, rowVersion: a.version };
  };
  const anomalies = {
    list(actor, { status = 'OPEN', type, siteId, limit = 100, offset = 0 } = /** @type {any} */ ({})) {
      need(actor, 'att.anomaly.view', 'see attendance anomalies');
      const scope = authz.scopeFilter(actor, 'att.anomaly.view', { project: 'a.project_id', site: 'a.site_id' }).sql;
      const where = ['a.company_id = ?', 'a.deleted_at IS NULL', scope]; const args = [actor.companyId];
      if (status && status !== 'ALL') { where.push('a.status = ?'); args.push(status); }
      if (type) { where.push('a.anomaly_type = ?'); args.push(type); }
      if (siteId) { where.push('a.site_id = ?'); args.push(siteId); }
      const rows = db.prepare(`SELECT a.* FROM att_anomalies a WHERE ${where.join(' AND ')} ORDER BY CASE a.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, a.created_at, a.id LIMIT ? OFFSET ?`).all(...args, limit, offset);
      return { rows: rows.map((a) => anomalyView(actor, a)), total: db.prepare(`SELECT COUNT(*) AS n FROM att_anomalies a WHERE ${where.join(' AND ')}`).get(...args).n };
    },
    get(actor, id) { return anomalyView(actor, anomalyRow(actor, id)); },
    /** Accept or reject. Accepting an outside-fence punch as present, for a person for whom that already happened several times lately, also goes to the HR manager. */
    review(actor, id, { decision, note, version = null }) {
      const a = anomalyRow(actor, id);
      const p = punchRow(a.punch_id);
      const site = siteRow(actor.companyId, p.punch_site_id);
      need(actor, 'att.anomaly.review', 'review anomalies', { projectId: site.org_project_id, siteId: site.id });
      if (a.status !== 'OPEN') throw conflict(`This anomaly is ${a.status.toLowerCase().replace('_', ' ')}.`);
      if (version != null && version !== a.version) throw conflict('This anomaly was changed by someone else. Reload and try again.');
      if (myEmployee(actor) === p.person_id) throw forbidden('You cannot review your own punch.');
      return transaction(db, () => {
        const repeated = decision === 'ACCEPT' && a.anomaly_type === 'OUTSIDE_FENCE' && db.prepare("SELECT COUNT(*) AS n FROM att_anomalies x JOIN att_punches q ON q.id = x.punch_id WHERE x.company_id = ? AND x.anomaly_type = 'OUTSIDE_FENCE' AND x.status = 'ACCEPTED' AND q.person_id = ? AND x.reviewed_at >= ? AND x.deleted_at IS NULL")
          .get(actor.companyId, p.person_id, new Date(nowMs() - param(actor.companyId, 'att.anomaly.repeat_days') * 86_400_000).toISOString()).n >= param(actor.companyId, 'att.anomaly.repeat_threshold');
        if (repeated) {
          db.prepare("UPDATE att_anomalies SET status = 'PENDING_APPROVAL', band = 'REPEATED', reviewed_by = ?, review_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, note, actor.user, nowIso(), id);
          const inst = workflowOf(db).submit(actor, { docType: ANOMALY_DOC, docId: id, comment: note, context: { band: 'REPEATED', siteId: site.id, projectId: site.org_project_id } });
          db.prepare('UPDATE att_anomalies SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id);
          writeAudit(db, { entity: 'att_anomalies', entityId: id, action: 'submit_repeated', reason: note, actor: actor.user, companyId: actor.companyId });
          return anomalyView(actor, anomalyRow(actor, id));
        }
        settle(actor, a, decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED', note);
        return anomalyView(actor, anomalyRow(actor, id));
      });
    },
    bulk(actor, { ids, decision, note }) {
      const out = ids.map((id) => { try { return { id, ok: true, anomaly: anomalies.review(actor, id, { decision, note }) }; } catch (e) { return { id, ok: false, error: e.message }; } });
      return { done: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok).length, results: out };
    },
  };
  const anomalyRow = (actor, id) => {
    const a = db.prepare('SELECT * FROM att_anomalies WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    const p = a && punchRow(a.punch_id);
    const s = p && siteRow(actor.companyId, p.punch_site_id);
    if (!a || !s || !may(actor, 'att.anomaly.view', { projectId: s.org_project_id, siteId: s.id })) throw notFound('That anomaly does not exist.');
    return a;
  };
  /** The effect of a decision on the punch: accepting an outside-fence punch makes it count (flagged as accepted by review); rejecting any anomaly takes the punch out of attendance. */
  function settle(actor, a, status, note) {
    const p = punchRow(a.punch_id);
    db.prepare('UPDATE att_anomalies SET status = ?, reviewed_by = COALESCE(?, reviewed_by), reviewed_at = ?, review_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor.user, nowIso(), note ?? a.review_note, actor.user, nowIso(), a.id);
    const flags = json(p.flags_json, []);
    if (status === 'ACCEPTED') {
      if (p.result === 'REJECTED' && a.anomaly_type === 'OUTSIDE_FENCE' && p.reason_code === 'OUTSIDE_FENCE') db.prepare("UPDATE att_punches SET result = 'FLAGGED', reason_code = NULL, flags_json = ? WHERE id = ?").run(JSON.stringify([...new Set([...flags, 'REVIEW_ACCEPTED'])]), p.id);
    } else if (p.result !== 'REJECTED') db.prepare("UPDATE att_punches SET result = 'REJECTED', reason_code = 'ANOMALY_REJECTED', flags_json = ? WHERE id = ?").run(JSON.stringify([...new Set([...flags, 'REVIEW_REJECTED'])]), p.id);
    writeAudit(db, { entity: 'att_anomalies', entityId: a.id, action: status.toLowerCase(), reason: note ?? null, newValues: { punchId: p.id, type: a.anomaly_type }, actor: actor.user, companyId: a.company_id });
    event('att.anomaly.reviewed', actor, 'att_anomaly', a.id, a.company_id, { punchId: p.id, personId: p.person_id, type: a.anomaly_type, decision: status }, p.punch_site_id, p.project_id);
    const e = empRow(a.company_id, p.person_id);
    tell(a.company_id, usernameOf(e?.user_id), 'Punch', `PNC-${p.id}`, `${ANOMALY_LABELS[a.anomaly_type]} on ${p.work_date}`, status === 'ACCEPTED' ? 'accepted' : 'rejected', note, '/att/punch');
  }
  const decisions = {
    anomaly(instance, actor, outcome, comment) {
      const a = db.prepare('SELECT * FROM att_anomalies WHERE id = ?').get(Number(instance.docId));
      if (!a || a.status !== 'PENDING_APPROVAL') return;
      if (outcome === 'APPROVED') settle(actor, a, 'ACCEPTED', comment);
      else if (outcome === 'REJECTED') settle(actor, a, 'REJECTED', comment);
      else db.prepare("UPDATE att_anomalies SET status = 'OPEN', band = 'STANDARD', workflow_instance_id = NULL, version = version + 1 WHERE id = ?").run(a.id);
    },
    visit(instance, actor, outcome, comment) {
      const v = db.prepare('SELECT * FROM att_visits WHERE id = ?').get(Number(instance.docId));
      if (!v || v.status !== 'SUBMITTED') return;
      const status = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'REJECTED' ? 'REJECTED' : outcome === 'RETURNED' ? 'REJECTED' : 'CANCELLED';
      db.prepare('UPDATE att_visits SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor.user, nowIso(), v.id);
      for (const p of db.prepare("SELECT * FROM att_punches WHERE visit_id = ? AND result = 'PENDING' AND deleted_at IS NULL").all(v.id)) {
        const flags = json(p.flags_json, []);
        if (status === 'APPROVED') db.prepare('UPDATE att_punches SET result = ?, flags_json = ? WHERE id = ?').run(flags.length ? 'FLAGGED' : 'ACCEPTED', JSON.stringify([...flags, 'VISIT_APPROVED']), p.id);
        else db.prepare("UPDATE att_punches SET result = 'REJECTED', reason_code = 'VISIT_REJECTED' WHERE id = ?").run(p.id);
        event('att.punch.recorded', actor, 'att_punch', p.id, v.company_id, { personId: p.person_id, siteId: p.punch_site_id, type: p.punch_type, workDate: p.work_date, result: status === 'APPROVED' ? 'ACCEPTED' : 'REJECTED', method: p.method, visit: v.doc_no, update: true }, p.punch_site_id, p.project_id);
      }
      writeAudit(db, { entity: 'att_visits', entityId: v.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: v.company_id });
      const e = empRow(v.company_id, v.employee_id);
      tell(v.company_id, usernameOf(e?.user_id), 'Visit', v.doc_no, `Punch at ${db.prepare('SELECT name FROM org_sites WHERE id = ?').get(v.visit_site_id)?.name}`, status === 'APPROVED' ? 'approved' : 'not approved', comment, '/att/punch');
    },
  };

  // ---- the report of the day, by site, with the records behind each count (drill-down through `punches.list`) ----
  const report = {
    today(actor, { date = istDate(nowMs()), projectId = null, siteId = null }) {
      need(actor, 'att.punch.view', 'see the attendance report');
      const scope = authz.scopeFilter(actor, 'att.punch.view', { project: 's.org_project_id', site: 's.id' }).sql;
      const where = ['s.company_id = ?', "s.status = 'ACTIVE'", 's.is_active = 1', scope]; const args = [actor.companyId];
      if (projectId) { where.push('s.org_project_id = ?'); args.push(projectId); }
      if (siteId) { where.push('s.id = ?'); args.push(siteId); }
      const sites = db.prepare(`SELECT s.id, s.code, s.name, s.org_project_id AS project_id, p.name AS project FROM org_sites s JOIN org_projects p ON p.id = s.org_project_id WHERE ${where.join(' AND ')} ORDER BY p.name, s.name LIMIT 200`).all(...args);
      const att = attendanceOf(db);
      const f = att?.facts(actor.companyId);
      const rows = sites.map((s) => {
        const people = db.prepare("SELECT DISTINCT d.person_id FROM hr_deployments d WHERE d.company_id = ? AND d.person_type = 'EMPLOYEE' AND d.dep_site_id = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND d.from_date <= ? AND (d.to_date IS NULL OR d.to_date >= ?)").all(actor.companyId, s.id, date, date).map((x) => x.person_id);
        const ins = db.prepare("SELECT person_id, MIN(effective_time) AS first_in FROM att_punches WHERE company_id = ? AND punch_site_id = ? AND work_date = ? AND punch_type = 'IN' AND result IN ('ACCEPTED', 'FLAGGED') AND deleted_at IS NULL GROUP BY person_id").all(actor.companyId, s.id, date);
        const present = new Set(ins.map((x) => x.person_id));
        let expected = 0; let late = 0; let off = 0;
        for (const id of people) {
          let r; try { r = att ? att.resolveFor(actor.companyId, id, date, f) : null; } catch { r = null; }
          if (r && r.dayType !== 'WORKING') { off += 1; continue; }
          expected += 1;
          const inn = ins.find((x) => x.person_id === id);
          if (inn && r?.shiftFull) {
            const [h, m] = [Math.floor(r.shiftFull.startMinute / 60), r.shiftFull.startMinute % 60];
            const start = Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`) - 19_800_000;
            if (Date.parse(inn.first_in) > start + (r.shiftFull.graceMinutes ?? 0) * 60_000) late += 1;
          }
        }
        const q = (sql, ...a) => db.prepare(sql).get(actor.companyId, s.id, date, ...a).n;
        const presentCount = people.filter((id) => present.has(id)).length + [...present].filter((id) => !people.includes(id)).length;
        return {
          siteId: s.id, site: s.name, projectId: s.project_id, project: s.project, deployed: people.length, expected, offToday: off, present: presentCount, absent: Math.max(0, expected - people.filter((id) => present.has(id)).length), late,
          outsideFence: q("SELECT COUNT(*) AS n FROM att_punches WHERE company_id = ? AND punch_site_id = ? AND work_date = ? AND reason_code = 'OUTSIDE_FENCE' AND deleted_at IS NULL") + q("SELECT COUNT(*) AS n FROM att_punches WHERE company_id = ? AND punch_site_id = ? AND work_date = ? AND flags_json LIKE '%REVIEW_ACCEPTED%' AND deleted_at IS NULL"),
          rejected: q("SELECT COUNT(*) AS n FROM att_punches WHERE company_id = ? AND punch_site_id = ? AND work_date = ? AND result = 'REJECTED' AND deleted_at IS NULL"), pending: q("SELECT COUNT(*) AS n FROM att_punches WHERE company_id = ? AND punch_site_id = ? AND work_date = ? AND result = 'PENDING' AND deleted_at IS NULL"),
          flagged: q("SELECT COUNT(*) AS n FROM att_punches WHERE company_id = ? AND punch_site_id = ? AND work_date = ? AND result = 'FLAGGED' AND deleted_at IS NULL"), openAnomalies: q("SELECT COUNT(*) AS n FROM att_anomalies a JOIN att_punches p ON p.id = a.punch_id WHERE a.company_id = ? AND p.punch_site_id = ? AND p.work_date = ? AND a.status = 'OPEN' AND a.deleted_at IS NULL"),
        };
      });
      const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
      return { date, rows, totals: { deployed: sum('deployed'), expected: sum('expected'), present: sum('present'), absent: sum('absent'), late: sum('late'), outsideFence: sum('outsideFence'), rejected: sum('rejected'), pending: sum('pending'), flagged: sum('flagged'), openAnomalies: sum('openAnomalies') } };
    },
    csv(actor, q) {
      const r = report.today(actor, q);
      const esc = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
      const cols = [['project', 'Project'], ['site', 'Site'], ['deployed', 'Deployed'], ['expected', 'Expected today'], ['present', 'Present'], ['absent', 'Absent'], ['late', 'Late'], ['outsideFence', 'Outside the fence'], ['rejected', 'Rejected punches'], ['pending', 'Waiting for a visit approval'], ['flagged', 'Flagged'], ['openAnomalies', 'Open anomalies']];
      writeAudit(db, { entity: 'att_punches', entityId: 0, action: 'export_report', newValues: { date: r.date }, actor: actor.user, companyId: actor.companyId });
      return [cols.map(([, l]) => l).join(','), ...r.rows.map((x) => cols.map(([k]) => `"${esc(x[k]).replace(/"/g, '""')}"`).join(','))].join('\n');
    },
  };

  // ---- settings per site ----
  const settings = {
    get(actor, siteId) {
      const s = siteRow(actor.companyId, siteId);
      if (!s) throw notFound('That site does not exist.');
      need(actor, 'att.punch.view', 'see punch settings', { projectId: s.org_project_id, siteId: s.id });
      const st = setting(actor.companyId, siteId);
      const row = db.prepare('SELECT version FROM att_site_settings WHERE company_id = ? AND setting_site_id = ? AND deleted_at IS NULL').get(actor.companyId, siteId);
      return { siteId, site: s.name, ...st, geofenceType: s.geofence_type, rowVersion: row?.version ?? 0, customised: !!row, can: { edit: may(actor, 'att.punch.settings') } };
    },
    set(actor, siteId, b) {
      need(actor, 'att.punch.settings', 'set punch settings');
      const s = siteRow(actor.companyId, siteId);
      if (!s) throw notFound('That site does not exist.');
      const row = db.prepare('SELECT * FROM att_site_settings WHERE company_id = ? AND setting_site_id = ? AND deleted_at IS NULL').get(actor.companyId, siteId);
      if (b.rejectAccuracyM != null && b.flagAccuracyM != null && b.rejectAccuracyM < b.flagAccuracyM) throw badRequest('Some fields are not valid.', [{ field: 'rejectAccuracyM', message: 'Rejecting starts at or after flagging' }]);
      if (row && b.version !== row.version) throw conflict('These settings were changed by someone else. Reload and try again.');
      if (row) db.prepare('UPDATE att_site_settings SET selfie_mode = ?, flag_accuracy_m = ?, reject_accuracy_m = ?, tolerance_m = ?, kiosk_enabled = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.selfieMode, b.flagAccuracyM ?? null, b.rejectAccuracyM ?? null, b.toleranceM ?? null, b.kioskEnabled ? 1 : 0, actor.user, nowIso(), row.id);
      else db.prepare("INSERT INTO att_site_settings (company_id, setting_site_id, selfie_mode, flag_accuracy_m, reject_accuracy_m, tolerance_m, kiosk_enabled, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'att_site_settings')").run(actor.companyId, siteId, b.selfieMode, b.flagAccuracyM ?? null, b.rejectAccuracyM ?? null, b.toleranceM ?? null, b.kioskEnabled ? 1 : 0, s.org_project_id, s.id, actor.user);
      writeAudit(db, { entity: 'att_site_settings', entityId: siteId, action: 'set', newValues: b, actor: actor.user, companyId: actor.companyId });
      return settings.get(actor, siteId);
    },
  };

  /** FR-09: after the retention period the coordinates and the selfie link of a punch are removed; the punch stays as a record of attendance. */
  function retention(companyId) {
    const months = param(companyId, 'att.punch.location_retention_months');
    const cut = new Date(nowMs() - months * 30.4375 * 86_400_000).toISOString();
    const rows = db.prepare('SELECT id, selfie_file_id FROM att_punches WHERE company_id = ? AND effective_time < ? AND (lat IS NOT NULL OR selfie_file_id IS NOT NULL) AND deleted_at IS NULL LIMIT 5000').all(companyId, cut);
    transaction(db, () => {
      for (const r of rows) {
        db.prepare("UPDATE att_punches SET lat = NULL, lng = NULL, selfie_file_id = NULL, flags_json = json_insert(flags_json, '$[#]', 'LOCATION_REMOVED') WHERE id = ?").run(r.id);
        if (r.selfie_file_id) db.prepare("UPDATE core_files SET deleted_at = ?, deleted_by = 'retention' WHERE id = ? AND deleted_at IS NULL").run(nowIso(), r.selfie_file_id);
      }
      if (rows.length) writeAudit(db, { entity: 'att_punches', entityId: 0, action: 'retention', newValues: { removed: rows.length, before: cut }, actor: 'system', companyId });
    });
    return { removed: rows.length };
  }
  const widget = (actor) => (may(actor, 'att.anomaly.view') ? { value: db.prepare("SELECT COUNT(*) AS n FROM att_anomalies WHERE company_id = ? AND status = 'OPEN' AND deleted_at IS NULL").get(actor.companyId).n } : { value: 0 });

  return { punches, anomalies, decisions, report, settings, retention, widget, record, recordSync, recordDeviceSync, myEmployee };
}

const services = new WeakMap();
export const bindPunches = (db, s) => services.set(db, s);
export const punchesOf = (db) => services.get(db) ?? null;

// the attendance punch is a form of the offline engine (04.15): the phone queues it with the device time and position, and the engine replays it here in order, with the clock difference corrected
registerOfflineForm({
  code: 'attendance_punch', label: 'Attendance punch', labelHi: 'उपस्थिति पंच', module: '07.05', permission: 'att.punch.own', attachmentEntity: 'att_punch',
  fields: [
    { key: 'siteId', label: 'Site', labelHi: 'साइट', type: 'site', required: true }, { key: 'punchType', label: 'In or out', labelHi: 'इन या आउट', type: 'text', required: true },
    { key: 'deviceTime', label: 'Time', labelHi: 'समय', type: 'text', required: true },
  ],
  rules: () => ({}),
  validate(values) {
    const e = [];
    if (!Number.isInteger(Number(values.siteId)) || Number(values.siteId) < 1) e.push({ field: 'siteId', message: 'Site: choose the site.' });
    if (!['IN', 'OUT'].includes(values.punchType)) e.push({ field: 'punchType', message: 'In or out: choose one.' });
    if (!Number.isFinite(Date.parse(values.deviceTime))) e.push({ field: 'deviceTime', message: 'Time: the time of the punch is missing.' });
    return e;
  },
  create(db, actor, v, ctx) {
    const svc = punchesOf(db);
    const me = svc.myEmployee(actor);
    if (!me) throw unprocessable('Your user account is not linked to an employee record.');
    // the engine is synchronous in its hooks: the record is made through the same checks, with the command id as the client id
    return svc.recordSync(actor, { personId: me, siteId: Number(v.siteId), punchType: v.punchType, deviceTime: ctx.effectiveAt ?? v.deviceTime, lat: v.lat ?? ctx.gps?.lat, lng: v.lng ?? ctx.gps?.lng, accuracyM: v.accuracyM ?? ctx.gps?.accuracy, mockLocation: v.mockLocation === true, deviceId: v.deviceId ?? null, clientUuid: ctx.commandId, offline: true, reason: v.reason ?? null, selfiePending: v.hasPhoto === true });
  },
  load: () => null,
  update() { throw unprocessable('A punch is not changed: it is reviewed.'); },
});

const step = (code, name, approvers, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 24, requireAttachment: false, checklist: [], when, notify: [], action: null });
const hooks = (fn) => ({
  onApproved: (db, { instance, actor }) => punchesOf(db)?.decisions[fn](instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => punchesOf(db)?.decisions[fn](instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => punchesOf(db)?.decisions[fn](instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => punchesOf(db)?.decisions[fn](instance, actor, 'CANCELLED', comment),
});
/** The reporting manager of the employee who punched (the manager on the employee record), and none when there is none. */
workflowResolvers.register('att.visit_manager', ({ db, instance }) => {
  const v = db.prepare('SELECT employee_id FROM att_visits WHERE id = ?').get(Number(instance.docId));
  const m = v && db.prepare('SELECT m.user_id FROM hr_employees e JOIN hr_employees m ON m.id = e.manager_id WHERE e.id = ?').get(v.employee_id);
  const u = m?.user_id ? db.prepare('SELECT username FROM iam_users WHERE id = ?').get(m.user_id)?.username : null;
  return u && !same(u, instance.submittedBy) ? [{ user: u }] : [{ role: 'HRMGR' }];
});
workflowTypes.register({
  docType: VISIT_DOC, label: 'Visit punch at a site where the person is not deployed', processOwner: 'HRMGR', route: () => '/att/today',
  describe(db, companyId, id) { const v = db.prepare('SELECT v.doc_no, v.work_date, v.visit_site_id, e.full_name, s.org_project_id FROM att_visits v JOIN hr_employees e ON e.id = v.employee_id JOIN org_sites s ON s.id = v.visit_site_id WHERE v.id = ? AND v.company_id = ?').get(Number(id), companyId); return v ? { ref: v.doc_no, title: `${v.full_name} visits on ${v.work_date}`, originator: db.prepare('SELECT username FROM iam_users u JOIN hr_employees e ON e.user_id = u.id JOIN att_visits x ON x.employee_id = e.id WHERE x.id = ?').get(Number(id))?.username, projectId: v.org_project_id, siteId: v.visit_site_id } : null; },
  summarise(db, _actor, id) { const v = db.prepare('SELECT v.*, e.full_name, s.name AS site FROM att_visits v JOIN hr_employees e ON e.id = v.employee_id JOIN org_sites s ON s.id = v.visit_site_id WHERE v.id = ?').get(Number(id)); if (!v) return null; return { fields: [{ label: 'Visit', value: v.doc_no }, { label: 'Person', value: v.full_name }, { label: 'Site', value: v.site }, { label: 'Day', value: v.work_date }, { label: 'Why', value: v.reason }] }; },
  defaultDefinition: { name: 'Visit punch: reporting manager, site project manager', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('MANAGER', 'Reporting manager', [{ kind: 'resolver', resolver: 'att.visit_manager' }]), step('PM', 'Project manager of the site', [{ kind: 'role', role: 'PM' }])] },
  hooks: hooks('visit'),
});
workflowTypes.register({
  docType: ANOMALY_DOC, label: 'Outside-fence punch accepted as present (repeated)', processOwner: 'HRMGR', route: () => '/att/anomalies',
  describe(db, companyId, id) { const a = db.prepare('SELECT a.*, p.work_date, p.punch_site_id, e.full_name FROM att_anomalies a JOIN att_punches p ON p.id = a.punch_id JOIN hr_employees e ON e.id = p.person_id WHERE a.id = ? AND a.company_id = ?').get(Number(id), companyId); const s = a && db.prepare('SELECT org_project_id FROM org_sites WHERE id = ?').get(a.punch_site_id); return a ? { ref: `ANM-${a.id}`, title: `${a.full_name}: ${a.anomaly_type} on ${a.work_date}`, originator: a.reviewed_by, projectId: s?.org_project_id, siteId: a.punch_site_id } : null; },
  summarise(db, _actor, id) { const a = db.prepare('SELECT a.*, p.work_date, e.full_name FROM att_anomalies a JOIN att_punches p ON p.id = a.punch_id JOIN hr_employees e ON e.id = p.person_id WHERE a.id = ?').get(Number(id)); if (!a) return null; return { fields: [{ label: 'Person', value: a.full_name }, { label: 'Day', value: a.work_date }, { label: 'Anomaly', value: ANOMALY_LABELS[a.anomaly_type] }, { label: 'Detail', value: a.detail ?? '—' }, { label: 'Reviewer\'s note', value: a.review_note ?? '—' }] }; },
  defaultDefinition: { name: 'Repeated outside-fence acceptance: supervisor or project manager, HR manager', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [step('WSUP', 'Supervisor or project manager', [{ kind: 'role', role: 'WSUP' }, { kind: 'role', role: 'PM' }]), step('HRMGR', 'HR manager', [{ kind: 'role', role: 'HRMGR' }])] },
  hooks: hooks('anomaly'),
});
evidenceProviders.register(ANOMALY_DOC, ({ db, instance }) => {
  const a = db.prepare('SELECT a.*, p.person_id, p.distance_m FROM att_anomalies a JOIN att_punches p ON p.id = a.punch_id WHERE a.id = ?').get(Number(instance.docId)); if (!a) return { sections: [] };
  const n = db.prepare("SELECT COUNT(*) AS n FROM att_anomalies x JOIN att_punches q ON q.id = x.punch_id WHERE x.anomaly_type = 'OUTSIDE_FENCE' AND x.status = 'ACCEPTED' AND q.person_id = ?").get(a.person_id).n;
  return { sections: [{ code: 'att-anomaly', title: 'Before approving', kind: 'metrics', items: [{ label: 'Distance outside the fence', value: a.distance_m == null ? '—' : `${Math.round(a.distance_m)} m`, format: 'text' }, { label: 'Earlier outside-fence punches accepted for this person', value: String(n), format: 'text', tone: n > 0 ? 'warn' : undefined }, { label: 'Reviewer', value: `${a.reviewed_by ?? '—'}: ${a.review_note ?? ''}`, format: 'text' }] }] };
});
objectTypes.register({
  type: 'att_punch', label: 'Attendance punch', permission: 'att.punch.view', route: () => '/att/today',
  access(db, actor, id) { const p = db.prepare('SELECT company_id, punch_site_id, project_id FROM att_punches WHERE id = ?').get(Number(id)); if (!p || p.company_id !== actor.companyId) return null; return authzOf(db).check(actor, 'att.punch.view', { companyId: p.company_id, projectId: p.project_id ?? undefined, siteId: p.punch_site_id }).allowed ? { companyId: p.company_id, projectId: p.project_id, siteId: p.punch_site_id } : null; },
  auditEntities: (id) => [{ entity: 'att_punches', id }],
  summary(db, actor, id) { const p = db.prepare('SELECT p.punch_type, p.result, p.work_date, e.full_name, p.company_id, p.punch_site_id, p.project_id FROM att_punches p JOIN hr_employees e ON e.id = p.person_id WHERE p.id = ?').get(Number(id)); if (!p || p.company_id !== actor.companyId || !authzOf(db).check(actor, 'att.punch.view', { companyId: p.company_id, projectId: p.project_id ?? undefined, siteId: p.punch_site_id }).allowed) return null; return { label: `${p.full_name} ${p.punch_type} ${p.work_date}`, status: p.result }; },
  search: () => [],
});
fileEntities.register({
  entity: 'att_punch', label: 'Attendance selfie or group photo',
  resolve(db, actor, id) {
    const p = db.prepare('SELECT company_id, punch_site_id, project_id, person_id FROM att_punches WHERE id = ? AND company_id = ?').get(Number(id), actor.companyId);
    if (!p) return null;
    const a = authzOf(db);
    const review = a.check(actor, 'att.anomaly.review', { companyId: p.company_id, projectId: p.project_id ?? undefined, siteId: p.punch_site_id }).allowed;
    return { companyId: p.company_id, projectId: p.project_id, siteId: p.punch_site_id, canView: review, canEdit: false, locked: true };
  },
});
void REASONS;
