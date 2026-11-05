import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { itemsOf } from '../mdm/items.js';

// The chart of accounts, cost heads and cost codes, and the financial dimensions (part 06.05). A company's chart is copied from the template of a construction company (seed of migration 105) the first
// time it is opened and then changed only through approved changes (fin_master_changes): the accounts manager proposes a new or changed group, account, item category mapping or a block (the project
// controls manager proposes cost heads and cost codes and the accounts manager checks them), and the CFO approves (FIN_MASTER_CHANGE). An account says what a posting to it must carry: its dimension rules
// (project, site, WBS, cost centre ... mandatory, optional or not allowed, FR-04) and whether a person may post to it by hand (a control account takes postings only from the posting engine unless it is
// explicitly allowed, BR-01). validatePosting() is the check every posting goes through (T-01). An account that has postings cannot be deleted and keeps its nature; it can be blocked (BR-02).
export const NATURES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
export const NATURE_LABELS = { ASSET: 'Assets', LIABILITY: 'Liabilities', EQUITY: 'Equity', INCOME: 'Income', EXPENSE: 'Expenses' };
export const ACCOUNT_TYPES = ['GENERAL', 'BANK', 'CASH', 'RECEIVABLE', 'PAYABLE', 'TAX', 'INVENTORY', 'WIP', 'RETENTION', 'FIXED_ASSET', 'REVENUE', 'EXPENSE', 'EQUITY'];
export const CONTROL_KINDS = { AP: 'Accounts payable', AR: 'Accounts receivable', GST_INPUT: 'GST input', GST_OUTPUT: 'GST output', TDS_PAYABLE: 'TDS payable', TDS_RECEIVABLE: 'TDS receivable', RETENTION_PAYABLE: 'Retention payable', RETENTION_RECEIVABLE: 'Retention receivable', INVENTORY: 'Inventory', WIP: 'Work-in-progress' };
/** The control accounts every company must have (FR-01): the setup reports any that is missing. */
export const REQUIRED_CONTROLS = ['AP', 'AR', 'GST_INPUT', 'GST_OUTPUT', 'TDS_PAYABLE', 'RETENTION_PAYABLE', 'RETENTION_RECEIVABLE', 'INVENTORY', 'WIP'];
export const DIMENSIONS = ['BRANCH', 'PROJECT', 'SITE', 'WBS', 'COST_CENTRE', 'PROFIT_CENTRE', 'DEPARTMENT', 'EMPLOYEE', 'EQUIPMENT'];
export const DIMENSION_LABELS = { COMPANY: 'Company', BRANCH: 'Branch', PROJECT: 'Project', SITE: 'Site', WBS: 'WBS element', COST_CENTRE: 'Cost centre', PROFIT_CENTRE: 'Profit centre', DEPARTMENT: 'Department', EMPLOYEE: 'Employee', EQUIPMENT: 'Equipment' };
export const REQUIREMENTS = ['MANDATORY', 'OPTIONAL', 'NOT_ALLOWED'];
/** The posting sources: MANUAL is a journal typed by a person; the others come from the posting engine of a module (BR-01). */
export const SOURCES = ['MANUAL', 'ENGINE'];
/** Natures an account type fits: a type of another nature is refused. */
const TYPE_NATURES = { GENERAL: NATURES, BANK: ['ASSET', 'LIABILITY'], CASH: ['ASSET'], RECEIVABLE: ['ASSET'], PAYABLE: ['LIABILITY'], TAX: ['ASSET', 'LIABILITY', 'EXPENSE'], INVENTORY: ['ASSET'], WIP: ['ASSET'], RETENTION: ['ASSET', 'LIABILITY'], FIXED_ASSET: ['ASSET'], REVENUE: ['INCOME'], EXPENSE: ['EXPENSE'], EQUITY: ['EQUITY'] };
const CONTROL_TYPES = { AP: ['PAYABLE'], AR: ['RECEIVABLE'], GST_INPUT: ['TAX'], GST_OUTPUT: ['TAX'], TDS_PAYABLE: ['TAX'], TDS_RECEIVABLE: ['TAX'], RETENTION_PAYABLE: ['RETENTION'], RETENTION_RECEIVABLE: ['RETENTION'], INVENTORY: ['INVENTORY'], WIP: ['WIP'] };
export const NORMAL = { ASSET: 'DR', EXPENSE: 'DR', LIABILITY: 'CR', EQUITY: 'CR', INCOME: 'CR' };

/** The lines of Schedule III (Division I) of the Companies Act, 2013 that the chart maps to (FR-01, T-02): balance sheet and statement of profit and loss, in their printed order. */
export const SCHEDULE3 = [
  ['BS_SHARE_CAPITAL', 'BS', 'EQUITY', 'Equity', 'Share capital'], ['BS_OTHER_EQUITY', 'BS', 'EQUITY', 'Equity', 'Other equity (reserves and surplus)'],
  ['BS_LT_BORROWINGS', 'BS', 'LIABILITY', 'Non-current liabilities', 'Long-term borrowings'], ['BS_ST_BORROWINGS', 'BS', 'LIABILITY', 'Current liabilities', 'Short-term borrowings'],
  ['BS_TRADE_PAYABLES', 'BS', 'LIABILITY', 'Current liabilities', 'Trade payables'], ['BS_OTHER_CURRENT_LIABILITIES', 'BS', 'LIABILITY', 'Current liabilities', 'Other current liabilities'], ['BS_ST_PROVISIONS', 'BS', 'LIABILITY', 'Current liabilities', 'Short-term provisions'],
  ['BS_PPE', 'BS', 'ASSET', 'Non-current assets', 'Property, plant and equipment'], ['BS_CWIP', 'BS', 'ASSET', 'Non-current assets', 'Capital work-in-progress'], ['BS_NC_INVESTMENTS', 'BS', 'ASSET', 'Non-current assets', 'Non-current investments'], ['BS_LT_LOANS_ADVANCES', 'BS', 'ASSET', 'Non-current assets', 'Long-term loans and advances'],
  ['BS_INVENTORIES', 'BS', 'ASSET', 'Current assets', 'Inventories'], ['BS_TRADE_RECEIVABLES', 'BS', 'ASSET', 'Current assets', 'Trade receivables'], ['BS_CASH', 'BS', 'ASSET', 'Current assets', 'Cash and cash equivalents'], ['BS_ST_LOANS_ADVANCES', 'BS', 'ASSET', 'Current assets', 'Short-term loans and advances'], ['BS_OTHER_CURRENT_ASSETS', 'BS', 'ASSET', 'Current assets', 'Other current assets'],
  ['PL_REVENUE', 'PL', 'INCOME', 'Income', 'Revenue from operations'], ['PL_OTHER_INCOME', 'PL', 'INCOME', 'Income', 'Other income'],
  ['PL_MATERIALS', 'PL', 'EXPENSE', 'Expenses', 'Cost of materials consumed'], ['PL_CHANGES_IN_INVENTORIES', 'PL', 'EXPENSE', 'Expenses', 'Changes in inventories of finished goods, work-in-progress and stock-in-trade'], ['PL_EMPLOYEE_BENEFITS', 'PL', 'EXPENSE', 'Expenses', 'Employee benefits expense'],
  ['PL_FINANCE_COSTS', 'PL', 'EXPENSE', 'Expenses', 'Finance costs'], ['PL_DEPRECIATION', 'PL', 'EXPENSE', 'Expenses', 'Depreciation and amortisation expense'], ['PL_OTHER_EXPENSES', 'PL', 'EXPENSE', 'Expenses', 'Other expenses'], ['PL_TAX_EXPENSE', 'PL', 'EXPENSE', 'Tax expense', 'Current and deferred tax'],
].map(([code, statement, nature, section, label]) => ({ code, statement, nature, section, label }));
const S3 = new Map(SCHEDULE3.map((s) => [s.code, s]));

/** The default item category mapping of the template (FR-05): category code → inventory account, expense account, cost code. A company's new categories have none until one is approved (AC-01 reports them). */
export const DEFAULT_MAPPING = {
  CIVIL: ['130001', '510001', 'MAT-OTH'], CEMENT: ['130001', '510001', 'MAT-CEM'], STEEL: ['130001', '510001', 'MAT-STL'], AGGREGATE: ['130001', '510001', 'MAT-AGG'], BLOCKS: ['130001', '510001', 'MAT-BRK'],
  ELECTRICAL: ['130001', '510001', 'MAT-OTH'], CONSUMABLE: ['130001', '510001', 'MAT-OTH'], SPARES: ['130001', '560006', 'PLT-OWN'], TOOLS: ['130001', '560004', 'SOH-EST'],
  LABOUR: [null, '530002', 'LAB-SKL'], EQUIPMENT: [null, '560002', 'PLT-HIRE'], SERVICES: [null, '560001', 'SUB-CIV'], WORKS: [null, '560001', 'SUB-CIV'],
};

/** The groups of Tally (and of most Indian accounting packages) and where they land in this chart (FR-06): the group code, the account type and the control account kind. */
export const TALLY_GROUP_MAP = {
  'sundry creditors': ['2200', 'PAYABLE', 'AP'], 'sundry debtors': ['1400', 'RECEIVABLE', 'AR'], 'bank accounts': ['1500', 'BANK', null], 'cash-in-hand': ['1500', 'CASH', null], 'cash in hand': ['1500', 'CASH', null],
  'bank od a/c': ['2150', 'BANK', null], 'bank od accounts': ['2150', 'BANK', null], 'secured loans': ['2100', 'GENERAL', null], 'unsecured loans': ['2100', 'GENERAL', null], 'loans (liability)': ['2100', 'GENERAL', null],
  'duties & taxes': ['2300', 'TAX', null], 'provisions': ['2400', 'GENERAL', null], 'current liabilities': ['2300', 'GENERAL', null], 'capital account': ['3100', 'EQUITY', null], 'reserves & surplus': ['3200', 'EQUITY', null],
  'fixed assets': ['1100', 'FIXED_ASSET', null], investments: ['1200', 'GENERAL', null], 'loans & advances (asset)': ['1600', 'GENERAL', null], 'deposits (asset)': ['1250', 'GENERAL', null], 'current assets': ['1700', 'GENERAL', null],
  'stock-in-hand': ['1300', 'INVENTORY', null], 'sales accounts': ['4100', 'REVENUE', null], 'direct incomes': ['4100', 'REVENUE', null], 'indirect incomes': ['4200', 'REVENUE', null],
  'purchase accounts': ['5100', 'EXPENSE', null], 'direct expenses': ['5600', 'EXPENSE', null], 'indirect expenses': ['5600', 'EXPENSE', null], 'misc. expenses (asset)': ['1700', 'GENERAL', null],
};
const ENTITY_LABEL = { GROUP: 'account group', ACCOUNT: 'account', COST_HEAD: 'cost head', COST_CODE: 'cost code', MAPPING: 'item category mapping' };
export const FIN_DOC = 'FIN_MASTER_CHANGE';
const nowIso = () => new Date().toISOString();
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const dayBefore = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** What other modules have posted to an account (BR-02): the general ledger and the sub-ledgers register here; until they exist an account has no postings. count(db, companyId, accountId) -> number. */
const postingSources = new Map();
export const accountPostings = { register(def) { postingSources.set(def.code, def); }, unregister(code) { postingSources.delete(code); }, list: () => [...postingSources.values()] };

export function createFinService({ db }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const may = (actor, key) => authz.check(actor, key).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const roleCodes = (actor) => (Array.isArray(actor.roles) ? actor.roles : String(actor.roles ?? '').split(',')).map((r) => String(r).trim().toUpperCase());
  const postings = (companyId, accountId) => accountPostings.list().reduce((n, s) => n + Number(s.count(db, companyId, accountId) ?? 0), 0);

  // ---- setup: the company's copy of the template ----
  function ensureSetup(companyId) {
    if (db.prepare('SELECT 1 FROM fin_account_groups WHERE company_id = ? LIMIT 1').get(companyId)) return;
    transaction(db, () => {
      const groups = new Map(); const accounts = new Map(); const heads = new Map(); const codes = new Map();
      for (const g of db.prepare('SELECT * FROM fin_account_groups WHERE company_id IS NULL AND deleted_at IS NULL ORDER BY parent_id IS NOT NULL, id').all())
        groups.set(g.id, Number(db.prepare("INSERT INTO fin_account_groups (company_id, parent_id, code, name, nature, schedule3_ref, sort_order, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'system', 'fin_template', ?)").run(companyId, g.parent_id ? groups.get(g.parent_id) ?? null : null, g.code, g.name, g.nature, g.schedule3_ref, g.sort_order, String(g.id)).lastInsertRowid));
      for (const a of db.prepare('SELECT * FROM fin_accounts WHERE company_id IS NULL AND deleted_at IS NULL ORDER BY id').all())
        accounts.set(a.id, Number(db.prepare("INSERT INTO fin_accounts (company_id, group_id, code, name, account_type, normal_side, currency_code, is_control, control_kind, manual_posting_allowed, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'fin_template', ?)").run(companyId, groups.get(a.group_id), a.code, a.name, a.account_type, a.normal_side, a.currency_code, a.is_control, a.control_kind, a.manual_posting_allowed, String(a.id)).lastInsertRowid));
      for (const r of db.prepare('SELECT * FROM fin_dimension_rules WHERE company_id IS NULL AND deleted_at IS NULL').all())
        db.prepare("INSERT INTO fin_dimension_rules (company_id, account_id, dimension, requirement, created_by, source_type) VALUES (?, ?, ?, ?, 'system', 'fin_template')").run(companyId, accounts.get(r.account_id), r.dimension, r.requirement);
      const byCode = (code) => (code ? db.prepare('SELECT id FROM fin_accounts WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(companyId, code)?.id ?? null : null);
      for (const h of db.prepare('SELECT * FROM fin_cost_heads WHERE company_id IS NULL AND deleted_at IS NULL ORDER BY parent_id IS NOT NULL, id').all())
        heads.set(h.id, Number(db.prepare("INSERT INTO fin_cost_heads (company_id, parent_id, code, name, default_account_id, default_account_code, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, 'system', 'fin_template', ?)").run(companyId, h.parent_id ? heads.get(h.parent_id) ?? null : null, h.code, h.name, byCode(h.default_account_code), h.default_account_code, String(h.id)).lastInsertRowid));
      for (const c of db.prepare('SELECT * FROM fin_cost_codes WHERE company_id IS NULL AND deleted_at IS NULL ORDER BY id').all())
        codes.set(c.code, Number(db.prepare("INSERT INTO fin_cost_codes (company_id, code, name, cost_head_id, uom, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, 'system', 'fin_template', ?)").run(companyId, c.code, c.name, heads.get(c.cost_head_id), c.uom, String(c.id)).lastInsertRowid));
      // the default item category mappings (FR-05) for the categories the company has from the item master's template
      itemsOf(db)?.ensureTree?.(companyId);
      const today = todayIST();
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mdm_item_categories'").get())
        for (const cat of db.prepare('SELECT id, code FROM mdm_item_categories WHERE company_id = ? AND deleted_at IS NULL').all(companyId)) {
          const m = DEFAULT_MAPPING[cat.code]; if (!m) continue;
          db.prepare("INSERT INTO fin_category_mappings (company_id, item_category_id, inventory_account_id, expense_account_id, cost_code_id, effective_from, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'system', 'fin_template')").run(companyId, cat.id, byCode(m[0]), byCode(m[1]), codes.get(m[2]) ?? null, today);
        }
      writeAudit(db, { entity: 'fin_accounts', entityId: companyId, action: 'setup', newValues: { groups: groups.size, accounts: accounts.size, costHeads: heads.size, costCodes: codes.size }, actor: 'system', companyId });
    });
  }
  const view = (actor) => { need(actor, 'fin.coa.view', 'see the chart of accounts'); ensureSetup(actor.companyId); };

  // ---- reading ----
  const groupRow = (companyId, id) => { const g = db.prepare('SELECT * FROM fin_account_groups WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId); if (!g) throw notFound('That account group does not exist.'); return g; };
  const accountRow = (companyId, id) => { const a = db.prepare('SELECT * FROM fin_accounts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId); if (!a) throw notFound('That account does not exist.'); return a; };
  const headRow = (companyId, id) => { const h = db.prepare('SELECT * FROM fin_cost_heads WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId); if (!h) throw notFound('That cost head does not exist.'); return h; };
  const codeRow = (companyId, id) => { const c = db.prepare('SELECT * FROM fin_cost_codes WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyId); if (!c) throw notFound('That cost code does not exist.'); return c; };
  const rulesOf = (accountId) => Object.fromEntries(db.prepare('SELECT dimension, requirement FROM fin_dimension_rules WHERE account_id = ? AND deleted_at IS NULL').all(accountId).map((r) => [r.dimension, r.requirement]));
  const natureOf = (groupId) => db.prepare('SELECT nature FROM fin_account_groups WHERE id = ?').get(groupId)?.nature ?? null;
  const pendingFor = (companyId, entity, entityId) => db.prepare("SELECT id FROM fin_master_changes WHERE company_id = ? AND entity = ? AND entity_id = ? AND request_status IN ('PENDING', 'RETURNED')").get(companyId, entity, entityId)?.id ?? null;
  const groupView = (g) => ({ id: g.id, parentId: g.parent_id, code: g.code, name: g.name, nature: g.nature, schedule3: g.schedule3_ref, schedule3Label: S3.get(g.schedule3_ref)?.label ?? null, status: g.group_status, sortOrder: g.sort_order, rowVersion: g.version, pendingChangeId: pendingFor(g.company_id, 'GROUP', g.id) });
  const accountView = (a, extra = {}) => ({ id: a.id, groupId: a.group_id, code: a.code, name: a.name, type: a.account_type, normalBalance: a.normal_side, currency: a.currency_code, isControl: Boolean(a.is_control), controlKind: a.control_kind, controlLabel: a.control_kind ? CONTROL_KINDS[a.control_kind] : null, manualPosting: Boolean(a.manual_posting_allowed), status: a.account_status, blockReason: a.block_reason, rowVersion: a.version, dimensions: rulesOf(a.id), pendingChangeId: pendingFor(a.company_id, 'ACCOUNT', a.id), ...extra });
  const headView = (h) => ({ id: h.id, parentId: h.parent_id, code: h.code, name: h.name, accountId: h.default_account_id, account: h.default_account_id ? db.prepare('SELECT code, name FROM fin_accounts WHERE id = ?').get(h.default_account_id) : null, status: h.head_status, rowVersion: h.version, pendingChangeId: pendingFor(h.company_id, 'COST_HEAD', h.id) });
  const codeView = (c) => ({ id: c.id, code: c.code, name: c.name, costHeadId: c.cost_head_id, uom: c.uom, status: c.code_status, rowVersion: c.version, pendingChangeId: pendingFor(c.company_id, 'COST_CODE', c.id) });

  function chart(actor, { q, status, type, control } = /** @type {any} */ ({})) {
    view(actor);
    const groups = db.prepare('SELECT * FROM fin_account_groups WHERE company_id = ? AND deleted_at IS NULL ORDER BY sort_order, code').all(actor.companyId).map(groupView);
    const where = ['company_id = ?', 'deleted_at IS NULL']; const args = [actor.companyId];
    if (q) { where.push('(code LIKE ? OR name LIKE ?)'); args.push(`${q}%`, `%${q}%`); }
    if (status) { where.push('account_status = ?'); args.push(status); }
    if (type) { where.push('account_type = ?'); args.push(type); }
    if (control === 'yes') where.push('is_control = 1'); else if (control === 'no') where.push('is_control = 0');
    const accounts = db.prepare(`SELECT * FROM fin_accounts WHERE ${where.join(' AND ')} ORDER BY code`).all(...args).map((a) => accountView(a));
    const controls = db.prepare("SELECT DISTINCT control_kind FROM fin_accounts WHERE company_id = ? AND is_control = 1 AND account_status = 'ACTIVE' AND deleted_at IS NULL").all(actor.companyId).map((r) => r.control_kind);
    return { groups, accounts, missingControls: REQUIRED_CONTROLS.filter((k) => !controls.includes(k)).map((k) => ({ kind: k, label: CONTROL_KINDS[k] })), pending: db.prepare("SELECT COUNT(*) AS n FROM fin_master_changes WHERE company_id = ? AND request_status IN ('PENDING', 'RETURNED')").get(actor.companyId).n, canEdit: may(actor, 'fin.coa.edit'), canEditCostCodes: may(actor, 'fin.costcode.edit'), canImport: may(actor, 'fin.import'), schedule3: SCHEDULE3 };
  }
  function account(actor, id) {
    view(actor);
    const a = accountRow(actor.companyId, id);
    const g = groupRow(actor.companyId, a.group_id);
    const path = []; for (let x = g; x; x = x.parent_id ? db.prepare('SELECT * FROM fin_account_groups WHERE id = ?').get(x.parent_id) : null) path.unshift({ id: x.id, code: x.code, name: x.name });
    const n = postings(actor.companyId, a.id);
    return accountView(a, {
      group: { ...groupView(g), path }, nature: g.nature, postings: n, canDelete: n === 0 && !a.is_control && !referenced(actor.companyId, a.id).length,
      costHeads: db.prepare('SELECT id, code, name FROM fin_cost_heads WHERE default_account_id = ? AND deleted_at IS NULL ORDER BY code').all(a.id),
      mappings: db.prepare("SELECT m.id, c.code, c.name, CASE WHEN m.inventory_account_id = ? THEN 'Inventory' ELSE 'Expense' END AS role FROM fin_category_mappings m JOIN mdm_item_categories c ON c.id = m.item_category_id WHERE (m.inventory_account_id = ? OR m.expense_account_id = ?) AND m.mapping_status = 'ACTIVE' AND m.deleted_at IS NULL ORDER BY c.code").all(a.id, a.id, a.id),
      changes: db.prepare("SELECT * FROM fin_master_changes WHERE company_id = ? AND entity = 'ACCOUNT' AND (entity_id = ? OR applied_entity_id = ?) ORDER BY id DESC LIMIT 20").all(actor.companyId, a.id, a.id).map(changeView),
      canEdit: may(actor, 'fin.coa.edit'), dimensionsList: DIMENSIONS.map((d) => ({ code: d, label: DIMENSION_LABELS[d] })),
    });
  }
  const referenced = (companyId, accountId) => [
    ...db.prepare('SELECT code FROM fin_cost_heads WHERE company_id = ? AND default_account_id = ? AND deleted_at IS NULL').all(companyId, accountId).map((h) => `cost head ${h.code}`),
    ...db.prepare("SELECT item_category_id FROM fin_category_mappings WHERE company_id = ? AND (inventory_account_id = ? OR expense_account_id = ?) AND mapping_status = 'ACTIVE' AND deleted_at IS NULL").all(companyId, accountId, accountId).map((m) => `item category mapping ${m.item_category_id}`),
  ];
  function costTree(actor) {
    view(actor);
    return { heads: db.prepare('SELECT * FROM fin_cost_heads WHERE company_id = ? AND deleted_at IS NULL ORDER BY code').all(actor.companyId).map(headView), codes: db.prepare('SELECT * FROM fin_cost_codes WHERE company_id = ? AND deleted_at IS NULL ORDER BY code').all(actor.companyId).map(codeView), canEdit: may(actor, 'fin.costcode.edit') };
  }
  function dimensionRules(actor, { accountId } = /** @type {any} */ ({})) {
    view(actor);
    const rows = db.prepare(`SELECT r.*, a.code, a.name FROM fin_dimension_rules r JOIN fin_accounts a ON a.id = r.account_id WHERE r.company_id = ? AND r.deleted_at IS NULL ${accountId ? 'AND r.account_id = ?' : ''} ORDER BY a.code, r.dimension`).all(...(accountId ? [actor.companyId, accountId] : [actor.companyId]));
    return { rows: rows.map((r) => ({ id: r.id, accountId: r.account_id, account: `${r.code} ${r.name}`, dimension: r.dimension, requirement: r.requirement })), dimensions: DIMENSIONS.map((d) => ({ code: d, label: DIMENSION_LABELS[d] })) };
  }

  // ---- the item category mapping (FR-05, AC-01) ----
  function categoryMap(actor) {
    view(actor);
    const cats = db.prepare("SELECT id, parent_id, code, name, category_status FROM mdm_item_categories WHERE company_id = ? AND deleted_at IS NULL ORDER BY code").all(actor.companyId);
    const maps = new Map(db.prepare("SELECT * FROM fin_category_mappings WHERE company_id = ? AND mapping_status = 'ACTIVE' AND deleted_at IS NULL").all(actor.companyId).map((m) => [m.item_category_id, m]));
    const acc = (id) => (id ? db.prepare('SELECT id, code, name FROM fin_accounts WHERE id = ?').get(id) : null);
    const cc = (id) => (id ? db.prepare('SELECT id, code, name FROM fin_cost_codes WHERE id = ?').get(id) : null);
    const byId = new Map(cats.map((c) => [c.id, c]));
    const rows = cats.map((c) => {
      const own = maps.get(c.id) ?? null;
      let from = null; for (let p = c.parent_id ? byId.get(c.parent_id) : null; p && !own && !from; p = p.parent_id ? byId.get(p.parent_id) : null) if (maps.get(p.id)) from = p;
      const m = own ?? (from ? maps.get(from.id) : null);
      const pending = db.prepare("SELECT id FROM fin_master_changes WHERE company_id = ? AND entity = 'MAPPING' AND request_status IN ('PENDING', 'RETURNED') AND EXISTS (SELECT 1 FROM json_each(json_extract(change_json, '$.rows')) j WHERE json_extract(j.value, '$.categoryId') = ?)").get(actor.companyId, c.id)?.id ?? null;
      return { categoryId: c.id, code: c.code, name: c.name, parentId: c.parent_id, status: c.category_status, inherited: Boolean(from && !own), inheritedFrom: from?.code ?? null, mapping: m ? { inventory: acc(m.inventory_account_id), expense: acc(m.expense_account_id), costCode: cc(m.cost_code_id), effectiveFrom: m.effective_from } : null, pendingChangeId: pending };
    });
    const active = rows.filter((r) => r.status === 'ACTIVE');
    const missing = active.filter((r) => !r.mapping);
    return { rows, complete: missing.length === 0, total: active.length, mapped: active.length - missing.length, missing: missing.map((r) => ({ categoryId: r.categoryId, code: r.code, name: r.name })), canEdit: may(actor, 'fin.coa.edit') };
  }
  /** What a posting of an item of this category uses (the posting engine and the purchase and stores modules): its own mapping or its nearest parent's, in force on the date. */
  function resolveCategory(companyId, categoryId, date = todayIST()) {
    ensureSetup(companyId);
    for (let c = db.prepare('SELECT id, parent_id FROM mdm_item_categories WHERE id = ? AND company_id = ?').get(categoryId, companyId); c; c = c.parent_id ? db.prepare('SELECT id, parent_id FROM mdm_item_categories WHERE id = ?').get(c.parent_id) : null) {
      const m = db.prepare("SELECT * FROM fin_category_mappings WHERE company_id = ? AND item_category_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) AND deleted_at IS NULL ORDER BY effective_from DESC LIMIT 1").get(companyId, c.id, date, date);
      if (m) return { categoryId: c.id, inventoryAccountId: m.inventory_account_id, expenseAccountId: m.expense_account_id, costCodeId: m.cost_code_id, effectiveFrom: m.effective_from };
    }
    return null;
  }

  // ---- the posting check (FR-04, BR-01, T-01) ----
  const DIM_CHECK = {
    BRANCH: (c, v) => db.prepare("SELECT 1 FROM org_branches WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(v, c),
    PROJECT: (c, v) => db.prepare("SELECT 1 FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(v, c),
    SITE: (c, v) => db.prepare("SELECT org_project_id AS p FROM org_sites WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(v, c),
    COST_CENTRE: (c, v) => db.prepare("SELECT 1 FROM org_cost_centres WHERE id = ? AND company_id = ? AND type = 'COST' AND status = 'ACTIVE' AND deleted_at IS NULL").get(v, c),
    PROFIT_CENTRE: (c, v) => db.prepare("SELECT 1 FROM org_cost_centres WHERE id = ? AND company_id = ? AND type = 'PROFIT' AND status = 'ACTIVE' AND deleted_at IS NULL").get(v, c),
    DEPARTMENT: (c, v) => db.prepare("SELECT 1 FROM org_departments WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(v, c),
    EMPLOYEE: (_c, v) => db.prepare("SELECT 1 FROM iam_users WHERE id = ? AND deleted_at IS NULL").get(v),
    WBS: (_c, v) => /^[A-Za-z0-9][A-Za-z0-9.\-/]{0,39}$/.test(String(v)), // D-307: no WBS master yet (planning, part 08); the code is checked for form only
    EQUIPMENT: (_c, v) => /^[A-Za-z0-9][A-Za-z0-9.\-/]{0,39}$/.test(String(v)), // D-307: no equipment register yet (plant, part 11)
  };
  /**
   * Whether a posting line may go to an account: { ok, errors: [{ dimension?, code, message }] }. A posting line is { accountId | accountCode, dimensions: { PROJECT: id, SITE: id, WBS: 'code', ... }, source: MANUAL | ENGINE }.
   * The account must be active; a control account takes only the posting engine's lines unless manual postings to it are explicitly allowed on the account (an approved change, BR-01);
   * a mandatory dimension must be given, a not-allowed one must not, every value must exist in the company and a site must belong to the project (T-01).
   */
  function validatePosting(companyId, line) {
    ensureSetup(companyId);
    const errors = [];
    const a = line.accountId ? db.prepare('SELECT * FROM fin_accounts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(line.accountId, companyId) : db.prepare('SELECT * FROM fin_accounts WHERE code = ? AND company_id = ? AND deleted_at IS NULL').get(String(line.accountCode ?? ''), companyId);
    if (!a) return { ok: false, errors: [{ code: 'ACCOUNT_UNKNOWN', message: 'The account does not exist in this company.' }] };
    if (a.account_status !== 'ACTIVE') errors.push({ code: 'ACCOUNT_BLOCKED', message: `Account ${a.code} ${a.name} is blocked${a.block_reason ? `: ${a.block_reason}` : ''}.` });
    const source = line.source ?? 'MANUAL';
    if (source === 'MANUAL' && !a.manual_posting_allowed) errors.push({ code: a.is_control ? 'CONTROL_ACCOUNT' : 'MANUAL_BLOCKED', message: a.is_control ? `${a.code} ${a.name} is a control account (${CONTROL_KINDS[a.control_kind] ?? 'control'}): it takes postings from the ${CONTROL_KINDS[a.control_kind] ?? 'sub-ledger'} documents only, not a manual journal.` : `${a.code} ${a.name} does not take manual postings.` });
    const dims = line.dimensions ?? {};
    const rules = rulesOf(a.id);
    for (const [d, req] of Object.entries(rules)) {
      const has = dims[d] !== undefined && dims[d] !== null && dims[d] !== '';
      if (req === 'MANDATORY' && !has) errors.push({ dimension: d, code: 'DIMENSION_REQUIRED', message: `A posting to ${a.code} ${a.name} needs a ${DIMENSION_LABELS[d].toLowerCase()}.` });
      if (req === 'NOT_ALLOWED' && has) errors.push({ dimension: d, code: 'DIMENSION_NOT_ALLOWED', message: `A posting to ${a.code} ${a.name} must not carry a ${DIMENSION_LABELS[d].toLowerCase()}.` });
    }
    for (const [d, v] of Object.entries(dims)) {
      if (v === undefined || v === null || v === '') continue;
      if (!DIM_CHECK[d]) { errors.push({ dimension: d, code: 'DIMENSION_UNKNOWN', message: `${d} is not a dimension.` }); continue; }
      const found = DIM_CHECK[d](companyId, v);
      if (!found) errors.push({ dimension: d, code: 'DIMENSION_VALUE', message: `The ${DIMENSION_LABELS[d].toLowerCase()} ${v} does not exist in this company.` });
      else if (d === 'SITE' && dims.PROJECT && found.p !== Number(dims.PROJECT)) errors.push({ dimension: 'SITE', code: 'SITE_NOT_IN_PROJECT', message: 'The site does not belong to the project of the posting.' });
    }
    return { ok: errors.length === 0, account: { id: a.id, code: a.code, name: a.name, normalBalance: a.normal_side, currency: a.currency_code }, errors };
  }
  function checkPosting(actor, line) {
    need(actor, 'fin.coa.view', 'check postings');
    return validatePosting(actor.companyId, line);
  }

  // ---- Schedule III (FR-01, T-02) ----
  function schedule3(actor) {
    view(actor);
    const groups = db.prepare('SELECT * FROM fin_account_groups WHERE company_id = ? AND deleted_at IS NULL').all(actor.companyId);
    const byId = new Map(groups.map((g) => [g.id, g]));
    const lineOf = (g) => { for (let x = g; x; x = x.parent_id ? byId.get(x.parent_id) : null) if (x.schedule3_ref) return x.schedule3_ref; return null; };
    const accounts = db.prepare('SELECT id, code, name, group_id, account_status FROM fin_accounts WHERE company_id = ? AND deleted_at IS NULL ORDER BY code').all(actor.companyId);
    const lines = SCHEDULE3.map((s) => ({ ...s, groups: groups.filter((g) => g.schedule3_ref === s.code).map((g) => ({ id: g.id, code: g.code, name: g.name })), accounts: [] }));
    const lineMap = new Map(lines.map((l) => [l.code, l]));
    const unmapped = [];
    const wrongNature = [];
    for (const a of accounts) {
      const g = byId.get(a.group_id); const ref = g ? lineOf(g) : null;
      if (!ref || !lineMap.has(ref)) { unmapped.push({ id: a.id, code: a.code, name: a.name, group: g?.name ?? null }); continue; }
      const l = lineMap.get(ref); l.accounts.push({ id: a.id, code: a.code, name: a.name, status: a.account_status });
      if (g.nature !== l.nature) wrongNature.push({ id: a.id, code: a.code, name: a.name, line: l.label });
    }
    const unmappedGroups = groups.filter((g) => g.parent_id && !lineOf(g)).map((g) => ({ id: g.id, code: g.code, name: g.name }));
    const empty = lines.filter((l) => !l.groups.length).map((l) => ({ code: l.code, label: l.label }));
    return { lines, complete: !unmapped.length && !unmappedGroups.length && !wrongNature.length && !empty.length, unmappedAccounts: unmapped, unmappedGroups, wrongNature, linesWithoutGroup: empty };
  }

  // ---- changes: proposed, approved, applied ----
  const changeView = (c) => ({ id: c.id, entity: c.entity, entityLabel: ENTITY_LABEL[c.entity], action: c.action, entityId: c.entity_id, change: json(c.change_json, {}), before: json(c.before_json, {}), reason: c.reason, makerRole: c.maker_role, status: c.request_status, requestedBy: c.requested_by, decidedBy: c.decided_by, decidedAt: c.decided_at, createdAt: c.created_at, instanceId: c.workflow_instance_id, appliedId: c.applied_entity_id, what: describeChange(c) });
  function describeChange(c) {
    const ch = json(c.change_json, {});
    if (c.entity === 'MAPPING') return `Item category mapping: ${(ch.rows ?? []).length} categor${(ch.rows ?? []).length === 1 ? 'y' : 'ies'}`;
    if (c.entity === 'ACCOUNT' && ch.rows) return `Import of ${ch.rows.length} accounts${ch.format ? ` from ${ch.format === 'TALLY' ? 'Tally' : 'a file'}` : ''}`;
    const label = ENTITY_LABEL[c.entity];
    const name = ch.code ? `${ch.code}${ch.name ? ` ${ch.name}` : ''}` : json(c.before_json, {}).code ?? `#${c.entity_id}`;
    return `${{ CREATE: 'New', UPDATE: 'Change of', BLOCK: 'Block', UNBLOCK: 'Unblock' }[c.action]} ${label} ${name}`;
  }
  /** The maker of a change (the workflow's first step depends on it): the accounts manager, or the project controls manager for cost heads and cost codes. */
  function makerOf(actor, entity) {
    const roles = roleCodes(actor);
    if (entity === 'COST_HEAD' || entity === 'COST_CODE') {
      if (!may(actor, 'fin.costcode.edit')) throw forbidden('You may not propose cost heads or cost codes (permission fin.costcode.edit).');
      return roles.includes('ACCMGR') ? 'ACCMGR' : roles.includes('PCMGR') ? 'PCMGR' : 'ACCMGR';
    }
    if (!may(actor, 'fin.coa.edit')) throw forbidden(`You may not propose a change of the ${ENTITY_LABEL[entity]} (permission fin.coa.edit).`);
    return 'ACCMGR';
  }
  function propose(actor, { entity, action, entityId = null, change, before = {}, reason }) {
    if (entityId && pendingFor(actor.companyId, entity, entityId)) throw new HttpError(409, 'PENDING_CHANGE', `A change of this ${ENTITY_LABEL[entity]} is already waiting for approval; withdraw it or wait for the decision.`);
    const maker = makerOf(actor, entity);
    return transaction(db, () => {
      const id = Number(db.prepare("INSERT INTO fin_master_changes (company_id, entity, action, entity_id, change_json, before_json, reason, maker_role, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fin_master_change')")
        .run(actor.companyId, entity, action, entityId, JSON.stringify(change), JSON.stringify(before), reason, maker, actor.user, actor.user).lastInsertRowid);
      const inst = workflowOf(db).submit(actor, { docType: FIN_DOC, docId: id, comment: reason, context: { makerRole: maker, entity, action } });
      db.prepare('UPDATE fin_master_changes SET workflow_instance_id = ? WHERE id = ?').run(inst?.id ?? null, id);
      writeAudit(db, { entity: 'fin_master_changes', entityId: id, action: 'propose', newValues: { entity, action, entityId, change }, reason, actor: actor.user, companyId: actor.companyId });
      publishEvent(db, { type: 'fin.master.change_requested', entity: 'fin_master_change', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { entity, action } });
      return changeView(db.prepare('SELECT * FROM fin_master_changes WHERE id = ?').get(id));
    });
  }
  const fail = (problems) => { if (problems.length) throw badRequest('Correct the highlighted fields', problems); };
  const codeTaken = (table, companyId, code, exceptId = null) => db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND code = ? AND deleted_at IS NULL ${exceptId ? 'AND id != ?' : ''}`).get(...(exceptId ? [companyId, code, exceptId] : [companyId, code]));
  let applying = 0; // the change being applied is not "another change waiting" for its own codes
  const pendingCode = (companyId, entity, code) => db.prepare("SELECT 1 FROM fin_master_changes WHERE company_id = ? AND entity = ? AND action = 'CREATE' AND request_status IN ('PENDING', 'RETURNED') AND id != ? AND (json_extract(change_json, '$.code') = ? OR EXISTS (SELECT 1 FROM json_each(json_extract(change_json, '$.rows')) j WHERE json_extract(j.value, '$.code') = ?))").get(companyId, entity, applying, code, code);

  // checking a proposed record; the same checks run again when it is applied (the chart may have changed in between)
  function checkGroup(companyId, b, existing = null) {
    const p = [];
    if (!existing || b.code !== existing.code) { if (codeTaken('fin_account_groups', companyId, b.code, existing?.id)) p.push({ field: 'code', message: `Group ${b.code} already exists` }); else if (!existing && pendingCode(companyId, 'GROUP', b.code)) p.push({ field: 'code', message: `A new group ${b.code} is already waiting for approval` }); }
    const parent = b.parentId ? db.prepare('SELECT * FROM fin_account_groups WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.parentId, companyId) : null;
    if (!b.parentId) p.push({ field: 'parentId', message: 'A group sits under one of the five primary groups (Assets, Liabilities, Equity, Income, Expenses) or a group below them' });
    else if (!parent) p.push({ field: 'parentId', message: 'The parent group does not exist' });
    else if (parent.nature !== b.nature) p.push({ field: 'nature', message: `A group under ${parent.name} is of nature ${parent.nature}` });
    if (existing && parent) for (let x = parent; x; x = x.parent_id ? db.prepare('SELECT * FROM fin_account_groups WHERE id = ?').get(x.parent_id) : null) if (x.id === existing.id) { p.push({ field: 'parentId', message: 'A group cannot sit under itself or its own subgroup' }); break; }
    if (b.schedule3 && !S3.has(b.schedule3)) p.push({ field: 'schedule3', message: 'Choose a line of Schedule III' });
    else if (b.schedule3 && S3.get(b.schedule3).nature !== b.nature) p.push({ field: 'schedule3', message: `${S3.get(b.schedule3).label} is a line of ${NATURE_LABELS[S3.get(b.schedule3).nature].toLowerCase()}` });
    if (existing && existing.nature !== b.nature) {
      const accts = db.prepare('SELECT id FROM fin_accounts WHERE group_id = ? AND deleted_at IS NULL').all(existing.id);
      if (accts.some((a) => postings(companyId, a.id) > 0)) p.push({ field: 'nature', message: 'Accounts of this group have postings: its nature cannot change (BR-02)' });
    }
    if (existing && !existing.parent_id) p.push({ field: 'code', message: 'The five primary groups are fixed' });
    return p;
  }
  function checkAccount(companyId, b, existing = null, field = '') {
    const p = []; const f = (k) => `${field}${k}`;
    if (!existing || b.code !== existing.code) { if (codeTaken('fin_accounts', companyId, b.code, existing?.id)) p.push({ field: f('code'), message: `Account ${b.code} already exists` }); else if (!existing && pendingCode(companyId, 'ACCOUNT', b.code)) p.push({ field: f('code'), message: `A new account ${b.code} is already waiting for approval` }); }
    const g = db.prepare('SELECT * FROM fin_account_groups WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.groupId, companyId);
    if (!g) { p.push({ field: f('groupId'), message: 'Choose the group of the account' }); return p; }
    if (!g.parent_id) p.push({ field: f('groupId'), message: 'An account sits in a group under a primary group (for example Trade payables), not in the primary group itself' });
    if (!TYPE_NATURES[b.type].includes(g.nature)) p.push({ field: f('type'), message: `An account of type ${b.type.toLowerCase().replace('_', ' ')} cannot be in a group of ${NATURE_LABELS[g.nature].toLowerCase()}` });
    if (b.normalBalance !== NORMAL[g.nature] && !b.contraReason) p.push({ field: f('normalBalance'), message: `Accounts of ${NATURE_LABELS[g.nature].toLowerCase()} have a ${NORMAL[g.nature] === 'DR' ? 'debit' : 'credit'} balance; give the reason for a contra account` });
    if (b.isControl && !b.controlKind) p.push({ field: f('controlKind'), message: 'Say which control account this is' });
    if (!b.isControl && b.controlKind) p.push({ field: f('isControl'), message: 'A control account kind is given only for a control account' });
    if (b.controlKind && !CONTROL_TYPES[b.controlKind].includes(b.type)) p.push({ field: f('controlKind'), message: `A ${CONTROL_KINDS[b.controlKind].toLowerCase()} control account is of type ${CONTROL_TYPES[b.controlKind].join(' or ').toLowerCase()}` });
    for (const [d, req] of Object.entries(b.dimensions ?? {})) if (!DIMENSIONS.includes(d) || !REQUIREMENTS.includes(req)) p.push({ field: f(`dimensions.${d}`), message: 'Unknown dimension or requirement' });
    if (b.dimensions?.SITE === 'MANDATORY' && b.dimensions?.PROJECT === 'NOT_ALLOWED') p.push({ field: f('dimensions.SITE'), message: 'A site belongs to a project: a site cannot be mandatory where a project is not allowed' });
    if (existing) {
      const n = postings(companyId, existing.id);
      const before = natureOf(existing.group_id);
      if (n > 0 && (before !== g.nature || existing.account_type !== b.type || existing.normal_side !== b.normalBalance || Boolean(existing.is_control) !== b.isControl)) p.push({ field: f('type'), message: `The account has ${n} posting${n === 1 ? '' : 's'}: its nature, type, normal balance and control setting cannot change; block it and open a new one (BR-02)` });
    }
    return p;
  }
  function checkHead(companyId, b, existing = null) {
    const p = [];
    if (!existing || b.code !== existing.code) { if (codeTaken('fin_cost_heads', companyId, b.code, existing?.id)) p.push({ field: 'code', message: `Cost head ${b.code} already exists` }); else if (!existing && pendingCode(companyId, 'COST_HEAD', b.code)) p.push({ field: 'code', message: `A new cost head ${b.code} is already waiting for approval` }); }
    if (b.parentId) { const par = db.prepare('SELECT * FROM fin_cost_heads WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.parentId, companyId); if (!par) p.push({ field: 'parentId', message: 'The parent cost head does not exist' }); else if (!b.code.startsWith(`${par.code}.`)) p.push({ field: 'code', message: `A cost head under ${par.code} is numbered ${par.code}.n` }); if (existing && par && (par.id === existing.id || par.parent_id === existing.id)) p.push({ field: 'parentId', message: 'A cost head cannot sit under itself' }); }
    if (b.accountId) { const a = db.prepare('SELECT a.*, g.nature FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE a.id = ? AND a.company_id = ? AND a.deleted_at IS NULL').get(b.accountId, companyId); if (!a) p.push({ field: 'accountId', message: 'The account does not exist' }); else if (!['EXPENSE', 'ASSET'].includes(a.nature) || a.is_control) p.push({ field: 'accountId', message: 'A cost head maps to an expense account (or work-in-progress, plant), not a control or income account' }); }
    else if (!b.parentId) p.push({ field: 'accountId', message: 'A top cost head maps to the account its costs are posted to' });
    return p;
  }
  function checkCode(companyId, b, existing = null) {
    const p = [];
    if (!existing || b.code !== existing.code) { if (codeTaken('fin_cost_codes', companyId, b.code, existing?.id)) p.push({ field: 'code', message: `Cost code ${b.code} already exists` }); else if (!existing && pendingCode(companyId, 'COST_CODE', b.code)) p.push({ field: 'code', message: `A new cost code ${b.code} is already waiting for approval` }); }
    if (!db.prepare("SELECT 1 FROM fin_cost_heads WHERE id = ? AND company_id = ? AND head_status = 'ACTIVE' AND deleted_at IS NULL").get(b.costHeadId, companyId)) p.push({ field: 'costHeadId', message: 'Choose an active cost head' });
    return p;
  }
  function checkMapping(companyId, rows) {
    const p = [];
    rows.forEach((r, i) => {
      if (!db.prepare('SELECT 1 FROM mdm_item_categories WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(r.categoryId, companyId)) p.push({ field: `rows.${i}.categoryId`, message: 'The item category does not exist' });
      const inv = r.inventoryAccountId ? db.prepare('SELECT * FROM fin_accounts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(r.inventoryAccountId, companyId) : null;
      if (r.inventoryAccountId && (!inv || !['INVENTORY', 'WIP'].includes(inv.account_type))) p.push({ field: `rows.${i}.inventoryAccountId`, message: 'The stock account is an inventory (or work-in-progress) account' });
      const exp = db.prepare('SELECT a.*, g.nature FROM fin_accounts a JOIN fin_account_groups g ON g.id = a.group_id WHERE a.id = ? AND a.company_id = ? AND a.deleted_at IS NULL').get(r.expenseAccountId, companyId);
      if (!exp || exp.is_control || !['EXPENSE', 'ASSET'].includes(exp.nature)) p.push({ field: `rows.${i}.expenseAccountId`, message: 'The consumption account is an expense (or fixed asset or work-in-progress) account that is not a control account' });
      else if (exp.account_status !== 'ACTIVE') p.push({ field: `rows.${i}.expenseAccountId`, message: `${exp.code} is blocked` });
      if (r.costCodeId && !db.prepare("SELECT 1 FROM fin_cost_codes WHERE id = ? AND company_id = ? AND code_status = 'ACTIVE' AND deleted_at IS NULL").get(r.costCodeId, companyId)) p.push({ field: `rows.${i}.costCodeId`, message: 'Choose an active cost code' });
    });
    if (new Set(rows.map((r) => r.categoryId)).size !== rows.length) p.push({ field: 'rows', message: 'A category appears twice' });
    return p;
  }

  const changes = {
    group: {
      create(actor, b) { view(actor); fail(checkGroup(actor.companyId, b)); return propose(actor, { entity: 'GROUP', action: 'CREATE', change: b, reason: b.reason }); },
      update(actor, id, b) { view(actor); const g = groupRow(actor.companyId, id); if (b.version !== g.version) throw conflict('The group was changed by someone else; reload it.'); const next = { code: g.code, parentId: g.parent_id, name: g.name, nature: g.nature, schedule3: g.schedule3_ref, ...b }; fail(checkGroup(actor.companyId, next, g)); return propose(actor, { entity: 'GROUP', action: 'UPDATE', entityId: id, change: next, before: groupView(g), reason: b.reason }); },
    },
    account: {
      create(actor, b) { view(actor); fail(checkAccount(actor.companyId, b)); return propose(actor, { entity: 'ACCOUNT', action: 'CREATE', change: b, reason: b.reason }); },
      update(actor, id, b) {
        view(actor); const a = accountRow(actor.companyId, id);
        if (b.version !== a.version) throw conflict('The account was changed by someone else; reload it.');
        const cur = accountView(a);
        const next = { code: a.code, name: a.name, groupId: a.group_id, type: a.account_type, normalBalance: a.normal_side, currency: a.currency_code, isControl: Boolean(a.is_control), controlKind: a.control_kind, manualPosting: Boolean(a.manual_posting_allowed), dimensions: cur.dimensions, ...b };
        fail(checkAccount(actor.companyId, next, a));
        return propose(actor, { entity: 'ACCOUNT', action: 'UPDATE', entityId: id, change: next, before: cur, reason: b.reason });
      },
      block(actor, id, { reason, block }) { view(actor); const a = accountRow(actor.companyId, id); if (block === (a.account_status === 'BLOCKED')) throw unprocessable(`The account is already ${block ? 'blocked' : 'active'}.`); return propose(actor, { entity: 'ACCOUNT', action: block ? 'BLOCK' : 'UNBLOCK', entityId: id, change: { code: a.code, name: a.name, reason }, before: accountView(a), reason }); },
      /** An unused account (no postings, not a control account, not used by a cost head or mapping) is deleted by the accounts manager; anything else is blocked (BR-02). */
      remove(actor, id, { reason }) {
        view(actor); need(actor, 'fin.coa.edit', 'delete accounts'); const a = accountRow(actor.companyId, id);
        const n = postings(actor.companyId, id);
        if (n > 0) throw unprocessable(`The account has ${n} posting${n === 1 ? '' : 's'}: it cannot be deleted, only blocked (BR-02).`);
        if (a.is_control) throw unprocessable('A control account is not deleted; block it if it is no longer used.');
        const refs = referenced(actor.companyId, id); if (refs.length) throw unprocessable(`The account is used by ${refs.join(', ')}; change those first.`);
        if (pendingFor(actor.companyId, 'ACCOUNT', id)) throw new HttpError(409, 'PENDING_CHANGE', 'A change of this account is waiting for approval.');
        const now = nowIso();
        transaction(db, () => {
          db.prepare('UPDATE fin_accounts SET deleted_at = ?, deleted_by = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?').run(now, actor.user, now, actor.user, id);
          db.prepare('UPDATE fin_dimension_rules SET deleted_at = ?, deleted_by = ? WHERE account_id = ? AND deleted_at IS NULL').run(now, actor.user, id);
          writeAudit(db, { entity: 'fin_accounts', entityId: id, action: 'delete', oldValues: accountView(a), reason, actor: actor.user, companyId: actor.companyId });
          publishEvent(db, { type: 'fin.account.changed', entity: 'fin_account', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code: a.code, action: 'DELETE' } });
        });
        return { id, deleted: true };
      },
      /** The dimension rules of an account (FR-04): a change of the account, approved like any other. */
      dimensions(actor, id, { rules, reason, version }) { const a = accountRow(actor.companyId, id); return changes.account.update(actor, id, { dimensions: Object.fromEntries(rules.map((r) => [r.dimension, r.requirement])), reason, version: version ?? a.version }); },
    },
    head: {
      create(actor, b) { view(actor); fail(checkHead(actor.companyId, b)); return propose(actor, { entity: 'COST_HEAD', action: 'CREATE', change: b, reason: b.reason }); },
      update(actor, id, b) { view(actor); const h = headRow(actor.companyId, id); if (b.version !== h.version) throw conflict('The cost head was changed by someone else; reload it.'); const next = { code: h.code, name: h.name, parentId: h.parent_id, accountId: h.default_account_id, status: h.head_status, ...b }; fail(checkHead(actor.companyId, next, h)); return propose(actor, { entity: 'COST_HEAD', action: 'UPDATE', entityId: id, change: next, before: headView(h), reason: b.reason }); },
    },
    code: {
      create(actor, b) { view(actor); fail(checkCode(actor.companyId, b)); return propose(actor, { entity: 'COST_CODE', action: 'CREATE', change: b, reason: b.reason }); },
      update(actor, id, b) { view(actor); const c = codeRow(actor.companyId, id); if (b.version !== c.version) throw conflict('The cost code was changed by someone else; reload it.'); const next = { code: c.code, name: c.name, costHeadId: c.cost_head_id, uom: c.uom, status: c.code_status, ...b }; fail(checkCode(actor.companyId, next, c)); return propose(actor, { entity: 'COST_CODE', action: 'UPDATE', entityId: id, change: next, before: codeView(c), reason: b.reason }); },
    },
    mapping(actor, { rows, effectiveFrom, reason }) {
      view(actor); fail(checkMapping(actor.companyId, rows));
      for (const r of rows) if (db.prepare("SELECT 1 FROM fin_master_changes WHERE company_id = ? AND entity = 'MAPPING' AND request_status IN ('PENDING', 'RETURNED') AND EXISTS (SELECT 1 FROM json_each(json_extract(change_json, '$.rows')) j WHERE json_extract(j.value, '$.categoryId') = ?)").get(actor.companyId, r.categoryId)) throw new HttpError(409, 'PENDING_CHANGE', 'A mapping of one of these categories is already waiting for approval.');
      return propose(actor, { entity: 'MAPPING', action: 'UPDATE', change: { rows, effectiveFrom: effectiveFrom ?? todayIST() }, reason });
    },
    list(actor, { status, entity } = /** @type {any} */ ({})) {
      view(actor);
      const where = ['company_id = ?']; const args = [actor.companyId];
      if (status) { where.push('request_status = ?'); args.push(status); } if (entity) { where.push('entity = ?'); args.push(entity); }
      const mine = new Set((workflowOf(db).listTasks?.(actor, { mine: 'assigned', limit: 200 })?.rows ?? []).map((t) => t.instance?.id));
      return { rows: db.prepare(`SELECT * FROM fin_master_changes WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 200`).all(...args).map((c) => ({ ...changeView(c), mine: Boolean(c.workflow_instance_id && mine.has(c.workflow_instance_id)), own: c.requested_by === actor.user })) };
    },
    get(actor, id) { view(actor); const c = db.prepare('SELECT * FROM fin_master_changes WHERE id = ? AND company_id = ?').get(id, actor.companyId); if (!c) throw notFound('That change does not exist.'); return changeView(c); },
    /** A change returned for correction is sent again as it is (the maker withdraws it and proposes a corrected one when it needs changing). */
    resubmit(actor, id, { reason }) {
      const c = db.prepare('SELECT * FROM fin_master_changes WHERE id = ? AND company_id = ?').get(id, actor.companyId);
      if (!c) throw notFound('That change does not exist.');
      if (c.requested_by !== actor.user) throw forbidden('Only the person who proposed a change sends it again.');
      if (c.request_status !== 'RETURNED') throw unprocessable('Only a change returned for correction is sent again.');
      workflowOf(db).resubmit(actor, c.workflow_instance_id, { comment: reason, context: { makerRole: c.maker_role, entity: c.entity, action: c.action } });
      db.prepare("UPDATE fin_master_changes SET request_status = 'PENDING', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
      return changeView(db.prepare('SELECT * FROM fin_master_changes WHERE id = ?').get(id));
    },
    withdraw(actor, id, { reason }) {
      const c = db.prepare('SELECT * FROM fin_master_changes WHERE id = ? AND company_id = ?').get(id, actor.companyId);
      if (!c) throw notFound('That change does not exist.');
      if (c.requested_by !== actor.user) throw forbidden('Only the person who proposed a change withdraws it.');
      if (!['PENDING', 'RETURNED'].includes(c.request_status)) throw unprocessable('The change was already decided.');
      // still running and nobody has acted: the engine's withdraw (its hook ends the change); returned to the maker: the instance is ended and the change with it
      if (c.request_status === 'PENDING') workflowOf(db).withdraw(actor, c.workflow_instance_id, { comment: reason });
      else transaction(db, () => { workflowOf(db).abandon(actor.companyId, c.workflow_instance_id, actor.user, 'WITHDRAWN', reason); decisions.change({ docId: c.id }, actor, 'CANCELLED', reason); });
      return changeView(db.prepare('SELECT * FROM fin_master_changes WHERE id = ?').get(id));
    },
  };

  // ---- import from Tally or another package (FR-06) ----
  /** The mapping report: each ledger of the file with the group, type and control account it lands in, or why it does not. Nothing is written. */
  function importPreview(actor, { format, rows }) {
    view(actor);
    const groups = new Map(db.prepare('SELECT * FROM fin_account_groups WHERE company_id = ? AND deleted_at IS NULL').all(actor.companyId).map((g) => [g.code, g]));
    const byName = new Map([...groups.values()].map((g) => [g.name.toLowerCase(), g]));
    const seen = new Set(); let next = 900001;
    const out = rows.map((r, i) => {
      const parent = String(r.parent ?? '').trim();
      let map = TALLY_GROUP_MAP[parent.toLowerCase()] ?? null;
      let how = map ? (format === 'TALLY' ? 'Tally group' : 'known group') : null;
      if (!map && byName.get(parent.toLowerCase())) { const g = byName.get(parent.toLowerCase()); map = [g.code, ['ASSET', 'LIABILITY'].includes(g.nature) ? 'GENERAL' : g.nature === 'INCOME' ? 'REVENUE' : g.nature === 'EXPENSE' ? 'EXPENSE' : 'EQUITY', null]; how = 'group of this chart'; }
      if (!map && groups.get(parent)) { const g = groups.get(parent); map = [g.code, g.nature === 'INCOME' ? 'REVENUE' : g.nature === 'EXPENSE' ? 'EXPENSE' : g.nature === 'EQUITY' ? 'EQUITY' : 'GENERAL', null]; how = 'group code of this chart'; }
      const name = String(r.name ?? '').trim();
      const problems = [];
      if (!name) problems.push('no ledger name');
      if (!map) problems.push(`the group "${parent || '(none)'}" is not known: add it to the mapping or put the ledger under a group of this chart`);
      let code = String(r.code ?? '').trim();
      if (!code) { while (codeTaken('fin_accounts', actor.companyId, String(next)) || seen.has(String(next))) next += 1; code = String(next); next += 1; }
      if (seen.has(code)) problems.push(`code ${code} appears twice in the file`);
      else if (codeTaken('fin_accounts', actor.companyId, code)) problems.push(`account ${code} already exists`);
      seen.add(code);
      if (name && db.prepare('SELECT 1 FROM fin_accounts WHERE company_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL').get(actor.companyId, name)) problems.push('an account of this name already exists');
      const g = map ? groups.get(map[0]) : null;
      if (map && !g) problems.push(`group ${map[0]} is not in this company's chart`);
      const nature = g?.nature ?? null;
      return { row: i + 1, name, parent, code, groupId: g?.id ?? null, group: g ? `${g.code} ${g.name}` : null, type: map?.[1] ?? null, controlKind: map?.[2] ?? null, normalBalance: nature ? NORMAL[nature] : null, mappedBy: how, ok: problems.length === 0, problems };
    });
    const groupsUsed = {}; for (const r of out) if (r.ok) groupsUsed[r.group] = (groupsUsed[r.group] ?? 0) + 1;
    return { rows: out, total: out.length, mapped: out.filter((r) => r.ok).length, unmapped: out.filter((r) => !r.ok).length, byGroup: Object.entries(groupsUsed).map(([group, n]) => ({ group, accounts: n })), unknownGroups: [...new Set(out.filter((r) => !r.groupId).map((r) => r.parent))] };
  }
  /** The mapped ledgers become one change, approved by the CFO like a new account; ledgers that do not map are left out and listed in the report. */
  function importSubmit(actor, { format, rows, reason }) {
    need(actor, 'fin.import', 'import a chart of accounts');
    const rep = importPreview(actor, { format, rows });
    const good = rep.rows.filter((r) => r.ok);
    if (!good.length) throw unprocessable('No ledger of the file maps to this chart; correct the groups and try again.', rep.rows.filter((r) => !r.ok).slice(0, 20).map((r) => ({ field: `rows.${r.row - 1}`, message: r.problems.join('; ') })));
    const accounts = good.map((r) => ({ code: r.code, name: r.name, groupId: r.groupId, type: r.type, normalBalance: r.normalBalance, currency: 'INR', isControl: Boolean(r.controlKind), controlKind: r.controlKind, manualPosting: !r.controlKind, dimensions: {}, source: { format, parent: r.parent, row: r.row } }));
    const change = propose(actor, { entity: 'ACCOUNT', action: 'CREATE', change: { rows: accounts, format }, reason });
    return { change, report: rep };
  }
  /** The chart as rows for the export (CSV): one row per account with its group, Schedule III line and dimension rules. */
  function exportRows(actor) {
    const c = chart(actor, {});
    const groups = new Map(c.groups.map((g) => [g.id, g]));
    const line = (g) => { for (let x = g; x; x = x.parentId ? groups.get(x.parentId) : null) if (x.schedule3) return x.schedule3Label; return ''; };
    return c.accounts.map((a) => { const g = groups.get(a.groupId); return { code: a.code, name: a.name, group: g ? `${g.code} ${g.name}` : '', nature: g?.nature ?? '', schedule3: g ? line(g) : '', type: a.type, normalBalance: a.normalBalance, currency: a.currency, control: a.controlKind ?? '', manualPosting: a.manualPosting ? 'Yes' : 'No', status: a.status, dimensions: Object.entries(a.dimensions).map(([d, r]) => `${d}:${r}`).join('; ') }; });
  }

  // ---- applying an approved change ----
  const tell = (c, decision, comment) => notif.notify({ companyId: c.company_id, templateCode: 'fin.master.decided', recipients: [`user:${c.requested_by}`], data: { decision, what: describeChange(c), comment: comment ? `: ${comment}` : '' }, link: c.entity === 'ACCOUNT' && (c.entity_id || c.applied_entity_id) ? `/finance/accounts/account?id=${c.entity_id ?? c.applied_entity_id}` : c.entity === 'MAPPING' ? '/finance/category-mapping' : c.entity.startsWith('COST') ? '/finance/cost-codes' : '/finance/chart-of-accounts', sourceType: 'fin_master_change', sourceId: String(c.id), eventKey: `fin.master.decided:${c.id}:${decision}` });
  function writeRules(companyId, accountId, dims, user) {
    const now = nowIso();
    db.prepare('UPDATE fin_dimension_rules SET deleted_at = ?, deleted_by = ? WHERE account_id = ? AND deleted_at IS NULL').run(now, user, accountId);
    for (const [d, req] of Object.entries(dims ?? {})) db.prepare("INSERT INTO fin_dimension_rules (company_id, account_id, dimension, requirement, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'fin_master_change')").run(companyId, accountId, d, req, user);
  }
  function insertAccount(companyId, b, user, changeId) {
    const id = Number(db.prepare("INSERT INTO fin_accounts (company_id, group_id, code, name, account_type, normal_side, currency_code, is_control, control_kind, manual_posting_allowed, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fin_master_change', ?)")
      .run(companyId, b.groupId, b.code, b.name, b.type, b.normalBalance, b.currency ?? 'INR', b.isControl ? 1 : 0, b.controlKind ?? null, b.manualPosting ? 1 : 0, user, String(changeId)).lastInsertRowid);
    writeRules(companyId, id, b.dimensions, user);
    return id;
  }
  function apply(c, actor) {
    const b = json(c.change_json, {}); const co = c.company_id; const now = nowIso(); const u = actor.user;
    const stale = (row) => { const before = json(c.before_json, {}); if (before.rowVersion && row.version !== before.rowVersion) throw new HttpError(409, 'VERSION_CONFLICT', `The ${ENTITY_LABEL[c.entity]} was changed after this change was proposed; reject it and propose it again.`); };
    const must = (p) => { if (p.length) throw unprocessable(`The change can no longer be applied: ${p.map((x) => x.message).join('; ')}. Reject it and propose it again.`, p); };
    let id = c.entity_id;
    if (c.entity === 'GROUP') {
      if (c.action === 'CREATE') { must(checkGroup(co, b)); id = Number(db.prepare("INSERT INTO fin_account_groups (company_id, parent_id, code, name, nature, schedule3_ref, sort_order, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fin_master_change', ?)").run(co, b.parentId, b.code, b.name, b.nature, b.schedule3 ?? null, b.sortOrder ?? 0, u, String(c.id)).lastInsertRowid); }
      else { const g = groupRow(co, id); stale(g); must(checkGroup(co, b, g)); db.prepare('UPDATE fin_account_groups SET code = ?, name = ?, parent_id = ?, nature = ?, schedule3_ref = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.code, b.name, b.parentId, b.nature, b.schedule3 ?? null, u, now, id); }
    } else if (c.entity === 'ACCOUNT') {
      if (c.action === 'CREATE' && b.rows) { const ids = []; for (const [i, r] of b.rows.entries()) { must(checkAccount(co, r, null, `rows.${i}.`)); ids.push(insertAccount(co, r, u, c.id)); } id = ids[0]; }
      else if (c.action === 'CREATE') { must(checkAccount(co, b)); id = insertAccount(co, b, u, c.id); }
      else {
        const a = accountRow(co, id);
        if (c.action === 'UPDATE') { stale(a); must(checkAccount(co, b, a)); db.prepare('UPDATE fin_accounts SET code = ?, name = ?, group_id = ?, account_type = ?, normal_side = ?, currency_code = ?, is_control = ?, control_kind = ?, manual_posting_allowed = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.code, b.name, b.groupId, b.type, b.normalBalance, b.currency ?? 'INR', b.isControl ? 1 : 0, b.controlKind ?? null, b.manualPosting ? 1 : 0, u, now, id); writeRules(co, id, b.dimensions, u); }
        else db.prepare('UPDATE fin_accounts SET account_status = ?, block_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(c.action === 'BLOCK' ? 'BLOCKED' : 'ACTIVE', c.action === 'BLOCK' ? c.reason : null, u, now, id);
      }
      publishEvent(db, { type: 'fin.account.changed', entity: 'fin_account', entityId: id, actorId: u, companyId: co, data: { code: b.code ?? b.rows?.[0]?.code ?? null, action: c.action, count: b.rows?.length ?? 1 } });
    } else if (c.entity === 'COST_HEAD') {
      if (c.action === 'CREATE') { must(checkHead(co, b)); id = Number(db.prepare("INSERT INTO fin_cost_heads (company_id, parent_id, code, name, default_account_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, 'fin_master_change', ?)").run(co, b.parentId ?? null, b.code, b.name, b.accountId ?? null, u, String(c.id)).lastInsertRowid); }
      else { const h = headRow(co, id); stale(h); must(checkHead(co, b, h)); db.prepare('UPDATE fin_cost_heads SET code = ?, name = ?, parent_id = ?, default_account_id = ?, head_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.code, b.name, b.parentId ?? null, b.accountId ?? null, b.status ?? 'ACTIVE', u, now, id); }
      publishEvent(db, { type: 'fin.cost_code.changed', entity: 'fin_cost_head', entityId: id, actorId: u, companyId: co, data: { code: b.code, kind: 'HEAD' } });
    } else if (c.entity === 'COST_CODE') {
      if (c.action === 'CREATE') { must(checkCode(co, b)); id = Number(db.prepare("INSERT INTO fin_cost_codes (company_id, code, name, cost_head_id, uom, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, 'fin_master_change', ?)").run(co, b.code, b.name, b.costHeadId, b.uom ?? null, u, String(c.id)).lastInsertRowid); }
      else { const x = codeRow(co, id); stale(x); must(checkCode(co, b, x)); db.prepare('UPDATE fin_cost_codes SET code = ?, name = ?, cost_head_id = ?, uom = ?, code_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.code, b.name, b.costHeadId, b.uom ?? null, b.status ?? 'ACTIVE', u, now, id); }
      publishEvent(db, { type: 'fin.cost_code.changed', entity: 'fin_cost_code', entityId: id, actorId: u, companyId: co, data: { code: b.code, kind: 'CODE' } });
    } else if (c.entity === 'MAPPING') {
      must(checkMapping(co, b.rows));
      for (const r of b.rows) {
        db.prepare("UPDATE fin_category_mappings SET mapping_status = 'RETIRED', effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND item_category_id = ? AND mapping_status = 'ACTIVE' AND deleted_at IS NULL").run(dayBefore(b.effectiveFrom), u, now, co, r.categoryId);
        db.prepare("INSERT INTO fin_category_mappings (company_id, item_category_id, inventory_account_id, expense_account_id, cost_code_id, effective_from, change_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fin_master_change')").run(co, r.categoryId, r.inventoryAccountId ?? null, r.expenseAccountId, r.costCodeId ?? null, b.effectiveFrom, c.id, u);
      }
      publishEvent(db, { type: 'fin.category_mapping.changed', entity: 'fin_master_change', entityId: c.id, actorId: u, companyId: co, data: { categories: b.rows.map((r) => r.categoryId), effectiveFrom: b.effectiveFrom } });
    }
    return id;
  }
  const decisions = {
    change(instance, actor, outcome, comment) {
      const c = db.prepare('SELECT * FROM fin_master_changes WHERE id = ?').get(Number(instance.docId));
      if (!c || !['PENDING', 'RETURNED'].includes(c.request_status)) return;
      const now = nowIso();
      if (outcome === 'RETURNED') { db.prepare("UPDATE fin_master_changes SET request_status = 'RETURNED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, c.id); tell(c, 'returned for correction', comment); return; }
      let applied = null;
      if (outcome === 'APPROVED') { applying = c.id; try { applied = apply(c, actor); } finally { applying = 0; } }
      db.prepare('UPDATE fin_master_changes SET request_status = ?, decided_by = ?, decided_at = ?, applied_entity_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run({ APPROVED: 'APPLIED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' }[outcome], actor.user, now, applied, actor.user, now, c.id);
      writeAudit(db, { entity: 'fin_master_changes', entityId: c.id, action: outcome.toLowerCase(), newValues: { appliedId: applied }, reason: comment ?? null, actor: actor.user, companyId: c.company_id });
      if (outcome !== 'CANCELLED') tell({ ...c, applied_entity_id: applied }, outcome === 'APPROVED' ? 'approved and applied' : 'rejected', comment);
    },
  };

  return { ensureSetup, chart, account, costTree, dimensionRules, categoryMap, resolveCategory, validatePosting, checkPosting, schedule3, changes, importPreview, importSubmit, exportRows, decisions, may };
}

const services = new WeakMap();
export const bindFin = (db, s) => services.set(db, s);
export const finOf = (db) => services.get(db) ?? null;
