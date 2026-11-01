import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { conflict, notFound, unprocessable } from '../../platform/http/errors.js';
import { likePattern, orderBySql, pageResponse } from '../../platform/pagination/index.js';
import { MAX_DRAFT_BYTES } from './validators.js';

const present = (r, names) => ({
  id: r.id,
  formCode: r.form_code,
  formName: names.get(r.form_code) ?? r.form_code,
  entityKey: r.entity_key,
  title: r.title ?? '',
  savedAt: r.saved_at,
  savedBy: r.saved_by,
  bytes: r.bytes,
  projectId: r.project_id,
  siteId: r.site_id,
  version: r.version,
});

/**
 * Server drafts (part 03.02, FR-07): a person's unfinished form, kept per company, form and record so it survives a closed tab or
 * a crashed browser and follows them to another device. Only the person sees their own drafts. A draft is not validated (it may be
 * half done) and its autosaves are not audited (they are not business records); discarding is. Saving a stale version is refused
 * so two windows cannot overwrite each other unseen.
 */
export function createDraftService({ db, now = () => new Date().toISOString() }) {
  const live = (actor, formCode, entityKey) => db.prepare('SELECT * FROM ui_drafts WHERE company_id = ? AND user_ref = ? AND form_code = ? AND entity_key = ? AND deleted_at IS NULL').get(actor.companyId, actor.user, formCode, entityKey);
  const formNames = () => new Map(db.prepare("SELECT form_code, name FROM ui_form_metadata WHERE status = 'ACTIVE' AND is_active = 1").all().map((r) => [r.form_code, r.name]));
  const discard = (row, actor, reason) => {
    db.prepare('UPDATE ui_drafts SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(now(), actor.user, row.id);
    writeAudit(db, { entity: 'ui_drafts', entityId: row.id, action: 'discard', oldValues: { formCode: row.form_code, entityKey: row.entity_key, title: row.title, savedAt: row.saved_at }, reason, actor: actor.user, companyId: actor.companyId });
  };

  const service = {
    list(actor, query) {
      const where = ["company_id = :c", "user_ref = :u", 'deleted_at IS NULL', "(COALESCE(title, '') LIKE :q ESCAPE '\\' OR form_code LIKE :q ESCAPE '\\')"];
      const params = { c: actor.companyId, u: actor.user, q: likePattern(query.q) };
      if (query.filters.formCode) { where.push('form_code = :form'); params.form = query.filters.formCode; }
      const sql = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM ui_drafts WHERE ${sql}`).get(params).n;
      const rows = db.prepare(`SELECT * FROM ui_drafts WHERE ${sql} ${orderBySql(query.sort, { savedAt: 'saved_at', formCode: 'form_code', title: "COALESCE(title, '')" }, 'id DESC')} LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      const names = formNames();
      return { ...pageResponse(rows.map((r) => present(r, names)), total, query), forms: [...new Set(db.prepare('SELECT DISTINCT form_code FROM ui_drafts WHERE company_id = ? AND user_ref = ? AND deleted_at IS NULL').all(actor.companyId, actor.user).map((r) => r.form_code))].map((code) => ({ code, name: names.get(code) ?? code })) };
    },

    /** The person's draft of a form (and record), or null. */
    get(actor, formCode, entityKey) {
      const row = live(actor, formCode, entityKey);
      return row ? { ...present(row, formNames()), payload: JSON.parse(row.payload_json) } : null;
    },

    save(actor, formCode, entityKey, input) {
      const payloadJson = JSON.stringify(input.payload);
      const bytes = Buffer.byteLength(payloadJson);
      if (bytes > MAX_DRAFT_BYTES) throw unprocessable(`The draft is too large to keep (${Math.ceil(bytes / 1024)} KB; at most ${MAX_DRAFT_BYTES / 1024} KB). Remove some rows or attach large text as a file.`);
      if (!db.prepare('SELECT 1 FROM org_companies WHERE id = ?').get(actor.companyId)) throw unprocessable('Your company is not set up yet, so drafts cannot be kept.');
      return transaction(db, () => {
        const before = live(actor, formCode, entityKey);
        const at = now();
        if (before) {
          if (input.version !== before.version) throw conflict('A newer copy of this draft was saved from another window or device. Reload it before saving again.');
          db.prepare('UPDATE ui_drafts SET title = ?, payload_json = ?, bytes = ?, saved_at = ?, saved_by = ?, project_id = ?, site_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
            .run(input.title ?? before.title, payloadJson, bytes, at, input.savedBy, input.projectId ?? null, input.siteId ?? null, actor.user, at, before.id);
        } else {
          if (input.version) throw conflict('This draft was discarded or submitted in another window. Start again, or reload.');
          db.prepare("INSERT INTO ui_drafts (company_id, user_id, user_ref, form_code, entity_key, title, payload_json, bytes, saved_at, saved_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ui_draft')")
            .run(actor.companyId, actor.userId ?? null, actor.user, formCode, entityKey, input.title ?? null, payloadJson, bytes, at, input.savedBy, input.projectId ?? null, input.siteId ?? null, actor.user);
        }
        const row = live(actor, formCode, entityKey);
        return present(row, formNames());
      });
    },

    /** @param {any} actor @param {string} formCode @param {string} entityKey @param {{ version?: number }} [opts] */
    remove(actor, formCode, entityKey, { version } = {}) {
      return transaction(db, () => {
        const row = live(actor, formCode, entityKey);
        if (!row) throw notFound('There is no draft of this form to discard.');
        if (version !== undefined && version !== row.version) throw conflict('The draft was saved again in another window. Reload it before discarding.');
        discard(row, actor, 'discarded by the person');
        return { discarded: 1 };
      });
    },

    removeMany(actor, ids) {
      return transaction(db, () => {
        const rows = db.prepare(`SELECT * FROM ui_drafts WHERE company_id = ? AND user_ref = ? AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).all(actor.companyId, actor.user, ...ids);
        for (const r of rows) discard(r, actor, 'discarded from My Drafts');
        return { discarded: rows.length, notFound: ids.length - rows.length };
      });
    },

    /** Called inside the transaction that saves the real record: the draft has done its job. */
    consume(actor, formCode, entityKey) {
      const row = live(actor, formCode, entityKey);
      if (row) db.prepare('UPDATE ui_drafts SET deleted_at = ?, deleted_by = ?, is_active = 0, remarks = ?, version = version + 1 WHERE id = ?').run(now(), actor.user, 'saved as the record', row.id);
      return Boolean(row);
    },
  };
  return service;
}
