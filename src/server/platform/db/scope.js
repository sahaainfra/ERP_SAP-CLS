import { ident } from './schema.js';
import { forbidden } from '../http/errors.js';

export const MAX_SCOPED_PAGE = 200;

/**
 * Company scope for a query (FR-06). Deny by default: an actor without a company gets no rows at all, never
 * "all companies". Returns an SQL condition and its bound parameter; every business query must include it.
 */
export function companyScope(actor, { column = 'company_id', alias = '' } = {}) {
  if (actor?.companyId == null) throw forbidden('Your account has no company scope, so no company data can be read. Ask an administrator to assign one.');
  const col = alias ? `${ident(alias)}.${ident(column)}` : ident(column);
  return { sql: `${col} = :_company_scope`, params: { _company_scope: actor.companyId } };
}

const live = 'is_active = 1 AND deleted_at IS NULL';

/** One row by id, inside the actor's company only. A row of another company is "not found", never "forbidden". */
export function findScoped(db, table, actor, id) {
  const scope = companyScope(actor);
  return db.prepare(`SELECT * FROM ${ident(table)} WHERE id = :_id AND ${scope.sql} AND ${live}`).get({ _id: id, ...scope.params });
}

/**
 * A bounded page of rows inside the actor's company. `where` is an SQL fragment written by the caller
 * (bound values go in `params`); the company condition and the soft-delete filter are always added.
 */
export function listScoped(db, table, actor, { where = '1 = 1', params = {}, orderBy = 'id', limit = 0, offset = 0 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SCOPED_PAGE) throw new RangeError(`A scoped list needs a limit between 1 and ${MAX_SCOPED_PAGE}`);
  const scope = companyScope(actor);
  const t = ident(table);
  const base = `${t} WHERE (${where}) AND ${scope.sql} AND ${live}`;
  const all = { ...params, ...scope.params };
  const total = db.prepare(`SELECT COUNT(*) AS n FROM ${base}`).get(all).n;
  const order = orderBy.split(',').map((p) => p.trim().split(/\s+/)).map(([col, dir]) => `${ident(col)}${dir?.toUpperCase() === 'DESC' ? ' DESC' : ''}`).join(', ');
  const rows = db.prepare(`SELECT * FROM ${base} ORDER BY ${order} LIMIT :_limit OFFSET :_offset`).all({ ...all, _limit: limit, _offset: offset });
  return { rows, total };
}
