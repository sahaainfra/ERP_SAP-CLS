import { z } from 'zod';
import { assertPermission, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { transaction } from '../../platform/db/index.js';
import { badRequest, notFound } from '../../platform/http/errors.js';
import { createParameterStore } from '../../platform/parameters/index.js';
import { createSearchService } from '../../platform/search/query.js';
import { commandRegistry, searchEntities } from '../../platform/search/registry.js';
import { createSearchIndex } from '../../platform/search/index.js';
import { normalise } from '../../../shared/search/text.js';
import { todayIST } from '../../../shared/dates.js';
import { parse } from '../../platform/validation/index.js';
import { defineList } from '../../platform/list/index.js';

// Part 03.08: global search for the palette, the Advanced Search page and the administrator. The index and its rules live in platform/search;
// this is the service in front of them: ranking, grouping, the re-check of every hit against its record, the commands of the palette, the log of
// searches and the rebuild of the index.

// The Advanced Search page keeps its filters as saved views like any list; this declares the columns a view may filter on (the page reads no data
// through the list contract: its rows come from the search endpoint, which applies the person's rights and scope).
defineList({
  code: 'ui.search', label: 'Advanced Search', from: 'core_search_index i', defaultSort: '-docDate',
  columns: {
    entity: { sql: 'i.entity', type: 'enum', label: 'Type' }, title: { sql: 'i.title', type: 'text', label: 'Title' }, code: { sql: 'i.code', type: 'text', label: 'Number' },
    status: { sql: 'i.status', type: 'enum', label: 'Status' }, projectId: { sql: 'i.project_id', type: 'id', label: 'Project' }, siteId: { sql: 'i.site_id', type: 'id', label: 'Site' }, docDate: { sql: 'i.doc_date', type: 'date', label: 'Date' },
  },
});

export const REINDEX_JOB = 'ui.search_reindex';
export const RECONCILE_JOB = 'ui.search_reconcile';
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-04-01');
const csv = z.string().max(400).transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

export const parseSearch = (q) => parse(z.object({
  q: z.string().max(200).default(''),
  types: csv.optional(),
  status: csv.optional(),
  projectId: z.coerce.number().int().positive().optional(),
  siteId: z.coerce.number().int().positive().optional(),
  from: day.optional(),
  to: day.optional(),
  sort: z.enum(['relevance', 'updated', 'title']).default('relevance'),
  perGroup: z.coerce.number().int().min(1).max(20).optional(),
  page: z.coerce.number().int().min(1).max(100).optional(),
  pageSize: z.coerce.number().int().refine((n) => [10, 25, 50, 100].includes(n), 'Use 10, 25, 50 or 100').optional(),
  source: z.enum(['palette', 'page']).default('palette'),
  log: z.enum(['0', '1']).default('1'),
}).strict(), q ?? {});
export const parseClick = (b) => parse(z.object({ entity: z.string().regex(/^[a-z][a-z_]*$/).max(40), entityId: z.number().int().positive(), position: z.number().int().min(0).max(1000).default(0), q: z.string().max(200).default('') }).strict(), b);
export const parseCommands = (q) => parse(z.object({ route: z.string().max(300).regex(/^\/[A-Za-z0-9/_\-.]*$/).optional() }).strict(), q ?? {});
export const parseReindex = (b) => parse(z.object({ reason: z.string().trim().min(5, 'Say why in at least 5 characters').max(300) }).strict(), b ?? {});
export const parseEntityParam = (v) => parse(z.string().regex(/^(all|[a-z][a-z_]*)$/, 'Use a searchable type or all'), v);
export const parseAnalytics = (q) => parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).strict(), q ?? {});

const nowIso = () => new Date().toISOString();
const p95 = (arr) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.ceil(arr.length * 0.95) - 1)] : 0);
const p50 = (arr) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.floor((arr.length - 1) / 2)] : 0);

export function createSearchApi({ db, flags, runtime, index = createSearchIndex({ db }) }) {
  const engine = createSearchService({ db });
  const param = (actor, key) => Number(createParameterStore(db).get(key, { companyId: actor.companyId, date: todayIST() }));

  /** Ranking nudge: records the person marked or opened lately come first among equal matches. */
  function boosts(actor) {
    const m = new Map();
    for (const f of db.prepare("SELECT entity, entity_id FROM ui_favourites WHERE company_id = ? AND user_ref = ? AND kind = 'record' AND deleted_at IS NULL").all(actor.companyId, actor.user)) m.set(`${f.entity}:${f.entity_id}`, 2);
    for (const r of db.prepare('SELECT entity, entity_id FROM ui_recent_records WHERE company_id = ? AND user_ref = ? ORDER BY visited_at DESC LIMIT 30').all(actor.companyId, actor.user)) { const k = `${r.entity}:${r.entity_id}`; if (!m.has(k)) m.set(k, 1); }
    return m;
  }

  const projectCodes = (() => {
    const cache = new Map();
    return (id) => {
      if (!id) return null;
      if (!cache.has(id)) cache.set(id, db.prepare('SELECT code FROM org_projects WHERE id = ?').get(id)?.code ?? null);
      return cache.get(id);
    };
  })();

  /** Read the hit again from its record: gone or no longer allowed means it is not shown (BR-01). */
  function live(actor, hit) {
    const def = searchEntities.get(hit.row.entity);
    if (!def) return null;
    const doc = /** @type {any} */ (def.load(db, hit.row.entity_id));
    if (!doc || doc.companyId !== actor.companyId) return null;
    const ok = def.access(db, actor, hit.row.entity_id);
    if (!ok) return null;
    return {
      id: `${def.type}:${hit.row.entity_id}`, entity: def.type, entityId: hit.row.entity_id, title: doc.title, subtitle: doc.subtitle ?? null, code: doc.code ?? null,
      status: doc.status ?? null, route: doc.route ?? def.route(hit.row.entity_id), projectCode: projectCodes(doc.projectId), match: ['exact', 'code', 'title', 'text', 'sound', 'typo'][hit.tier],
    };
  }

  function search(actor, p) {
    const started = process.hrtime.bigint();
    const qn = normalise(p.q);
    const types = searchEntities.list();
    const typeInfo = (t) => types.find((d) => d.type === t);
    const minLen = param(actor, 'ui.search.min_query_length');
    let hits = [];
    if (qn.length >= 1) {
      const out = engine.match(actor, qn, { projectId: p.projectId, siteId: p.siteId, status: p.status, from: p.from, to: p.to });
      hits = out.hits;
    }
    if (qn.length < minLen && qn.length > 0 && !/\d/.test(qn)) hits = hits.filter((h) => h.tier <= 2); // one letter: starts of titles and codes only
    const boost = boosts(actor);
    const order = { relevance: (a, b) => a.tier - b.tier || (boost.get(`${b.row.entity}:${b.row.entity_id}`) ?? 0) - (boost.get(`${a.row.entity}:${a.row.entity_id}`) ?? 0) || a.rank - b.rank || a.row.title_lc.localeCompare(b.row.title_lc),
      updated: (a, b) => String(b.row.doc_date ?? b.row.updated_at ?? b.row.created_at).localeCompare(String(a.row.doc_date ?? a.row.updated_at ?? a.row.created_at)),
      title: (a, b) => a.row.title_lc.localeCompare(b.row.title_lc) }[p.sort];
    hits.sort(order);
    const counts = {};
    for (const h of hits) counts[h.row.entity] = (counts[h.row.entity] ?? 0) + 1;
    const chosen = p.types?.length ? hits.filter((h) => p.types.includes(h.row.entity)) : hits;

    let result;
    if (p.page) {
      const size = p.pageSize ?? 25;
      const slice = chosen.slice((p.page - 1) * size, p.page * size);
      const items = slice.map((h) => live(actor, h)).filter(Boolean);
      result = { mode: 'page', total: chosen.length, page: p.page, pageSize: size, capped: chosen.length >= 500, items };
    } else {
      const per = p.perGroup ?? param(actor, 'ui.search.results_per_group');
      const byType = new Map();
      for (const h of chosen) { if (!byType.has(h.row.entity)) byType.set(h.row.entity, []); byType.get(h.row.entity).push(h); }
      const groups = [];
      for (const [t, list] of byType) {
        const items = [];
        for (const h of list) { if (items.length >= per) break; const it = live(actor, h); if (it) items.push(it); }
        if (!items.length) continue;
        const d = typeInfo(t);
        groups.push({ type: t, label: d.label, labelHi: d.labelHi ?? null, icon: d.icon, total: list.length, items, best: list[0].tier });
      }
      groups.sort((a, b) => a.best - b.best || types.findIndex((d) => d.type === a.type) - types.findIndex((d) => d.type === b.type));
      result = { mode: 'grouped', total: chosen.length, groups: groups.map((g) => ({ ...g, best: undefined })) };
    }
    const tookMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    if (p.log === '1' && qn.length >= 2) logQuery(actor, { q: p.q, qn, source: p.source, types: p.types, count: result.total, tookMs, project: p.projectId, site: p.siteId });
    return { query: p.q, took: tookMs, counts, ...result };
  }

  /** Keep the search in the log; a word typed letter by letter is one search (the previous row is extended, not repeated). */
  function logQuery(actor, { q, qn, source, types, count, tookMs, project, site }) {
    const prev = db.prepare('SELECT id, q_norm, created_at, clicked_entity FROM core_search_queries WHERE company_id = ? AND user_ref = ? ORDER BY id DESC LIMIT 1').get(actor.companyId, actor.user);
    const typed = prev && !prev.clicked_entity && Date.now() - Date.parse(prev.created_at) < 4000 && (qn.startsWith(prev.q_norm) || prev.q_norm.startsWith(qn));
    if (typed) {
      db.prepare('UPDATE core_search_queries SET q = ?, q_norm = ?, result_count = ?, took_ms = ?, types = ?, source = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(q.slice(0, 200), qn.slice(0, 200), count, tookMs, types?.join(',') ?? null, source, nowIso(), prev.id);
      return;
    }
    db.prepare("INSERT INTO core_search_queries (company_id, user_ref, q, q_norm, source, types, result_count, took_ms, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'search')")
      .run(actor.companyId, actor.user, q.slice(0, 200), qn.slice(0, 200), source, types?.join(',') ?? null, count, tookMs, project ?? null, site ?? null, actor.user);
  }

  /** What the person opened from the results: the last search is marked with it, and the record joins their recent records. */
  function click(actor, body, shell) {
    const def = searchEntities.get(body.entity);
    if (!def || !def.access(db, actor, body.entityId)) throw notFound('That record does not exist or is not open to you.');
    const last = db.prepare('SELECT id FROM core_search_queries WHERE company_id = ? AND user_ref = ? AND clicked_entity IS NULL AND created_at > ? ORDER BY id DESC LIMIT 1').get(actor.companyId, actor.user, new Date(Date.now() - 120_000).toISOString());
    if (last) db.prepare('UPDATE core_search_queries SET clicked_entity = ?, clicked_id = ?, clicked_pos = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(body.entity, body.entityId, body.position, nowIso(), last.id);
    const doc = /** @type {any} */ (def.load(db, body.entityId));
    shell?.visit(actor, { entity: body.entity, entityId: body.entityId, title: doc?.title ?? `${def.label} ${body.entityId}`, route: doc?.route ?? def.route(body.entityId) });
    return { entity: body.entity, entityId: body.entityId };
  }

  /** The searchable types the person can use, with the filters each offers (the Advanced Search page). */
  function typesFor(actor) {
    return searchEntities.list().filter((d) => hasPermissionAnywhere(actor, typeof d.permission === 'string' ? d.permission : (d.permissionKeys?.()[0] ?? ''))).map((d) => ({
      type: d.type, label: d.label, labelHi: d.labelHi ?? null, icon: d.icon, statuses: d.statuses, dateLabel: d.dateLabel, scoped: d.scoped !== false,
    }));
  }

  /** The commands the person may run, with the ones that belong to the page they are on first. @param {any} actor @param {{ route?: string }} [query] */
  function commands(actor, { route } = {}) {
    const on = flags.evaluate(actor, { keys: [...new Set(commandRegistry.list().map((c) => c.flag).filter(Boolean))] });
    return commandRegistry.list()
      .filter((c) => (c.permission === 'self' || hasPermissionAnywhere(actor, c.permission)) && (!c.flag || on[c.flag] === true))
      .map((c) => ({ code: c.code, label: c.label, labelHi: c.labelHi ?? null, keywords: c.keywords, icon: c.icon, group: c.group, route: c.route ?? null, clientAction: c.clientAction ?? null, requiresContext: c.requiresContext, here: Boolean(route && c.contexts.some((x) => route === x || route.startsWith(`${x}/`))) }))
      .sort((a, b) => Number(b.here) - Number(a.here) || a.label.localeCompare(b.label));
  }

  // ---- administration ----
  const mustReindex = (actor) => assertPermission(actor, 'ui.search.reindex');
  const mustSee = (actor) => assertPermission(actor, 'ui.search.analytics');

  function status(actor) {
    if (!hasPermissionAnywhere(actor, 'ui.search.reindex')) mustSee(actor);
    const jobs = db.prepare("SELECT * FROM core_jobs WHERE type IN (?, ?) ORDER BY id DESC LIMIT 10").all(REINDEX_JOB, RECONCILE_JOB).map((r) => runtime.jobs.present(r));
    return { types: index.status(actor.companyId), jobs: jobs.map((j) => ({ id: j.jobId, type: j.type, status: j.status, progress: j.progress, message: j.progressMessage, params: j.params, result: j.result, error: j.error, createdBy: j.createdBy, createdAt: j.createdAt, finishedAt: j.finishedAt })), canReindex: hasPermissionAnywhere(actor, 'ui.search.reindex') };
  }

  /** Ask for the index of one type (or all) to be rebuilt: a background job with progress; audited with the reason (BR-02). */
  function requestReindex(actor, entity, { reason }) {
    mustReindex(actor);
    const targets = entity === 'all' ? searchEntities.list().map((d) => d.type) : [entity];
    if (entity !== 'all' && !searchEntities.get(entity)) throw notFound(`There is no searchable type ${entity}.`);
    const running = db.prepare("SELECT params_json FROM core_jobs WHERE type = ? AND status IN ('QUEUED', 'RUNNING')").all(REINDEX_JOB).some((j) => JSON.parse(j.params_json).types?.some((t) => targets.includes(t)));
    if (running) throw badRequest('A rebuild of this index is already queued or running.', [{ field: 'entity', message: 'is already being rebuilt' }]);
    return transaction(db, () => {
      const job = runtime.jobs.enqueue(REINDEX_JOB, { types: targets, reason, requestedBy: actor.user }, { createdBy: actor.user, companyId: actor.companyId });
      writeAudit(db, { entity: 'core_search_index', entityId: entity, action: 'reindex_requested', newValues: { types: targets }, reason, actor: actor.user, companyId: actor.companyId });
      publishEvent(db, { type: 'ui.search.reindex_requested', entity: 'search_index', entityId: entity, actorId: actor.user, companyId: actor.companyId, data: { types: targets } });
      return { entity, types: targets, jobId: job.jobId };
    });
  }

  /** The job body: rebuild each type, then audit and announce the result. */
  function runReindex(ctx) {
    const { types, requestedBy, reason } = ctx.params;
    const out = [];
    types.forEach((t, n) => {
      const r = index.reindex(t, { onProgress: (pc, msg) => ctx.setProgress(Math.round(((n + pc / 100) / types.length) * 100), msg), isCancelled: () => ctx.isCancelled() });
      out.push(r);
      ctx.log(`${t}: ${r.indexed} indexed, ${r.unchanged} unchanged, ${r.removed} removed`);
    });
    const company = db.prepare('SELECT company_id FROM core_jobs WHERE job_id = ?').get(ctx.jobId)?.company_id ?? null;
    transaction(db, () => {
      writeAudit(db, { entity: 'core_search_index', entityId: types.length === 1 ? types[0] : 'all', action: 'reindexed', newValues: { results: out }, reason, actor: requestedBy ?? 'system', companyId: company });
      publishEvent(db, { type: 'ui.search.reindexed', entity: 'search_index', entityId: types.length === 1 ? types[0] : 'all', actorId: requestedBy ?? 'system', companyId: company, data: { types } });
    });
    return { results: out };
  }

  function analytics(actor, { days }) {
    mustSee(actor);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = db.prepare('SELECT q_norm, result_count, took_ms, clicked_entity, user_ref FROM core_search_queries WHERE company_id = ? AND created_at >= ?').all(actor.companyId, since);
    const agg = (list) => {
      const m = new Map();
      for (const r of list) { const e = m.get(r.q_norm) ?? { q: r.q_norm, searches: 0, people: new Set(), results: 0, clicks: 0 }; e.searches += 1; e.people.add(r.user_ref); e.results += r.result_count; if (r.clicked_entity) e.clicks += 1; m.set(r.q_norm, e); }
      return [...m.values()].map((e) => ({ q: e.q, searches: e.searches, people: e.people.size, avgResults: Math.round((e.results / e.searches) * 10) / 10, clicks: e.clicks })).sort((a, b) => b.searches - a.searches || a.q.localeCompare(b.q)).slice(0, 20);
    };
    const zero = rows.filter((r) => r.result_count === 0);
    const took = rows.map((r) => r.took_ms);
    return {
      days, searches: rows.length, noResult: zero.length, noResultRate: rows.length ? Math.round((zero.length / rows.length) * 1000) / 10 : 0,
      withClick: rows.filter((r) => r.clicked_entity).length, p50Ms: p50(took), p95Ms: p95(took), top: agg(rows), noResultTop: agg(zero),
    };
  }

  return { search, click, typesFor, commands, status, requestReindex, runReindex, analytics, index };
}
