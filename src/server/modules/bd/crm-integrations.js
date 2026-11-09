import { authzOf } from '../../platform/authz/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { lookupRegistry } from '../../platform/lookups/index.js';
import { registerImportType } from '../eng/excel.js';
import { SECTORS, SOURCES } from './constants.js';
import { crmOf } from './crm.js';

// Business development (part 08.01) for the rest of the ERP: the lookups of the forms (clients from the partner master and the users who own leads), the files of leads and opportunities (offers, brochures, minutes) and the Excel import (04.13): a row
// makes a draft lead or opportunity; an import never qualifies a lead and never gives a go-ahead (AC-04).
const CLIENT_SQL = "p.company_id = ? AND p.deleted_at IS NULL AND p.partner_status IN ('PROSPECT', 'PENDING', 'ACTIVE') AND EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role = 'CLIENT' AND r.deleted_at IS NULL)";
lookupRegistry.register({
  module: 'bd', name: 'clients', label: 'Clients and prospects', permission: 'bd.client.view', columns: [{ key: 'status', label: 'Status' }],
  search(db, actor, q) {
    const where = [CLIENT_SQL]; const args = [actor.companyId];
    if (q.ids) { where.push(`p.id IN (${q.ids.map(() => '?').join(',')})`); args.push(...q.ids); }
    if (q.text) { where.push('(p.code LIKE ? OR p.legal_name LIKE ? OR p.trade_name LIKE ?)'); args.push(`${q.text}%`, `%${q.text}%`, `%${q.text}%`); }
    const total = db.prepare(`SELECT COUNT(*) AS n FROM mdm_partners p WHERE ${where.join(' AND ')}`).get(...args).n;
    const rows = db.prepare(`SELECT p.id, p.code, p.legal_name, p.partner_status FROM mdm_partners p WHERE ${where.join(' AND ')} ORDER BY p.legal_name LIMIT ? OFFSET ?`).all(...args, q.ids ? 200 : q.limit, q.ids ? 0 : q.offset);
    return { rows: rows.map((r) => ({ id: r.id, code: r.code, name: r.legal_name, extra: { status: r.partner_status } })), total };
  },
});
lookupRegistry.register({
  module: 'bd', name: 'owners', label: 'Business development owners', permission: 'bd.lead.view', columns: [],
  search(db, actor, q) {
    const all = db.prepare("SELECT id, username, display_name, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1 ORDER BY display_name, username").all(actor.companyId)
      .filter((u) => { try { return JSON.parse(u.roles_json ?? '[]').some((r) => ['BD', 'DIR', 'COMMGR', 'EST'].includes(r)); } catch { return false; } })
      .filter((u) => !q.text || `${u.username} ${u.display_name ?? ''}`.toLowerCase().includes(q.text.toLowerCase()));
    const rows = q.ids ? all.filter((u) => q.ids.includes(u.id)) : all.slice(q.offset, q.offset + q.limit);
    return { rows: rows.map((u) => ({ id: u.id, code: u.username, name: u.display_name ?? u.username, extra: {} })), total: q.ids ? rows.length : all.length };
  },
});
for (const [entity, label, view, edit] of [['bd_lead', 'Lead attachments', 'bd.lead.view', 'bd.lead.edit'], ['bd_opportunity', 'Opportunity attachments', 'bd.opportunity.view', 'bd.opportunity.track']]) {
  fileEntities.register({
    entity, label,
    resolve(db, actor, id) {
      const a = crmOf(db)?.access(actor, entity, id); if (!a) return null;
      const authz = authzOf(db);
      return { companyId: a.companyId, projectId: null, siteId: null, canView: authz.check(actor, view).allowed, canEdit: a.canEdit && authz.check(actor, edit).allowed, locked: false };
    },
  });
}
const clientByCode = (db, companyId, code) => db.prepare("SELECT p.id FROM mdm_partners p WHERE p.company_id = ? AND lower(p.code) = lower(?) AND p.deleted_at IS NULL AND p.partner_status IN ('PROSPECT', 'PENDING', 'ACTIVE') AND EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role = 'CLIENT' AND r.deleted_at IS NULL)").get(companyId, String(code ?? '').trim())?.id ?? null;
const rating = (v) => { const s = String(v ?? '').trim().toUpperCase(); return ['YES', 'PARTIAL', 'NO'].includes(s) ? s : null; };
registerImportType({
  code: 'BD_LEAD', label: 'Leads (drafts)', module: 'business development',
  description: 'Each row makes a draft lead of the person who imports it. Name the client by its partner code, or write the client name for a prospect not yet in the partner master. The qualification is rated Yes, Partial or No; the lead is sent for qualification by hand.',
  permission: 'bd.lead.import', exportPermission: 'bd.lead.export', onExisting: ['ERROR'], chunked: false,
  columns: [
    { key: 'title', label: 'Title', type: 'text', required: true, maxLength: 160 }, { key: 'source', label: 'Source', type: 'enum', values: Object.keys(SOURCES), required: true }, { key: 'sourceRef', label: 'Source reference', type: 'text', maxLength: 80 },
    { key: 'sector', label: 'Sector', type: 'enum', values: Object.keys(SECTORS), required: true }, { key: 'clientCode', label: 'Client code', type: 'text', maxLength: 30 }, { key: 'clientName', label: 'Client name', type: 'text', maxLength: 160 },
    { key: 'contactName', label: 'Contact', type: 'text', maxLength: 80 }, { key: 'phone', label: 'Phone', type: 'text', maxLength: 20 }, { key: 'email', label: 'E-mail', type: 'text', maxLength: 120 }, { key: 'location', label: 'Location', type: 'text', maxLength: 120 }, { key: 'region', label: 'Region', type: 'text', maxLength: 40 },
    { key: 'estValue', label: 'Estimated value (₹)', type: 'money', min: 0 }, { key: 'budget', label: 'Budget', type: 'text', maxLength: 8, help: 'Yes, Partial or No' }, { key: 'authority', label: 'Authority', type: 'text', maxLength: 8 }, { key: 'need', label: 'Need', type: 'text', maxLength: 8 }, { key: 'timeline', label: 'Timeline', type: 'text', maxLength: 8 },
  ],
  keys: ['title'], findExisting: () => null,
  validateRow(ctx, row) {
    const out = [];
    if (row.clientCode && !clientByCode(ctx.db, ctx.actor.companyId, row.clientCode)) out.push({ column: 'clientCode', message: `${row.clientCode} is not a client or prospect in the partner master` });
    if (!row.clientCode && !row.clientName) out.push({ column: 'clientName', message: 'Give the client code or the client name' });
    for (const k of ['budget', 'authority', 'need', 'timeline']) if (row[k] && !rating(row[k])) out.push({ column: k, message: 'Use Yes, Partial or No' });
    return out;
  },
  commitRow(ctx, { row }) {
    const q = Object.fromEntries(['budget', 'authority', 'need', 'timeline'].map((k) => [k, { rating: rating(row[k]), note: null }]));
    const r = crmOf(ctx.db).leads.create(ctx.actor, { source: row.source, sourceRef: row.sourceRef ?? null, title: row.title, clientPartnerId: row.clientCode ? clientByCode(ctx.db, ctx.actor.companyId, row.clientCode) : null, clientName: row.clientCode ? null : row.clientName, contactName: row.contactName ?? null, phone: row.phone ?? null, email: row.email ?? null, sector: row.sector, location: row.location ?? null, region: row.region ?? null, estValue: Number(row.estValue ?? 0), qualification: q, submit: false });
    return { id: r.id, ref: `${r.docNo} (draft)` };
  },
});
registerImportType({
  code: 'BD_OPPORTUNITY', label: 'Opportunities (drafts)', module: 'business development',
  description: 'Each row makes a draft opportunity at stage Identified or Qualified, for a client or prospect of the partner master. The go-ahead for tendering is asked for by hand; an import never gives it.',
  permission: 'bd.opportunity.import', exportPermission: 'bd.opportunity.export', onExisting: ['ERROR'], chunked: false,
  columns: [
    { key: 'name', label: 'Project', type: 'text', required: true, maxLength: 160 }, { key: 'clientCode', label: 'Client code', type: 'text', required: true, maxLength: 30 }, { key: 'sector', label: 'Sector', type: 'enum', values: Object.keys(SECTORS), required: true },
    { key: 'location', label: 'Location', type: 'text', maxLength: 120 }, { key: 'region', label: 'Region', type: 'text', maxLength: 40 }, { key: 'estValue', label: 'Estimated value (₹)', type: 'money', required: true, min: 0 },
    { key: 'stage', label: 'Stage', type: 'enum', values: ['IDENTIFIED', 'QUALIFIED'] }, { key: 'expectedTenderDate', label: 'Expected tender date', type: 'date' }, { key: 'expectedAwardDate', label: 'Expected award date', type: 'date' },
  ],
  keys: ['name'], findExisting: () => null,
  validateRow(ctx, row) {
    const out = [];
    if (!clientByCode(ctx.db, ctx.actor.companyId, row.clientCode)) out.push({ column: 'clientCode', message: `${row.clientCode} is not a client or prospect in the partner master` });
    if (row.expectedTenderDate && row.expectedAwardDate && row.expectedAwardDate < row.expectedTenderDate) out.push({ column: 'expectedAwardDate', message: 'The expected award is on or after the expected tender date' });
    return out;
  },
  commitRow(ctx, { row }) {
    const r = crmOf(ctx.db).opportunities.create(ctx.actor, { clientPartnerId: clientByCode(ctx.db, ctx.actor.companyId, row.clientCode), name: row.name, sector: row.sector, location: row.location ?? null, region: row.region ?? null, estValue: Number(row.estValue ?? 0), stage: row.stage ?? 'IDENTIFIED', expectedTenderDate: row.expectedTenderDate ?? null, expectedAwardDate: row.expectedAwardDate ?? null, competitors: [], submit: false });
    return { id: r.id, ref: `${r.docNo} (draft)` };
  },
});
