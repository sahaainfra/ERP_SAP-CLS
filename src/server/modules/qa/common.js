import { publishEvent } from '../../platform/events/index.js';
import { forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { rid } from '../proc/base.js';

/** Helpers every service of the quality module needs: the event publisher, the permission gate, the scope filter, project lookup and the file check. */
export function qaHelpers({ db, base }) {
  const { authz, may } = base;
  const evt = (type, actor, companyId, entity, entityId, data, projectId) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, projectId: projectId ?? undefined, data });
  const holds = (actor, key) => authz.hasAnywhere(actor, key);
  const gate = (actor, key, what) => { if (!holds(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const scopeOf = (actor, key, alias = 'x', pcol = 'org_project_id', scol = 'org_site_id') => { gate(actor, key, 'see this'); const f = authz.scopeFilter(actor, key, { project: `${alias}.${pcol}`, site: `${alias}.${scol}` }); return `${alias}.company_id = :c AND ${f.sql}`; };
  const pcode = (id) => (id ? (db.prepare('SELECT code FROM org_projects WHERE id = ?').get(id)?.code ?? '') : null);
  const projectOk = (actor, id, key) => { const p = db.prepare('SELECT id, company_id FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(rid(id ?? 0)); if (!p || p.company_id !== actor.companyId || !may(actor, key, p.id)) throw notFound('That project does not exist.'); return p; };
  const fileOk = (actor, fileId, entity, entityId) => { const f = db.prepare('SELECT id FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = ? AND linked_id = ? AND deleted_at IS NULL').get(rid(fileId), actor.companyId, entity, entityId); if (!f) throw unprocessable('That file is not attached to this record. Upload it to the record first.'); return f; };
  return { evt, holds, gate, scopeOf, pcode, projectOk, fileOk };
}
