import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { transaction } from '../../platform/db/index.js';
import { badRequest, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { explainOf } from '../bi/explain.js';
import { leakageOf } from '../bi/leakage.js';
import { readDomainMetric } from '../bi/domain-metrics.js';
import { readProjectStatusDataset } from '../bi/project-status-dataset.js';
import { towerOf } from '../bi/control-tower.js';
import { enggOf } from '../engg/drawings.js';
import { parseLetterCreate, parseRfiCreate } from '../engg/validators.js';
import { invOf } from '../inv/index.js';
import { procOf } from '../proc/index.js';
import { aiFeatures, aiOf, requireAi } from './gateway.js';

/**
 * Part 28.02 — the AI assistant and the role copilots, on the gateway of 28.01 (every call is a registered feature: enablement, quotas, kill
 * switch, log). BR-01: an answer is built only from data retrieved for the person through the owners' services; when that data holds no answer
 * the assistant says so without asking a model; nothing is done without the person's confirmation — a draft becomes a DRAFT record of its module
 * only when the person saves it.
 *   ask       a question in plain words is turned by a deterministic parser into a governed query (shown with the answer): a certified metric of
 *             a project (27.03), the project status dataset (27.02), the stock balances (16.01), or the Why? of a project (27.08)
 *   copilots  PM (health, alerts, schedule variance), QS (billing findings and the margin bridge), procurement (a vendor's orders and findings),
 *             finance (cost and margin variance)
 *   drafts    letters, RFIs, RFQs, minutes, DPR narratives and MIS commentary; RFIs and letters are saved as DRAFT records of 06.x
 */

const contexts = new WeakMap();
export const bindAssistant = (db, context) => contexts.set(db, context);
const ctxOf = (db) => contexts.get(db);
const refused = (message) => { const e = notFound(message); return e; };
const lower = (s) => String(s ?? '').toLowerCase();

const QUERY = { METRIC: 'metric(<code>).project(<project>)', VARIANCE: 'why(<kpi>).project(<project>)', STOCK: 'stock(item, place)', PROJECT_STATUS: 'dataset(project-status)' };
/** @type {Array<[string, string[]]>} */
const METRICS = [
  ['spi', ['spi', 'schedule performance']], ['cpi', ['cpi', 'cost performance']], ['eac', ['eac', 'estimate at completion', 'forecast cost']], ['gross-margin', ['margin']],
  ['revenue-to-date', ['revenue']], ['dso', ['dso', 'receivable days', 'days sales']], ['stock-turns', ['stock turns', 'inventory turns']], ['ltifr', ['ltifr', 'lost-time', 'injury rate']],
];
/** The intent of a question (deterministic; the generated query is shown to the person). */
export function parseQuestion(question, projectCodes = []) {
  const q = lower(question).replace(/[?!.]+$/, '').trim();
  const lead = (t) => t.replace(/^(?:what(?:'s| is| are)|show(?: me)?|tell me|give me|is there|do we have|how much)\s+(?:the\s+|our\s+)?/, '');
  const project = projectCodes.find((c) => new RegExp(`(^|[^a-z0-9])${c.toLowerCase().replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}([^a-z0-9]|$)`).test(q)) ?? null;
  if (/\b(why|overrun|over budget|variance|explain)\b/.test(q)) return { intent: 'VARIANCE', project, kpi: /schedule|delay|late/.test(q) ? 'schedule' : /margin/.test(q) ? 'margin' : 'cost' };
  if (/\bstock\b|\bon hand\b|\bhow much\b.*\b(left|available)\b/.test(q)) {
    const m = /(?:stock of|how much)\s+([a-z0-9][a-z0-9 .-]*?)(?:\s+(?:stock|is|are|left|available|remaining|do we have))*(?:\s+(?:at|in)\s+(.+))?$/.exec(q) ?? /(?:the\s+)?([a-z0-9][a-z0-9 .-]*?)\s+stock(?:\s+(?:at|in)\s+(.+))?$/.exec(q);
    return { intent: 'STOCK', item: m?.[1] ? lead(m[1]).replace(/^(the|our)\s+/, '').trim() || null : null, place: m?.[2]?.trim() || null };
  }
  const metric = METRICS.find(([, words]) => words.some((w) => q.includes(w)));
  if (metric) return { intent: 'METRIC', metric: metric[0], project };
  if (/\b(projects?|portfolio)\b.*\b(status|health|state|stage|list)\b|\b(status|health) of (the |all )?projects\b/.test(q)) return { intent: 'PROJECT_STATUS' };
  return { intent: 'UNKNOWN', project };
}

/** The projects a person may see through any of the permissions given (each checked by the permission engine with its scope). */
const projectsInScope = (db, actor, keys = ['proj.project.view']) => {
  const seen = new Map();
  for (const k of keys) {
    const f = authzOf(db).scopeFilter(actor, k, { project: 'p.id' });
    for (const p of db.prepare(`SELECT p.id, p.code, p.name FROM org_projects p WHERE p.company_id = :c AND p.deleted_at IS NULL AND (${f.sql})`).all({ ...(f.params ?? {}), c: actor.companyId })) seen.set(p.id, p);
  }
  return [...seen.values()].sort((a, b) => b.code.length - a.code.length);
};

aiFeatures.register({
  code: 'ai.assistant',
  label: 'Assistant: questions over ERP data',
  description: 'Answers questions in plain words from governed queries run as the person (metrics, project status, stock, variance), citing the records.',
  promptVersion: 'assistant/1',
  system: 'You are the ERP assistant of an Indian construction company. Answer only from the data given, cite the records by their names, give figures with their units, and say plainly when the data does not answer the question.',
  prompt: (input, data) => `Question: ${String(input.question ?? '').slice(0, 500)}\nAnswer in two to four sentences from the data of the query "${data?.facts?.query ?? ''}".`,
  projectOf: (input) => Number(input.projectId) || null,
  tools: [{ name: 'read_metric', mode: 'READ', permission: 'bi.metric.catalogue.view', description: 'A certified metric of a project (27.03).' },
    { name: 'read_project_status', mode: 'READ', permission: 'proj.project.view', description: 'The project status dataset (27.02).' },
    { name: 'read_stock', mode: 'READ', permission: 'inv.stock.view', description: 'Stock balances of the stores the person may see (16.01).' },
    { name: 'read_variance', mode: 'READ', permission: 'bi.explain.view', description: 'The Why? decomposition of a project (27.08).' }],
  async context(db, actor, input) {
    const context = ctxOf(db);
    const projects = projectsInScope(db, actor);
    const p = parseQuestion(input.question, projects.map((x) => x.code));
    const projectId = p.project ? projects.find((x) => x.code.toLowerCase() === p.project.toLowerCase())?.id : Number(input.projectId) || null;
    // a project code that the person cannot see is refused, never looked up (T-01)
    const named = /\b([A-Z]{2,6}-\d{1,4})\b/.exec(String(input.question ?? ''))?.[1];
    if (named && !projects.some((x) => x.code.toUpperCase() === named.toUpperCase())) throw refused(`${named} is not a project you may see.`);
    if (input.projectId && !projects.some((x) => x.id === Number(input.projectId))) throw refused('That project is not in your scope.');
    const label = (id) => projects.find((x) => x.id === id);
    // a governed query the owner refuses to the person's role is answered honestly, without data and without a model (BR-01)
    try { return await governed(); } catch (e) {
      if (e.status === 403) return { noAnswer: `Your role may not see the data this question needs (${p.intent.toLowerCase().replace('_', ' ')} query: ${QUERY[p.intent] ?? 'none'}). ${e.message}`, meta: { intent: p.intent, query: QUERY[p.intent] ?? null }, refs: [] };
      throw e;
    }
    async function governed() {
    if (p.intent === 'METRIC') {
      if (!projectId) return { noAnswer: 'Name the project (its code) or open the question from the project.', meta: { intent: p.intent, query: `metric(${p.metric})` }, refs: [] };
      const m = readDomainMetric(context, actor, p.metric, { projectId, includeHistory: false });
      const pr = label(projectId);
      if (!m.live) return { noAnswer: `There is no ${m.name ?? p.metric} value for ${pr.code} yet.`, meta: { intent: p.intent, query: `metric(${p.metric}).project(${pr.code})` }, refs: [] };
      return { meta: { intent: p.intent, query: `metric(${p.metric}).project(${pr.code})`, certified: m.certified },
        refs: [{ type: 'bi.metric', id: `${p.metric}:${projectId}`, label: `${m.name} — ${pr.code}`, route: `/bi/metrics?code=${p.metric}&projectId=${projectId}` }],
        data: { facts: { query: `metric(${p.metric}).project(${pr.code})`, metric: m.name, project: `${pr.code} ${pr.name}`, value: m.live.value, unit: m.unit ?? null, certified: m.certified, formula: m.formula ?? null } } };
    }
    if (p.intent === 'VARIANCE') {
      if (!projectId) return { noAnswer: 'Name the project (its code) to explain its variance.', meta: { intent: p.intent, query: `why(${p.kpi})` }, refs: [] };
      const w = explainOf(db).why(actor, { projectId, kpi: p.kpi });
      const top = [...w.components].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 5);
      return { meta: { intent: p.intent, query: `why(${p.kpi}).project(${label(projectId).code})` }, refs: [{ type: 'bi.explain', id: `${projectId}:${p.kpi}`, label: `${w.project} — ${w.label}`, route: `/bi/explain?projectId=${projectId}&kpi=${p.kpi}` }],
        data: { facts: { query: `why(${p.kpi}).project(${label(projectId).code})`, figure: w.label, total: w.total, residual: w.residual, largest: top.map((c) => `${c.label}: ₹${c.amount}`) } } };
    }
    if (p.intent === 'STOCK') {
      if (!p.item) return { noAnswer: 'Say which material, for example "cement stock at Site A".', meta: { intent: p.intent, query: 'stock(?)' }, refs: [] };
      const inv = invOf(db); if (!inv?.balances) throw refused('The stock module is not installed.');
      const rows = inv.balances.list(actor, { q: p.item, page: 1, pageSize: 100 }).data ?? [];
      const here = p.place ? rows.filter((r) => lower(`${r.store} ${r.storeName ?? ''} ${r.site ?? ''} ${r.project ?? ''}`).includes(lower(p.place).replace(/^site\s+/, ''))) : rows;
      const query = `stock(item~"${p.item}"${p.place ? `, place~"${p.place}"` : ''})`;
      if (!here.length) return { noAnswer: `I found no ${p.item} in the stores you may see${p.place ? ` at ${p.place}` : ''}.`, meta: { intent: p.intent, query }, refs: [] };
      const total = here.reduce((n, r) => n + Number(r.onHand ?? 0), 0);
      return { meta: { intent: p.intent, query }, refs: here.slice(0, 10).map((r) => ({ type: 'inv.balance', id: String(r.id), label: `${r.itemCode} ${r.item} — ${r.store}`, route: `/inv/stock?storeId=${r.storeId ?? ''}` })),
        data: { facts: { query, item: here[0].item, total: `${total} ${here[0].uom ?? ''}`.trim(), stores: here.slice(0, 10).map((r) => `${r.store}: ${r.onHand} ${r.uom ?? ''}`) } } };
    }
    if (p.intent === 'PROJECT_STATUS') {
      const d = readProjectStatusDataset(context, actor, { fields: ['code', 'name', 'stateLabel', 'statusLabel', 'health'] });
      const rows = (d.data ?? []).slice(0, 15);
      return { meta: { intent: p.intent, query: 'dataset(project-status).fields(code,name,state,status,health)' }, refs: rows.map((r) => ({ type: 'proj.project', id: String(r.code), label: `${r.code} ${r.name}`, route: '/bi/reports' })),
        data: { facts: { query: 'dataset(project-status)', projects: rows.map((r) => `${r.code}: ${r.stateLabel ?? ''} / ${r.statusLabel ?? ''} / ${r.health ?? ''}`) } } };
    }
    return { noAnswer: 'I can answer questions about project metrics (SPI, CPI, EAC, margin, revenue, DSO, LTIFR), project status, stock of a material, and why a project\'s cost, schedule or margin moved. I could not match your question to those.', meta: { intent: 'UNKNOWN', query: null }, refs: [] };
    }
  },
  evaluation: [
    { name: 'answers from the governed project status dataset and names the query', input: { question: 'What is the status of the projects?' }, expect: { contains: ['project-status'] } },
    { name: 'says it cannot answer an unrelated question', input: { question: 'Who will win the cricket match?' }, expect: { contains: ['could not match'] } },
    { name: 'refuses a project the person may not see', input: { question: 'Why is ZZ-999 over budget?' }, expect: { refused: 404 } },
  ],
});

const copilot = (code, label, description, build, evalInput) => aiFeatures.register({
  code, label, description, promptVersion: `${code.split('.')[1]}/1`,
  system: 'You are a copilot for a construction company manager. From the data given only, list the three most important points with figures, then one suggested next step. Never claim to have done anything.',
  prompt: () => 'Give the three most important points and one suggested next step.',
  projectOf: (input) => Number(input.projectId) || null,
  tools: [{ name: 'read_context', mode: 'READ', permission: 'self', description: 'Reads the figures named in the description as the person.' }],
  context: build,
  evaluation: [{ name: 'summarises the figures given', input: evalInput, expect: { contains: ['summary'] } }, { name: 'refuses a project that does not exist', input: { projectId: 999999999, vendor: 'x' }, expect: { refused: 404 } }],
});
const needProject = (db, actor, input, keys) => { const p = projectsInScope(db, actor, keys).find((x) => x.id === Number(input.projectId)); if (!p) throw refused('That project is not in your scope.'); return p; };
copilot('ai.copilot_pm', 'PM copilot: risks and delays', 'The health of the project, its open executive alerts and the activities driving its schedule variance.', async (db, actor, input) => {
  const p = needProject(db, actor, input);
  const facts = { project: `${p.code} ${p.name}` }; const refs = [];
  try { const t = towerOf(db)?.project(actor, p.id); if (t) { facts.health = t.health; facts.alerts = (t.alerts ?? []).slice(0, 5).map((a) => `${a.alertNo}: ${a.message}`); refs.push({ type: 'bi.tower', id: String(p.id), label: `${p.code} control tower`, route: `/bi/control-tower?tab=matrix&projectId=${p.id}` }); } } catch (e) { if (![403, 404].includes(e.status)) throw e; }
  try { const s = explainOf(db)?.why(actor, { projectId: p.id, kpi: 'schedule' }); if (s) { facts.scheduleVariance = s.total; facts.lateActivities = s.components.slice(0, 5).map((c) => `${c.label}: ₹${c.amount}`); refs.push({ type: 'bi.explain', id: `${p.id}:schedule`, label: `${p.code} schedule variance`, route: `/bi/explain?projectId=${p.id}&kpi=schedule` }); } } catch (e) { if (![403, 404].includes(e.status)) throw e; }
  if (refs.length === 0) return { noAnswer: 'You may not see the control tower or the schedule variance of this project.', refs: [] };
  return { refs, data: { facts } };
}, (db, actor) => ({ projectId: firstProject(db, actor) }));
copilot('ai.copilot_qs', 'QS copilot: bill checks', 'Billing and measurement findings of the project and the margin bridge between its last two CVRs.', async (db, actor, input) => {
  const p = needProject(db, actor, input);
  const facts = { project: `${p.code} ${p.name}` }; const refs = [];
  try { const l = leakageOf(db)?.list(actor, { projectId: p.id, status: 'ACTIVE', pageSize: 20 }); if (l) { facts.findings = l.rows.filter((f) => ['UNBILLED_WORK_AGEING', 'CONSUMPTION_ABOVE_NORM', 'DUP_INVOICE'].includes(f.ruleCode)).slice(0, 6).map((f) => `${f.docNo} ${f.title} (₹${f.valueAtRisk})`); refs.push({ type: 'bi.findings', id: String(p.id), label: `${p.code} findings`, route: `/bi/leakage?tab=findings&projectId=${p.id}` }); } } catch (e) { if (![403, 404].includes(e.status)) throw e; }
  try { const m = explainOf(db)?.why(actor, { projectId: p.id, kpi: 'margin' }); if (m) { facts.marginChange = m.total; facts.marginDrivers = m.components.slice(0, 5).map((c) => `${c.label}: ₹${c.amount}`); refs.push({ type: 'bi.explain', id: `${p.id}:margin`, label: `${p.code} margin bridge`, route: `/bi/explain?projectId=${p.id}&kpi=margin` }); } } catch (e) { if (![403, 404].includes(e.status)) throw e; }
  if (refs.length === 0) return { noAnswer: 'You may not see the findings or the margin of this project.', refs: [] };
  return { refs, data: { facts } };
}, (db, actor) => ({ projectId: firstProject(db, actor) }));
copilot('ai.copilot_procurement', 'Procurement copilot: vendor history', 'The purchase orders of a vendor the person may see, and the leakage findings that name it.', async (db, actor, input) => {
  const name = String(input.vendor ?? '').trim(); if (name.length < 2) throw badRequest('Name the vendor.', [{ field: 'vendor', message: 'is required' }]);
  const po = procOf(db)?.poSvc?.pos; if (!po) throw refused('Purchasing is not installed.');
  const rows = (po.list(actor, { q: name, page: 1, pageSize: 50 }).data ?? []);
  if (!rows.length) return { noAnswer: `I found no purchase orders of "${name}" that you may see.`, refs: [] };
  const total = rows.reduce((n, r) => n + Number(r.totalAmount ?? r.total ?? 0), 0);
  return { refs: rows.slice(0, 10).map((r) => ({ type: 'proc_purchase_orders', id: String(r.id), label: `${r.docNo} ${r.vendor ?? ''}`, route: `/proc/purchase-orders?id=${r.id}` })),
    data: { facts: { vendor: name, orders: rows.length, value: total, latest: rows.slice(0, 8).map((r) => `${r.docNo} ${r.date ?? ''} ${r.statusLabel ?? r.status ?? ''} ₹${r.totalAmount ?? r.total ?? ''}`) } } };
}, () => ({ vendor: 'a' }));
copilot('ai.copilot_finance', 'Finance copilot: variance explanations', 'The cost and margin variance of a project from the Why? decomposition.', async (db, actor, input) => {
  const p = needProject(db, actor, input);
  const svc = explainOf(db); if (!svc) throw refused('The variance explainer is not installed.');
  const c = svc.why(actor, { projectId: p.id, kpi: 'cost' });
  const facts = { project: `${p.code} ${p.name}`, costVariance: c.total, costDrivers: c.components.slice(0, 5).map((x) => `${x.label}: ₹${x.amount}`), residual: c.residual };
  try { const m = svc.why(actor, { projectId: p.id, kpi: 'margin' }); facts.marginChange = m.total; } catch (e) { if (![403, 404].includes(e.status)) throw e; }
  return { refs: [{ type: 'bi.explain', id: `${p.id}:cost`, label: `${p.code} cost variance`, route: `/bi/explain?projectId=${p.id}&kpi=cost` }], data: { facts } };
}, (db, actor) => ({ projectId: firstProject(db, actor) }));

const KINDS = { RFI: 'request for information', LETTER: 'letter', RFQ: 'request for quotation', MOM: 'minutes of meeting', DPR_NARRATIVE: 'daily progress report narrative', MIS_COMMENTARY: 'monthly MIS commentary' };
aiFeatures.register({
  code: 'ai.draft_document',
  label: 'Drafting: letters, RFIs, RFQs, minutes, narratives',
  description: 'Drafts a document from the person\'s brief and the project facts; the person reviews it and saves it as a DRAFT of the target module.',
  promptVersion: 'draft/1',
  system: 'You draft documents for an Indian construction company. Write a clear, polite draft from the brief and the facts given; mark anything you had to assume with [check]. Do not invent figures, dates or names.',
  prompt: (input) => `Draft a ${KINDS[input.kind] ?? 'document'}. Brief: ${String(input.brief ?? '').slice(0, 1500)}`,
  projectOf: (input) => Number(input.projectId) || null,
  tools: [{ name: 'create_draft', mode: 'DRAFT', permission: 'self', description: 'Saves the draft as a DRAFT record of the target module when the person confirms.' }],
  async context(db, actor, input) {
    if (!KINDS[input.kind]) throw badRequest('Choose what to draft.', [{ field: 'kind', message: 'is not a kind of draft' }]);
    const p = input.projectId ? needProject(db, actor, input, ['proj.project.view', 'engg.rfi.view', 'engg.letter.view']) : null;
    return { refs: p ? [{ type: 'org_project', id: String(p.id), label: `${p.code} ${p.name}`, route: `/proj/project-360?projectId=${p.id}` }] : [],
      data: { facts: { kind: KINDS[input.kind], project: p ? `${p.code} ${p.name}` : null, brief: String(input.brief ?? '').slice(0, 1500), date: new Date().toISOString().slice(0, 10) } } };
  },
  evaluation: [{ name: 'drafts from the brief', input: { kind: 'LETTER', brief: 'Ask the consultant to approve the revised shop drawing by Friday.' }, expect: { contains: ['brief'] } },
    { name: 'refuses a project outside scope', input: { kind: 'RFI', projectId: 999999999, brief: 'x' }, expect: { refused: 404 } }],
});

function firstProject(db, actor) { return projectsInScope(db, actor).sort((a, b) => a.id - b.id)[0]?.id ?? 0; }

/** The assistant service: what the person may use, ask, copilots, drafts and their saving as module DRAFTs, feedback. */
export function createAssistant(context) {
  const { db } = context;
  bindAssistant(db, context);
  const gw = () => { const g = aiOf(db); if (!g) throw notFound('The AI gateway is not installed.'); return g; };
  const flag = (actor) => { requireAi(context, actor); if (!context.flags.isOn(actor, 'ff.ai.p2802')) throw notFound('The AI assistant is not enabled for this company.'); };
  const live = (companyId, code) => db.prepare("SELECT * FROM ai_features WHERE company_id = ? AND code = ? AND status = 'APPROVED' AND enabled = 1 AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(companyId, code);
  const COPILOTS = { pm: 'ai.copilot_pm', qs: 'ai.copilot_qs', procurement: 'ai.copilot_procurement', finance: 'ai.copilot_finance' };
  const svc = {
    /** FR-01: what the panel offers this person (features live for one of their roles), and the kill switch. */
    me(actor) {
      flag(actor);
      const kill = db.prepare('SELECT kill_switch FROM ai_controls WHERE company_id = ?').get(actor.companyId)?.kill_switch === 1;
      const mine = (code) => { const f = live(actor.companyId, code); return Boolean(f && (actor.roles ?? []).some((r) => JSON.parse(f.enabled_scope_json).roles?.includes(r))); };
      return { killSwitch: kill, ask: mine('ai.assistant'), draft: mine('ai.draft_document'), copilots: Object.entries(COPILOTS).filter(([, code]) => mine(code)).map(([k]) => k), label: 'AI-generated — verify', kinds: Object.keys(KINDS) };
    },
    async ask(actor, { question, projectId }) { flag(actor); return gw().run(actor, 'ai.assistant', { question, ...(projectId ? { projectId } : {}) }); },
    async copilot(actor, kind, input) { flag(actor); if (!COPILOTS[kind]) throw notFound('That copilot does not exist.'); return gw().run(actor, COPILOTS[kind], input); },
    async draft(actor, { kind, projectId, brief }) {
      flag(actor);
      const out = await gw().run(actor, 'ai.draft_document', { kind, brief, ...(projectId ? { projectId } : {}) });
      const title = `${KINDS[kind][0].toUpperCase()}${KINDS[kind].slice(1)}: ${String(brief).slice(0, 80)}`;
      const id = Number(db.prepare('INSERT INTO ai_drafts (company_id, log_id, kind, owner_user, title, body, project_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, out.logId, kind, actor.user, title, out.text, projectId ?? null, actor.user).lastInsertRowid);
      writeAudit(db, { companyId: actor.companyId, entity: 'ai_drafts', entityId: id, action: 'create', newValues: { kind, logId: out.logId }, actor: actor.user });
      return { ...out, draftId: id, canSave: ['RFI', 'LETTER'].includes(kind) };
    },
    drafts(actor) {
      flag(actor);
      return db.prepare("SELECT * FROM ai_drafts WHERE company_id = ? AND owner_user = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 50").all(actor.companyId, actor.user)
        .map((d) => ({ id: d.id, kind: d.kind, title: d.title, body: d.body, status: d.status, target: d.target_entity ? { entity: d.target_entity, id: d.target_id, ref: d.target_ref, route: d.target_entity === 'engg_rfis' ? `/engg/rfis?id=${d.target_id}` : `/engg/letters?id=${d.target_id}` } : null, projectId: d.project_id, at: d.created_at, rowVersion: d.version, canSave: d.status === 'PROPOSED' && ['RFI', 'LETTER'].includes(d.kind) }));
    },
    /** FR-03, BR-01: the person confirms; the draft becomes a DRAFT record of the target module through that module's own service and rights. */
    save(actor, id, b) {
      flag(actor);
      return transaction(db, () => {
        const d = db.prepare('SELECT * FROM ai_drafts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
        if (!d || d.owner_user !== actor.user) throw notFound('That draft does not exist.');
        if (d.status !== 'PROPOSED') throw unprocessable('This draft was already saved or discarded.');
        const engg = enggOf(db); if (!engg) throw unprocessable('Engineering is not installed.');
        let made; let entity;
        if (d.kind === 'RFI') { entity = 'engg_rfis'; made = engg.rfis.create(actor, parseRfiCreate({ projectId: d.project_id ?? b.projectId, subject: b.subject, question: b.body ?? d.body, discipline: b.discipline, requiredBy: b.requiredBy, priority: b.priority ?? 'MEDIUM' })); }
        else if (d.kind === 'LETTER') { entity = 'engg_letters'; made = engg.letters.create(actor, parseLetterCreate({ projectId: d.project_id ?? b.projectId, direction: 'OUT', letterDate: b.letterDate, party: b.party, subject: b.subject, category: b.category ?? 'OTHER', bodyText: b.body ?? d.body })); }
        else throw unprocessable('This kind of draft is copied by hand; saving it into its module comes with that module.');
        if (made.status && made.status !== 'DRAFT') throw unprocessable('The target module did not create a draft.');
        const ref = made.rfiNo ?? made.letterNo ?? made.docNo ?? made.refNo ?? String(made.id);
        db.prepare("UPDATE ai_drafts SET status = 'APPLIED', target_entity = ?, target_id = ?, target_ref = ?, applied_at = CURRENT_TIMESTAMP, updated_by = ?, updated_at = CURRENT_TIMESTAMP, version = version + 1 WHERE id = ?").run(entity, String(made.id), ref, actor.user, d.id);
        writeAudit(db, { companyId: actor.companyId, entity: 'ai_drafts', entityId: d.id, action: 'apply', newValues: { entity, id: made.id, ref }, actor: actor.user });
        return { draftId: d.id, entity, id: made.id, ref, status: made.status ?? 'DRAFT', route: entity === 'engg_rfis' ? `/engg/rfis?id=${made.id}` : `/engg/letters?id=${made.id}` };
      });
    },
    discard(actor, id) {
      flag(actor);
      const d = db.prepare('SELECT * FROM ai_drafts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
      if (!d || d.owner_user !== actor.user) throw notFound('That draft does not exist.');
      if (d.status !== 'PROPOSED') throw unprocessable('This draft was already saved or discarded.');
      db.prepare("UPDATE ai_drafts SET status = 'DISCARDED', updated_by = ?, updated_at = CURRENT_TIMESTAMP, version = version + 1 WHERE id = ?").run(actor.user, d.id);
      return { id: d.id, status: 'DISCARDED' };
    },
    /** FR-05: thumbs on an answer of the person's own; kept for the evaluation of the feature. */
    feedback(actor, { logId, rating, comment }) {
      flag(actor);
      const l = db.prepare('SELECT * FROM ai_logs WHERE id = ? AND company_id = ?').get(Number(logId), actor.companyId);
      if (!l || l.user_name !== actor.user) throw forbidden('You give feedback on your own answers only.');
      db.prepare(`INSERT INTO ai_feedback (company_id, log_id, feature_code, user_name, rating, comment, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(log_id, user_name) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, updated_at = CURRENT_TIMESTAMP, version = version + 1`).run(actor.companyId, l.id, l.feature_code, actor.user, rating, comment ?? null, actor.user);
      return { logId: l.id, rating };
    },
    /** FR-05: the feedback of each feature, for the evaluation (28.01 users with ai.usage.view). */
    feedbackSummary(actor) {
      requireAi(context, actor);
      if (!authzOf(db).check(actor, 'ai.usage.view', { companyId: actor.companyId }).allowed) throw forbidden('Your role does not include ai.usage.view.');
      return db.prepare('SELECT feature_code AS feature, SUM(rating = 1) AS up, SUM(rating = -1) AS down, COUNT(*) AS n FROM ai_feedback WHERE company_id = ? GROUP BY feature_code ORDER BY n DESC').all(actor.companyId)
        .map((r) => ({ feature: r.feature, label: aiFeatures.get(r.feature)?.label ?? r.feature, up: r.up, down: r.down, total: r.n, approval: r.n ? Math.round((r.up * 1000) / r.n) / 10 : null }));
    },
  };
  return svc;
}
