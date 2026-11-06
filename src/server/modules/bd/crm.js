import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { AWARD_DOC, AWARD_STATUS, BANT, GO_AHEAD_FROM, LEAD_DOC, LEAD_STATUS, OPEN_STAGES, OPP_DOC, OPP_STATUS, RATINGS, SECTORS, SOURCES, STAGES, STAGE_LIST, esc, json, nowIso, rupees, same, stageIndex, toMinor, weightedMinor, WEIGHTED_SQL } from './constants.js';
import { createKit } from './kit.js';
import { createOps } from './crm-ops.js';

/** The id of the record in the document id of a workflow instance: an amendment is approved as '12-A1', the first approval as '12'. */
const rid = (v) => parseInt(String(v), 10);
const wfDoc = (id, n) => (n ? `${id}-A${n}` : String(id));
const CLIENT_OK = ['PROSPECT', 'PENDING', 'ACTIVE'];
const CLIENT_ROLE = "EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role = 'CLIENT' AND r.deleted_at IS NULL)";
const SCOPE_L = (all) => (all ? 'l.company_id = :c AND (1 = 1 OR :u IS NULL OR :roles IS NULL)' : "l.company_id = :c AND (lower(l.owner) = lower(:u) OR lower(l.created_by) = lower(:u) OR EXISTS (SELECT 1 FROM wf_tasks t JOIN wf_instances i ON i.id = t.instance_id WHERE i.doc_type = 'BD_LEAD' AND (i.doc_id = CAST(l.id AS TEXT) OR i.doc_id LIKE CAST(l.id AS TEXT) || '-A%') AND t.status IN ('OPEN', 'ADMIN_QUEUE', 'DONE') AND (lower(t.assignee_user_id) = lower(:u) OR t.assignee_role IN (SELECT value FROM json_each(:roles)))))");
const SCOPE_O = (all) => (all ? 'o.company_id = :c AND (1 = 1 OR :u IS NULL OR :roles IS NULL)' : "o.company_id = :c AND (lower(o.owner) = lower(:u) OR lower(o.created_by) = lower(:u) OR EXISTS (SELECT 1 FROM wf_tasks t JOIN wf_instances i ON i.id = t.instance_id WHERE i.doc_type IN ('BD_OPPORTUNITY', 'BD_DIRECT_AWARD') AND (i.doc_id = CAST(o.id AS TEXT) OR i.doc_id LIKE CAST(o.id AS TEXT) || '-A%') AND t.status IN ('OPEN', 'ADMIN_QUEUE', 'DONE') AND (lower(t.assignee_user_id) = lower(:u) OR t.assignee_role IN (SELECT value FROM json_each(:roles)))))");

export const leadList = defineList({
  code: 'bd.leads', label: 'Leads', permission: 'bd.lead.view',
  from: 'bd_leads l LEFT JOIN mdm_partners p ON p.id = l.client_partner_id', where: 'l.deleted_at IS NULL', searchable: ['l.doc_no', 'l.title', 'l.client_name', 'p.legal_name', 'l.contact_name'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'l.doc_no', type: 'text', label: 'Lead' }, title: { sql: 'l.title', type: 'text', label: 'Title' }, client: { sql: 'COALESCE(p.legal_name, l.client_name)', type: 'text', label: 'Client' },
    source: { sql: 'l.source', type: 'enum', label: 'Source', options: Object.entries(SOURCES) }, sector: { sql: 'l.sector', type: 'enum', label: 'Sector', options: Object.entries(SECTORS) }, region: { sql: 'l.region', type: 'text', label: 'Region' },
    estValue: { sql: '(l.est_value_minor / 100.0)', type: 'money', label: 'Estimated value (₹)' }, score: { sql: 'l.qual_score', type: 'number', label: 'Qualification score' }, owner: { sql: 'l.owner', type: 'text', label: 'Owner' },
    docDate: { sql: 'l.doc_date', type: 'date', label: 'Raised' }, status: { sql: 'l.status', type: 'enum', label: 'Status', options: Object.entries(LEAD_STATUS) },
  },
});
export const opportunityList = defineList({
  code: 'bd.opportunities', label: 'Opportunities', permission: 'bd.opportunity.view',
  from: 'bd_opportunities o JOIN mdm_partners p ON p.id = o.client_partner_id', where: 'o.deleted_at IS NULL', searchable: ['o.doc_no', 'o.name', 'p.legal_name', 'p.code'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'o.doc_no', type: 'text', label: 'Opportunity' }, name: { sql: 'o.name', type: 'text', label: 'Project' }, client: { sql: 'p.legal_name', type: 'text', label: 'Client' },
    sector: { sql: 'o.sector', type: 'enum', label: 'Sector', options: Object.entries(SECTORS) }, region: { sql: 'o.region', type: 'text', label: 'Region' }, stage: { sql: 'o.stage', type: 'enum', label: 'Stage', options: Object.entries(STAGES) },
    estValue: { sql: '(o.est_value_minor / 100.0)', type: 'money', label: 'Estimated value (₹)' }, probability: { sql: 'o.probability_pct', type: 'number', label: 'Probability (%)' }, weighted: { sql: `(${WEIGHTED_SQL('o')} / 100.0)`, type: 'money', label: 'Weighted value (₹)' },
    expectedAward: { sql: 'o.expected_award_date', type: 'date', label: 'Expected award' }, owner: { sql: 'o.owner', type: 'text', label: 'Owner' }, status: { sql: 'o.status', type: 'enum', label: 'Go-ahead', options: Object.entries(OPP_STATUS) },
  },
});

export function createCrmService({ db }) {
  const kit = createKit(db);
  const { may, need, param, today, nextDoc, event, tell } = kit;
  const maker = (actor, r) => same(r.created_by, actor.user) || same(r.owner, actor.user);
  const seesAll = (actor) => may(actor, 'bd.view_all');
  const scopeParams = (actor) => ({ c: actor.companyId, u: actor.user, roles: JSON.stringify(actor.roles ?? []) });
  const approverOf = (actor, docTypes, id) => Boolean(db.prepare(`SELECT 1 FROM wf_tasks t JOIN wf_instances i ON i.id = t.instance_id WHERE i.company_id = ? AND i.doc_type IN (${docTypes.map(() => '?').join(',')}) AND (i.doc_id = ? OR i.doc_id LIKE ?) AND t.status IN ('OPEN', 'ADMIN_QUEUE', 'DONE') AND (lower(t.assignee_user_id) = lower(?) OR t.assignee_role IN (SELECT value FROM json_each(?)))`).get(actor.companyId, ...docTypes, String(id), `${id}-A%`, actor.user, JSON.stringify(actor.roles ?? [])));
  const seen = (actor, r, docTypes) => r.company_id === actor.companyId && (seesAll(actor) || maker(actor, r) || approverOf(actor, docTypes, r.id));

  // ------------------------------------------------------------------ the client: read from the partner master (06.04), never copied (FR-02)
  const clientRow = (companyId, id) => (id ? db.prepare(`SELECT p.id, p.code, p.legal_name, p.trade_name, p.partner_status FROM mdm_partners p WHERE p.id = ? AND p.company_id = ? AND p.deleted_at IS NULL AND ${CLIENT_ROLE}`).get(rid(id), companyId) : undefined);
  const clientProblem = (companyId, id) => {
    const c = clientRow(companyId, id);
    if (!c) return { field: 'clientPartnerId', message: 'Choose a client from the partner master (a business partner with the role Client); register a prospect there first if it is new' };
    if (!CLIENT_OK.includes(c.partner_status)) return { field: 'clientPartnerId', message: `${c.legal_name} is ${c.partner_status.toLowerCase().replace('_', ' ')} in the partner master and cannot be chosen` };
    return null;
  };
  const regionProblem = (companyId, region) => { const l = param(companyId, 'bd.regions'); return region && Array.isArray(l) && l.length && !l.includes(region) ? { field: 'region', message: `The region is one of ${l.join(', ')}` } : null; };
  const ownerProblem = (companyId, owner) => (owner && !kit.userExists(companyId, owner) ? { field: 'owner', message: 'The owner is not an active user of this company' } : null);

  // ------------------------------------------------------------------ leads (FR-01)
  const qualOf = (q = {}) => {
    const out = {}; let pts = 0; let rated = 0;
    for (const k of BANT) { const x = q?.[k] ?? {}; const rating = x.rating ?? null; out[k] = { rating, note: x.note?.trim() || null }; if (rating) rated += 1; pts += rating === 'YES' ? 3 : rating === 'PARTIAL' ? 1 : 0; }
    return { json: out, score: Math.round((pts / (BANT.length * 3)) * 100), complete: rated === BANT.length };
  };
  const leadRow = (actor, id) => {
    const l = db.prepare('SELECT * FROM bd_leads WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!l || !seen(actor, l, [LEAD_DOC])) throw notFound('That lead does not exist or is not yours to see.');
    return l;
  };
  const leadFields = (l) => ({ source: l.source, sourceRef: l.source_ref, title: l.title, clientPartnerId: l.client_partner_id, clientName: l.client_name, contactName: l.contact_name, phone: l.phone, email: l.email, sector: l.sector, location: l.location, region: l.region, estValue: rupees(l.est_value_minor), qualification: json(l.qualification_json, {}), owner: l.owner });
  const defined = (b) => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
  function leadProblems(actor, m) {
    const out = [];
    if (m.clientPartnerId) { const p = clientProblem(actor.companyId, m.clientPartnerId); if (p) out.push(p); } else if (!String(m.clientName ?? '').trim()) out.push({ field: 'clientName', message: 'Name the client, or choose one from the partner master' });
    for (const p of [regionProblem(actor.companyId, m.region), ownerProblem(actor.companyId, m.owner)]) if (p) out.push(p);
    return out;
  }
  const leadView = (actor, l, { detail = false } = {}) => {
    const p = l.client_partner_id ? clientRow(l.company_id, l.client_partner_id) : null; const mine = maker(actor, l);
    const v = {
      id: l.id, docNo: l.doc_no, docDate: l.doc_date, status: l.status, statusLabel: LEAD_STATUS[l.status], rowVersion: l.version, source: l.source, sourceLabel: SOURCES[l.source], sourceRef: l.source_ref, title: l.title,
      clientPartnerId: l.client_partner_id, clientCode: p?.code ?? null, clientName: p?.legal_name ?? l.client_name, contactName: l.contact_name, phone: l.phone, email: l.email, sector: l.sector, sectorLabel: SECTORS[l.sector], location: l.location, region: l.region,
      estValue: rupees(l.est_value_minor), qualification: json(l.qualification_json, {}), qualScore: l.qual_score, owner: l.owner, amendmentNo: l.amendment_no, opportunityId: l.opportunity_id, convertedAt: l.converted_at, workflowInstanceId: l.workflow_instance_id, requestedBy: l.requested_by, createdBy: l.created_by,
      can: {
        edit: ['DRAFT', 'RETURNED'].includes(l.status) && mine && may(actor, 'bd.lead.edit'), submit: ['DRAFT', 'RETURNED'].includes(l.status) && mine && may(actor, 'bd.lead.submit'), delete: l.status === 'DRAFT' && mine && may(actor, 'bd.lead.delete'),
        withdraw: l.status === 'SUBMITTED' && same(l.requested_by, actor.user), cancel: ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'].includes(l.status) && mine && may(actor, 'bd.lead.cancel'),
        amend: l.status === 'APPROVED' && mine && may(actor, 'bd.lead.amend'), convert: l.status === 'APPROVED' && (mine || seesAll(actor)) && may(actor, 'bd.lead.convert'), print: may(actor, 'bd.lead.print'), interact: !['CANCELLED'].includes(l.status) && may(actor, 'bd.interaction.log'),
      },
    };
    if (detail) {
      v.amendments = db.prepare("SELECT amendment_no AS no, snapshot_json, reason, amended_by AS by, amended_at AS at FROM bd_amendments WHERE entity = 'LEAD' AND entity_id = ? ORDER BY amendment_no").all(l.id).map((a) => ({ no: a.no, reason: a.reason, by: a.by, at: a.at, before: json(a.snapshot_json, {}) }));
      v.related = l.opportunity_id ? [{ type: 'Opportunity', id: l.opportunity_id, ref: db.prepare('SELECT doc_no FROM bd_opportunities WHERE id = ?').get(l.opportunity_id)?.doc_no, route: `/bd/opportunity?id=${l.opportunity_id}` }] : [];
    }
    return v;
  };
  const leads = {
    list(actor, query) { need(actor, 'bd.lead.view', 'see leads'); return runList(db, leadList, parseListRequest(leadList, query), { select: 'l.*', scopeSql: SCOPE_L(seesAll(actor)), params: scopeParams(actor), tieBreaker: 'l.id', map: (l) => leadView(actor, l) }); },
    exportSource(actor, req) {
      need(actor, 'bd.lead.export', 'export leads');
      const opts = { select: 'l.*', scopeSql: SCOPE_L(seesAll(actor)), params: scopeParams(actor), tieBreaker: 'l.id' };
      return { title: leadList.label, permission: 'bd.lead.export', personal: false, columns: Object.entries(leadList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, leadList, req, opts),
        rows: () => runList(db, leadList, req, { ...opts, limit: null, map: (l) => { const v = leadView(actor, l); return { docNo: v.docNo, title: v.title, client: v.clientName, source: v.sourceLabel, sector: v.sectorLabel, region: v.region, estValue: v.estValue, score: v.qualScore, owner: v.owner, docDate: v.docDate, status: v.statusLabel }; } }).data,
        describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${leadList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    get(actor, id) { need(actor, 'bd.lead.view', 'see leads'); return leadView(actor, leadRow(actor, id), { detail: true }); },
    create(actor, b) {
      need(actor, 'bd.lead.create', 'create leads');
      const m = { ...b, owner: b.owner ?? actor.user }; const problems = leadProblems(actor, m); if (problems.length) throw badRequest('Some fields are not valid.', problems);
      if (m.sourceRef && db.prepare("SELECT 1 FROM bd_leads WHERE company_id = ? AND source = ? AND source_ref = ? AND status <> 'CANCELLED' AND deleted_at IS NULL").get(actor.companyId, m.source, m.sourceRef)) throw conflict(`A lead from this source with the reference ${m.sourceRef} exists already.`);
      const q = qualOf(m.qualification);
      return transaction(db, () => {
        const no = nextDoc(actor, LEAD_DOC, 'bd_leads', 'LEAD');
        const id = Number(db.prepare("INSERT INTO bd_leads (company_id, doc_no, doc_date, source, source_ref, title, client_partner_id, client_name, contact_name, phone, email, sector, location, region, est_value_minor, qualification_json, qual_score, owner, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 'bd_lead')")
          .run(actor.companyId, no, today(), m.source, m.sourceRef ?? null, m.title.trim(), m.clientPartnerId ?? null, m.clientPartnerId ? null : m.clientName.trim(), m.contactName ?? null, m.phone ?? null, m.email ?? null, m.sector, m.location ?? null, m.region ?? null, toMinor(m.estValue ?? 0), JSON.stringify(q.json), q.score, m.owner, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'bd_leads', entityId: id, action: 'create', newValues: { docNo: no, title: m.title, estValue: m.estValue ?? 0 }, actor: actor.user, companyId: actor.companyId });
        event('bd.lead.created', actor, 'bd_lead', id, actor.companyId, { docNo: no, source: m.source, sector: m.sector, estValue: m.estValue ?? 0 });
        return b.submit ? leads.submit(actor, id, {}) : leads.get(actor, id);
      });
    },
    update(actor, id, b) {
      const l = leadRow(actor, id); need(actor, 'bd.lead.edit', 'change leads');
      if (!['DRAFT', 'RETURNED'].includes(l.status)) throw conflict(`A lead that is ${LEAD_STATUS[l.status].toLowerCase()} is not changed; an approved one is amended.`);
      if (!maker(actor, l)) throw forbidden(`Only ${l.created_by} or ${l.owner} changes this lead.`);
      if (l.version !== b.version) throw conflict('This lead was changed by someone else. Reload it and try again.');
      return saveLead(actor, l, b, 'update');
    },
    remove(actor, id) {
      const l = leadRow(actor, id); need(actor, 'bd.lead.delete', 'delete leads');
      if (l.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel the others.');
      if (!maker(actor, l)) throw forbidden(`Only ${l.created_by} or ${l.owner} deletes this draft.`);
      db.prepare('UPDATE bd_leads SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, l.id);
      writeAudit(db, { entity: 'bd_leads', entityId: l.id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id: l.id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const l = leadRow(actor, id); need(actor, 'bd.lead.submit', 'send leads for qualification');
      if (!['DRAFT', 'RETURNED'].includes(l.status)) throw conflict(`This lead is ${LEAD_STATUS[l.status].toLowerCase()}.`);
      if (!maker(actor, l)) throw forbidden(`Only ${l.created_by} or ${l.owner} sends this lead.`);
      const q = qualOf(json(l.qualification_json, {})); const min = Number(param(actor.companyId, 'bd.lead.min_score')) || 0; const problems = leadProblems(actor, leadFields(l));
      if (!q.complete) problems.push({ field: 'qualification', message: 'Rate budget, authority, need and timeline before sending the lead for qualification' });
      else if (q.score < min) problems.push({ field: 'qualification', message: `The qualification score is ${q.score}; at least ${min} is needed to send the lead (cancel the lead if it is not worth following)` });
      if (problems.length) throw badRequest('The lead cannot be sent yet.', problems);
      return transaction(db, () => {
        const ctx = { valueMinor: l.est_value_minor, score: q.score };
        if (l.status === 'RETURNED') workflowOf(db).resubmit(actor, l.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: LEAD_DOC, docId: wfDoc(l.id, l.amendment_no), amendsDocId: l.amendment_no ? wfDoc(l.id, l.amendment_no - 1) : null, comment: comment ?? 'For qualification', context: ctx }); db.prepare('UPDATE bd_leads SET workflow_instance_id = ? WHERE id = ?').run(inst.id, l.id); }
        db.prepare("UPDATE bd_leads SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), l.id);
        writeAudit(db, { entity: 'bd_leads', entityId: l.id, action: 'submit', reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return leads.get(actor, l.id);
      });
    },
    withdraw(actor, id, { reason }) {
      const l = leadRow(actor, id);
      if (l.status !== 'SUBMITTED') throw unprocessable('Only a lead in approval is withdrawn.');
      if (!same(l.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.');
      workflowOf(db).withdraw(actor, l.workflow_instance_id, { comment: reason });
      return leads.get(actor, id);
    },
    cancel(actor, id, { reason }) {
      const l = leadRow(actor, id); need(actor, 'bd.lead.cancel', 'cancel leads');
      if (!['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'].includes(l.status)) throw unprocessable(`A lead that is ${LEAD_STATUS[l.status].toLowerCase()} cannot be cancelled.`);
      if (!maker(actor, l)) throw forbidden(`Only ${l.created_by} or ${l.owner} cancels this lead.`);
      return transaction(db, () => {
        if (l.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, l.workflow_instance_id, actor.user, 'CANCELLED', reason);
        db.prepare("UPDATE bd_leads SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1, remarks = ? WHERE id = ?").run(actor.user, nowIso(), reason, l.id);
        writeAudit(db, { entity: 'bd_leads', entityId: l.id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
        event('bd.lead.cancelled', actor, 'bd_lead', l.id, l.company_id, { docNo: l.doc_no, reason });
        return leads.get(actor, l.id);
      });
    },
    /** A qualified lead is locked; an amendment keeps what it replaces, sends the lead back to draft and needs the review again. */
    amend(actor, id, b) {
      const l = leadRow(actor, id); need(actor, 'bd.lead.amend', 'amend leads');
      if (l.status !== 'APPROVED') throw unprocessable('Only a qualified lead that is not converted is amended.');
      if (!maker(actor, l)) throw forbidden(`Only ${l.created_by} or ${l.owner} amends this lead.`);
      if (l.version !== b.version) throw conflict('This lead was changed by someone else. Reload it and try again.');
      return transaction(db, () => {
        db.prepare('INSERT INTO bd_amendments (company_id, entity, entity_id, amendment_no, snapshot_json, reason, amended_by, created_by) VALUES (?, \'LEAD\', ?, ?, ?, ?, ?, ?)').run(l.company_id, l.id, l.amendment_no + 1, JSON.stringify({ ...leadFields(l), qualScore: l.qual_score }), b.reason, actor.user, actor.user);
        db.prepare("UPDATE bd_leads SET status = 'DRAFT', amendment_no = amendment_no + 1, workflow_instance_id = NULL, requested_by = NULL WHERE id = ?").run(l.id);
        const { reason, ...fields } = b;
        const out = saveLead(actor, db.prepare('SELECT * FROM bd_leads WHERE id = ?').get(l.id), { ...fields, version: undefined }, 'amend', reason);
        event('bd.lead.amended', actor, 'bd_lead', l.id, l.company_id, { docNo: l.doc_no, amendmentNo: l.amendment_no + 1 });
        return out;
      });
    },
    history(actor, id) {
      const l = leadRow(actor, id);
      return { approvals: l.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(l.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'bd_leads' AND entity_id = ? ORDER BY id").all(String(l.id)) };
    },
    print(actor, id) {
      need(actor, 'bd.lead.print', 'print leads'); const v = leadView(actor, leadRow(actor, id), { detail: true });
      writeAudit(db, { entity: 'bd_leads', entityId: v.id, action: 'print', actor: actor.user, companyId: actor.companyId });
      const q = v.qualification;
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title><style>body{font:14px sans-serif;margin:24px}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #888;padding:6px;text-align:left}</style></head><body><h1>Lead ${esc(v.docNo)}</h1><p>${esc(v.title)} · ${esc(v.statusLabel)}</p><table><tr><th>Client</th><td>${esc(v.clientName)}</td><th>Source</th><td>${esc(v.sourceLabel)} ${esc(v.sourceRef ?? '')}</td></tr><tr><th>Sector</th><td>${esc(v.sectorLabel)}</td><th>Location</th><td>${esc(v.location ?? '')} ${esc(v.region ?? '')}</td></tr><tr><th>Estimated value</th><td>₹ ${esc(v.estValue?.toLocaleString('en-IN'))}</td><th>Owner</th><td>${esc(v.owner)}</td></tr><tr><th>Contact</th><td>${esc(v.contactName ?? '')} ${esc(v.phone ?? '')} ${esc(v.email ?? '')}</td><th>Qualification score</th><td>${v.qualScore}</td></tr></table><table><tr><th>Budget</th><th>Authority</th><th>Need</th><th>Timeline</th></tr><tr>${BANT.map((k) => `<td>${esc(RATINGS[q[k]?.rating] ?? '–')} ${esc(q[k]?.note ?? '')}</td>`).join('')}</tr></table></body></html>`;
    },
    /** FR-01: a qualified lead becomes an opportunity (a draft, at stage Qualified); the lead is kept, marked converted, with its interactions. */
    convert(actor, id, b = {}) {
      const l = leadRow(actor, id); need(actor, 'bd.lead.convert', 'convert leads');
      if (l.status !== 'APPROVED') throw unprocessable(l.status === 'CONVERTED' ? 'This lead is converted already.' : 'Only a qualified lead is converted: send it for qualification first.');
      if (!maker(actor, l) && !seesAll(actor)) throw forbidden('Only the owner of the lead converts it.');
      const p = clientProblem(actor.companyId, l.client_partner_id);
      if (p) throw unprocessable(l.client_partner_id ? p.message : 'The client is not in the partner master yet: register it as a prospect there (06.04), choose it on the lead, then convert.');
      return transaction(db, () => {
        const opp = opportunities.insert(actor, { clientPartnerId: l.client_partner_id, name: (b.name ?? l.title).trim(), sector: l.sector, location: l.location, region: l.region, estValue: rupees(l.est_value_minor), stage: 'QUALIFIED', expectedTenderDate: b.expectedTenderDate ?? null, expectedAwardDate: b.expectedAwardDate ?? null, owner: l.owner, leadId: l.id, sourceType: 'bd_lead', sourceId: String(l.id) });
        db.prepare("UPDATE bd_leads SET status = 'CONVERTED', opportunity_id = ?, converted_at = ?, converted_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(opp.id, nowIso(), actor.user, actor.user, nowIso(), l.id);
        writeAudit(db, { entity: 'bd_leads', entityId: l.id, action: 'convert', newValues: { opportunity: opp.docNo }, actor: actor.user, companyId: actor.companyId });
        event('bd.lead.converted', actor, 'bd_lead', l.id, l.company_id, { docNo: l.doc_no, opportunityId: opp.id, opportunityNo: opp.docNo });
        return { lead: leads.get(actor, l.id), opportunity: opp };
      });
    },
  };
  function saveLead(actor, l, b, action, reason = null) {
    const cur = leadFields(l); const m = { ...cur, ...defined(b) }; delete m.version; delete m.submit; delete m.comment;
    const problems = leadProblems(actor, m); if (problems.length) throw badRequest('Some fields are not valid.', problems);
    const q = qualOf(m.qualification);
    db.prepare('UPDATE bd_leads SET source = ?, source_ref = ?, title = ?, client_partner_id = ?, client_name = ?, contact_name = ?, phone = ?, email = ?, sector = ?, location = ?, region = ?, est_value_minor = ?, qualification_json = ?, qual_score = ?, owner = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(m.source, m.sourceRef ?? null, m.title.trim(), m.clientPartnerId ?? null, m.clientPartnerId ? null : String(m.clientName ?? '').trim(), m.contactName ?? null, m.phone ?? null, m.email ?? null, m.sector, m.location ?? null, m.region ?? null, toMinor(m.estValue ?? 0), JSON.stringify(q.json), q.score, m.owner, actor.user, nowIso(), l.id);
    writeAudit(db, { entity: 'bd_leads', entityId: l.id, action, reason, oldValues: { title: cur.title, estValue: cur.estValue, owner: cur.owner }, newValues: { title: m.title, estValue: m.estValue, owner: m.owner }, actor: actor.user, companyId: actor.companyId });
    return leads.get(actor, l.id);
  }

  // ------------------------------------------------------------------ opportunities (FR-04, BR-01, BR-02)
  const oppRow = (actor, id) => {
    const o = db.prepare('SELECT * FROM bd_opportunities WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!o || !seen(actor, o, [OPP_DOC, AWARD_DOC])) throw notFound('That opportunity does not exist or is not yours to see.');
    return o;
  };
  const oppFields = (o) => ({ clientPartnerId: o.client_partner_id, name: o.name, sector: o.sector, location: o.location, region: o.region, estValue: rupees(o.est_value_minor), expectedTenderDate: o.expected_tender_date, expectedAwardDate: o.expected_award_date, competitors: json(o.competitors_json, []), owner: o.owner });
  const defaultProb = (companyId, stage) => Number((param(companyId, 'bd.stage_probability') ?? {})[stage] ?? 0);
  /** BR-02: the probability follows the stage; a different one is the person's own and needs a reason. */
  function probabilityOf(companyId, stage, asked, reason) {
    const def = defaultProb(companyId, stage); const pct = asked == null ? def : Number(asked);
    if (pct !== def && !String(reason ?? '').trim()) return { problem: { field: 'probabilityReason', message: `The probability of ${STAGES[stage]} is ${def}% unless you say why it is ${pct}%` } };
    return { pct, def, reason: pct !== def ? String(reason).trim() : null };
  }
  function oppProblems(actor, m, { stage }) {
    const out = [];
    const p = clientProblem(actor.companyId, m.clientPartnerId); if (p) out.push(p);
    for (const x of [regionProblem(actor.companyId, m.region), ownerProblem(actor.companyId, m.owner)]) if (x) out.push(x);
    if (m.expectedTenderDate && m.expectedAwardDate && m.expectedAwardDate < m.expectedTenderDate) out.push({ field: 'expectedAwardDate', message: 'The expected award is on or after the expected tender date' });
    if (stageIndex(stage) >= stageIndex('TENDER_EXPECTED') && !m.expectedAwardDate) out.push({ field: 'expectedAwardDate', message: 'Give the expected award date once a tender is expected' });
    return out;
  }
  const goAheadPending = (o) => stageIndex(o.stage) >= stageIndex(GO_AHEAD_FROM) && o.status !== 'APPROVED' && !['WON', 'LOST'].includes(o.stage);
  const oppView = (actor, o, { detail = false } = {}) => {
    const c = clientRow(o.company_id, o.client_partner_id); const mine = maker(actor, o); const closed = ['WON', 'LOST'].includes(o.stage); const live = !['CANCELLED', 'REJECTED'].includes(o.status);
    const v = {
      id: o.id, docNo: o.doc_no, docDate: o.doc_date, leadId: o.lead_id, status: o.status, statusLabel: OPP_STATUS[o.status], rowVersion: o.version, stage: o.stage, stageLabel: STAGES[o.stage],
      clientPartnerId: o.client_partner_id, clientCode: c?.code ?? null, clientName: c?.legal_name ?? null, name: o.name, sector: o.sector, sectorLabel: SECTORS[o.sector], location: o.location, region: o.region, estValue: rupees(o.est_value_minor),
      probability: o.probability_pct, probabilityDefault: o.probability_default_pct, probabilityReason: o.probability_reason, weighted: rupees(weightedMinor(o.est_value_minor, o.probability_pct)), expectedTenderDate: o.expected_tender_date, expectedAwardDate: o.expected_award_date,
      competitors: json(o.competitors_json, []), owner: o.owner, lostReasonCode: o.lost_reason_code, lostReason: o.lost_reason, lostTo: o.lost_to, wonVia: o.won_via, wonValue: rupees(o.won_value_minor), closedOn: o.closed_on,
      amendmentNo: o.amendment_no, awardStatus: o.award_status, awardStatusLabel: AWARD_STATUS[o.award_status], awardReason: o.award_reason, awardValue: rupees(o.award_value_minor), convertedAt: o.converted_at, convertedBy: o.converted_by, tenderRef: o.tender_ref,
      workflowInstanceId: o.workflow_instance_id, awardInstanceId: o.award_instance_id, requestedBy: o.requested_by, createdBy: o.created_by, goAheadPending: goAheadPending(o), directorNeeded: o.est_value_minor > Number(param(o.company_id, 'bd.go_ahead.director_above_minor')),
      can: {
        edit: ['DRAFT', 'RETURNED'].includes(o.status) && !closed && mine && may(actor, 'bd.opportunity.edit'), submit: ['DRAFT', 'RETURNED'].includes(o.status) && !closed && mine && may(actor, 'bd.opportunity.submit'), delete: o.status === 'DRAFT' && o.stage !== 'WON' && mine && may(actor, 'bd.opportunity.delete'),
        withdraw: o.status === 'SUBMITTED' && same(o.requested_by, actor.user), cancel: live && !closed && !o.converted_at && mine && may(actor, 'bd.opportunity.cancel') && o.award_status !== 'REQUESTED',
        amend: o.status === 'APPROVED' && !closed && !o.converted_at && mine && may(actor, 'bd.opportunity.amend'), track: live && !closed && (mine || seesAll(actor)) && may(actor, 'bd.opportunity.track'),
        win: o.status === 'APPROVED' && !closed && o.award_status !== 'REQUESTED' && mine && may(actor, 'bd.opportunity.win'), convert: o.status === 'APPROVED' && !closed && !o.converted_at && (mine || seesAll(actor)) && may(actor, 'bd.opportunity.convert'),
        print: may(actor, 'bd.opportunity.print'), interact: live && may(actor, 'bd.interaction.log'),
      },
    };
    if (detail) {
      v.lostReasons = (param(o.company_id, 'bd.lost_reasons') ?? []).map(([code, label]) => ({ code, label }));
      v.stages = db.prepare('SELECT from_stage AS fromStage, to_stage AS toStage, probability_pct AS probability, reason, changed_by AS by, changed_at AS at FROM bd_stage_log WHERE opportunity_id = ? ORDER BY id').all(o.id);
      v.amendments = db.prepare("SELECT amendment_no AS no, snapshot_json, reason, amended_by AS by, amended_at AS at FROM bd_amendments WHERE entity = 'OPPORTUNITY' AND entity_id = ? ORDER BY amendment_no").all(o.id).map((a) => ({ no: a.no, reason: a.reason, by: a.by, at: a.at, before: json(a.snapshot_json, {}) }));
      v.related = [
        ...(o.lead_id ? [{ type: 'Lead', id: o.lead_id, ref: db.prepare('SELECT doc_no FROM bd_leads WHERE id = ?').get(o.lead_id)?.doc_no, route: `/bd/lead?id=${o.lead_id}` }] : []),
        { type: 'Client', id: o.client_partner_id, ref: c ? `${c.code} ${c.legal_name}` : null, route: `/bd/client?id=${o.client_partner_id}` },
        ...(o.tender_ref ? [{ type: 'Tender', id: null, ref: o.tender_ref, route: null }] : []),
      ];
    }
    return v;
  };
  function logStage(actor, o, from, to, pct, reason) {
    db.prepare('INSERT INTO bd_stage_log (company_id, opportunity_id, from_stage, to_stage, probability_pct, reason, changed_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'bd_opportunity\')').run(o.company_id ?? actor.companyId, o.id, from, to, pct, reason ?? null, actor.user, actor.user);
  }
  const opportunities = {
    /** The one place an opportunity row is written at creation (the form, the conversion of a lead and the import all come here). */
    insert(actor, b) {
      const stage = b.stage ?? 'IDENTIFIED';
      if (!['IDENTIFIED', 'QUALIFIED'].includes(stage)) throw badRequest('Some fields are not valid.', [{ field: 'stage', message: 'A new opportunity starts as Identified or Qualified; later stages need the go-ahead' }]);
      const m = { ...b, owner: b.owner ?? actor.user }; const problems = oppProblems(actor, m, { stage });
      const pr = probabilityOf(actor.companyId, stage, b.probability, b.probabilityReason); if (pr.problem) problems.push(pr.problem);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const no = nextDoc(actor, OPP_DOC, 'bd_opportunities', 'OPP');
      const id = Number(db.prepare("INSERT INTO bd_opportunities (company_id, doc_no, doc_date, lead_id, client_partner_id, name, sector, location, region, est_value_minor, probability_pct, probability_default_pct, probability_reason, expected_tender_date, expected_award_date, stage, competitors_json, owner, status, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)")
        .run(actor.companyId, no, today(), b.leadId ?? null, m.clientPartnerId, m.name.trim(), m.sector, m.location ?? null, m.region ?? null, toMinor(m.estValue ?? 0), pr.pct, pr.def, pr.reason, m.expectedTenderDate ?? null, m.expectedAwardDate ?? null, stage, JSON.stringify(m.competitors ?? []), m.owner, actor.user, b.sourceType ?? 'bd_opportunity', b.sourceId ?? null).lastInsertRowid);
      const o = db.prepare('SELECT * FROM bd_opportunities WHERE id = ?').get(id);
      logStage(actor, o, null, stage, pr.pct, b.leadId ? 'Converted from a lead' : 'Created');
      writeAudit(db, { entity: 'bd_opportunities', entityId: id, action: 'create', newValues: { docNo: no, name: m.name, estValue: m.estValue ?? 0, stage }, actor: actor.user, companyId: actor.companyId });
      event('bd.opportunity.created', actor, 'bd_opportunity', id, actor.companyId, { docNo: no, clientPartnerId: m.clientPartnerId, stage, estValue: m.estValue ?? 0, leadId: b.leadId ?? null });
      return oppView(actor, o);
    },
    list(actor, query) { need(actor, 'bd.opportunity.view', 'see opportunities'); return runList(db, opportunityList, parseListRequest(opportunityList, query), { select: 'o.*', scopeSql: SCOPE_O(seesAll(actor)), params: scopeParams(actor), tieBreaker: 'o.id', map: (o) => oppView(actor, o) }); },
    exportSource(actor, req) {
      need(actor, 'bd.opportunity.export', 'export opportunities');
      const opts = { select: 'o.*', scopeSql: SCOPE_O(seesAll(actor)), params: scopeParams(actor), tieBreaker: 'o.id' };
      return { title: opportunityList.label, permission: 'bd.opportunity.export', personal: false, columns: Object.entries(opportunityList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, opportunityList, req, opts),
        rows: () => runList(db, opportunityList, req, { ...opts, limit: null, map: (o) => { const v = oppView(actor, o); return { docNo: v.docNo, name: v.name, client: v.clientName, sector: v.sectorLabel, region: v.region, stage: v.stageLabel, estValue: v.estValue, probability: v.probability, weighted: v.weighted, expectedAward: v.expectedAwardDate, owner: v.owner, status: v.statusLabel }; } }).data,
        describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${opportunityList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    get(actor, id) { need(actor, 'bd.opportunity.view', 'see opportunities'); return oppView(actor, oppRow(actor, id), { detail: true }); },
    create(actor, b) {
      need(actor, 'bd.opportunity.create', 'create opportunities');
      return transaction(db, () => { const o = opportunities.insert(actor, b); return b.submit ? opportunities.submit(actor, o.id, {}) : o; });
    },
    update(actor, id, b) {
      const o = oppRow(actor, id); need(actor, 'bd.opportunity.edit', 'change opportunities');
      if (!['DRAFT', 'RETURNED'].includes(o.status) || ['WON', 'LOST'].includes(o.stage)) throw conflict(`An opportunity whose go-ahead is ${OPP_STATUS[o.status].toLowerCase()} is not changed here; an approved one is amended.`);
      if (!maker(actor, o)) throw forbidden(`Only ${o.created_by} or ${o.owner} changes this opportunity.`);
      if (o.version !== b.version) throw conflict('This opportunity was changed by someone else. Reload it and try again.');
      return saveOpp(actor, o, b, 'update');
    },
    remove(actor, id) {
      const o = oppRow(actor, id); need(actor, 'bd.opportunity.delete', 'delete opportunities');
      if (o.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel the others.');
      if (!maker(actor, o)) throw forbidden(`Only ${o.created_by} or ${o.owner} deletes this draft.`);
      if (o.lead_id) db.prepare("UPDATE bd_leads SET status = 'APPROVED', opportunity_id = NULL, converted_at = NULL, converted_by = NULL WHERE id = ? AND opportunity_id = ?").run(o.lead_id, o.id);
      db.prepare('UPDATE bd_opportunities SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, o.id);
      writeAudit(db, { entity: 'bd_opportunities', entityId: o.id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id: o.id, deleted: true };
    },
    /** The go-ahead for tendering: the business development review, and the director above the limit. */
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const o = oppRow(actor, id); need(actor, 'bd.opportunity.submit', 'ask for the go-ahead');
      if (!['DRAFT', 'RETURNED'].includes(o.status) || ['WON', 'LOST'].includes(o.stage)) throw conflict(`The go-ahead of this opportunity is ${OPP_STATUS[o.status].toLowerCase()}.`);
      if (!maker(actor, o)) throw forbidden(`Only ${o.created_by} or ${o.owner} asks for the go-ahead.`);
      const problems = oppProblems(actor, oppFields(o), { stage: o.stage }); if (!o.est_value_minor) problems.push({ field: 'estValue', message: 'Give the estimated value before asking for the go-ahead' });
      if (problems.length) throw badRequest('The opportunity cannot be sent yet.', problems);
      return transaction(db, () => {
        const ctx = { valueMinor: o.est_value_minor, sector: o.sector };
        if (o.status === 'RETURNED') workflowOf(db).resubmit(actor, o.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: OPP_DOC, docId: wfDoc(o.id, o.amendment_no), amendsDocId: o.amendment_no ? wfDoc(o.id, o.amendment_no - 1) : null, comment: comment ?? 'Go-ahead for tendering', context: ctx }); db.prepare('UPDATE bd_opportunities SET workflow_instance_id = ? WHERE id = ?').run(inst.id, o.id); }
        db.prepare("UPDATE bd_opportunities SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), o.id);
        writeAudit(db, { entity: 'bd_opportunities', entityId: o.id, action: 'submit', reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return opportunities.get(actor, o.id);
      });
    },
    withdraw(actor, id, { reason }) {
      const o = oppRow(actor, id);
      if (o.status !== 'SUBMITTED') throw unprocessable('Only an opportunity in approval is withdrawn.');
      if (!same(o.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.');
      workflowOf(db).withdraw(actor, o.workflow_instance_id, { comment: reason });
      return opportunities.get(actor, id);
    },
    cancel(actor, id, { reason }) {
      const o = oppRow(actor, id); need(actor, 'bd.opportunity.cancel', 'cancel opportunities');
      if (!oppView(actor, o).can.cancel) throw unprocessable('This opportunity cannot be cancelled now (it is closed, converted to a tender or waiting for a direct award decision).');
      return transaction(db, () => {
        if (o.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, o.workflow_instance_id, actor.user, 'CANCELLED', reason);
        db.prepare("UPDATE bd_opportunities SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1, remarks = ? WHERE id = ?").run(actor.user, nowIso(), reason, o.id);
        writeAudit(db, { entity: 'bd_opportunities', entityId: o.id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
        event('bd.opportunity.cancelled', actor, 'bd_opportunity', o.id, o.company_id, { docNo: o.doc_no, reason });
        return opportunities.get(actor, o.id);
      });
    },
    amend(actor, id, b) {
      const o = oppRow(actor, id); need(actor, 'bd.opportunity.amend', 'amend opportunities');
      if (!oppView(actor, o).can.amend) throw unprocessable('Only an approved opportunity that is open and not yet converted to a tender is amended.');
      if (o.version !== b.version) throw conflict('This opportunity was changed by someone else. Reload it and try again.');
      return transaction(db, () => {
        db.prepare('INSERT INTO bd_amendments (company_id, entity, entity_id, amendment_no, snapshot_json, reason, amended_by, created_by) VALUES (?, \'OPPORTUNITY\', ?, ?, ?, ?, ?, ?)').run(o.company_id, o.id, o.amendment_no + 1, JSON.stringify({ ...oppFields(o), stage: o.stage, probability: o.probability_pct }), b.reason, actor.user, actor.user);
        db.prepare("UPDATE bd_opportunities SET status = 'DRAFT', amendment_no = amendment_no + 1, workflow_instance_id = NULL, requested_by = NULL WHERE id = ?").run(o.id);
        const { reason, ...fields } = b;
        const out = saveOpp(actor, db.prepare('SELECT * FROM bd_opportunities WHERE id = ?').get(o.id), { ...fields, version: undefined }, 'amend', reason);
        event('bd.opportunity.amended', actor, 'bd_opportunity', o.id, o.company_id, { docNo: o.doc_no, amendmentNo: o.amendment_no + 1 });
        return out;
      });
    },
    /** Working the pipeline: the stage, the probability (a reason when it is not the default of the stage), the dates, the competitors and the owner. The value and the client are the go-ahead's and change only by amendment. */
    track(actor, id, b) {
      const o = oppRow(actor, id); need(actor, 'bd.opportunity.track', 'move opportunities in the pipeline');
      const v = oppView(actor, o);
      if (!v.can.track) throw unprocessable(['WON', 'LOST'].includes(o.stage) ? 'A closed opportunity is not moved.' : ['CANCELLED', 'REJECTED'].includes(o.status) ? 'This opportunity is not live.' : 'Only the owner (or somebody who sees the whole pipeline) works this opportunity.');
      if (o.version !== b.version) throw conflict('This opportunity was changed by someone else. Reload it and try again.');
      const stage = b.stage ?? o.stage; const problems = [];
      if (b.stage && !OPEN_STAGES.includes(b.stage)) problems.push({ field: 'stage', message: b.stage === 'LOST' ? 'Mark an opportunity lost with a reason' : 'A win comes from the tender award or from an approved direct award (BR-01)' });
      if (problems.length === 0 && stageIndex(stage) >= stageIndex(GO_AHEAD_FROM) && o.status !== 'APPROVED') throw unprocessable(`${STAGES[stage]} needs the go-ahead for tendering first: ask for it (${OPP_STATUS[o.status].toLowerCase()}).`);
      const m = { ...oppFields(o), ...defined({ expectedTenderDate: b.expectedTenderDate, expectedAwardDate: b.expectedAwardDate, competitors: b.competitors, owner: b.owner }) };
      problems.push(...oppProblems(actor, m, { stage }));
      const stageChanged = stage !== o.stage;
      const asked = b.probability !== undefined ? b.probability : stageChanged ? null : o.probability_pct; const reason = b.probability !== undefined ? b.probabilityReason : stageChanged ? null : o.probability_reason;
      const pr = probabilityOf(actor.companyId, stage, asked, reason); if (pr.problem) problems.push(pr.problem);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        db.prepare('UPDATE bd_opportunities SET stage = ?, probability_pct = ?, probability_default_pct = ?, probability_reason = ?, expected_tender_date = ?, expected_award_date = ?, competitors_json = ?, owner = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
          .run(stage, pr.pct, pr.def, pr.reason, m.expectedTenderDate ?? null, m.expectedAwardDate ?? null, JSON.stringify(m.competitors ?? []), m.owner, actor.user, nowIso(), o.id);
        if (stageChanged || pr.pct !== o.probability_pct) logStage(actor, o, o.stage, stage, pr.pct, b.reason ?? pr.reason ?? null);
        writeAudit(db, { entity: 'bd_opportunities', entityId: o.id, action: stageChanged ? 'stage' : 'track', reason: b.reason ?? pr.reason ?? null, oldValues: { stage: o.stage, probability: o.probability_pct, expectedAward: o.expected_award_date }, newValues: { stage, probability: pr.pct, expectedAward: m.expectedAwardDate }, actor: actor.user, companyId: actor.companyId });
        if (stageChanged) event('bd.opportunity.stage_changed', actor, 'bd_opportunity', o.id, o.company_id, { docNo: o.doc_no, from: o.stage, to: stage, probability: pr.pct });
        return opportunities.get(actor, o.id);
      });
    },
    /** FR-06: lost, with the reason (from the list of reasons), who won it when known, and a note. */
    lose(actor, id, b) {
      const o = oppRow(actor, id); need(actor, 'bd.opportunity.track', 'close opportunities');
      if (!oppView(actor, o).can.track) throw unprocessable('This opportunity cannot be closed now.');
      if (o.version !== b.version) throw conflict('This opportunity was changed by someone else. Reload it and try again.');
      const codes = (param(o.company_id, 'bd.lost_reasons') ?? []).map((x) => x[0]);
      if (!codes.includes(b.reasonCode)) throw badRequest('Some fields are not valid.', [{ field: 'reasonCode', message: `The reason is one of ${codes.join(', ')}` }]);
      return transaction(db, () => {
        db.prepare("UPDATE bd_opportunities SET stage = 'LOST', probability_pct = 0, probability_default_pct = 0, probability_reason = NULL, lost_reason_code = ?, lost_reason = ?, lost_to = ?, closed_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
          .run(b.reasonCode, b.reason?.trim() || null, b.lostTo?.trim() || null, today(), actor.user, nowIso(), o.id);
        logStage(actor, o, o.stage, 'LOST', 0, `${b.reasonCode}${b.reason ? `: ${b.reason}` : ''}`);
        writeAudit(db, { entity: 'bd_opportunities', entityId: o.id, action: 'lose', reason: b.reasonCode, newValues: { lostTo: b.lostTo ?? null }, actor: actor.user, companyId: actor.companyId });
        event('bd.opportunity.lost', actor, 'bd_opportunity', o.id, o.company_id, { docNo: o.doc_no, reasonCode: b.reasonCode, lostTo: b.lostTo ?? null, estValue: rupees(o.est_value_minor), sector: o.sector, region: o.region });
        return opportunities.get(actor, o.id);
      });
    },
    /** BR-01, the second way to a win: a direct award (no tender) is asked for with its reason and value and decided by the director. */
    requestDirectAward(actor, id, b) {
      const o = oppRow(actor, id); need(actor, 'bd.opportunity.win', 'ask for a direct award');
      if (!oppView(actor, o).can.win) throw unprocessable(o.status !== 'APPROVED' ? 'A direct award needs the go-ahead first.' : o.award_status === 'REQUESTED' ? 'A direct award is waiting for approval already.' : 'This opportunity is closed.');
      if (o.version !== b.version) throw conflict('This opportunity was changed by someone else. Reload it and try again.');
      return transaction(db, () => {
        const inst = workflowOf(db).submit(actor, { docType: AWARD_DOC, docId: o.id, comment: b.reason, context: { valueMinor: toMinor(b.awardValue) } });
        db.prepare("UPDATE bd_opportunities SET award_status = 'REQUESTED', award_instance_id = ?, award_reason = ?, award_value_minor = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(inst.id, b.reason.trim(), toMinor(b.awardValue), actor.user, nowIso(), o.id);
        writeAudit(db, { entity: 'bd_opportunities', entityId: o.id, action: 'direct_award_request', reason: b.reason, newValues: { awardValue: b.awardValue }, actor: actor.user, companyId: actor.companyId });
        return opportunities.get(actor, o.id);
      });
    },
    /** BR-01, the first way to a win: called by the award of a tender (08.03) with the award it recorded. There is no route for it: a client cannot declare a win. */
    awardFromTender(actor, id, { tenderRef, awardValue, awardedOn }) {
      const o = db.prepare('SELECT * FROM bd_opportunities WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
      if (!o) throw notFound('That opportunity does not exist.');
      if (o.status !== 'APPROVED' || ['WON', 'LOST'].includes(o.stage)) throw unprocessable('Only an open opportunity with the go-ahead is won through a tender.');
      return transaction(db, () => markWon(actor, o, 'TENDER_AWARD', toMinor(awardValue ?? rupees(o.est_value_minor)), awardedOn ?? today(), tenderRef ?? null));
    },
    /** 08.02 tells the opportunity which tender it became. */
    linkTender(actor, id, tenderRef) {
      const o = db.prepare('SELECT * FROM bd_opportunities WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
      if (!o || !o.converted_at) throw unprocessable('The opportunity has not been converted to a tender.');
      db.prepare('UPDATE bd_opportunities SET tender_ref = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(tenderRef, actor.user, nowIso(), o.id);
      writeAudit(db, { entity: 'bd_opportunities', entityId: o.id, action: 'tender_linked', newValues: { tenderRef }, actor: actor.user, companyId: actor.companyId });
      return { id: o.id, tenderRef };
    },
    /** FR-06: the approved opportunity becomes a tender (08.02): it moves to Pre-bid at least, is marked converted, and bd.opportunity.converted carries what the tender needs. */
    convert(actor, id, b = {}) {
      const o = oppRow(actor, id); need(actor, 'bd.opportunity.convert', 'convert opportunities to tenders');
      if (!oppView(actor, o).can.convert) throw unprocessable(o.converted_at ? 'This opportunity is converted already.' : o.status !== 'APPROVED' ? 'The go-ahead for tendering comes first.' : 'This opportunity cannot be converted now.');
      if (b.version !== undefined && o.version !== b.version) throw conflict('This opportunity was changed by someone else. Reload it and try again.');
      return transaction(db, () => {
        const stage = stageIndex(o.stage) < stageIndex('PRE_BID') ? 'PRE_BID' : o.stage; const pr = stage === o.stage ? { pct: o.probability_pct, def: o.probability_default_pct, reason: o.probability_reason } : { pct: defaultProb(o.company_id, stage), def: defaultProb(o.company_id, stage), reason: null };
        db.prepare('UPDATE bd_opportunities SET stage = ?, probability_pct = ?, probability_default_pct = ?, probability_reason = ?, converted_at = ?, converted_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(stage, pr.pct, pr.def, pr.reason, nowIso(), actor.user, actor.user, nowIso(), o.id);
        if (stage !== o.stage) logStage(actor, o, o.stage, stage, pr.pct, 'Converted to a tender');
        writeAudit(db, { entity: 'bd_opportunities', entityId: o.id, action: 'convert', actor: actor.user, companyId: actor.companyId });
        event('bd.opportunity.converted', actor, 'bd_opportunity', o.id, o.company_id, { opportunityId: o.id, docNo: o.doc_no, clientPartnerId: o.client_partner_id, name: o.name, sector: o.sector, location: o.location, region: o.region, estValue: rupees(o.est_value_minor), expectedTenderDate: o.expected_tender_date, expectedAwardDate: o.expected_award_date, competitors: json(o.competitors_json, []), owner: o.owner, notes: b.notes ?? null });
        return opportunities.get(actor, o.id);
      });
    },
    history(actor, id) {
      const o = oppRow(actor, id);
      return { approvals: o.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(o.workflow_instance_id) : [], awardApprovals: o.award_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(o.award_instance_id) : [],
        stages: db.prepare('SELECT from_stage AS fromStage, to_stage AS toStage, probability_pct AS probability, reason, changed_by AS by, changed_at AS at FROM bd_stage_log WHERE opportunity_id = ? ORDER BY id').all(o.id), audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'bd_opportunities' AND entity_id = ? ORDER BY id").all(String(o.id)) };
    },
    print(actor, id) {
      need(actor, 'bd.opportunity.print', 'print opportunities'); const v = oppView(actor, oppRow(actor, id), { detail: true });
      writeAudit(db, { entity: 'bd_opportunities', entityId: v.id, action: 'print', actor: actor.user, companyId: actor.companyId });
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title><style>body{font:14px sans-serif;margin:24px}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #888;padding:6px;text-align:left}</style></head><body><h1>Opportunity ${esc(v.docNo)}</h1><p>${esc(v.name)} · ${esc(v.stageLabel)} · ${esc(v.statusLabel)}</p><table><tr><th>Client</th><td>${esc(v.clientCode)} ${esc(v.clientName)}</td><th>Sector</th><td>${esc(v.sectorLabel)}</td></tr><tr><th>Location</th><td>${esc(v.location ?? '')} ${esc(v.region ?? '')}</td><th>Owner</th><td>${esc(v.owner)}</td></tr><tr><th>Estimated value</th><td>₹ ${esc(v.estValue?.toLocaleString('en-IN'))}</td><th>Probability</th><td>${v.probability}% (weighted ₹ ${esc(v.weighted?.toLocaleString('en-IN'))})</td></tr><tr><th>Expected tender</th><td>${esc(v.expectedTenderDate ?? '')}</td><th>Expected award</th><td>${esc(v.expectedAwardDate ?? '')}</td></tr></table><h2>Competitors</h2><table><tr><th>Name</th><th>Strength</th><th>Note</th></tr>${v.competitors.map((c) => `<tr><td>${esc(c.name)}${c.incumbent ? ' (incumbent)' : ''}</td><td>${esc(c.strength ?? '')}</td><td>${esc(c.note ?? '')}</td></tr>`).join('')}</table></body></html>`;
    },
  };
  function saveOpp(actor, o, b, action, reason = null) {
    const cur = oppFields(o); const m = { ...cur, ...defined(b) }; delete m.version; delete m.submit; delete m.comment;
    const problems = oppProblems(actor, m, { stage: o.stage });
    const pr = probabilityOf(actor.companyId, o.stage, b.probability !== undefined ? b.probability : o.probability_pct, b.probability !== undefined ? b.probabilityReason : o.probability_reason); if (pr.problem) problems.push(pr.problem);
    if (problems.length) throw badRequest('Some fields are not valid.', problems);
    db.prepare('UPDATE bd_opportunities SET client_partner_id = ?, name = ?, sector = ?, location = ?, region = ?, est_value_minor = ?, probability_pct = ?, probability_default_pct = ?, probability_reason = ?, expected_tender_date = ?, expected_award_date = ?, competitors_json = ?, owner = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(m.clientPartnerId, m.name.trim(), m.sector, m.location ?? null, m.region ?? null, toMinor(m.estValue ?? 0), pr.pct, pr.def, pr.reason, m.expectedTenderDate ?? null, m.expectedAwardDate ?? null, JSON.stringify(m.competitors ?? []), m.owner, actor.user, nowIso(), o.id);
    if (pr.pct !== o.probability_pct) logStage(actor, o, o.stage, o.stage, pr.pct, pr.reason ?? reason);
    writeAudit(db, { entity: 'bd_opportunities', entityId: o.id, action, reason, oldValues: { name: cur.name, estValue: cur.estValue, clientPartnerId: cur.clientPartnerId }, newValues: { name: m.name, estValue: m.estValue, clientPartnerId: m.clientPartnerId }, actor: actor.user, companyId: actor.companyId });
    return opportunities.get(actor, o.id);
  }
  function markWon(actor, o, via, wonMinor, on, tenderRef) {
    db.prepare("UPDATE bd_opportunities SET stage = 'WON', probability_pct = 100, probability_default_pct = 100, probability_reason = NULL, won_via = ?, won_value_minor = ?, closed_on = ?, tender_ref = COALESCE(?, tender_ref), award_status = CASE WHEN ? = 'DIRECT_AWARD' THEN 'APPROVED' ELSE award_status END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
      .run(via, wonMinor, on, tenderRef, via, actor.user, nowIso(), o.id);
    logStage(actor, o, o.stage, 'WON', 100, via === 'DIRECT_AWARD' ? 'Direct award approved' : `Tender award ${tenderRef ?? ''}`.trim());
    writeAudit(db, { entity: 'bd_opportunities', entityId: o.id, action: 'win', newValues: { via, value: rupees(wonMinor) }, actor: actor.user, companyId: o.company_id });
    event('bd.opportunity.won', actor, 'bd_opportunity', o.id, o.company_id, { opportunityId: o.id, docNo: o.doc_no, via, clientPartnerId: o.client_partner_id, name: o.name, sector: o.sector, region: o.region, wonValue: rupees(wonMinor), tenderRef });
    return db.prepare('SELECT * FROM bd_opportunities WHERE id = ?').get(o.id);
  }

  // ------------------------------------------------------------------ what the workflow decided
  function decideLead(instance, actor, outcome, comment) {
    const l = db.prepare('SELECT * FROM bd_leads WHERE id = ?').get(rid(instance.docId));
    if (!l || !['SUBMITTED', 'RETURNED'].includes(l.status)) return;
    const now = nowIso();
    if (outcome === 'APPROVED') db.prepare("UPDATE bd_leads SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, l.id);
    else {
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare('UPDATE bd_leads SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, l.id);
      if (withdrawn) db.prepare('UPDATE bd_leads SET workflow_instance_id = NULL WHERE id = ?').run(l.id);
    }
    writeAudit(db, { entity: 'bd_leads', entityId: l.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: l.company_id });
    if (outcome === 'APPROVED') event('bd.lead.qualified', actor, 'bd_lead', l.id, l.company_id, { docNo: l.doc_no, score: l.qual_score, estValue: rupees(l.est_value_minor) });
    tell(l.company_id, l.requested_by ?? l.created_by, 'bd.decided', { what: 'Lead', ref: l.doc_no, title: l.title, decision: outcome === 'APPROVED' ? 'qualified' : outcome === 'RETURNED' ? 'returned for correction' : outcome === 'REJECTED' ? 'not qualified' : 'cancelled', comment: comment ? `: ${comment}` : '' }, `/bd/lead?id=${l.id}`, `lead:${l.id}:${outcome}`);
  }
  function decideOpportunity(instance, actor, outcome, comment) {
    const o = db.prepare('SELECT * FROM bd_opportunities WHERE id = ?').get(rid(instance.docId));
    if (!o || !['SUBMITTED', 'RETURNED'].includes(o.status)) return;
    const now = nowIso();
    if (outcome === 'APPROVED') db.prepare("UPDATE bd_opportunities SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, o.id);
    else {
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare('UPDATE bd_opportunities SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, o.id);
      if (withdrawn) db.prepare('UPDATE bd_opportunities SET workflow_instance_id = NULL WHERE id = ?').run(o.id);
    }
    writeAudit(db, { entity: 'bd_opportunities', entityId: o.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: o.company_id });
    if (outcome === 'APPROVED') event('bd.opportunity.approved', actor, 'bd_opportunity', o.id, o.company_id, { docNo: o.doc_no, clientPartnerId: o.client_partner_id, estValue: rupees(o.est_value_minor), name: o.name });
    tell(o.company_id, o.requested_by ?? o.created_by, 'bd.decided', { what: 'Go-ahead for', ref: o.doc_no, title: o.name, decision: outcome === 'APPROVED' ? 'given' : outcome === 'RETURNED' ? 'returned for correction' : outcome === 'REJECTED' ? 'refused' : 'cancelled', comment: comment ? `: ${comment}` : '' }, `/bd/opportunity?id=${o.id}`, `opp:${o.id}:${outcome}`);
  }
  function decideAward(instance, actor, outcome, comment) {
    const o = db.prepare('SELECT * FROM bd_opportunities WHERE id = ?').get(rid(instance.docId));
    if (!o || o.award_status !== 'REQUESTED') return;
    if (outcome === 'APPROVED') markWon(actor, o, 'DIRECT_AWARD', o.award_value_minor ?? o.est_value_minor, today(), null);
    else db.prepare('UPDATE bd_opportunities SET award_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'REJECTED' ? 'REJECTED' : 'NONE', actor.user, nowIso(), o.id);
    writeAudit(db, { entity: 'bd_opportunities', entityId: o.id, action: `award_${outcome.toLowerCase()}`, reason: comment ?? null, actor: actor.user, companyId: o.company_id });
    tell(o.company_id, o.requested_by ?? o.created_by, 'bd.decided', { what: 'Direct award of', ref: o.doc_no, title: o.name, decision: outcome === 'APPROVED' ? 'approved: the opportunity is won' : outcome === 'REJECTED' ? 'refused' : 'returned or cancelled', comment: comment ? `: ${comment}` : '' }, `/bd/opportunity?id=${o.id}`, `award:${o.id}:${outcome}`);
  }

  const ops = createOps({ db, kit, base: { leadRow, oppRow, leadView, oppView, clientRow, clientProblem, seesAll, maker, seen, SCOPE_O, scopeParams } });
  return { leads, opportunities, ...ops, decisions: { lead: decideLead, opportunity: decideOpportunity, award: decideAward }, access: (actor, entity, id) => {
    const t = entity === 'bd_lead' ? 'bd_leads' : 'bd_opportunities'; const r = db.prepare(`SELECT * FROM ${t} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r || !seen(actor, r, entity === 'bd_lead' ? [LEAD_DOC] : [OPP_DOC, AWARD_DOC])) return null;
    return { companyId: r.company_id, canView: may(actor, entity === 'bd_lead' ? 'bd.lead.view' : 'bd.opportunity.view'), canEdit: !['CANCELLED'].includes(r.status) && (maker(actor, r) || seesAll(actor)) && may(actor, entity === 'bd_lead' ? 'bd.lead.edit' : 'bd.opportunity.track') };
  } };
}

const services = new WeakMap();
export const bindCrm = (db, s) => services.set(db, s);
export const crmOf = (db) => services.get(db) ?? null;

const step = (code, name, approvers, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
if (!workflowResolvers.get('bd.reviewer')) workflowResolvers.register('bd.reviewer', ({ db, companyId, instance }) => {
  const r = db.prepare(`SELECT created_by, owner FROM ${instance.docType === LEAD_DOC ? 'bd_leads' : 'bd_opportunities'} WHERE id = ?`).get(rid(instance.docId));
  const out = new Set([instance.submittedBy, r?.created_by, r?.owner].filter(Boolean).map((x) => String(x).toLowerCase()));
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => json(u.roles_json, []).includes('BD') && !out.has(u.username.toLowerCase())).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role: 'DIR' }];
});
const describeOf = (table, prefix) => (db, companyId, id) => { const r = db.prepare(`SELECT doc_no, ${prefix === 'lead' ? 'title' : 'name'} AS title, requested_by, created_by FROM ${table} WHERE id = ? AND company_id = ?`).get(rid(id), companyId); return r ? { ref: r.doc_no, title: r.title, originator: r.requested_by ?? r.created_by } : null; };
workflowTypes.register({
  docType: LEAD_DOC, label: 'Lead qualification', processOwner: 'BD', route: (id) => `/bd/lead?id=${id}`, describe: describeOf('bd_leads', 'lead'),
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM bd_leads WHERE id = ?').get(rid(id)); if (!r) return null; const q = json(r.qualification_json, {}); return { fields: [{ label: 'Lead', value: r.doc_no }, { label: 'Title', value: r.title }, { label: 'Source', value: SOURCES[r.source] }, { label: 'Sector', value: SECTORS[r.sector] }, { label: 'Estimated value', value: `₹ ${rupees(r.est_value_minor).toLocaleString('en-IN')}` }, { label: 'Qualification', value: `${r.qual_score}/100 (budget ${q.budget?.rating ?? '–'}, authority ${q.authority?.rating ?? '–'}, need ${q.need?.rating ?? '–'}, timeline ${q.timeline?.rating ?? '–'})` }] }; },
  defaultDefinition: { name: 'Lead qualification: reviewed by a business development colleague (the director when there is none)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('REVIEW', 'Business development review', [{ kind: 'resolver', resolver: 'bd.reviewer' }])] },
  hooks: {
    onApproved: (db, { instance, actor }) => crmOf(db)?.decisions.lead(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => crmOf(db)?.decisions.lead(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => crmOf(db)?.decisions.lead(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => crmOf(db)?.decisions.lead(instance, actor, 'CANCELLED', comment),
  },
});
workflowTypes.register({
  docType: OPP_DOC, label: 'Opportunity go-ahead for tendering', processOwner: 'BD', route: (id) => `/bd/opportunity?id=${id}`, describe: describeOf('bd_opportunities', 'opp'),
  summarise(db, _actor, id) { const r = db.prepare('SELECT o.*, p.legal_name FROM bd_opportunities o JOIN mdm_partners p ON p.id = o.client_partner_id WHERE o.id = ?').get(rid(id)); if (!r) return null; return { fields: [{ label: 'Opportunity', value: r.doc_no }, { label: 'Project', value: r.name }, { label: 'Client', value: r.legal_name }, { label: 'Sector', value: SECTORS[r.sector] }, { label: 'Location', value: [r.location, r.region].filter(Boolean).join(', ') || '–' }, { label: 'Estimated value', value: `₹ ${rupees(r.est_value_minor).toLocaleString('en-IN')}` }, { label: 'Stage', value: `${STAGES[r.stage]} (${r.probability_pct}%)` }, { label: 'Expected award', value: r.expected_award_date ?? '–' }] }; },
  defaultDefinition: { name: 'Go-ahead for tendering: business development review, then the director above ₹10 crore', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('REVIEW', 'Business development review', [{ kind: 'resolver', resolver: 'bd.reviewer' }]), step('DIR', 'Director', [{ kind: 'role', role: 'DIR' }], { field: 'valueMinor', op: 'gt', value: 10_000_000_000 })] },
  hooks: {
    onApproved: (db, { instance, actor }) => crmOf(db)?.decisions.opportunity(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => crmOf(db)?.decisions.opportunity(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => crmOf(db)?.decisions.opportunity(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => crmOf(db)?.decisions.opportunity(instance, actor, 'CANCELLED', comment),
  },
});
workflowTypes.register({
  docType: AWARD_DOC, label: 'Direct award of an opportunity', processOwner: 'DIR', route: (id) => `/bd/opportunity?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT doc_no, name, requested_by, created_by FROM bd_opportunities WHERE id = ? AND company_id = ?').get(rid(id), companyId); return r ? { ref: r.doc_no, title: `Direct award: ${r.name}`, originator: r.requested_by ?? r.created_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT o.*, p.legal_name FROM bd_opportunities o JOIN mdm_partners p ON p.id = o.client_partner_id WHERE o.id = ?').get(rid(id)); if (!r) return null; return { fields: [{ label: 'Opportunity', value: r.doc_no }, { label: 'Project', value: r.name }, { label: 'Client', value: r.legal_name }, { label: 'Award value', value: `₹ ${rupees(r.award_value_minor ?? r.est_value_minor).toLocaleString('en-IN')}` }, { label: 'Why no tender', value: r.award_reason ?? '–' }] }; },
  defaultDefinition: { name: 'Direct award: the director decides', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('DIR', 'Director', [{ kind: 'role', role: 'DIR' }])] },
  hooks: {
    onApproved: (db, { instance, actor }) => crmOf(db)?.decisions.award(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => crmOf(db)?.decisions.award(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => crmOf(db)?.decisions.award(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => crmOf(db)?.decisions.award(instance, actor, 'CANCELLED', comment),
  },
});
const interactionsOf = (db, entity, id) => db.prepare("SELECT COUNT(*) AS n, MAX(interaction_date) AS last FROM bd_interactions WHERE entity = ? AND entity_id = ? AND deleted_at IS NULL").get(entity, id);
evidenceProviders.register(OPP_DOC, ({ db, instance }) => {
  const o = db.prepare('SELECT o.*, p.legal_name FROM bd_opportunities o JOIN mdm_partners p ON p.id = o.client_partner_id WHERE o.id = ?').get(rid(instance.docId)); if (!o) return { sections: [] };
  const mine = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(est_value_minor), 0) AS v FROM bd_opportunities WHERE client_partner_id = ? AND id <> ? AND stage NOT IN ('WON', 'LOST') AND status NOT IN ('CANCELLED', 'REJECTED') AND deleted_at IS NULL").get(o.client_partner_id, o.id);
  const won = db.prepare("SELECT COUNT(*) AS n FROM bd_opportunities WHERE client_partner_id = ? AND stage = 'WON' AND deleted_at IS NULL").get(o.client_partner_id).n; const lost = db.prepare("SELECT COUNT(*) AS n FROM bd_opportunities WHERE client_partner_id = ? AND stage = 'LOST' AND deleted_at IS NULL").get(o.client_partner_id).n;
  const i = interactionsOf(db, 'OPPORTUNITY', o.id);
  return { sections: [{ code: 'bd-opportunity', title: 'Before giving the go-ahead', kind: 'metrics', items: [
    { label: 'Estimated value / weighted', value: `₹ ${rupees(o.est_value_minor).toLocaleString('en-IN')} / ₹ ${rupees(weightedMinor(o.est_value_minor, o.probability_pct)).toLocaleString('en-IN')} (${o.probability_pct}%)`, format: 'text' },
    { label: 'Other open opportunities with this client', value: `${mine.n} worth ₹ ${rupees(mine.v).toLocaleString('en-IN')}`, format: 'text' }, { label: 'History with this client (won / lost)', value: `${won} / ${lost}`, format: 'text' },
    { label: 'Interactions logged', value: `${i.n}${i.last ? `, last ${i.last}` : ''}`, format: 'text' }, { label: 'Competitors named', value: String(json(o.competitors_json, []).length), format: 'text' }] }] };
});
evidenceProviders.register(LEAD_DOC, ({ db, instance }) => {
  const l = db.prepare('SELECT * FROM bd_leads WHERE id = ?').get(rid(instance.docId)); if (!l) return { sections: [] };
  const q = json(l.qualification_json, {}); const i = interactionsOf(db, 'LEAD', l.id);
  return { sections: [{ code: 'bd-lead', title: 'Qualification', kind: 'metrics', items: [{ label: 'Score', value: `${l.qual_score}/100`, format: 'text' }, ...BANT.map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: `${RATINGS[q[k]?.rating] ?? 'Not rated'}${q[k]?.note ? `: ${q[k].note}` : ''}`, format: 'text' })), { label: 'Interactions logged', value: String(i.n), format: 'text' }] }] };
});
export { stageIndex, STAGE_LIST };
