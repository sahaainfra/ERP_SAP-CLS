import { assertPermission } from '../auth/index.js';
import { writeAudit, recordSecurityEvent } from '../audit/index.js';
import { publishEvent } from '../events/index.js';
import { unprocessable } from '../http/errors.js';
import { createParameterStore } from '../parameters/index.js';
import { securitySettingsOf } from './settings.js';

/**
 * Export controls (part 02.07, FR-08). An export needs the permission of its report (`*.export`); more rows than
 * `core.export.max_rows` are refused (they belong in a background job); an export of personal data over the threshold in the
 * security settings (1,000 people by default) needs an approved request (requester, then the HR manager or the director) that
 * can be used once; every export is written to the audit trail, and an export of personal data is also a security event.
 */
export function createExportGuard({ db, approvals }) {
  const settings = securitySettingsOf(db);
  const today = () => new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);
  const maxRows = (companyId) => Number(createParameterStore(db).get('core.export.max_rows', { companyId, date: today() }));
  const stable = (o) => JSON.stringify(o, Object.keys(o ?? {}).sort());

  return {
    threshold: () => settings.get().settings.exports.personalApprovalThreshold,
    /**
     * Decide whether this export may run now. Returns { status: 'OK' } or { status: 'APPROVAL_REQUIRED', request } (the request was
     * raised, or is the one already waiting). Throws when the permission is missing, the export is too large or the approval
     * given is not valid.
     */
    authorize(actor, { report, permission, rows, personal, filters = {}, approvalId = null }) {
      assertPermission(actor, permission);
      const max = maxRows(actor.companyId);
      if (rows > max) throw unprocessable(`This export has ${rows} rows; the most a download may hold is ${max}. Narrow the filters and export in parts.`);
      const threshold = settings.get().settings.exports.personalApprovalThreshold;
      if (!personal || rows <= threshold) return { status: 'OK' };
      if (!approvalId) {
        const open = db.prepare("SELECT id FROM core_change_requests WHERE company_id = ? AND type = 'bulk_personal_export' AND requested_by = ? AND status = 'SUBMITTED' AND is_active = 1 ORDER BY id DESC").all(actor.companyId, actor.user).find((r) => JSON.parse(db.prepare('SELECT payload_json FROM core_change_requests WHERE id = ?').get(r.id).payload_json).report === report);
        if (open) return { status: 'APPROVAL_REQUIRED', request: approvals.get(actor, open.id) };
        const request = approvals.submit(actor, {
          type: 'bulk_personal_export', title: `Export ${rows} people records (${report})`, targetType: 'export', targetId: 0, reason: `Bulk export of personal data: ${report}, ${rows} records`,
          chain: ['HRMGR|DIR'], payload: { report, rows, filters },
        });
        return { status: 'APPROVAL_REQUIRED', request };
      }
      const r = db.prepare("SELECT * FROM core_change_requests WHERE id = ? AND company_id = ? AND type = 'bulk_personal_export' AND is_active = 1").get(approvalId, actor.companyId);
      const p = r ? JSON.parse(r.payload_json) : null;
      if (!r || r.requested_by !== actor.user || p.report !== report) throw unprocessable('That approval is not for this export, or it is not yours.');
      if (r.status !== 'APPROVED') throw unprocessable(`That approval is ${r.status.toLowerCase()}, so the export cannot run yet.`);
      if (stable(p.filters) !== stable(filters)) throw unprocessable('The filters changed since the export was approved. Ask for approval of this export.');
      if (db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'export_grant' AND action = 'used' AND entity_id = ?").get(String(approvalId))) throw unprocessable('That approval was already used for an export. Ask again.');
      return { status: 'OK', approvalId };
    },
    /** Record a finished export: the audit trail, the security log (personal data) and the event. */
    complete(actor, { report, format = 'csv', rows, filters = {}, personal = false, approvalId = null }) {
      writeAudit(db, { entity: 'report', entityId: report, action: 'export', newValues: { format, rows, filters, personal, approval: approvalId }, actor: actor.user, companyId: actor.companyId });
      if (approvalId) writeAudit(db, { entity: 'export_grant', entityId: approvalId, action: 'used', newValues: { report, rows }, actor: actor.user, companyId: actor.companyId });
      if (personal) recordSecurityEvent(db, { companyId: actor.companyId, userId: actor.userId ?? null, username: actor.user, type: 'export.sensitive', severity: rows > settings.get().settings.exports.personalApprovalThreshold ? 'HIGH' : 'WARNING', details: { report, format, rows, filters, approval: approvalId } });
      publishEvent(db, { type: 'core.export.completed', entity: 'export', entityId: report, actorId: actor.user, companyId: actor.companyId, data: { report, format, rows, personal } });
    },
  };
}
