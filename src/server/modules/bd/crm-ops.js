import { writeAudit } from '../../platform/audit/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { INFLUENCE_ROLES, INTERACTION_TYPES, OPEN_STAGES, SECTORS, STAGES, STAGE_LIST, WEIGHTED_SQL, json, nowIso, rupees, same } from './constants.js';

const CLIENT_ROLE = "EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role = 'CLIENT' AND r.deleted_at IS NULL)";
export const PARTNER_STATUS = { PROSPECT: 'Prospect', PENDING: 'Pending approval', ACTIVE: 'Active', ON_HOLD: 'On hold' };
export const clientList = defineList({
  code: 'bd.clients', label: 'Clients', permission: 'bd.client.view',
  from: 'mdm_partners p', where: `p.deleted_at IS NULL AND p.partner_status IN ('PROSPECT', 'PENDING', 'ACTIVE', 'ON_HOLD') AND ${CLIENT_ROLE}`, searchable: ['p.code', 'p.legal_name', 'p.trade_name'], defaultSort: 'name',
  columns: {
    code: { sql: 'p.code', type: 'text', label: 'Code' }, name: { sql: 'p.legal_name', type: 'text', label: 'Client' }, trade: { sql: 'p.trade_name', type: 'text', label: 'Trade name' },
    status: { sql: 'p.partner_status', type: 'enum', label: 'Status', options: Object.entries(PARTNER_STATUS) },
  },
});

/** Interactions, contacts and the influence map, the client view, the pipeline board, the forecast, the win and loss analysis and the dashboard (part 08.01). */
export function createOps({ db, kit, base }) {
  const { may, need, param, today, event, tell } = kit;
  const { leadRow, oppRow, clientRow, clientProblem, seesAll, SCOPE_O, scopeParams } = base;
  const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  // ------------------------------------------------------------------ interactions (FR-03)
  const subject = (actor, entity, id) => {
    if (entity === 'LEAD') { const l = leadRow(actor, id); return { clientPartnerId: l.client_partner_id, label: l.doc_no, locked: l.status === 'CANCELLED' }; }
    if (entity === 'OPPORTUNITY') { const o = oppRow(actor, id); return { clientPartnerId: o.client_partner_id, label: o.doc_no, locked: o.status === 'CANCELLED' }; }
    need(actor, 'bd.client.view', 'see clients');
    const c = clientRow(actor.companyId, id); if (!c) throw notFound('That client does not exist.');
    return { clientPartnerId: c.id, label: c.code, locked: false };
  };
  const interactionView = (actor, x, extra = {}) => ({
    id: x.id, entity: x.entity, entityId: x.entity_id, clientPartnerId: x.client_partner_id, type: x.type, typeLabel: INTERACTION_TYPES[x.type], date: x.interaction_date, participants: json(x.participants_json, []), notes: x.notes, emailRef: x.email_ref,
    nextAction: x.next_action, nextActionDate: x.next_action_date, nextActionOwner: x.next_action_owner, nextDone: Boolean(x.next_done), taskId: x.task_id, createdBy: x.created_by, createdAt: x.created_at,
    overdue: Boolean(x.next_action && !x.next_done && x.next_action_date && x.next_action_date < today()), can: { done: Boolean(x.next_action && !x.next_done && (same(x.next_action_owner, actor.user) || same(x.created_by, actor.user))), edit: same(x.created_by, actor.user) }, ...extra,
  });
  function checkInteraction(actor, b) {
    const problems = [];
    if (b.date > today()) problems.push({ field: 'date', message: 'An interaction is logged on or after the day it happened: the date cannot be in the future' });
    if (b.nextAction && !b.nextActionDate) problems.push({ field: 'nextActionDate', message: 'Give the date of the next action' });
    if (!b.nextAction && b.nextActionDate) problems.push({ field: 'nextAction', message: 'Say what the next action is' });
    if (b.nextActionDate && b.nextActionDate < b.date) problems.push({ field: 'nextActionDate', message: 'The next action is on or after the day of the interaction' });
    if (b.nextActionOwner && !kit.userExists(actor.companyId, b.nextActionOwner)) problems.push({ field: 'nextActionOwner', message: 'The owner of the next action is not an active user' });
    if (problems.length) throw badRequest('Some fields are not valid.', problems);
  }
  const interactions = {
    list(actor, { entity, entityId }) {
      const s = subject(actor, entity, entityId);
      const rows = entity === 'CLIENT'
        ? db.prepare("SELECT * FROM bd_interactions WHERE company_id = ? AND client_partner_id = ? AND deleted_at IS NULL ORDER BY interaction_date DESC, id DESC LIMIT 200").all(actor.companyId, entityId).filter((x) => x.entity === 'CLIENT' || seesAll(actor) || same(x.created_by, actor.user))
        : db.prepare("SELECT * FROM bd_interactions WHERE company_id = ? AND entity = ? AND entity_id = ? AND deleted_at IS NULL ORDER BY interaction_date DESC, id DESC LIMIT 200").all(actor.companyId, entity, entityId);
      const out = rows.map((x) => interactionView(actor, x));
      if (entity === 'OPPORTUNITY') { const o = oppRow(actor, entityId); if (o.lead_id) out.push(...db.prepare("SELECT * FROM bd_interactions WHERE company_id = ? AND entity = 'LEAD' AND entity_id = ? AND deleted_at IS NULL ORDER BY interaction_date DESC, id DESC").all(actor.companyId, o.lead_id).map((x) => interactionView(actor, x, { fromLead: true }))); out.sort((a, b) => (b.date + String(b.id).padStart(9, '0')).localeCompare(a.date + String(a.id).padStart(9, '0'))); }
      return { subject: s.label, rows: out };
    },
    create(actor, b) {
      need(actor, 'bd.interaction.log', 'log interactions');
      const s = subject(actor, b.entity, b.entityId); if (s.locked) throw unprocessable('A cancelled record takes no new interactions.');
      checkInteraction(actor, b);
      const owner = b.nextActionOwner ?? actor.user;
      const id = Number(db.prepare('INSERT INTO bd_interactions (company_id, entity, entity_id, client_partner_id, type, interaction_date, participants_json, notes, email_ref, next_action, next_action_date, next_action_owner, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'bd_interaction\')')
        .run(actor.companyId, b.entity, b.entityId, s.clientPartnerId, b.type, b.date, JSON.stringify(b.participants ?? []), b.notes.trim(), b.emailRef ?? null, b.nextAction?.trim() ?? null, b.nextActionDate ?? null, b.nextAction ? owner : null, actor.user).lastInsertRowid);
      if (b.nextAction) {
        // the reminder is a task of the owner, due on the day (04.08); the interaction is saved even if the task service refuses
        try { const task = tasksOf(db).create({ companyId: actor.companyId, title: `Follow up: ${b.nextAction.trim()}`.slice(0, 160), description: `${INTERACTION_TYPES[b.type]} on ${b.date} (${s.label}): ${b.notes.trim().slice(0, 300)}`, assignees: [owner], dueDate: b.nextActionDate, entity: 'bd_interaction', entityId: id, entityLabel: s.label, origin: 'auto', source: { type: 'bd_interaction', id }, actor: actor.user }); db.prepare('UPDATE bd_interactions SET task_id = ? WHERE id = ?').run(task?.id ?? null, id); } catch { /* the follow-up is still on the list and in the daily reminder */ }
      }
      writeAudit(db, { entity: 'bd_interactions', entityId: id, action: 'create', newValues: { entity: b.entity, entityId: b.entityId, type: b.type }, actor: actor.user, companyId: actor.companyId });
      event('bd.interaction.logged', actor, 'bd_interaction', id, actor.companyId, { entity: b.entity, entityId: b.entityId, type: b.type, clientPartnerId: s.clientPartnerId, nextActionDate: b.nextActionDate ?? null });
      return interactionView(actor, db.prepare('SELECT * FROM bd_interactions WHERE id = ?').get(id));
    },
    done(actor, id) {
      const x = db.prepare('SELECT * FROM bd_interactions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!x) throw notFound('That interaction does not exist.');
      subject(actor, x.entity, x.entity_id);
      if (!x.next_action) throw unprocessable('This interaction has no next action.');
      if (!(same(x.next_action_owner, actor.user) || same(x.created_by, actor.user))) throw forbidden('Only the owner of the next action marks it done.');
      db.prepare('UPDATE bd_interactions SET next_done = 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), x.id);
      if (x.task_id) { try { tasksOf(db).act(actor, x.task_id, 'complete', { reason: 'Done from the interaction' }); } catch { /* a task closed or taken elsewhere stays as it is */ } }
      writeAudit(db, { entity: 'bd_interactions', entityId: x.id, action: 'next_done', actor: actor.user, companyId: actor.companyId });
      return interactionView(actor, db.prepare('SELECT * FROM bd_interactions WHERE id = ?').get(x.id));
    },
    remove(actor, id) {
      const x = db.prepare('SELECT * FROM bd_interactions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!x) throw notFound('That interaction does not exist.');
      subject(actor, x.entity, x.entity_id);
      if (!same(x.created_by, actor.user)) throw forbidden(`Only ${x.created_by} removes this interaction.`);
      db.prepare('UPDATE bd_interactions SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, x.id);
      writeAudit(db, { entity: 'bd_interactions', entityId: x.id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id: x.id, deleted: true };
    },
    /** The follow-ups waiting for the person (FR-03): their own, earliest first. */
    mine(actor) {
      need(actor, 'bd.interaction.log', 'see your follow-ups');
      return db.prepare("SELECT * FROM bd_interactions WHERE company_id = ? AND next_action IS NOT NULL AND next_done = 0 AND deleted_at IS NULL AND lower(next_action_owner) = lower(?) ORDER BY next_action_date, id LIMIT 100").all(actor.companyId, actor.user).map((x) => interactionView(actor, x, { subject: subjectLabel(x) }));
    },
  };
  const subjectLabel = (x) => (x.entity === 'LEAD' ? db.prepare('SELECT doc_no AS d, title AS t FROM bd_leads WHERE id = ?').get(x.entity_id) : x.entity === 'OPPORTUNITY' ? db.prepare('SELECT doc_no AS d, name AS t FROM bd_opportunities WHERE id = ?').get(x.entity_id) : db.prepare('SELECT code AS d, legal_name AS t FROM mdm_partners WHERE id = ?').get(x.entity_id)) ?? { d: '', t: '' };

  // ------------------------------------------------------------------ contacts and the influence map (FR-02)
  const contactView = (c) => ({ id: c.id, partnerId: c.partner_id, name: c.name, designation: c.designation, email: c.email, mobile: c.mobile, influenceRole: c.influence_role, influenceRoleLabel: INFLUENCE_ROLES[c.influence_role], influenceLevel: c.influence_level, stance: c.stance, reportsToId: c.reports_to_id, relationshipOwner: c.relationship_owner, notes: c.notes, rowVersion: c.version });
  const contactRow = (actor, id) => { const c = db.prepare('SELECT * FROM bd_contacts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!c) throw notFound('That contact does not exist.'); return c; };
  function checkContact(actor, partnerId, b, selfId = null) {
    const problems = [];
    if (b.reportsToId) {
      const r = db.prepare('SELECT partner_id FROM bd_contacts WHERE id = ? AND deleted_at IS NULL').get(b.reportsToId);
      if (!r || r.partner_id !== partnerId) problems.push({ field: 'reportsToId', message: 'The person reported to is another contact of the same client' });
      else for (let cur = b.reportsToId, n = 0; cur && n < 30; n += 1) { if (selfId && cur === selfId) { problems.push({ field: 'reportsToId', message: 'A contact cannot report to themselves, directly or through others' }); break; } cur = db.prepare('SELECT reports_to_id AS r FROM bd_contacts WHERE id = ?').get(cur)?.r ?? null; }
    }
    if (b.relationshipOwner && !kit.userExists(actor.companyId, b.relationshipOwner)) problems.push({ field: 'relationshipOwner', message: 'The relationship owner is not an active user' });
    if (problems.length) throw badRequest('Some fields are not valid.', problems);
  }
  /** What the map tells: who decides, who is for and who against us, and where the relationship is thin. */
  function mapOf(contacts) {
    const has = (r) => contacts.some((c) => c.influenceRole === r);
    const warnings = [];
    if (!has('DECISION_MAKER')) warnings.push('No decision maker is known');
    if (contacts.some((c) => c.stance === 'BLOCKER')) warnings.push('A blocker is on the map');
    if (contacts.length && !contacts.some((c) => ['CHAMPION', 'SUPPORTER'].includes(c.stance))) warnings.push('Nobody supports us yet');
    if (contacts.some((c) => c.influenceRole === 'DECISION_MAKER' && !['CHAMPION', 'SUPPORTER'].includes(c.stance))) warnings.push('A decision maker is not yet a supporter');
    return { total: contacts.length, byStance: Object.fromEntries(Object.keys({ CHAMPION: 1, SUPPORTER: 1, NEUTRAL: 1, SKEPTIC: 1, BLOCKER: 1 }).map((s) => [s, contacts.filter((c) => c.stance === s).length])), warnings };
  }
  const contacts = {
    list(actor, partnerId) {
      need(actor, 'bd.client.view', 'see clients'); if (!clientRow(actor.companyId, partnerId)) throw notFound('That client does not exist.');
      const rows = db.prepare('SELECT * FROM bd_contacts WHERE company_id = ? AND partner_id = ? AND deleted_at IS NULL ORDER BY influence_level DESC, name').all(actor.companyId, partnerId).map(contactView);
      return { rows, map: mapOf(rows), canManage: may(actor, 'bd.contact.manage') };
    },
    create(actor, partnerId, b) {
      need(actor, 'bd.contact.manage', 'keep client contacts'); const p = clientProblem(actor.companyId, partnerId); if (p) throw badRequest('The client cannot take contacts.', [{ ...p, field: 'partnerId' }]);
      checkContact(actor, partnerId, b);
      const id = Number(db.prepare('INSERT INTO bd_contacts (company_id, partner_id, name, designation, email, mobile, influence_role, influence_level, stance, reports_to_id, relationship_owner, notes, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'bd_contact\')')
        .run(actor.companyId, partnerId, b.name.trim(), b.designation ?? null, b.email ?? null, b.mobile ?? null, b.influenceRole, b.influenceLevel, b.stance, b.reportsToId ?? null, b.relationshipOwner ?? actor.user, b.notes ?? null, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'bd_contacts', entityId: id, action: 'create', newValues: { name: b.name, influenceRole: b.influenceRole, stance: b.stance }, actor: actor.user, companyId: actor.companyId });
      return contactView(db.prepare('SELECT * FROM bd_contacts WHERE id = ?').get(id));
    },
    update(actor, id, b) {
      need(actor, 'bd.contact.manage', 'keep client contacts'); const c = contactRow(actor, id);
      if (c.version !== b.version) throw conflict('This contact was changed by someone else. Reload it and try again.');
      const m = { name: c.name, designation: c.designation, email: c.email, mobile: c.mobile, influenceRole: c.influence_role, influenceLevel: c.influence_level, stance: c.stance, reportsToId: c.reports_to_id, relationshipOwner: c.relationship_owner, notes: c.notes, ...Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && k !== 'version')) };
      checkContact(actor, c.partner_id, m, c.id);
      db.prepare('UPDATE bd_contacts SET name = ?, designation = ?, email = ?, mobile = ?, influence_role = ?, influence_level = ?, stance = ?, reports_to_id = ?, relationship_owner = ?, notes = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(m.name.trim(), m.designation ?? null, m.email ?? null, m.mobile ?? null, m.influenceRole, m.influenceLevel, m.stance, m.reportsToId ?? null, m.relationshipOwner ?? null, m.notes ?? null, actor.user, nowIso(), c.id);
      writeAudit(db, { entity: 'bd_contacts', entityId: c.id, action: 'update', oldValues: { stance: c.stance, influenceLevel: c.influence_level }, newValues: { stance: m.stance, influenceLevel: m.influenceLevel }, actor: actor.user, companyId: actor.companyId });
      return contactView(db.prepare('SELECT * FROM bd_contacts WHERE id = ?').get(c.id));
    },
    remove(actor, id) {
      need(actor, 'bd.contact.manage', 'keep client contacts'); const c = contactRow(actor, id);
      db.prepare('UPDATE bd_contacts SET reports_to_id = NULL WHERE reports_to_id = ?').run(c.id);
      db.prepare('UPDATE bd_contacts SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, c.id);
      writeAudit(db, { entity: 'bd_contacts', entityId: c.id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id: c.id, deleted: true };
    },
  };

  // ------------------------------------------------------------------ the pipeline filters, board, forecast, win and loss (FR-05, FR-06)
  function pipelineWhere(actor, f = {}, { open = true } = {}) {
    const where = [SCOPE_O(seesAll(actor)), 'o.deleted_at IS NULL', "o.status NOT IN ('CANCELLED', 'REJECTED')"]; const params = scopeParams(actor);
    if (open) where.push("o.stage NOT IN ('WON', 'LOST')");
    if (f.sector) { where.push('o.sector = :sector'); params.sector = f.sector; }
    if (f.region) { where.push('o.region = :region'); params.region = f.region; }
    if (f.owner) { where.push('lower(o.owner) = lower(:owner)'); params.owner = f.owner; }
    if (f.clientPartnerId) { where.push('o.client_partner_id = :client'); params.client = f.clientPartnerId; }
    if (f.stage) { where.push('o.stage = :stage'); params.stage = f.stage; }
    if (f.from) { where.push('o.expected_award_date >= :from'); params.from = f.from; }
    if (f.to) { where.push('o.expected_award_date <= :to'); params.to = f.to; }
    return { sql: where.join(' AND '), params };
  }
  const GROUPS = { month: "COALESCE(substr(o.expected_award_date, 1, 7), 'UNDATED')", sector: 'o.sector', region: "COALESCE(o.region, 'UNSET')", stage: 'o.stage', owner: 'lower(o.owner)', client: 'CAST(o.client_partner_id AS TEXT)' };
  const labelOf = (groupBy, key) => (groupBy === 'sector' ? SECTORS[key] ?? key : groupBy === 'stage' ? STAGES[key] ?? key : groupBy === 'client' ? db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ?').get(Number(key))?.legal_name ?? key : key === 'UNDATED' ? 'No award date' : key === 'UNSET' ? 'No region' : key);
  /** T-01: the weighted forecast is the sum over the opportunities of value times probability (each rounded to the paisa once), by month, sector, region, stage, owner or client, for the filter. */
  function forecast(actor, f = {}) {
    need(actor, 'bd.forecast.view', 'see the forecast');
    const groupBy = f.groupBy ?? 'month'; const w = pipelineWhere(actor, f);
    const rows = db.prepare(`SELECT ${GROUPS[groupBy]} AS k, COUNT(*) AS n, COALESCE(SUM(o.est_value_minor), 0) AS value, COALESCE(SUM(${WEIGHTED_SQL('o')}), 0) AS weighted FROM bd_opportunities o WHERE ${w.sql} GROUP BY k ORDER BY k`).all(w.params)
      .map((r) => ({ key: r.k, label: labelOf(groupBy, r.k), count: r.n, value: rupees(r.value), weighted: rupees(r.weighted) }));
    const t = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(o.est_value_minor), 0) AS value, COALESCE(SUM(${WEIGHTED_SQL('o')}), 0) AS weighted FROM bd_opportunities o WHERE ${w.sql}`).get(w.params);
    return { groupBy, filters: { sector: f.sector ?? null, region: f.region ?? null, owner: f.owner ?? null, from: f.from ?? null, to: f.to ?? null, clientPartnerId: f.clientPartnerId ?? null }, rows, total: { count: t.n, value: rupees(t.value), weighted: rupees(t.weighted) } };
  }
  /** FR-06: what was won and lost in the period (by the day it closed), the win rate by count and by value, the reasons for losing and who won instead. */
  function winLoss(actor, f = {}) {
    need(actor, 'bd.forecast.view', 'see win and loss');
    const w = pipelineWhere(actor, { ...f, from: undefined, to: undefined }, { open: false }); const params = { ...w.params }; let closed = "o.stage IN ('WON', 'LOST')";
    if (f.from) { closed += ' AND o.closed_on >= :cfrom'; params.cfrom = f.from; } if (f.to) { closed += ' AND o.closed_on <= :cto'; params.cto = f.to; }
    const one = (stage) => db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN o.stage = 'WON' THEN COALESCE(o.won_value_minor, o.est_value_minor) ELSE o.est_value_minor END), 0) AS v FROM bd_opportunities o WHERE ${w.sql} AND ${closed} AND o.stage = '${stage}'`).get(params);
    const won = one('WON'); const lost = one('LOST');
    const reasons = db.prepare(`SELECT o.lost_reason_code AS k, COUNT(*) AS n, COALESCE(SUM(o.est_value_minor), 0) AS v FROM bd_opportunities o WHERE ${w.sql} AND ${closed} AND o.stage = 'LOST' GROUP BY k ORDER BY n DESC, k`).all(params);
    const labels = Object.fromEntries((param(actor.companyId, 'bd.lost_reasons') ?? []).map((x) => [x[0], x[1]]));
    const bySector = db.prepare(`SELECT o.sector AS k, SUM(o.stage = 'WON') AS won, SUM(o.stage = 'LOST') AS lost FROM bd_opportunities o WHERE ${w.sql} AND ${closed} GROUP BY k ORDER BY k`).all(params).map((r) => ({ key: r.k, label: SECTORS[r.k], won: r.won, lost: r.lost, winRate: r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 100) : null }));
    const lostTo = db.prepare(`SELECT lower(o.lost_to) AS k, COUNT(*) AS n FROM bd_opportunities o WHERE ${w.sql} AND ${closed} AND o.stage = 'LOST' AND o.lost_to IS NOT NULL GROUP BY k ORDER BY n DESC, k LIMIT 10`).all(params).map((r) => ({ competitor: r.k, count: r.n }));
    return { period: { from: f.from ?? null, to: f.to ?? null }, won: { count: won.n, value: rupees(won.v) }, lost: { count: lost.n, value: rupees(lost.v) }, winRate: won.n + lost.n ? Math.round((won.n / (won.n + lost.n)) * 100) : null, winRateByValue: won.v + lost.v ? Math.round((won.v / (won.v + lost.v)) * 100) : null,
      reasons: reasons.map((r) => ({ code: r.k ?? 'OTHER', label: labels[r.k] ?? r.k ?? 'Not given', count: r.n, value: rupees(r.v) })), bySector, lostTo };
  }
  function board(actor, f = {}) {
    need(actor, 'bd.opportunity.view', 'see the pipeline');
    const w = pipelineWhere(actor, f, { open: false }); const recent = addDays(today(), -90);
    const cols = STAGE_LIST.map((stage) => {
      const closedCol = stage === 'WON' || stage === 'LOST';
      const where = `${w.sql} AND o.stage = '${stage}'${closedCol ? ' AND o.closed_on >= :recent' : ''}`; const params = closedCol ? { ...w.params, recent } : w.params;
      const t = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(o.est_value_minor), 0) AS v, COALESCE(SUM(${WEIGHTED_SQL('o')}), 0) AS w FROM bd_opportunities o WHERE ${where}`).get(params);
      const items = db.prepare(`SELECT o.*, p.legal_name FROM bd_opportunities o JOIN mdm_partners p ON p.id = o.client_partner_id WHERE ${where} ORDER BY o.est_value_minor DESC, o.id LIMIT 60`).all(params).map((o) => ({ id: o.id, docNo: o.doc_no, name: o.name, client: o.legal_name, sector: o.sector, estValue: rupees(o.est_value_minor), probability: o.probability_pct, weighted: rupees(Math.round((o.est_value_minor * o.probability_pct) / 100)), expectedAward: o.expected_award_date, owner: o.owner, status: o.status, goAheadPending: OPEN_STAGES.indexOf(o.stage) >= 2 && o.status !== 'APPROVED', rowVersion: o.version }));
      return { stage, label: STAGES[stage], count: t.n, value: rupees(t.v), weighted: rupees(t.w), items, more: Math.max(0, t.n - items.length) };
    });
    return { columns: cols, canMove: may(actor, 'bd.opportunity.track') };
  }

  // ------------------------------------------------------------------ clients (FR-02)
  const statsFor = (actor, ids) => {
    if (!ids.length) return new Map();
    const params = { ...scopeParams(actor), ids: JSON.stringify(ids) };
    const rows = db.prepare(`SELECT o.client_partner_id AS id, SUM(o.stage NOT IN ('WON', 'LOST')) AS open, COALESCE(SUM(CASE WHEN o.stage NOT IN ('WON', 'LOST') THEN o.est_value_minor END), 0) AS pipeline, COALESCE(SUM(CASE WHEN o.stage NOT IN ('WON', 'LOST') THEN ${WEIGHTED_SQL('o')} END), 0) AS weighted, SUM(o.stage = 'WON') AS won, COALESCE(SUM(CASE WHEN o.stage = 'WON' THEN COALESCE(o.won_value_minor, o.est_value_minor) END), 0) AS wonValue, SUM(o.stage = 'LOST') AS lost FROM bd_opportunities o WHERE ${SCOPE_O(seesAll(actor))} AND o.deleted_at IS NULL AND o.status NOT IN ('CANCELLED', 'REJECTED') AND o.client_partner_id IN (SELECT value FROM json_each(:ids)) GROUP BY o.client_partner_id`).all(params);
    const last = db.prepare("SELECT client_partner_id AS id, MAX(interaction_date) AS last FROM bd_interactions WHERE company_id = ? AND deleted_at IS NULL AND client_partner_id IN (SELECT value FROM json_each(?)) GROUP BY client_partner_id").all(actor.companyId, JSON.stringify(ids));
    const next = db.prepare("SELECT client_partner_id AS id, MIN(next_action_date) AS d FROM bd_interactions WHERE company_id = ? AND deleted_at IS NULL AND next_action IS NOT NULL AND next_done = 0 AND client_partner_id IN (SELECT value FROM json_each(?)) GROUP BY client_partner_id").all(actor.companyId, JSON.stringify(ids));
    const m = new Map(ids.map((id) => [id, { open: 0, pipeline: 0, weighted: 0, won: 0, wonValue: 0, lost: 0, lastInteraction: null, nextAction: null }]));
    for (const r of rows) Object.assign(m.get(r.id), { open: r.open ?? 0, pipeline: rupees(r.pipeline), weighted: rupees(r.weighted), won: r.won ?? 0, wonValue: rupees(r.wonValue), lost: r.lost ?? 0 });
    for (const r of last) m.get(r.id).lastInteraction = r.last; for (const r of next) m.get(r.id).nextAction = r.d;
    return m;
  };
  const clients = {
    list(actor, query) {
      need(actor, 'bd.client.view', 'see clients');
      const res = runList(db, clientList, parseListRequest(clientList, query), { select: 'p.*', scopeSql: 'p.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'p.id', map: (p) => ({ id: p.id, code: p.code, name: p.legal_name, trade: p.trade_name, status: p.partner_status, statusLabel: PARTNER_STATUS[p.partner_status] }) });
      const st = statsFor(actor, res.data.map((r) => r.id)); res.data = res.data.map((r) => ({ ...r, ...st.get(r.id) }));
      return res;
    },
    /** Client 360: the partner (read from the partner master), the contacts with the influence map, the opportunities and leads the person may see, the interactions and what comes with later parts. */
    get(actor, id) {
      need(actor, 'bd.client.view', 'see clients'); const c = clientRow(actor.companyId, id); if (!c) throw notFound('That client does not exist.');
      const stats = statsFor(actor, [c.id]).get(c.id);
      const opps = db.prepare(`SELECT o.* FROM bd_opportunities o WHERE ${SCOPE_O(seesAll(actor))} AND o.deleted_at IS NULL AND o.status <> 'CANCELLED' AND o.client_partner_id = :client ORDER BY o.id DESC LIMIT 100`).all({ ...scopeParams(actor), client: c.id })
        .map((o) => ({ id: o.id, docNo: o.doc_no, name: o.name, stage: o.stage, stageLabel: STAGES[o.stage], estValue: rupees(o.est_value_minor), probability: o.probability_pct, weighted: rupees(Math.round((o.est_value_minor * o.probability_pct) / 100)), expectedAward: o.expected_award_date, owner: o.owner }));
      const lds = db.prepare('SELECT l.* FROM bd_leads l WHERE ' + `${seesAll(actor) ? 'l.company_id = :c AND (1 = 1 OR :u IS NULL)' : 'l.company_id = :c AND (lower(l.owner) = lower(:u) OR lower(l.created_by) = lower(:u))'}` + " AND l.deleted_at IS NULL AND l.status NOT IN ('CANCELLED') AND l.client_partner_id = :client ORDER BY l.id DESC LIMIT 100").all({ c: actor.companyId, u: actor.user, client: c.id })
        .map((l) => ({ id: l.id, docNo: l.doc_no, title: l.title, status: l.status, estValue: rupees(l.est_value_minor), owner: l.owner }));
      const ct = contacts.list(actor, c.id);
      return { id: c.id, code: c.code, legalName: c.legal_name, tradeName: c.trade_name, status: c.partner_status, statusLabel: PARTNER_STATUS[c.partner_status] ?? c.partner_status, stats, opportunities: opps, leads: lds, contacts: ct.rows, map: ct.map, canManageContacts: ct.canManage, interactions: interactions.list(actor, { entity: 'CLIENT', entityId: c.id }).rows.slice(0, 50),
        later: [{ section: 'Tenders', part: '08.02' }, { section: 'Projects', part: '10.01' }, { section: 'Receivables', part: '23.x' }], partnerRoute: `/mdm/partners?id=${c.id}` };
    },
  };

  // ------------------------------------------------------------------ the dashboard (FR-05) and the daily reminders (FR-03)
  function dashboard(actor, f = {}) {
    need(actor, 'bd.forecast.view', 'see the business development dashboard');
    const fc = forecast(actor, { ...f, groupBy: 'stage' }); const byMonth = forecast(actor, { ...f, groupBy: 'month' });
    const byStage = OPEN_STAGES.map((s) => { const r = fc.rows.find((x) => x.key === s); return { stage: s, label: STAGES[s], count: r?.count ?? 0, value: r?.value ?? 0, weighted: r?.weighted ?? 0 }; });
    const wl = winLoss(actor, f); const w = pipelineWhere(actor, f);
    const top = db.prepare(`SELECT o.*, p.legal_name FROM bd_opportunities o JOIN mdm_partners p ON p.id = o.client_partner_id WHERE ${w.sql} ORDER BY ${WEIGHTED_SQL('o')} DESC, o.id LIMIT 5`).all(w.params).map((o) => ({ id: o.id, docNo: o.doc_no, name: o.name, client: o.legal_name, stage: o.stage, stageLabel: STAGES[o.stage], estValue: rupees(o.est_value_minor), probability: o.probability_pct, weighted: rupees(Math.round((o.est_value_minor * o.probability_pct) / 100)), expectedAward: o.expected_award_date }));
    const followUps = may(actor, 'bd.interaction.log') ? interactions.mine(actor).slice(0, 10) : [];
    const roles = JSON.stringify(actor.roles ?? []);
    const approvals = db.prepare("SELECT COUNT(*) AS n FROM wf_tasks t JOIN wf_instances i ON i.id = t.instance_id WHERE i.company_id = ? AND i.doc_type IN ('BD_LEAD', 'BD_OPPORTUNITY', 'BD_DIRECT_AWARD') AND t.status = 'OPEN' AND (lower(t.assignee_user_id) = lower(?) OR t.assignee_role IN (SELECT value FROM json_each(?)))").get(actor.companyId, actor.user, roles).n;
    const stale = db.prepare(`SELECT o.id, o.doc_no, o.name, o.expected_award_date FROM bd_opportunities o WHERE ${w.sql} AND o.expected_award_date < :today ORDER BY o.expected_award_date LIMIT 10`).all({ ...w.params, today: today() });
    const alerts = [...stale.map((o) => ({ kind: 'AWARD_DATE_PASSED', ref: o.doc_no, text: `${o.name}: the expected award date ${o.expected_award_date} has passed`, route: `/bd/opportunity?id=${o.id}` })), ...followUps.filter((x) => x.overdue).map((x) => ({ kind: 'FOLLOW_UP_OVERDUE', ref: x.subject.d, text: `${x.nextAction} was due ${x.nextActionDate}`, route: x.entity === 'LEAD' ? `/bd/lead?id=${x.entityId}` : x.entity === 'OPPORTUNITY' ? `/bd/opportunity?id=${x.entityId}` : `/bd/client?id=${x.entityId}` }))];
    return { filters: fc.filters, tiles: { openCount: fc.total.count, pipeline: fc.total.value, weighted: fc.total.weighted, winRate: wl.winRate, won: wl.won, lost: wl.lost }, byStage, byMonth: byMonth.rows, top, myActions: { followUps, approvals }, alerts, winLoss: wl };
  }
  /** Daily: the follow-ups due (or due soon, by the setting) are told to their owner once. */
  function cycle(companyId) {
    const lead = Number(param(companyId, 'bd.followup.remind_days')) || 0; const out = { reminded: 0 };
    const rows = db.prepare("SELECT * FROM bd_interactions WHERE company_id = ? AND next_action IS NOT NULL AND next_done = 0 AND deleted_at IS NULL AND next_action_date <= ?").all(companyId, addDays(today(), lead));
    for (const x of rows) { const s = subjectLabel(x); tell(companyId, x.next_action_owner, 'bd.followup', { ref: s.d, action: x.next_action, date: x.next_action_date }, x.entity === 'LEAD' ? `/bd/lead?id=${x.entity_id}` : x.entity === 'OPPORTUNITY' ? `/bd/opportunity?id=${x.entity_id}` : `/bd/client?id=${x.entity_id}`, `fu:${x.id}`); out.reminded += 1; }
    return out;
  }
  const widget = (actor) => {
    if (!may(actor, 'bd.forecast.view')) return { value: 0, count: 0 };
    const w = pipelineWhere(actor, {}); const t = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(${WEIGHTED_SQL('o')}), 0) AS w FROM bd_opportunities o WHERE ${w.sql}`).get(w.params);
    return { value: rupees(t.w), count: t.n };
  };
  return { interactions, contacts, clients, reports: { forecast, winLoss, board, dashboard }, cycle, widget };
}
