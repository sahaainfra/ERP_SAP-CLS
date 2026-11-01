import { hasPermission } from '../../platform/auth/index.js';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, unprocessable } from '../../platform/http/errors.js';
import tokens from '../../../shared/design/design-tokens.json' with { type: 'json' };
import icons from '../../../shared/design/icon-registry.json' with { type: 'json' };
import { contrastReport } from '../../../shared/design/contrast.js';

const DEFAULTS = { theme: 'light', density: 'comfortable', language: 'en', startPage: null, tableSettings: {} };
const present = (r) => (r
  ? { theme: r.theme, density: r.density, language: r.language, startPage: r.start_page, tableSettings: JSON.parse(r.table_settings_json), version: r.version, saved: true, updatedAt: r.updated_at ?? r.created_at }
  : { ...DEFAULTS, version: 0, saved: false, updatedAt: null });

/** Each person's screen preferences (part 03.01) and the design system's style guide. */
export function createUiService({ db, config }) {
  const rowOf = (actor) => db.prepare('SELECT * FROM ui_user_preferences WHERE company_id = ? AND user_ref = ? AND is_active = 1').get(actor.companyId, actor.user);

  return {
    /** The person's own preferences, or the defaults when they have chosen nothing yet. Nobody reads another person's. */
    get(actor) {
      const row = rowOf(actor);
      if (row || !actor.userId) return present(row);
      const old = db.prepare("SELECT preferences_json FROM iam_user_profiles WHERE user_id = ?").get(actor.userId);
      const theme = old ? JSON.parse(old.preferences_json || '{}').theme : null;
      return { ...present(null), ...(['light', 'dark', 'high-contrast'].includes(theme) ? { theme, saved: true, fromProfile: true } : {}) };
    },

    /** Change the person's own preferences. A stale version is refused, so two devices cannot overwrite each other unseen. */
    update(actor, input) {
      if (!db.prepare('SELECT 1 FROM org_companies WHERE id = ?').get(actor.companyId)) throw unprocessable('Your company is not set up yet, so preferences cannot be saved.');
      return transaction(db, () => {
        const before = rowOf(actor);
        if (before && input.version !== undefined && input.version !== before.version) throw conflict('Your preferences were changed on another device. Reload to see them, then try again.');
        const was = present(before);
        const next = {
          theme: input.theme ?? was.theme, density: input.density ?? was.density, language: input.language ?? was.language,
          startPage: input.startPage === undefined ? was.startPage : input.startPage,
          tableSettings: input.tableSettings ? { ...was.tableSettings, ...input.tableSettings } : was.tableSettings,
        };
        const tableJson = JSON.stringify(next.tableSettings);
        if (tableJson.length > 20_000) throw unprocessable('The saved table settings are too large. Remove some saved tables first.');
        const at = new Date().toISOString();
        let id = before?.id;
        if (before) {
          db.prepare('UPDATE ui_user_preferences SET theme = ?, density = ?, language = ?, start_page = ?, table_settings_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
            .run(next.theme, next.density, next.language, next.startPage, tableJson, actor.user, at, before.id);
        } else {
          id = Number(db.prepare("INSERT INTO ui_user_preferences (company_id, user_id, user_ref, theme, density, language, start_page, table_settings_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ui_preferences')")
            .run(actor.companyId, actor.userId ?? null, actor.user, next.theme, next.density, next.language, next.startPage, tableJson, actor.user).lastInsertRowid);
        }
        const shown = (p) => ({ theme: p.theme, density: p.density, language: p.language, startPage: p.startPage, tables: Object.keys(p.tableSettings).length });
        writeAudit(db, { entity: 'ui_user_preferences', entityId: id, action: before ? 'update' : 'create', oldValues: before ? shown(was) : null, newValues: shown(next), actor: actor.user, companyId: actor.companyId });
        publishEvent(db, { type: 'ui.preferences.changed', entity: 'ui_preferences', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { theme: next.theme, density: next.density, language: next.language } });
        return present(rowOf(actor));
      });
    },

    /** The style guide: every token, the contrast report and the icon registry. In production, only for those with ui.styleguide.view. */
    styleGuide(actor) {
      const open = config.environment !== 'production';
      if (!open && !hasPermission(actor, 'ui.styleguide.view')) throw forbidden('Your role does not include ui.styleguide.view. Ask a system administrator for access.');
      const counts = Object.fromEntries(['groups', 'actions', 'states', 'construction', 'modules'].map((g) => [g, Object.keys(icons[g]).length]));
      return { tokens, contrast: contrastReport(tokens), icons: { grid: icons.grid, stroke: icons.stroke, sizes: icons.sizes, counts }, environment: config.environment, openToAll: open };
    },
  };
}
