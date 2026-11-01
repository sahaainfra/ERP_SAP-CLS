import { assertPermissionAnywhere } from '../../platform/auth/index.js';
import { createFrom, duplicateChecks } from '../../platform/forms/index.js';
import { notFound } from '../../platform/http/errors.js';
import { lookupRegistry } from '../../platform/lookups/index.js';

const present = (r) => ({ code: r.form_code, version: r.form_version, name: r.name, module: r.module, status: r.status, ...JSON.parse(r.layout_json), ...JSON.parse(r.schema_json) });

/**
 * Form definitions and the framework's hooks (part 03.02, FR-08 to FR-10). A definition is read by every signed-in person (it holds
 * labels and rules, no data); a company-specific version, when one exists, wins over the shared one. The registry lists what the
 * framework offers (forms, lookups, duplicate checks, create-from) for the components gallery.
 */
export function createFormService({ db }) {
  const latest = (actor, code) => db.prepare("SELECT * FROM ui_form_metadata WHERE form_code = ? AND status = 'ACTIVE' AND is_active = 1 AND (company_id IS NULL OR company_id = ?) ORDER BY company_id IS NULL, form_version DESC LIMIT 1").get(code, actor.companyId);

  return {
    list(actor) {
      const rows = db.prepare("SELECT * FROM ui_form_metadata WHERE status = 'ACTIVE' AND is_active = 1 AND (company_id IS NULL OR company_id = ?) ORDER BY form_code, company_id IS NULL, form_version DESC").all(actor.companyId);
      const seen = new Set();
      return rows.filter((r) => !seen.has(r.form_code) && seen.add(r.form_code)).map((r) => ({ code: r.form_code, version: r.form_version, name: r.name, module: r.module, scope: r.company_id ? 'company' : 'shared' }));
    },

    get(actor, code) {
      const row = latest(actor, code);
      if (!row) throw notFound(`There is no form called ${code}.`);
      return { ...present(row), createFrom: createFrom.sourcesFor(code) };
    },

    registry(actor) {
      return {
        forms: this.list(actor),
        lookups: lookupRegistry.list().map((l) => ({ path: `/api/v1/${l.module}/lookups/${l.name}`, label: l.label, permission: l.permission ?? 'signed in', columns: l.columns.map((c) => c.label) })),
        duplicateChecks: duplicateChecks.names().map((n) => ({ name: n, label: duplicateChecks.get(n).label, permission: duplicateChecks.get(n).permission ?? 'signed in' })),
        createFrom: this.list(actor).flatMap((f) => createFrom.sourcesFor(f.code).map((s) => ({ target: f.code, ...s }))),
      };
    },

    /** Similar records to warn about while the form is filled in; the person decides (FR-08). */
    duplicates(actor, name, fields) {
      const def = duplicateChecks.get(name);
      if (def.permission) assertPermissionAnywhere(actor, def.permission);
      const matches = def.check(db, actor, fields);
      return { check: name, matches };
    },

    /** The values a new record starts with when it is made from another one (FR-09). */
    createFrom(actor, target, { source, id }) {
      const def = createFrom.get(target, source);
      if (def.permission) assertPermissionAnywhere(actor, def.permission);
      return { target, source, sourceId: id, ...def.prefill(db, actor, id) };
    },
  };
}
