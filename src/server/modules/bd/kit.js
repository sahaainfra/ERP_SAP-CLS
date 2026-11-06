import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { forbidden } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { createParameterStore } from '../../platform/parameters/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';

/** The small tools every service of the module shares: rights, parameters, document numbers, events and notifications. */
export function createKit(db) {
  const authz = authzOf(db); const notif = notificationsOf(db);
  const today = () => todayIST();
  const may = (actor, key) => authz.check(actor, key).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: today() });
  const nextDoc = (actor, docType, table, prefix) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType, actor: actor.user, refType: table }).number; } catch (e) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(e?.code)) throw e; }
    const n = db.prepare(`SELECT COUNT(DISTINCT doc_no) AS n FROM ${table} WHERE company_id = ?`).get(actor.companyId).n + 1;
    let no = `${prefix}-${String(n).padStart(5, '0')}`;
    for (let k = n + 1; db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(actor.companyId, no); k += 1) no = `${prefix}-${String(k).padStart(5, '0')}`;
    return no;
  };
  const event = (type, actor, entity, id, companyId, data) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, data });
  const tell = (companyId, to, templateCode, data, link, key) => to && notif.notify({ companyId, templateCode, recipients: [`user:${to}`], data, link, sourceType: 'bd', sourceId: key, eventKey: `${templateCode}:${key}` });
  const systemActor = (companyId) => ({ user: 'system', userId: null, companyId, roles: ['SYSADM'] });
  const userExists = (companyId, username) => Boolean(db.prepare('SELECT 1 FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(companyId, username));
  const holders = (companyId, roles) => db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => { try { return roles.some((r) => JSON.parse(u.roles_json ?? '[]').includes(r)); } catch { return false; } }).map((u) => u.username);
  return { authz, may, need, param, today, nextDoc, event, tell, systemActor, userExists, holders };
}
