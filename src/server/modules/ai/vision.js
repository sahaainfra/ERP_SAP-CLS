import { createRequire } from 'node:module';
import { writeAudit } from '../../platform/audit/index.js';
import { hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { filesOf } from '../../platform/files/registry.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { integrationsOf } from '../../platform/integrations/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { hseOf } from '../hse/index.js';
import { parseObsCreate } from '../hse/validators.js';
import { createBase, nowIso } from '../proc/base.js';
import { qaOf } from '../qa/index.js';
import { parseNcrCreate } from '../qa/validators.js';

/**
 * Part 28.05 — computer vision decision support.
 *
 * FR-01 photographs attached to daily progress reports (14.02) and quality inspections (18.x) are analysed when the virus scan clears them,
 * by the detector the company has chosen: the built-in colour detector (high-visibility vests, needs no model) or a connected model endpoint
 * through the integration hub (`ai/vision_http`: helmets and vests worn or not, cracks, honeycombing, exposed reinforcement, slab cast,
 * formwork, materials). FR-02 each detection is a suggestion with its box and confidence; a person confirms it into a safety observation (19.04)
 * or an NCR (18.04) through those modules, notes a progress cue, or marks it a false positive. FR-03 faces and people boxes are blurred into a
 * copy of the photograph (on by default) and the reviewer can blur more; nobody is ever identified (BR-01): labels are an allow-list without
 * identities, observations name no person, and nothing reaches HR or a penalty. FR-04 the outcomes measure each model's precision per label.
 */

export const CV_FLAG = 'ff.ai.p2805';
export const CV_ENTITIES = new Set(['site_dpr', 'qa_inspections', 'qa_inspection_requests', 'hse_observations']);
const IMAGES = new Set(['jpg', 'jpeg', 'png']);
const SLA_HOURS = 24;
export const CV_LABELS = Object.freeze({
  PERSON: { group: 'PRIVACY', text: 'Person' }, FACE: { group: 'PRIVACY', text: 'Face' },
  HELMET: { group: 'PPE', text: 'Helmet worn' }, VEST: { group: 'PPE', text: 'High-visibility vest' },
  NO_HELMET: { group: 'PPE', action: 'OBSERVATION', text: 'No helmet' }, NO_VEST: { group: 'PPE', action: 'OBSERVATION', text: 'No high-visibility vest' },
  CRACK: { group: 'DEFECT', action: 'NCR', text: 'Crack' }, HONEYCOMB: { group: 'DEFECT', action: 'NCR', text: 'Honeycombing' }, EXPOSED_REBAR: { group: 'DEFECT', action: 'NCR', text: 'Exposed reinforcement' },
  SLAB_CAST: { group: 'PROGRESS', action: 'NOTE', text: 'Slab cast' }, FORMWORK: { group: 'PROGRESS', action: 'NOTE', text: 'Formwork in place' }, REBAR_PLACED: { group: 'PROGRESS', action: 'NOTE', text: 'Reinforcement placed' },
  MATERIAL: { group: 'MATERIAL', action: 'NOTE', text: 'Material' },
});
for (const [key, def, description, type] of [
  ['ai.cv.detector', 'builtin.colour', 'FR-01: the detector of photographs: builtin.colour (high-visibility vests) or the code of an AI connector of provider vision_http.', 'string'],
  ['ai.cv.blur_faces', true, 'FR-03: blur faces and people in a copy of each analysed photograph.', 'boolean'],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: type, default: def, scopes: ['system', 'company'], description });
const shape = { type: 'object', additionalProperties: true };
eventTypes.define({ type: 'ai.vision.analysed', version: 1, schema: shape, owner: 'ai', description: 'A site photograph was analysed (part 28.05): data { fileId, model, suggestions }.' });
eventTypes.define({ type: 'ai.vision.confirmed', version: 1, schema: shape, owner: 'ai', description: 'A person confirmed a vision suggestion (part 28.05): data { label, entity, id }.' });
eventTypes.define({ type: 'ai.vision.false_positive', version: 1, schema: shape, owner: 'ai', description: 'A person marked a vision suggestion as wrong (part 28.05): data { model, label }.' });

const require = createRequire(import.meta.url);
const sharp = () => require('sharp');
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v)));

// ------------------------------------------------------------------------------------------------------------- the built-in detector
/** Hue in degrees, saturation and value in 0..1. */
const hsv = (r, g, b) => { const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn; let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [((h * 60) + 360) % 360, mx ? d / mx : 0, mx / 255]; };
/**
 * High-visibility vests: fluorescent yellow-green and orange regions (a colour cue only — it cannot tell a vest from a sign of the same colour,
 * hence the moderate confidence). Returns detections with boxes in 0..1 of the image.
 */
export async function colourDetect(buffer) {
  const W = 160;
  const { data, info } = await sharp()(buffer).rotate().resize({ width: W, withoutEnlargement: false }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width; const h = info.height; const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) { const [hu, s, v] = hsv(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]); if (s > 0.6 && v > 0.65 && ((hu >= 50 && hu <= 85) || (hu >= 12 && hu <= 35))) mask[i] = 1; }
  const seen = new Uint8Array(w * h); const out = [];
  for (let i = 0; i < w * h; i += 1) {
    if (!mask[i] || seen[i]) continue;
    let n = 0; let x0 = w; let y0 = h; let x1 = 0; let y1 = 0; const stack = [i]; seen[i] = 1;
    while (stack.length) { const p = stack.pop(); n += 1; const x = p % w; const y = (p - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - w, p + w]) if (q >= 0 && q < w * h && !seen[q] && mask[q] && Math.abs((q % w) - x) <= 1) { seen[q] = 1; stack.push(q); } }
    const bw = x1 - x0 + 1; const bh = y1 - y0 + 1;
    if (n < w * h * 0.004 || bw < 3 || bh < 3) continue;
    const fill = n / (bw * bh);
    out.push({ label: 'VEST', confidence: Math.round(Math.min(0.75, 0.35 + fill * 0.45) * 100) / 100, box: [x0 / w, y0 / h, bw / w, bh / h].map((v) => Math.round(v * 1000) / 1000) });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 20);
}
/** FR-03: a copy of the image with each box blurred (faces and people, and the reviewer's own boxes). */
export async function blurRegions(buffer, boxes) {
  const img = sharp()(buffer).rotate();
  const meta = await img.metadata(); const W = meta.width; const H = meta.height;
  const base = await sharp()(buffer).rotate().toBuffer();
  const layers = [];
  for (const b of boxes) {
    const left = Math.max(0, Math.floor(clamp01(b[0]) * W)); const top = Math.max(0, Math.floor(clamp01(b[1]) * H));
    const width = Math.max(1, Math.min(W - left, Math.ceil(clamp01(b[2]) * W))); const height = Math.max(1, Math.min(H - top, Math.ceil(clamp01(b[3]) * H)));
    const patch = await sharp()(base).extract({ left, top, width, height }).blur(Math.max(8, Math.round(Math.min(width, height) / 4))).toBuffer();
    layers.push({ input: patch, left, top });
  }
  return sharp()(base).composite(layers).toFormat(meta.format === 'png' ? 'png' : 'jpeg').toBuffer();
}

/** The model endpoint provider of the integration hub (an inference server answering { detections: [{ label, confidence, box }] }). */
export function registerVisionProvider(db) {
  const reg = integrationsOf(db).providers;
  if (reg.get('ai', 'vision_http')) return;
  reg.register({
    type: 'ai', provider: 'vision_http', label: 'Vision model endpoint', description: 'An object-detection model served over HTTP (for example a PPE or concrete-defect model): POST an image, get labelled boxes.',
    configFields: [{ name: 'baseUrl', label: 'Base URL', required: true }, { name: 'path', label: 'Path', help: 'Default /detect' }, { name: 'model', label: 'Model name and version', required: true }],
    secrets: [{ name: 'api_key', label: 'API key', required: false }],
    validateConfig: (c) => (String(c.baseUrl ?? '').startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(String(c.baseUrl ?? '')) ? [] : ['The base URL must start with https://.']),
    operations: { detect: { validate: (p) => (p?.image ? [] : [{ field: 'image', message: 'Give the image.' }]), run: async (ctx, p) => {
      const { httpJson } = await import('../../platform/integrations/providers.js');
      const out = await httpJson(ctx, { path: ctx.config.path || '/detect', headers: ctx.secrets.api_key ? { authorization: `Bearer ${ctx.secrets.api_key}` } : {}, body: { image: p.image, mime: p.mime, labels: p.labels } });
      return { httpStatus: out.httpStatus, data: { detections: out.data?.detections ?? [], model: out.data?.model ?? ctx.config.model } };
    } } },
    health: async () => ({ message: 'Configured.' }),
  });
}
/** Keep only allowed labels with a box inside the image and a confidence (BR-01: anything naming a person is dropped). */
export function cleanDetections(list) {
  return (Array.isArray(list) ? list : []).filter((d) => d && CV_LABELS[String(d.label).toUpperCase()] && Array.isArray(d.box) && d.box.length === 4 && d.box.every((v) => Number.isFinite(Number(v))))
    .map((d) => ({ label: String(d.label).toUpperCase(), confidence: Math.round(clamp01(d.confidence) * 100) / 100, box: d.box.map((v) => Math.round(clamp01(v) * 1000) / 1000), ...(d.detail && CV_LABELS[String(d.label).toUpperCase()].group === 'MATERIAL' ? { detail: String(d.detail).slice(0, 60) } : {}) }))
    .slice(0, 50);
}

// ------------------------------------------------------------------------------------------------------------- the service
const services = new WeakMap();
export const visionOf = (db) => services.get(db) ?? null;
export function requireVision(context, actor) {
  if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, CV_FLAG)) throw notFound('Vision suggestions are not enabled for this company.');
}

/** @param {any} context @param {{ jobs?: any, bus?: any }} [deps] */
export function createVision(context, { jobs, bus } = {}) {
  const { db } = context;
  registerVisionProvider(db);
  const base = createBase({ db });
  const authz = authzOf(db);
  const guard = (actor, key) => { requireVision(context, actor); if (key && !hasPermissionAnywhere(actor, key)) throw forbidden(`You may not do this (permission ${key}).`); };
  const flagOn = (companyId) => { try { return context.flags.isOn({ companyId, user: 'system', roles: [] }, CV_FLAG); } catch { return false; } };
  const param = (companyId, key) => base.param(companyId, key) ?? parameterRegistry.get(key)?.default;

  /** FR-01: analyse one photograph with the company's detector; blur faces and people into a copy (FR-03). */
  async function analyse(fileId, by = 'system') {
    const files = filesOf(db);
    const { file, companyId, projectId, siteId, buffer } = await files.bytesOf(fileId);
    const prior = db.prepare('SELECT * FROM cv_results WHERE company_id = ? AND file_id = ? AND deleted_at IS NULL').get(companyId, file.id);
    if (prior && prior.status !== 'FAILED') return prior;
    const detector = String(param(companyId, 'ai.cv.detector') ?? 'builtin.colour');
    let model; let found; let failure = null;
    try {
      if (detector === 'builtin.colour') { model = 'builtin.colour/1'; found = await colourDetect(buffer); }
      else {
        const out = await integrationsOf(db).hub.call(detector, 'detect', { image: buffer.toString('base64'), mime: file.mime, labels: Object.keys(CV_LABELS) }, { companyId, actor: { companyId, user: by, roles: [] }, idempotencyKey: `cv:${file.id}` });
        model = `${detector}/${out.data?.model ?? 'model'}`; found = out.data?.detections ?? [];
      }
    } catch (e) { model = detector; found = []; failure = String(e?.message ?? e).slice(0, 300); }
    const labels = cleanDetections(found).map((d) => ({ ...d, status: CV_LABELS[d.label].action ? 'PENDING' : 'INFO' }));
    let blurredId = null;
    const privacy = labels.filter((l) => CV_LABELS[l.label].group === 'PRIVACY');
    if (!failure && privacy.length && param(companyId, 'ai.cv.blur_faces') !== false && String(param(companyId, 'ai.cv.blur_faces')) !== 'false') {
      // for a person box only its top third (the head) is blurred; a face box entirely
      const boxes = privacy.map((p) => (p.label === 'FACE' ? p.box : [p.box[0], p.box[1], p.box[2], p.box[3] / 3]));
      blurredId = (await files.storeDerivative(file.id, await blurRegions(buffer, boxes), { suffix: 'blurred', by, kind: 'cv_blur' })).id;
    }
    const actionable = labels.filter((l) => l.status === 'PENDING').length;
    const status = failure ? 'FAILED' : actionable ? 'PENDING' : 'NO_FINDINGS';
    return transaction(db, () => {
      const stamp = nowIso(); let id;
      const vals = [model, JSON.stringify(labels), labels.length ? Math.max(...labels.map((l) => l.confidence)) : 0, status, failure, blurredId, blurredId ? JSON.stringify(privacy.map((p) => p.box)) : null, stamp];
      if (prior) { db.prepare('UPDATE cv_results SET model = ?, labels_json = ?, confidence = ?, status = ?, reason = ?, blurred_file_id = ?, blur_regions_json = ?, analysed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(...vals, by, stamp, prior.id); id = prior.id; }
      else {
        const docNo = base.number(companyId, by, 'AI_VISION_RESULT', 'cv_results', 'CVR');
        id = Number(db.prepare(`INSERT INTO cv_results (company_id, doc_no, file_id, file_name, linked_entity, linked_id, model, labels_json, confidence, status, reason, blurred_file_id, blur_regions_json, analysed_at, project_id, site_id, created_by, source_type, source_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'core_files', ?)`).run(companyId, docNo, file.id, file.name, file.linkedEntity, file.linkedId, ...vals, projectId ?? null, siteId ?? null, by, String(file.id)).lastInsertRowid);
      }
      writeAudit(db, { companyId, entity: 'cv_results', entityId: String(id), action: prior ? 're-analyse' : 'analyse', actor: by, newValues: { fileId: file.id, model, labels: labels.map((l) => l.label), blurred: Boolean(blurredId) } });
      publishEvent(db, { type: 'ai.vision.analysed', entity: 'cv_results', entityId: id, actorId: by, companyId, projectId: projectId ?? null, siteId: siteId ?? null, data: { fileId: file.id, model, suggestions: actionable } });
      return db.prepare('SELECT * FROM cv_results WHERE id = ?').get(id);
    });
  }

  const visible = (actor) => authz.scopeFilter(actor, 'ai.vision.view', { project: 'r.project_id', site: 'r.site_id' }).sql;
  const ageHours = (r) => Math.max(0, Math.round((Date.now() - Date.parse(r.analysed_at)) / 3_600_000));
  const view = (actor, r, full = false) => {
    const labels = JSON.parse(r.labels_json).map((l, i) => ({ index: i, ...l, text: CV_LABELS[l.label].text, group: CV_LABELS[l.label].group, action: CV_LABELS[l.label].action ?? null }));
    const h = ageHours(r); const shown = r.blurred_file_id ?? r.file_id;
    let image = null; if (full) { try { image = filesOf(db).signedUrl(actor, shown, { variant: 'file', download: false })?.url ?? null; } catch { image = null; } }
    return { id: r.id, docNo: r.doc_no, fileId: r.file_id, fileName: r.file_name, source: r.linked_entity, sourceId: r.linked_id, model: r.model, status: r.status, reason: r.reason, confidence: r.confidence, analysedAt: r.analysed_at, ageHours: h,
      sla: r.status === 'PENDING' ? (h >= SLA_HOURS ? 'OVERDUE' : h >= SLA_HOURS / 2 ? 'DUE_SOON' : 'ON_TIME') : null, blurred: Boolean(r.blurred_file_id), imageFileId: shown, image, projectId: r.project_id, siteId: r.site_id,
      labels, pending: labels.filter((l) => l.status === 'PENDING').length, rowVersion: r.version };
  };
  function row(actor, id) {
    const r = db.prepare(`SELECT * FROM cv_results r WHERE r.id = ? AND r.company_id = ? AND r.deleted_at IS NULL AND ${visible(actor)}`).get(Number(id), actor.companyId);
    if (!r) throw notFound('That vision result does not exist.');
    filesOf(db).get(actor, r.file_id); // the person may open the photograph's record
    return r;
  }
  function decide(actor, r, index, next, outcome) {
    const labels = JSON.parse(r.labels_json); const l = labels[index];
    if (!l) throw notFound('That suggestion does not exist.');
    if (l.status !== 'PENDING') throw unprocessable('This suggestion was decided already.');
    labels[index] = { ...l, status: next, decidedBy: actor.user, decidedAt: nowIso(), ...outcome };
    const left = labels.filter((x) => x.status === 'PENDING').length;
    db.prepare('UPDATE cv_results SET labels_json = ?, status = ?, confirmed_by = COALESCE(confirmed_by, ?), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(labels), left ? 'PENDING' : 'REVIEWED', next === 'CONFIRMED' ? actor.user : null, actor.user, nowIso(), r.id);
    writeAudit(db, { companyId: actor.companyId, entity: 'cv_results', entityId: String(r.id), action: next === 'CONFIRMED' ? 'confirm' : 'false_positive', actor: actor.user, newValues: { index, label: l.label, ...outcome } });
  }
  const svc = {
    analyse,
    list(actor, { status = 'PENDING', page = 1, pageSize = 25 } = {}) {
      guard(actor, 'ai.vision.view');
      const where = ['r.company_id = ?', 'r.deleted_at IS NULL', visible(actor)]; const params = [actor.companyId];
      if (status !== 'ALL') { where.push('r.status = ?'); params.push(status); }
      const sql = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM cv_results r WHERE ${sql}`).get(...params).n;
      const rows = db.prepare(`SELECT r.* FROM cv_results r WHERE ${sql} ORDER BY r.status = 'PENDING' DESC, r.analysed_at ASC, r.id LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize).map((r) => view(actor, r));
      const counts = Object.fromEntries(db.prepare(`SELECT r.status AS s, COUNT(*) AS n FROM cv_results r WHERE r.company_id = ? AND r.deleted_at IS NULL AND ${visible(actor)} GROUP BY r.status`).all(actor.companyId).map((x) => [x.s, x.n]));
      return { rows, total, page, pageSize, counts, canReview: hasPermissionAnywhere(actor, 'ai.vision.review'), canRun: hasPermissionAnywhere(actor, 'ai.vision.run'), detector: String(param(actor.companyId, 'ai.cv.detector')) };
    },
    get(actor, id) { guard(actor, 'ai.vision.view'); const r = row(actor, id); return { ...view(actor, r, true), can: { review: hasPermissionAnywhere(actor, 'ai.vision.review') && r.status === 'PENDING', blur: hasPermissionAnywhere(actor, 'ai.vision.review') } }; },
    async run(actor, fileId) {
      guard(actor, 'ai.vision.run');
      const f = filesOf(db).get(actor, Number(fileId));
      if (!IMAGES.has(f.extension)) throw unprocessable('Only photographs (JPEG or PNG) are analysed.');
      const r = await analyse(f.id, actor.user);
      return svc.get(actor, r.id);
    },
    /** FR-02: confirm a suggestion; an action creates the record in its module with the reviewer's rights, with the (blurred) photograph attached. */
    async confirm(actor, id, index, b) {
      guard(actor, 'ai.vision.review');
      const r = row(actor, id);
      if (b.rowVersion !== r.version) throw conflict('The result was changed by someone else. Reload it.');
      const l = JSON.parse(r.labels_json)[index]; if (!l) throw notFound('That suggestion does not exist.');
      if (l.status !== 'PENDING') throw unprocessable('This suggestion was decided already.');
      const kind = CV_LABELS[l.label].action; const projectId = b.projectId ?? r.project_id; const siteId = b.siteId ?? r.site_id;
      let made = null;
      if (kind === 'OBSERVATION') {
        const hse = hseOf(db); if (!hse?.svc?.observations) throw unprocessable('Safety observations (19.04) are not installed.');
        if (!projectId || !siteId) throw unprocessable('Choose the project and site of the observation.');
        // BR-01: an observation of a condition seen in a photograph, naming nobody, for correction — never a penalty
        const o = hse.svc.observations.create(actor, parseObsCreate({ projectId, siteId, obsType: 'UNSAFE_CONDITION', severity: b.severity ?? 'MEDIUM', description: b.description ?? `${CV_LABELS[l.label].text} seen in a site photograph (${r.file_name}); vision suggestion ${r.doc_no} confirmed by ${actor.user}.`, actionRequired: b.actionRequired ?? 'Brief the crew on the PPE rule at the next toolbox talk.' }));
        made = { entity: 'hse_observations', id: o.id, label: o.docNo ?? o.doc_no ?? `Observation ${o.id}`, route: `/hse/observations?id=${o.id}` };
      } else if (kind === 'NCR') {
        const qa = qaOf(db); if (!qa?.ncv?.ncrs) throw unprocessable('NCRs (18.04) are not installed.');
        if (!projectId) throw unprocessable('Choose the project of the NCR.');
        const n = qa.ncv.ncrs.create(actor, parseNcrCreate({ projectId, siteId: siteId ?? null, originKind: r.linked_entity === 'qa_inspections' ? 'INSPECTION' : 'OTHER', originId: r.linked_entity === 'qa_inspections' ? r.linked_id : `vision ${r.doc_no}`, ncrType: 'WORKMANSHIP', severity: b.severity ?? 'MINOR', description: b.description ?? `${CV_LABELS[l.label].text} seen in a site photograph (${r.file_name}); vision suggestion ${r.doc_no} confirmed by ${actor.user}.` }));
        made = { entity: 'qa_ncrs', id: n.id, label: n.ncrNo ?? n.docNo ?? n.doc_no ?? `NCR ${n.id}`, route: `/qa/ncrs?id=${n.id}` };
      }
      if (made) { try { await filesOf(db).copyTo(actor, { fileId: r.blurred_file_id ?? r.file_id, entity: made.entity, entityId: made.id, projectId, siteId }); } catch { /* the record stands without the copy if its module refuses attachments now */ } }
      transaction(db, () => {
        decide(actor, db.prepare('SELECT * FROM cv_results WHERE id = ?').get(r.id), index, 'CONFIRMED', { note: b.note ?? null, created: made });
        publishEvent(db, { type: 'ai.vision.confirmed', entity: 'cv_results', entityId: r.id, actorId: actor.user, companyId: actor.companyId, projectId: projectId ?? null, data: { label: l.label, entity: made?.entity ?? null, id: made?.id ?? null } });
      });
      return svc.get(actor, r.id);
    },
    /** FR-04: a wrong suggestion, with the reason, counts against the model's precision for that label. */
    falsePositive(actor, id, index, { reason, rowVersion }) {
      guard(actor, 'ai.vision.review');
      const r = row(actor, id);
      if (rowVersion !== r.version) throw conflict('The result was changed by someone else. Reload it.');
      transaction(db, () => {
        decide(actor, r, index, 'FALSE_POSITIVE', { reason });
        publishEvent(db, { type: 'ai.vision.false_positive', entity: 'cv_results', entityId: r.id, actorId: actor.user, companyId: actor.companyId, data: { model: r.model, label: JSON.parse(r.labels_json)[index].label } });
      });
      return svc.get(actor, r.id);
    },
    /** FR-03: blur more of the photograph (boxes drawn by the reviewer); the new copy replaces the shown one. */
    async blur(actor, id, { boxes }) {
      guard(actor, 'ai.vision.review');
      const r = row(actor, id);
      const src = await filesOf(db).bytesOf(r.blurred_file_id ?? r.file_id);
      const made = await filesOf(db).storeDerivative(r.file_id, await blurRegions(src.buffer, boxes), { suffix: 'blurred', by: actor.user, kind: 'cv_blur' });
      const regions = [...(r.blur_regions_json ? JSON.parse(r.blur_regions_json) : []), ...boxes];
      db.prepare('UPDATE cv_results SET blurred_file_id = ?, blur_regions_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(made.id, JSON.stringify(regions), actor.user, nowIso(), r.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'cv_results', entityId: String(r.id), action: 'blur', actor: actor.user, newValues: { boxes: boxes.length, fileId: made.id } });
      return svc.get(actor, r.id);
    },
    /** FR-04: per model and label, suggestions confirmed, wrong and waiting, and the precision. */
    performance(actor) {
      guard(actor, 'ai.vision.view');
      const by = {};
      for (const r of db.prepare(`SELECT r.model, r.labels_json FROM cv_results r WHERE r.company_id = ? AND r.deleted_at IS NULL AND ${visible(actor)}`).all(actor.companyId)) {
        for (const l of JSON.parse(r.labels_json)) {
          if (!CV_LABELS[l.label].action) continue;
          const k = `${r.model}|${l.label}`; by[k] ??= { model: r.model, label: l.label, text: CV_LABELS[l.label].text, suggested: 0, confirmed: 0, falsePositive: 0, pending: 0, confSum: 0 };
          const x = by[k]; x.suggested += 1; x.confSum += l.confidence; if (l.status === 'CONFIRMED') x.confirmed += 1; else if (l.status === 'FALSE_POSITIVE') x.falsePositive += 1; else x.pending += 1;
        }
      }
      return Object.values(by).map(({ confSum, ...x }) => ({ ...x, avgConfidence: x.suggested ? Math.round((confSum / x.suggested) * 100) / 100 : null, precisionPct: x.confirmed + x.falsePositive ? Math.round((x.confirmed / (x.confirmed + x.falsePositive)) * 1000) / 10 : null }))
        .sort((a, b) => a.model.localeCompare(b.model) || a.label.localeCompare(b.label));
    },
  };
  services.set(db, svc);
  contexts.set(db, context);
  if (jobs) jobs.register('ai.vision.analyse', (ctx) => analyse(ctx.params.fileId), { maxAttempts: 3, description: 'Analyses a site photograph for PPE, progress and defect cues (part 28.05).' });
  if (bus && jobs) bus.subscribe('core.file.available', (event, { db: tx }) => {
    const f = tx.prepare('SELECT id, company_id, extension, linked_entity FROM core_files WHERE id = ?').get(Number(event.entityId));
    if (!f || !IMAGES.has(f.extension) || !CV_ENTITIES.has(f.linked_entity) || !flagOn(f.company_id)) return;
    if (tx.prepare("SELECT 1 FROM core_files WHERE id = ? AND source_type = 'cv_blur'").get(f.id)) return; // never analyse our own blurred copies
    jobs.enqueue('ai.vision.analyse', { fileId: f.id }, { createdBy: 'vision', companyId: f.company_id });
  }, { consumer: 'ai.vision' });
  return svc;
}

const contexts = new WeakMap();
widgetRegistry.register({
  code: 'ai.vision_queue',
  available: (db, actor) => { const c = contexts.get(db); if (!c || !hasPermissionAnywhere(actor, 'ai.vision.view')) return false; try { requireVision(c, actor); return true; } catch { return false; } },
  provider({ db, actor }) { const l = visionOf(db).list(actor, { pageSize: 1 }); return { label: 'Vision suggestions to review', value: l.total, unit: 'photographs', subtitle: `${l.counts.REVIEWED ?? 0} reviewed`, status: l.total ? 'amber' : 'green', drill: '/ai/vision' }; },
});
