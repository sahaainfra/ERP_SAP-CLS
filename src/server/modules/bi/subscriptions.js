import { z } from 'zod';
import { nextRun } from '../../../shared/cron.js';
import { transaction } from '../../platform/db/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { hasPermissionAnywhere } from '../../platform/auth/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../platform/http/errors.js';
import { writeAudit } from '../../platform/audit/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { parse } from '../../platform/validation/index.js';

const schedules = { DAILY: '0 8 * * *', WEEKLY: '0 8 * * 1', MONTHLY: '0 8 1 * *' };
const format = z.enum(['csv', 'xlsx', 'pdf']);
export const subscriptionInput = z.object({
  name: z.string().trim().min(1).max(80),
  savedReportId: z.number().int().positive().optional(),
  state: z.string().max(80).optional(),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  format,
  channel: z.enum(['IN_APP', 'EMAIL', 'WHATSAPP']),
}).strict();
export const subscriptionStatus = z.object({
  status: z.enum(['ACTIVE', 'PAUSED']), version: z.number().int().positive(),
}).strict();
export const subscriptionUpdate = subscriptionInput.extend({ version: z.number().int().positive() });

const present = (row) => ({
  id: row.id, name: row.name, savedReportId: row.saved_view_id, state: row.lifecycle_state,
  frequency: row.frequency, format: row.format, channel: row.channel,
  status: row.status, nextRunAt: row.status === 'ACTIVE' ? row.next_run_at : null, version: row.version,
});

const expected = (error) => [400, 403, 404, 422].includes(error.status);

export function createReportSubscriptions({ db, exports, views, verify, exportCodes, environment }) {
  const authz = authzOf(db);
  const notifications = notificationsOf(db);
  const account = (companyId, userId) => db.prepare(`SELECT id, username, roles_json FROM iam_users
    WHERE id = ? AND company_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL AND is_active = 1`).get(userId, companyId);
  const owner = (actor) => {
    // Development headers have no IAM user ID. Use the same company-local account the worker can resolve.
    const userId = actor.userId ?? (environment !== 'production' ? db.prepare(
      'SELECT id FROM iam_users WHERE company_id = ? AND username = ?'
    ).get(actor.companyId, actor.user)?.id : null);
    const row = userId && account(actor.companyId, userId);
    if (!row || row.username !== actor.user) throw forbidden('Sign in with an active company account to manage subscriptions.');
    return row.id;
  };
  const asOwner = (companyId, row) => authz.enrich({
    companyId, userId: row.id, user: row.username, roles: JSON.parse(row.roles_json),
  });
  const verifyAccess = (actor) => {
    verify(actor);
    if (!hasPermissionAnywhere(actor, 'proj.project.export')) throw forbidden('Report subscriptions require project export access.');
  };
  function exportQuery(actor, row) {
    const saved = row.saved_view_id == null ? null : views.list(actor, exportCodes.standard)
      .find((item) => item.id === row.saved_view_id && item.mine);
    if (row.saved_view_id != null && !saved) throw notFound('The saved report is unavailable.');
    const state = saved ? saved.config.filters.find((filter) => filter.key === 'state')?.value : row.lifecycle_state;
    return {
      code: saved ? exportCodes.custom : exportCodes.standard,
      query: {
        format: row.format,
        ...(state ? { 'filter[state]': state } : {}),
        ...(saved ? { fields: saved.config.columns.join(',') } : {}),
      },
    };
  }
  const get = (actor, ownerId, id) => {
    const row = db.prepare('SELECT * FROM rpt_subscriptions WHERE id = ? AND company_id = ? AND owner_id = ? AND deleted_at IS NULL')
      .get(id, actor.companyId, ownerId);
    if (!row) throw notFound('That subscription does not exist.');
    return row;
  };
  function checkSettings(actor, ownerId, input) {
    const current = asOwner(actor.companyId, account(actor.companyId, ownerId));
    if (input.savedReportId && input.state) throw badRequest('Set the lifecycle filter in the saved report.');
    if (!hasPermissionAnywhere(current, 'proj.project.export')) throw forbidden('Report subscriptions require project export access.');
    verify(current, input.savedReportId, input.state);
    exportQuery(current, { saved_view_id: input.savedReportId, lifecycle_state: input.state, format: input.format });
  }
  function checkName(actor, ownerId, name, except = 0) {
    if (db.prepare('SELECT 1 FROM rpt_subscriptions WHERE company_id = ? AND owner_id = ? AND name = ? COLLATE NOCASE AND id <> ? AND deleted_at IS NULL').get(actor.companyId, ownerId, name, except)) {
      throw conflict('You already have a subscription with that name.');
    }
  }
  const checkVersion = (row, version) => {
    if (row.version !== version) throw conflict('This subscription changed. Reload it and try again.');
  };

  return {
    assertAccess(actor) {
      verifyAccess(actor);
      owner(actor);
    },

    list(actor) {
      verifyAccess(actor);
      const ownerId = owner(actor);
      const rows = db.prepare('SELECT * FROM rpt_subscriptions WHERE company_id = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY id DESC')
        .all(actor.companyId, ownerId);
      const runs = db.prepare(`SELECT r.id, r.subscription_id AS subscriptionId, r.report_name AS name, r.scheduled_at AS scheduledAt, r.status, r.detail,
        r.export_id AS exportId,
        CASE WHEN r.notification_id IS NOT NULL THEN COALESCE(d.status, 'PREFERENCE_DISABLED') END AS deliveryStatus
        FROM rpt_runs r JOIN rpt_subscriptions s ON s.id = r.subscription_id
        LEFT JOIN ntf_deliveries d ON d.notification_id = r.notification_id AND d.channel = r.channel
        WHERE r.company_id = ? AND s.owner_id = ? ORDER BY r.id DESC LIMIT 50`).all(actor.companyId, ownerId);
      let savedReports = [];
      try {
        verify(actor, true);
        savedReports = views.list(actor, exportCodes.standard).filter((view) => view.mine)
          .map(({ id, name }) => ({ id, name }));
      } catch (error) {
        if (!expected(error)) throw error;
      }
      const usage = db.prepare(`SELECT r.status, COUNT(*) AS total FROM rpt_runs r
        JOIN rpt_subscriptions s ON s.id = r.subscription_id
        WHERE r.company_id = ? AND s.owner_id = ? AND r.scheduled_at >= ?
        GROUP BY r.status`).all(actor.companyId, ownerId, new Date(Date.now() - 30 * 86_400_000).toISOString());
      return { subscriptions: rows.map(present), savedReports, runs, usage };
    },

    create(actor, body) {
      verifyAccess(actor);
      const ownerId = owner(actor);
      const input = parse(subscriptionInput, body);
      return transaction(db, () => {
        checkSettings(actor, ownerId, input);
        checkName(actor, ownerId, input.name);
        const id = Number(db.prepare(`INSERT INTO rpt_subscriptions
          (company_id, owner_id, saved_view_id, name, frequency, format, channel, lifecycle_state, next_run_at, created_by, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'report_subscription')`)
          .run(actor.companyId, ownerId, input.savedReportId ?? null, input.name, input.frequency, input.format, input.channel,
            input.state || null, nextRun(schedules[input.frequency], new Date()), actor.user).lastInsertRowid);
        const result = present(get(actor, ownerId, id));
        writeAudit(db, { entity: 'rpt_subscriptions', entityId: id, action: 'create', actor: actor.user, companyId: actor.companyId, newValues: result });
        return result;
      });
    },

    update(actor, id, input) {
      verifyAccess(actor);
      const ownerId = owner(actor);
      return transaction(db, () => {
        const row = get(actor, ownerId, id);
        checkVersion(row, input.version);
        checkSettings(actor, ownerId, input);
        checkName(actor, ownerId, input.name, id);
        const next = row.frequency === input.frequency ? row.next_run_at : nextRun(schedules[input.frequency], new Date());
        db.prepare(`UPDATE rpt_subscriptions SET name = ?, saved_view_id = ?, lifecycle_state = ?, format = ?, channel = ?,
          frequency = ?, next_run_at = ?, version = version + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`).run(input.name, input.savedReportId ?? null, input.state || null, input.format,
          input.channel, input.frequency, next, actor.user, id);
        const result = present(get(actor, ownerId, id));
        writeAudit(db, { entity: 'rpt_subscriptions', entityId: id, action: 'update', actor: actor.user,
          companyId: actor.companyId, oldValues: present(row), newValues: result });
        return result;
      });
    },

    change(actor, id, input) {
      verifyAccess(actor);
      const ownerId = owner(actor);
      return transaction(db, () => {
        const row = get(actor, ownerId, id);
        checkVersion(row, input.version);
        const next = input.status === 'ACTIVE' ? nextRun(schedules[row.frequency], new Date()) : row.next_run_at;
        const remove = input.remove ? 1 : 0;
        db.prepare(`UPDATE rpt_subscriptions SET status = ?, next_run_at = ?, version = version + 1,
          updated_at = CURRENT_TIMESTAMP, updated_by = ?, deleted_at = CASE WHEN ? THEN CURRENT_TIMESTAMP END,
          deleted_by = CASE WHEN ? THEN ? END, is_active = ?
          WHERE id = ?`).run(input.status, next, actor.user, remove, remove, actor.user, 1 - remove, id);
        const result = input.remove ? null : present(get(actor, ownerId, id));
        writeAudit(db, { entity: 'rpt_subscriptions', entityId: id, action: input.remove ? 'delete' : 'update',
          actor: actor.user, companyId: actor.companyId, oldValues: present(row), newValues: result });
        return result;
      });
    },

    tick(now = new Date()) {
      const due = db.prepare(`SELECT * FROM rpt_subscriptions WHERE status = 'ACTIVE' AND deleted_at IS NULL
        AND next_run_at <= ? ORDER BY next_run_at, id LIMIT 100`).all(now.toISOString());
      for (const row of due) transaction(db, () => {
        const advanced = db.prepare(`UPDATE rpt_subscriptions SET next_run_at = ?
          WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL AND next_run_at = ? AND version = ?`)
          .run(nextRun(schedules[row.frequency], now), row.id, row.next_run_at, row.version);
        if (!advanced.changes) return;
        const user = account(row.company_id, row.owner_id);
        let result = { status: 'SKIPPED', id: null, detail: 'Subscriber is inactive.' };
        if (user) {
          const actor = asOwner(row.company_id, user);
          try {
            verifyAccess(actor);
            const { code, query } = exportQuery(actor, row);
            result = { status: 'QUEUED', id: exports.start(actor, code, query, { queued: true }).id, detail: null };
          } catch (error) {
            if (!expected(error)) throw error;
            result.detail = 'The subscriber or source report is unavailable.';
          }
        }
        db.prepare(`INSERT INTO rpt_runs (company_id, subscription_id, subscription_version, report_name, channel, export_id, scheduled_at, status, detail)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(row.company_id, row.id, row.version, row.name, row.channel, result.id, row.next_run_at, result.status, result.detail);
      });

      const finished = db.prepare(`SELECT r.id FROM rpt_runs r JOIN ui_export_jobs e ON e.id = r.export_id
        LEFT JOIN core_jobs j ON j.id = e.job_id WHERE r.status = 'QUEUED'
        AND (e.status IN ('DONE','EXPIRED') OR j.status IN ('FAILED','CANCELLED')) ORDER BY r.id LIMIT 100`).all();
      for (const { id } of finished) transaction(db, () => {
        const row = db.prepare(`SELECT r.*, s.owner_id, s.status AS subscription_status, s.deleted_at AS subscription_deleted, s.version AS current_version,
          e.status AS export_status, e.expires_at
          FROM rpt_runs r JOIN rpt_subscriptions s ON s.id = r.subscription_id JOIN ui_export_jobs e ON e.id = r.export_id
          WHERE r.id = ? AND r.status = 'QUEUED'`).get(id);
        if (!row) return;
        let status = 'FAILED';
        let detail = 'The export is unavailable. See My Exports.';
        let notificationId = null;
        if (row.export_status === 'DONE' && row.expires_at > now.toISOString()) {
          const user = account(row.company_id, row.owner_id);
          try {
            if (!user || row.subscription_deleted || row.subscription_status !== 'ACTIVE' || row.subscription_version !== row.current_version) {
              throw forbidden('Subscription settings changed.');
            }
            const actor = asOwner(row.company_id, user);
            exports.checkAccess(actor, row.export_id);
            const note = notifications.notify({
              companyId: row.company_id, templateCode: 'bi.report.ready', recipients: [`user:${actor.user}`],
              channels: ['IN_APP', row.channel], data: {}, link: '/account/exports',
              sourceType: 'report_subscription_run', sourceId: id,
            });
            notificationId = note.ids[0] ?? null;
            status = 'READY';
            detail = null;
          } catch (error) {
            if (!expected(error)) throw error;
            status = 'SKIPPED';
            detail = 'Subscription or report access changed before delivery.';
          }
        }
        db.prepare('UPDATE rpt_runs SET status = ?, detail = ?, notification_id = ?, updated_at = CURRENT_TIMESTAMP, version = version + 1 WHERE id = ?')
          .run(status, detail, notificationId, id);
      });
      return { due: due.length, finished: finished.length };
    },
  };
}
