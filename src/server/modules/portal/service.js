import { z } from 'zod';
import { authzOf } from '../../platform/authz/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../platform/http/errors.js';
import { createPasswordHasher } from '../../platform/identity/password.js';
import { DEFAULT_POLICY, passwordProblems } from '../../platform/identity/policy.js';
import { DEV_AUTH_SECRET, hashToken, newPublicId, newToken, signJwt, verifyJwt } from '../../platform/identity/tokens.js';
import { newTotpSecret, verifyTotp } from '../../platform/identity/totp.js';
import { createVault } from '../../platform/integrations/vault.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { documentOpsOf } from '../eng/documents-ops.js';
import { CONSTITUTIONS, partnersOf } from '../mdm/partners.js';
import { parsePartnerCreate } from '../mdm/validators.js';
import { teamOf } from '../proj/team.js';
import { portalPrerequisitesMet } from './prerequisites.js';

const ROLES = { 'X-SUP': 'VENDOR', 'X-SUB': 'SUBCONTRACTOR', 'X-CLI': 'CLIENT', 'X-CON': 'CONSULTANT' };
const TERMS = '2026-11-20';
const DAY = 86400000;
const IDLE = DEFAULT_POLICY.session.idleMinutes * 60000;
const LIFETIME = DEFAULT_POLICY.session.absoluteHours * 3600000;
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const code = z.string().regex(/^\d{6}$/);
const password = z.string().min(1).max(128);
const documentNumber = z.string().regex(/^PTL-[a-f0-9]{32}$/);
const inviteInput = z.union([
  z.strictObject({ partnerId: id, contactId: id, portalType: z.enum(['X-SUP', 'X-SUB', 'X-CLI', 'X-CON']) }),
  z.strictObject({ stakeholderId: id, portalType: z.enum(['X-CLI', 'X-CON']) }),
]);
const activationInput = z.strictObject({ token, password, code, termsVersion: z.literal(TERMS) });
const signInInput = z.strictObject({ account: documentNumber, password, code });
const messageInput = z.strictObject({ subject: z.string().trim().min(3).max(120), body: z.string().trim().min(5).max(1500) });
const requestKey = z.string().regex(/^[A-Za-z0-9_-]{16,100}$/);
const scoped = (account) => ({ companyId: account.company_id, projectId: account.project_id, siteId: account.site_id });
const vendorFields = z.strictObject({
  companyCode: z.string().trim().min(1).max(40),
  legalName: z.string().trim().min(3).max(160),
  constitution: z.enum(CONSTITUTIONS),
  pan: z.string().trim().max(10).optional(),
  cin: z.string().trim().max(21).optional(),
  contactName: z.string().trim().min(2).max(80),
  email: z.email().max(120),
  address: z.string().trim().min(5).max(300),
  stateCode: z.string().trim().min(2).max(3),
});

function vendorInput(fields) {
  return parsePartnerCreate({
    legalName: fields.legalName, constitution: fields.constitution, pan: fields.pan ?? null, cin: fields.cin ?? null,
    roles: ['VENDOR'], contacts: [{ name: fields.contactName, email: fields.email, isPrimary: true }],
    addresses: [{ addressType: 'REGISTERED', address: fields.address, stateCode: fields.stateCode }],
  });
}

function vendorWrite(action) {
  try {
    return action();
  } catch (error) {
    if (['DUPLICATE', 'DUPLICATE_WARNING'].includes(error.code)) {
      throw conflict('The registration needs manual review. Contact the procurement team.');
    }
    throw error;
  }
}

export const PORTAL_ACCOUNTS_LIST = 'portal.accounts';
const accountList = defineList({
  code: PORTAL_ACCOUNTS_LIST, label: 'Portal users', from: 'ptl_accounts a',
  where: 'a.deleted_at IS NULL AND a.is_active = 1', searchable: ['a.doc_no'], defaultSort: '-createdAt',
  columns: {
    account: { sql: 'a.doc_no', label: 'Account reference', type: 'text' },
    partnerId: { sql: 'a.partner_id', label: 'Partner ID', type: 'id' },
    contactId: { sql: 'a.contact_id', label: 'Contact ID', type: 'id' },
    stakeholderId: { sql: 'a.stakeholder_id', label: 'Stakeholder ID', type: 'id' },
    role: { sql: 'a.portal_type', label: 'Portal role', type: 'enum', options: Object.keys(ROLES).map((role) => [role, role]) },
    status: { sql: 'a.status', label: 'Status', type: 'enum', options: [['INVITED', 'Invited'], ['ACTIVE', 'Active'], ['REVOKED', 'Revoked']] },
    createdAt: { sql: 'a.created_at', label: 'Created', type: 'datetime' },
  },
});
const ACCOUNT_FIELDS = `a.id, a.version, ${Object.entries(accountList.columns).map(([key, column]) => `${column.sql} AS ${key}`).join(', ')}`;

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw badRequest('Check the portal form fields and try again.', result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  })));
}

export function createPortalService({ db, flags, vaultKey, authSecret = DEV_AUTH_SECRET, now = Date.now }) {
  const vault = createVault({ secret: vaultKey ?? undefined });
  const hasher = createPasswordHasher();
  const authz = authzOf(db);
  const loginError = () => unauthorized('Check the account, password and authenticator code.');
  const inviteError = () => unauthorized('The invitation is unavailable or has expired.');
  const byId = (accountId) => db.prepare('SELECT * FROM ptl_accounts WHERE id = ? AND is_active = 1 AND deleted_at IS NULL').get(accountId);
  const slot = (account) => `portal/${account.company_id}/${account.doc_no}/totp`;
  const eligible = (companyId) => portalPrerequisitesMet({ db, flags, companyId })
    && Boolean(db.prepare("SELECT 1 FROM org_companies WHERE id = ? AND status = 'ACTIVE' AND is_active = 1 AND deleted_at IS NULL").get(companyId));
  const contactOf = (account) => account.stakeholder_id != null
    ? teamOf(db)?.portalStakeholder(account.company_id, account.stakeholder_id, ROLES[account.portal_type])
    : partnersOf(db)?.portalContact(account.company_id, account.partner_id, account.contact_id, ROLES[account.portal_type]);
  const audit = (account, action, actor = account.doc_no) => writeAudit(db, {
    entity: 'ptl_accounts', entityId: account.id, action, actor, companyId: account.company_id,
  });
  const event = (account, action, actor) => publishEvent(db, {
    type: `portal.account.${action}`, entity: 'ptl_account', entityId: account.id,
    actorId: actor, companyId: account.company_id, data: account.stakeholder_id ? { stakeholderId: account.stakeholder_id } : { partnerId: account.partner_id },
  });
  const permitted = (actor, permission, resource = { companyId: actor.companyId }) => {
    if (!authz.check(actor, permission, resource).allowed) throw forbidden('You do not have permission to manage this portal account.');
    if (!eligible(actor.companyId)) throw notFound('The portal is unavailable.');
  };
  const activeContact = (account) => {
    if (!account || !eligible(account.company_id)) return null;
    const contact = contactOf(account);
    return contact && contact.projectId === account.project_id && contact.siteId === account.site_id
      && (account.stakeholder_id === null || contact.partnerId === account.partner_id) ? contact : null;
  };

  function invited(value) {
    const account = db.prepare(`SELECT * FROM ptl_accounts WHERE invite_hash = ? AND invite_expires_at > ?
      AND status = 'INVITED' AND is_active = 1 AND deleted_at IS NULL`).get(hashToken(value), now());
    if (!activeContact(account)) throw inviteError();
    return account;
  }

  function session(value) {
    if (!token.safeParse(value).success) throw unauthorized('Sign in to the portal.');
    const hash = hashToken(value);
    const entry = db.prepare('SELECT * FROM ptl_sessions WHERE token_hash = ? AND expires_at > ? AND last_seen > ?')
      .get(hash, now(), now() - IDLE);
    const account = entry && byId(entry.account_id);
    const contact = account?.status === 'ACTIVE' && account.terms_version === TERMS && activeContact(account);
    if (!contact) throw unauthorized('Sign in to the portal.');
    return { account, contact, hash };
  }

  function useSession(value, action) {
    const current = session(value);
    db.prepare('UPDATE ptl_sessions SET last_seen = ? WHERE token_hash = ?').run(now(), current.hash);
    audit(current.account, action);
    return current;
  }

  function sharedRevision(account, shareId) {
    const share = db.prepare(`SELECT version_id FROM ptl_shares WHERE id = ? AND company_id = ? AND account_id = ?
      AND deleted_at IS NULL AND is_active = 1`).get(shareId, account.company_id, account.id);
    if (!share) throw notFound('That shared revision does not exist.');
    return share.version_id;
  }

  function managedAccount(actor, accountId) {
    permitted(actor, 'portal.account.manage');
    const account = byId(parse(id, Number(accountId)));
    if (!account || account.company_id !== actor.companyId || !authz.check(actor, 'portal.account.manage', scoped(account)).allowed) {
      throw notFound('That portal account does not exist.');
    }
    return account;
  }

  function recordMessage(account, { subject, body }, { kind, key = null, actor }) {
    const reference = `PTM-${newPublicId()}`;
    const status = kind === 'PROFILE_REQUEST' ? 'REQUESTED' : 'UNREAD';
    const { lastInsertRowid } = db.prepare(`INSERT INTO ptl_messages
      (company_id, account_id, doc_no, kind, subject, body, status, submission_key, project_id, site_id, created_by, source_type, source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ptl_account', ?)`).run(
      account.company_id, account.id, reference, kind, subject, body, status, key,
      account.project_id, account.site_id, actor, String(account.id),
    );
    writeAudit(db, { entity: 'ptl_messages', entityId: lastInsertRowid, action: 'create',
      newValues: { status, kind }, actor, companyId: account.company_id });
    publishEvent(db, { type: kind === 'PROFILE_REQUEST' ? 'portal.profile.requested' : 'portal.notice.sent',
      entity: 'ptl_message', entityId: Number(lastInsertRowid), actorId: actor, companyId: account.company_id,
      data: { accountId: account.id } });
    return { id: Number(lastInsertRowid), reference, status };
  }

  function accountScope(actor, permission) {
    const scope = authz.scopeFilter(actor, permission, { project: 'a.project_id', site: 'a.site_id' });
    return { scopeSql: `a.company_id = :company AND (${scope.sql})`, params: { company: actor.companyId } };
  }

  function queryAccounts(actor, req, permission, limit = undefined) {
    return runList(db, accountList, req, { ...accountScope(actor, permission), select: ACCOUNT_FIELDS, tieBreaker: 'a.id DESC', limit });
  }

  function revokeAccount(account, actor) {
    db.prepare(`UPDATE ptl_accounts SET status = 'REVOKED', password_hash = NULL, totp_enc = NULL, invite_hash = NULL,
      version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?`).run(actor.user, new Date(now()).toISOString(), account.id);
    db.prepare('DELETE FROM ptl_sessions WHERE account_id = ?').run(account.id);
    audit(account, 'revoke', actor.user);
    event(account, 'revoked', actor.user);
    return { id: account.id, status: 'REVOKED' };
  }

  function registration(value) {
    const hash = hashToken(parse(token, value));
    const row = db.prepare(`SELECT * FROM ptl_registrations WHERE receipt_hash = ? AND is_active = 1 AND deleted_at IS NULL`).get(hash);
    if (!row || !eligible(row.company_id)) throw notFound('That registration is unavailable.');
    const intake = partnersOf(db)?.vendorIntake;
    if (!intake) throw notFound('Registration is unavailable.');
    return { row, intake, actor: { companyId: row.company_id, user: row.created_by, roles: [] } };
  }

  return {
    registerVendor(value, input) {
      const receipt = parse(token, value);
      const fields = parse(vendorFields, input);
      return transaction(db, () => {
        const company = db.prepare(`SELECT id FROM org_companies WHERE code = ? AND status = 'ACTIVE'
          AND is_active = 1 AND deleted_at IS NULL`).get(fields.companyCode);
        if (!company || !eligible(company.id)) throw notFound('Vendor registration is unavailable.');
        const intake = partnersOf(db)?.vendorIntake;
        if (!intake) throw notFound('Vendor registration is unavailable.');
        const receiptHash = hashToken(receipt);
        const submissionHash = hashToken(`vendor:${receipt}:${JSON.stringify(fields)}`);
        const prior = db.prepare('SELECT * FROM ptl_registrations WHERE receipt_hash = ?').get(receiptHash);
        if (prior) {
          if (prior.company_id !== company.id || prior.submission_hash !== submissionHash) throw conflict('Use a new receipt for a different registration.');
          return intake.status({ companyId: prior.company_id, user: prior.created_by }, prior.partner_id);
        }
        const reference = `PTR-${newPublicId()}`;
        const actor = { companyId: company.id, user: `portal-registration/${reference}`, roles: [] };
        const partner = vendorWrite(() => intake.create(actor, vendorInput(fields)));
        const out = db.prepare(`INSERT INTO ptl_registrations
          (company_id, partner_id, doc_no, receipt_hash, submission_hash, created_by, source_type, source_id)
          VALUES (?, ?, ?, ?, ?, ?, 'mdm_partner', ?)`).run(company.id, partner.id, reference, receiptHash, submissionHash, actor.user, String(partner.id));
        writeAudit(db, { entity: 'ptl_registrations', entityId: out.lastInsertRowid, action: 'register',
          actor: actor.user, companyId: actor.companyId });
        return intake.status(actor, partner.id);
      });
    },

    vendorStatus(input) {
      const { receipt } = parse(z.strictObject({ receipt: token }), input);
      return transaction(db, () => {
        const { row, intake, actor } = registration(receipt);
        const status = intake.status(actor, row.partner_id);
        writeAudit(db, { entity: 'ptl_registrations', entityId: row.id, action: 'status_view',
          actor: actor.user, companyId: actor.companyId });
        return status;
      });
    },

    reviseVendor(value, input) {
      const { version, ...fields } = parse(vendorFields.extend({ version: id }), input);
      return transaction(db, () => {
        const { row, intake, actor } = registration(value);
        const company = db.prepare('SELECT code FROM org_companies WHERE id = ?').get(actor.companyId);
        if (!company || company.code.toLowerCase() !== fields.companyCode.toLowerCase()) throw notFound('That registration is unavailable.');
        const result = vendorWrite(() => intake.revise(actor, row.partner_id, { ...vendorInput(fields), version }));
        writeAudit(db, { entity: 'ptl_registrations', entityId: row.id, action: 'resubmit',
          actor: actor.user, companyId: actor.companyId });
        return result;
      });
    },

    invite(actor, input) {
      if (!authz.check(actor, 'portal.account.invite').allowed) throw forbidden('You do not have permission to invite portal users.');
      const body = parse(inviteInput, input);
      if (!eligible(actor.companyId)) throw notFound('The portal is unavailable.');
      return transaction(db, () => {
        const stakeholderId = 'stakeholderId' in body ? body.stakeholderId : null;
        const contactId = 'contactId' in body ? body.contactId : null;
        const companyId = actor.companyId;
        const masterRole = ROLES[body.portalType];
        const partnerId = 'partnerId' in body ? body.partnerId : null;
        const contact = stakeholderId
          ? teamOf(db)?.portalStakeholder(companyId, stakeholderId, masterRole)
          : partnersOf(db)?.portalContact(companyId, partnerId, contactId, masterRole);
        if (!contact) throw notFound('No active partner contact or project stakeholder matches those details.');
        permitted(actor, 'portal.account.invite', { companyId, projectId: contact.projectId, siteId: contact.siteId });
        const sourceColumn = stakeholderId ? 'stakeholder_id' : 'contact_id';
        const existing = db.prepare(`SELECT id, status, invite_expires_at FROM ptl_accounts
          WHERE company_id = ? AND ${sourceColumn} = ? AND portal_type = ? AND status != 'REVOKED' AND deleted_at IS NULL`)
          .get(companyId, stakeholderId ?? contactId, body.portalType);
        if (existing?.status === 'ACTIVE' || existing?.invite_expires_at > now()) throw conflict('This contact already has a current account or invitation.');
        if (existing) db.prepare("UPDATE ptl_accounts SET status = 'REVOKED', invite_hash = NULL, totp_enc = NULL, version = version + 1 WHERE id = ?").run(existing.id);
        const secret = newToken();
        const docNo = `PTL-${newPublicId()}`;
        const { lastInsertRowid } = db.prepare(`INSERT INTO ptl_accounts
          (company_id, doc_no, partner_id, contact_id, stakeholder_id, portal_type, status, invite_hash, invite_expires_at, totp_enc, project_id, site_id, created_by, source_type, source_id)
          VALUES (?, ?, ?, ?, ?, ?, 'INVITED', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          companyId, docNo, stakeholderId ? contact.partnerId : partnerId, contactId, stakeholderId, body.portalType,
          hashToken(secret), now() + DAY, vault.encrypt(newTotpSecret(), slot({ company_id: companyId, doc_no: docNo })),
          contact.projectId, contact.siteId, actor.user, stakeholderId ? 'proj_stakeholder' : 'mdm_partner_contact', String(stakeholderId ?? contactId),
        );
        const account = byId(lastInsertRowid);
        audit(account, 'invite', actor.user);
        event(account, 'invited', actor.user);
        return { account: docNo, token: secret };
      });
    },

    prepare(input) {
      const account = invited(parse(z.strictObject({ token }), input).token);
      return transaction(db, () => {
        audit(account, 'enrolment_view');
        return { account: account.doc_no, secret: vault.decrypt(account.totp_enc, slot(account)), termsVersion: TERMS };
      });
    },

    async activate(input) {
      const body = parse(activationInput, input);
      const account = invited(body.token);
      const problems = passwordProblems(body.password, DEFAULT_POLICY);
      if (problems.length) throw badRequest('Choose a stronger password.', problems.map((message) => ({ field: 'password', message })));
      const counter = verifyTotp(vault.decrypt(account.totp_enc, slot(account)), body.code, { nowMs: now() });
      if (counter === null) throw inviteError();
      const hash = await hasher.hash(body.password);
      return transaction(db, () => {
        const current = invited(body.token);
        db.prepare(`UPDATE ptl_accounts SET status = 'ACTIVE', invite_hash = NULL, invite_expires_at = NULL,
          password_hash = ?, last_counter = ?, terms_version = ?, terms_accepted_at = ?, version = version + 1,
          updated_at = ? WHERE id = ?`).run(hash, counter, TERMS, new Date(now()).toISOString(), new Date(now()).toISOString(), current.id);
        audit(current, 'terms_accepted');
        event(current, 'activated', current.doc_no);
        return { account: current.doc_no };
      });
    },

    async login(input) {
      const body = parse(signInInput, input);
      const account = db.prepare(`SELECT * FROM ptl_accounts
        WHERE doc_no = ? AND status = 'ACTIVE' AND is_active = 1 AND deleted_at IS NULL`).get(body.account);
      if (!activeContact(account) || account.locked_until > now()) {
        await hasher.decoy(body.password);
        throw loginError();
      }
      const checked = await hasher.verify(account.password_hash, body.password);
      const result = transaction(db, () => {
        const current = byId(account.id);
        if (!current || current.status !== 'ACTIVE' || current.password_hash !== account.password_hash
          || current.terms_version !== TERMS || current.locked_until > now() || !activeContact(current)) return null;
        const counter = checked.ok ? verifyTotp(vault.decrypt(current.totp_enc, slot(current)), body.code, {
          nowMs: now(), lastCounter: current.last_counter,
        }) : null;
        if (counter === null) {
          const attempts = current.failed_attempts + 1;
          const locked = attempts >= DEFAULT_POLICY.lockout.threshold;
          db.prepare('UPDATE ptl_accounts SET failed_attempts = ?, locked_until = ? WHERE id = ?')
            .run(locked ? 0 : attempts, locked ? now() + DEFAULT_POLICY.lockout.baseDelayMinutes * 60000 : null, current.id);
          audit(current, 'login_denied');
          return null;
        }
        const sessionToken = newToken();
        db.prepare('UPDATE ptl_accounts SET last_counter = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(counter, current.id);
        db.prepare('DELETE FROM ptl_sessions WHERE account_id = ? AND (expires_at <= ? OR last_seen <= ?)').run(current.id, now(), now() - IDLE);
        db.prepare(`DELETE FROM ptl_sessions WHERE token_hash IN (
          SELECT token_hash FROM ptl_sessions WHERE account_id = ?
          ORDER BY last_seen DESC, rowid DESC LIMIT -1 OFFSET ?
        )`).run(current.id, DEFAULT_POLICY.session.maxConcurrent - 1);
        db.prepare('INSERT INTO ptl_sessions VALUES (?, ?, ?, ?)').run(hashToken(sessionToken), current.id, now() + LIFETIME, now());
        audit(current, 'login');
        return { token: sessionToken };
      });
      if (!result) throw loginError();
      return result;
    },

    /** Resolve the scope for supplier-facing services using the portal session as the sole identity source. */
    supplierScope(value) {
      const { account } = session(value);
      if (account.portal_type !== 'X-SUP') throw forbidden('A supplier portal account is required.');
      if (!flags.isOn({ companyId: account.company_id }, 'ff.portal.p2502')) {
        throw notFound('The supplier portal is unavailable.');
      }
      return Object.freeze({ ...scoped(account), partnerId: account.partner_id, accountId: account.id });
    },

    /** Resolve the grant used by future subcontractor integrations from a live portal session. */
    subcontractorScope(value) {
      const { account } = session(value);
      if (account.portal_type !== 'X-SUB' || account.contact_id === null || account.partner_id === null) {
        throw forbidden('A subcontractor portal account is required.');
      }
      if (!flags.isOn({ companyId: account.company_id }, 'ff.portal.p2503')) {
        throw notFound('The subcontractor portal is unavailable.');
      }
      return Object.freeze({ ...scoped(account), partnerId: account.partner_id, accountId: account.id });
    },

    /** Resolve an identity grant. Record sharing and routing must be checked by the owning service. */
    clientConsultantScope(value) {
      const { account } = session(value);
      if (account.portal_type !== 'X-CLI' && account.portal_type !== 'X-CON') {
        throw forbidden('A client or consultant portal account is required.');
      }
      if (!flags.isOn({ companyId: account.company_id }, 'ff.portal.p2504')) {
        throw notFound('The client and consultant portal is unavailable.');
      }
      const project = db.prepare(`SELECT 1 FROM org_projects p
        WHERE p.id = ? AND p.company_id = ? AND p.is_active = 1 AND p.deleted_at IS NULL
          AND (? IS NULL OR EXISTS (
            SELECT 1 FROM org_sites s WHERE s.id = ? AND s.org_project_id = p.id
              AND s.company_id = p.company_id AND s.status = 'ACTIVE' AND s.is_active = 1 AND s.deleted_at IS NULL
          ))`).get(account.project_id, account.company_id, account.site_id, account.site_id);
      if (!project) throw forbidden('An active project grant is required.');
      return Object.freeze({ ...scoped(account), role: account.portal_type, accountId: account.id,
        partnerId: account.partner_id, contactId: account.contact_id, stakeholderId: account.stakeholder_id });
    },

    profile(value) {
      return transaction(db, () => {
        const { account, contact } = useSession(value, 'profile_view');
        const company = db.prepare('SELECT short_name FROM org_companies WHERE id = ? AND deleted_at IS NULL').get(account.company_id);
        if (!company) throw unauthorized('Sign in to the portal.');
        return { account: account.doc_no, role: account.portal_type, companyName: company.short_name,
          partnerName: contact.partnerName, partnerCode: contact.partnerCode, contactName: contact.contactName,
          termsAcceptedAt: account.terms_accepted_at,
          ...(account.portal_type === 'X-SUP' && flags.isOn({ companyId: account.company_id }, 'ff.portal.p2502')
            ? { supplierEnabled: true,
              supplierInvoices: flags.isOn({ companyId: account.company_id }, 'ff.proc.p1505') &&
                flags.isOn({ companyId: account.company_id }, 'ff.bill.p2206') && flags.isOn({ companyId: account.company_id }, 'ff.core.p0105'),
              supplierVdr: flags.isOn({ companyId: account.company_id }, 'ff.proc.p1505') &&
                flags.isOn({ companyId: account.company_id }, 'ff.engg.p1104') && flags.isOn({ companyId: account.company_id }, 'ff.core.p0105'),
              supplierCompliance: account.project_id === null && account.site_id === null &&
                flags.isOn({ companyId: account.company_id }, 'ff.mdm.p0604') && flags.isOn({ companyId: account.company_id }, 'ff.core.p0105'),
              supplierScorecards: account.project_id === null && account.site_id === null &&
              flags.isOn({ companyId: account.company_id }, 'ff.proc.p1508') } : {}) };
      });
    },

    logout(value) {
      transaction(db, () => {
        const { account, hash } = session(value);
        db.prepare('DELETE FROM ptl_sessions WHERE token_hash = ?').run(hash);
        audit(account, 'logout');
      });
    },

    messages(value) {
      return transaction(db, () => {
        const { account } = useSession(value, 'inbox_view');
        return db.prepare(`SELECT id, doc_no AS reference, subject, kind, body, status, created_at AS createdAt
          FROM ptl_messages WHERE account_id = ? AND company_id = ? AND is_active = 1 AND deleted_at IS NULL
          ORDER BY id DESC LIMIT 100`).all(account.id, account.company_id);
      });
    },

    readMessage(value, messageId) {
      return transaction(db, () => {
        const { account } = useSession(value, 'message_read');
        const parsedId = parse(id, Number(messageId));
        const message = db.prepare(`SELECT status FROM ptl_messages WHERE id = ? AND company_id = ? AND account_id = ?
          AND kind = 'NOTICE' AND is_active = 1 AND deleted_at IS NULL`).get(parsedId, account.company_id, account.id);
        if (!message) throw notFound('That portal message does not exist.');
        if (message.status === 'UNREAD') {
          db.prepare(`UPDATE ptl_messages SET status = 'READ', updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`)
            .run(new Date(now()).toISOString(), account.doc_no, parsedId);
          writeAudit(db, { entity: 'ptl_messages', entityId: parsedId, action: 'read', oldValues: { status: 'UNREAD' },
            newValues: { status: 'READ' }, actor: account.doc_no, companyId: account.company_id });
        }
        return { id: parsedId, status: 'READ' };
      });
    },

    requestProfile(value, key, input) {
      return transaction(db, () => {
        const { account } = useSession(value, 'profile_request');
        const body = parse(messageInput, input);
        const request = parse(requestKey, key);
        const prior = db.prepare(`SELECT id, doc_no AS reference, subject, body, status
          FROM ptl_messages WHERE company_id = ? AND account_id = ? AND submission_key = ?`).get(account.company_id, account.id, request);
        if (prior) {
          if (prior.subject !== body.subject || prior.body !== body.body) throw conflict('Use a new request key for different details.');
          return { id: prior.id, reference: prior.reference, status: prior.status };
        }
        const result = recordMessage(account, body, { kind: 'PROFILE_REQUEST', key: request, actor: account.doc_no });
        notificationsOf(db).notify({
          companyId: account.company_id, templateCode: 'portal.profile.requested', recipients: ['permission:portal.account.manage'],
          data: { reference: result.reference }, sourceType: 'ptl_message', sourceId: String(result.id),
          link: `/admin/portal-users?filter[account]=${encodeURIComponent(account.doc_no)}`,
          eventKey: `portal.profile.requested:${result.id}`,
        });
        return result;
      });
    },

    sendNotice(actor, accountId, input) {
      const body = parse(messageInput, input);
      return transaction(db, () => {
        const account = managedAccount(actor, accountId);
        if (account.status !== 'ACTIVE' || !activeContact(account)) throw conflict('This account is unavailable.');
        return recordMessage(account, body, { kind: 'NOTICE', actor: actor.user });
      });
    },

    profileRequests(actor, accountId) {
      const account = managedAccount(actor, accountId);
      return db.prepare(`SELECT id, doc_no AS reference, subject, body, status, version, created_at AS createdAt FROM ptl_messages
        WHERE company_id = ? AND account_id = ? AND kind = 'PROFILE_REQUEST' AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 100`).all(account.company_id, account.id);
    },

    closeProfileRequest(actor, accountId, requestId, input) {
      const { version, response } = parse(z.strictObject({ version: id, response: z.string().trim().min(5).max(1500) }), input);
      const request = parse(id, Number(requestId));
      return transaction(db, () => {
        const account = managedAccount(actor, accountId);
        const row = db.prepare(`SELECT * FROM ptl_messages WHERE company_id = ? AND account_id = ? AND id = ?
          AND kind = 'PROFILE_REQUEST' AND deleted_at IS NULL`).get(account.company_id, account.id, request);
        if (!row) throw notFound('That profile request does not exist.');
        if (row.status !== 'REQUESTED' || row.version !== version) throw conflict('Reload the request before closing it.');
        db.prepare(`UPDATE ptl_messages SET status = 'CLOSED', updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`)
          .run(new Date(now()).toISOString(), actor.user, request);
        writeAudit(db, { entity: 'ptl_messages', entityId: request, action: 'close',
          oldValues: { status: 'REQUESTED' }, newValues: { status: 'CLOSED' }, actor: actor.user, companyId: account.company_id });
        recordMessage(account, { subject: `Response to ${row.doc_no}`, body: response }, { kind: 'NOTICE', actor: actor.user });
        return { id: request, status: 'CLOSED' };
      });
    },

    share(actor, accountId, input) {
      const { versionId } = parse(z.strictObject({ versionId: id }), input);
      return transaction(db, () => {
        const account = managedAccount(actor, accountId);
        if (account.status !== 'ACTIVE' || !activeContact(account)) throw conflict('This account is unavailable.');
        const revision = documentOpsOf(db)?.portalShare(actor, scoped(account), versionId);
        if (!revision) throw notFound('The document service is unavailable.');
        const prior = db.prepare('SELECT id FROM ptl_shares WHERE account_id = ? AND version_id = ? AND deleted_at IS NULL').get(account.id, versionId);
        if (prior) return { id: prior.id };
        const { lastInsertRowid } = db.prepare(`INSERT INTO ptl_shares
          (company_id, account_id, version_id, doc_no, project_id, site_id, created_by, source_type, source_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'doc_version', ?)`).run(
          account.company_id, account.id, versionId, `PTS-${newPublicId()}`, account.project_id, account.site_id, actor.user, String(versionId),
        );
        writeAudit(db, { entity: 'ptl_shares', entityId: lastInsertRowid, action: 'share',
          newValues: { versionId }, actor: actor.user, companyId: account.company_id });
        recordMessage(account, { subject: 'Document shared', body: revision.title }, { kind: 'NOTICE', actor: actor.user });
        return { id: Number(lastInsertRowid) };
      });
    },

    documents(value) {
      return transaction(db, () => {
        const { account } = useSession(value, 'documents_view');
        return db.prepare(`SELECT s.id, d.title, v.revision, s.created_at AS sharedAt
          FROM ptl_shares s JOIN doc_versions v ON v.id = s.version_id AND v.company_id = s.company_id
          JOIN doc_documents d ON d.id = v.document_id AND d.company_id = s.company_id AND d.current_version_id = v.id
          JOIN core_files f ON f.id = v.file_id AND f.company_id = s.company_id AND f.linked_entity = 'doc_version' AND f.linked_id = v.id
          WHERE s.company_id = ? AND s.account_id = ? AND s.deleted_at IS NULL AND s.is_active = 1
            AND v.status = 'ISSUED' AND d.status = 'ISSUED' AND d.confidentiality IN ('PUBLIC','INTERNAL')
            AND (d.project_id IS NULL OR d.project_id = ?) AND (d.site_id IS NULL OR d.site_id = ?)
            AND v.is_active = 1 AND d.is_active = 1 AND f.is_active = 1
            AND v.deleted_at IS NULL AND d.deleted_at IS NULL AND f.deleted_at IS NULL AND f.scan_status = 'CLEAN'
          ORDER BY s.id DESC LIMIT 100`).all(account.company_id, account.id, account.project_id, account.site_id);
      });
    },

    documentTicket(value, shareId) {
      return transaction(db, () => {
        const { account, hash } = useSession(value, 'download_ticket');
        const share = parse(id, Number(shareId));
        const versionId = sharedRevision(account, share);
        if (!documentOpsOf(db)?.portalRevision(scoped(account), versionId)) throw notFound('That shared revision is no longer available.');
        const ticket = signJwt({ t: 'portal-download', share, session: hash, versionId }, authSecret, { expiresInSec: 60, nowMs: now() });
        return { ticket };
      });
    },

    async download(value, shareId, ticket) {
      const { account, hash } = session(value);
      const share = parse(id, Number(shareId));
      const versionId = sharedRevision(account, share);
      const claims = verifyJwt(ticket, authSecret, { type: 'portal-download', nowMs: now() });
      if (!claims || claims.session !== hash || claims.share !== share || claims.versionId !== versionId) throw unauthorized('Open the document again to obtain a new download ticket.');
      const ops = documentOpsOf(db);
      if (!ops) throw notFound('That shared revision does not exist.');
      const output = await ops.portalContent(scoped(account), versionId, account.doc_no);
      transaction(db, () => {
        useSession(value, 'download');
        if (sharedRevision(account, share) !== versionId || !ops.portalRevision(scoped(account), versionId)) throw notFound('That shared revision is no longer available.');
        writeAudit(db, { entity: 'ptl_shares', entityId: share, action: 'download',
          newValues: { versionId }, actor: account.doc_no, companyId: account.company_id });
      });
      return output;
    },

    list(actor, input) {
      permitted(actor, 'portal.account.view');
      return queryAccounts(actor, parseListRequest(accountList, input), 'portal.account.view');
    },

    exportSource(actor, req) {
      permitted(actor, 'portal.account.export');
      return {
        title: accountList.label, permission: 'portal.account.export', personal: false,
        columns: Object.entries(accountList.columns).map(([key, column]) => ({ key, label: column.label, type: column.type })),
        count: () => countList(db, accountList, req, accountScope(actor, 'portal.account.export')),
        rows: () => queryAccounts(actor, req, 'portal.account.export', null).data,
        describe: (query) => [query.q, ...query.filters.map((filter) => `${filter.key} ${filter.op} ${filter.raw}`)].filter(Boolean).join(' / '),
      };
    },

    revoke(actor, accountId, input) {
      return transaction(db, () => {
        const account = managedAccount(actor, accountId);
        const { version } = parse(z.strictObject({ version: id }), input);
        if (account.status === 'REVOKED' || account.version !== version) throw conflict('Reload the account before making this change.');
        return revokeAccount(account, actor);
      });
    },

    revokeBatch(actor, input) {
      permitted(actor, 'portal.account.manage');
      const { ids } = parse(z.strictObject({ ids: z.array(id).min(1).max(200) }), input);
      return transaction(db, () => ({
        results: [...new Set(ids)].map((accountId) => {
          const account = byId(accountId);
          if (!account || account.company_id !== actor.companyId || !authz.check(actor, 'portal.account.manage', scoped(account)).allowed) {
            return { id: accountId, ok: false, message: 'Account unavailable.' };
          }
          if (account.status !== 'REVOKED') revokeAccount(account, actor);
          return { id: accountId, ok: true };
        }),
      }));
    },
  };
}
