import { authzOf } from '../../platform/authz/index.js';
import { hasPermissionAnywhere } from '../../platform/auth/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { todayIST } from '../../../shared/dates.js';
import { siteOf } from '../site/index.js';

// Part 166.3, FR-01: what waits for a site person today, counted from the records themselves, for the Field Home's task cards. Each count is shown
// only to a person who holds its permission somewhere and is limited to the projects and sites that permission covers (the same data scope as the
// list it opens), so a card never shows a figure the list behind it would not. Nothing is stored.

const has = (db, table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));

/**
 * @param {{ db: any, approvals: any }} deps the approval engine of part 03 (requests waiting for the person)
 */
export function createFieldToday({ db, approvals }) {
  const authz = authzOf(db);
  const scoped = (actor, key, alias, project = 'org_project_id', site = 'org_site_id') => `${alias}.company_id = :c AND ${authz.scopeFilter(actor, key, { project: `${alias}.${project}`, site: `${alias}.${site}` }).sql}`;
  const count = (sql, params) => db.prepare(sql).get(params).n;

  /** [code, permission, route, count(actor)]: the order is the order of the cards. */
  /** @type {Array<[string, string, string, (actor: any) => number | null]>} */
  const SOURCES = [
    ['approvals', 'self', '/field/approvals', (actor) => {
      const wf = widgetRegistry.get('workflow.inbox');
      let n = 0;
      try { n += Number(wf?.({ db, actor, filters: {}, params: {} })?.value ?? 0); } catch { /* the workflow engine is switched off for this company */ }
      try { n += Number(approvals.awaitingCount(actor) ?? 0); } catch { /* the request engine is switched off */ }
      return n;
    }],
    ['dpr', 'site.dpr.create', '/site/dpr-entry', (actor) => {
      const svc = siteOf(db);
      if (!svc) return null;
      const sites = svc.dpr.dprs.sites(actor).filter((s) => s.canCreate);
      if (!sites.length) return 0;
      const sent = new Set(db.prepare("SELECT dpr_site_id AS s FROM site_dprs WHERE company_id = ? AND dpr_date = ? AND status IN ('SUBMITTED', 'APPROVED') AND deleted_at IS NULL").all(actor.companyId, todayIST()).map((r) => r.s));
      return sites.filter((s) => !sent.has(s.id)).length;
    }],
    ['dprDraft', 'site.dpr.create', '/site/dprs', (actor) => (has(db, 'site_dprs')
      ? count("SELECT COUNT(*) AS n FROM site_dprs WHERE company_id = :c AND created_by = :u AND status IN ('DRAFT', 'RETURNED') AND deleted_at IS NULL", { c: actor.companyId, u: actor.user }) : null)],
    ['inspections', 'qa.inspection_request.view', '/qa/inspection-requests', (actor) => (has(db, 'qa_inspection_requests')
      ? count(`SELECT COUNT(*) AS n FROM qa_inspection_requests x WHERE ${scoped(actor, 'qa.inspection_request.view', 'x')} AND x.status = 'SUBMITTED' AND x.deleted_at IS NULL`, { c: actor.companyId }) : null)],
    ['ncrs', 'qa.ncr.view', '/qa/ncrs', (actor) => (has(db, 'qa_ncrs')
      ? count(`SELECT COUNT(*) AS n FROM qa_ncrs x WHERE ${scoped(actor, 'qa.ncr.view', 'x')} AND x.status IN ('OPEN', 'RECTIFIED') AND x.deleted_at IS NULL`, { c: actor.companyId }) : null)],
    ['observations', 'hse.observation.view', '/hse/observations', (actor) => (has(db, 'hse_observations')
      ? count(`SELECT COUNT(*) AS n FROM hse_observations x WHERE ${scoped(actor, 'hse.observation.view', 'x')} AND x.obs_status = 'OPEN' AND x.deleted_at IS NULL`, { c: actor.companyId }) : null)],
    ['permits', 'hse.permit.approve', '/hse/permit-approvals', (actor) => (has(db, 'hse_permits')
      ? count(`SELECT COUNT(*) AS n FROM hse_permits x WHERE ${scoped(actor, 'hse.permit.approve', 'x')} AND x.status = 'SUBMITTED' AND x.deleted_at IS NULL`, { c: actor.companyId }) : null)],
    ['gate', 'inv.grn.create', '/inv/grn-new', (actor) => (has(db, 'inv_gate_inward') && has(db, 'inv_grns')
      ? count(`SELECT COUNT(*) AS n FROM inv_gate_inward x WHERE ${scoped(actor, 'inv.grn.create', 'x')} AND x.status = 'HANDED_OVER' AND x.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM inv_grns g WHERE g.gate_inward_id = x.id AND g.status NOT IN ('CANCELLED', 'REJECTED') AND g.deleted_at IS NULL)`, { c: actor.companyId }) : null)],
  ];

  /** The task cards of the person: { date, cards: [{ code, count, route }] }; a card the person may not see, or whose module is off, is left out. */
  function today(actor) {
    const cards = [];
    for (const [code, permission, route, fn] of SOURCES) {
      if (permission !== 'self' && !hasPermissionAnywhere(actor, permission)) continue;
      let n;
      try { n = fn(actor); } catch { n = null; } // a module that is switched off or not migrated for this company: no card, never a wrong figure
      if (n === null || n === undefined) continue;
      cards.push({ code, count: n, route });
    }
    return { date: todayIST(), cards };
  }

  return { today, SOURCES: SOURCES.map(([code, permission, route]) => ({ code, permission, route })) };
}
