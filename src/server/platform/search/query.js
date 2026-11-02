import { authzOf } from '../authz/index.js';
import { hasPermissionAnywhere } from '../auth/index.js';
import { codeKey, ftsPhrase, fuzzyHit, hasDevanagari, normalise, phoneticKey, transliterate, words } from '../../../shared/search/text.js';
import { searchEntities } from './registry.js';

const CAP = 500; // the most hits one query keeps per way of matching: a search is for finding, a list is for browsing
const MIN_FUZZY = 4;
const TIERS = { exact: 0, codePrefix: 1, titlePrefix: 2, text: 3, secret: 3, sound: 4, typo: 5 };

/** The tokens of a typed query: up to six words, each at most 60 characters. */
export const queryTokens = (qn) => qn.split(' ').filter(Boolean).slice(0, 6).map((t) => t.slice(0, 60));

/**
 * The query side of global search (FR-02, FR-04): the words typed are matched in six ways, strictest first (the whole document number, the
 * start of a number, the start of a title, the words anywhere, the sound of a name, a typing mistake), restricted in SQL to what the person's
 * rights and data scope reach, then every hit is read again from its record before it is shown (BR-01).
 */
export function createSearchService({ db }) {
  const authz = authzOf(db);

  /** The SQL condition limiting index rows to the records the actor's rights reach, one clause for each permission key they hold. */
  function visibility(actor) {
    const keys = searchEntities.permissionKeys().filter((k) => hasPermissionAnywhere(actor, k));
    const clauses = [];
    const params = {};
    keys.forEach((k, n) => {
      const sql = authz.scopeFilter(actor, k, { project: 'i.project_id', site: 'i.site_id', branch: 'i.branch_id', department: 'i.department_id', owner: 'i.owner_user_id' }, null).sql;
      if (sql === '1 = 0') return;
      params[`k${n}`] = k;
      clauses.push(`(i.permission_key = :k${n} AND ${sql})`);
    });
    return { sql: clauses.length ? `(${clauses.join(' OR ')})` : '1 = 0', params };
  }

  /** The sensitive fields this actor may search in: those whose mask rule shows them in full. */
  function secretFields(actor) {
    const out = new Set();
    for (const def of searchEntities.list()) {
      for (const f of def.secretFields ?? []) if (authz.maskRule(actor, f.entity, f.field) === 'show') out.add(`${f.entity}.${f.field}`);
    }
    return [...out];
  }

  function filtersOf(actor, p) {
    const vis = visibility(actor);
    const where = ['i.company_id = :company', vis.sql];
    /** @type {Record<string, any>} */
    const params = { company: actor.companyId, ...vis.params };
    const allowed = searchEntities.list().map((d) => d.type);
    const types = p.types?.length ? p.types.filter((t) => allowed.includes(t)) : allowed;
    types.forEach((t, n) => { params[`t${n}`] = t; });
    where.push(types.length ? `i.entity IN (${types.map((_, n) => `:t${n}`).join(', ')})` : '1 = 0');
    if (p.projectId) { where.push('i.project_id = :project'); params.project = p.projectId; }
    if (p.siteId) { where.push('i.site_id = :site'); params.site = p.siteId; }
    if (p.status?.length) { p.status.forEach((s, n) => { params[`s${n}`] = s; }); where.push(`i.record_status IN (${p.status.map((_, n) => `:s${n}`).join(', ')})`); }
    const day = "COALESCE(i.doc_date, substr(i.updated_at, 1, 10), substr(i.created_at, 1, 10))";
    if (p.from) { where.push(`${day} >= :from`); params.from = p.from; }
    if (p.to) { where.push(`${day} <= :to`); params.to = p.to; }
    return { where: where.join(' AND '), params, types };
  }

  const bump = (hits, rows, tier) => {
    for (const r of rows) {
      const old = hits.get(r.id);
      if (!old || tier < old.tier) hits.set(r.id, { row: r, tier, rank: r.rank ?? 0 });
    }
  };

  /** All matching index rows, best first: [{ row, tier, rank }]. */
  function match(actor, qn, p) {
    const f = filtersOf(actor, p);
    const hits = new Map();
    const tokens = queryTokens(qn);
    if (tokens.length === 0 || f.types.length === 0) return { hits: [], types: f.types };
    const dk = codeKey(qn);
    const run = (sql, extra = {}) => db.prepare(sql).all({ ...f.params, ...extra });
    const select = `SELECT i.* FROM core_search_index i WHERE ${f.where}`;

    if (dk.length >= 2) {
      bump(hits, run(`${select} AND i.code_key = :dk LIMIT ${CAP}`, { dk }), TIERS.exact);
      bump(hits, run(`${select} AND i.code_key >= :dk AND i.code_key < :dkHi ORDER BY i.code_key LIMIT ${CAP}`, { dk, dkHi: `${dk}￿` }), TIERS.codePrefix);
    }
    bump(hits, run(`${select} AND i.title_lc >= :tq AND i.title_lc < :tqHi ORDER BY i.title_lc LIMIT ${CAP}`, { tq: qn, tqHi: `${qn}￿` }), TIERS.titlePrefix);

    // the words anywhere (substring, so a partial code like 0123 or a piece of a name works)
    const long = tokens.filter((t) => t.length >= 3);
    const short = tokens.filter((t) => t.length < 3);
    const shortSql = short.map((_, n) => `(instr(i.title_lc, :sh${n}) > 0 OR instr(COALESCE(i.code_key, ''), :sh${n}) > 0 OR instr(lower(i.body), :sh${n}) > 0)`).join(' AND ');
    const shortParams = Object.fromEntries(short.map((t, n) => [`sh${n}`, t]));
    const ftsTerm = (t) => {
      const alt = hasDevanagari(t) ? normalise(transliterate(t)).replace(/[^a-z0-9]/g, '') : '';
      return alt.length >= 3 ? `(${ftsPhrase(t)} OR ${ftsPhrase(alt)})` : ftsPhrase(t);
    };
    const bm = 'bm25(core_search_fts, 10.0, 6.0, 3.0, 1.0, 0.5)';
    if (long.length) {
      const m = `{code title subtitle body} : (${long.map(ftsTerm).join(' AND ')})`;
      bump(hits, run(`SELECT i.*, ${bm} AS rank FROM core_search_fts JOIN core_search_index i ON i.id = core_search_fts.rowid WHERE core_search_fts MATCH :m AND ${f.where}${shortSql ? ` AND ${shortSql}` : ''} ORDER BY rank LIMIT ${CAP}`, { m, ...shortParams }), TIERS.text);
      // sensitive values: only in the fields this person may see in full
      const fields = secretFields(actor);
      if (fields.length) {
        const ps = Object.fromEntries(fields.map((k, n) => [`f${n}`, k]));
        bump(hits, run(`SELECT i.* FROM core_search_secret s JOIN core_search_index i ON i.id = s.index_id WHERE s.value MATCH :sm AND s.field_key IN (${fields.map((_, n) => `:f${n}`).join(', ')}) AND ${f.where} LIMIT ${CAP}`, { sm: long.map((t) => ftsPhrase(t)).join(' AND '), ...ps }), TIERS.secret);
      }
    } else if (shortSql) {
      bump(hits, run(`${select} AND ${shortSql} ORDER BY i.title_lc LIMIT ${CAP}`, shortParams), TIERS.text);
    }

    // the sound of a name (शर्मा, Sharma and Sarma are one)
    const keys = tokens.map(phoneticKey).filter((k) => k.length >= 3);
    if (keys.length === tokens.length && keys.length) {
      const m = `phon : (${keys.map(ftsPhrase).join(' AND ')})`;
      bump(hits, run(`SELECT i.*, ${bm} AS rank FROM core_search_fts JOIN core_search_index i ON i.id = core_search_fts.rowid WHERE core_search_fts MATCH :m AND ${f.where} ORDER BY rank LIMIT ${CAP}`, { m }), TIERS.sound);
    }

    // a typing mistake: records sharing letter groups with the longest word, kept when every word is close to a word of the record
    if (hits.size < 10 && tokens.some((t) => t.length >= MIN_FUZZY)) {
      const grams = new Set();
      for (const t of tokens.filter((x) => x.length >= MIN_FUZZY)) for (let n = 0; n + 3 <= t.length && grams.size < 24; n += 1) grams.add(t.slice(n, n + 3));
      const rows = run(`SELECT i.*, ${bm} AS rank FROM core_search_fts JOIN core_search_index i ON i.id = core_search_fts.rowid WHERE core_search_fts MATCH :m AND ${f.where} ORDER BY rank LIMIT 300`, { m: `{code title subtitle} : (${[...grams].map(ftsPhrase).join(' OR ')})` });
      const near = rows.filter((r) => {
        const text = words(`${r.title} ${r.subtitle ?? ''} ${r.code ?? ''}`);
        return tokens.every((t) => (t.length >= MIN_FUZZY ? fuzzyHit(t, text) || text.some((w) => w.startsWith(t)) : text.some((w) => w.includes(t))));
      });
      bump(hits, near, TIERS.typo);
    }
    return { hits: [...hits.values()], types: f.types };
  }

  return { match, visibility, secretFields, filtersOf };
}
