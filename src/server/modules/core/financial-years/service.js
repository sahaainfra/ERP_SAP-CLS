import { transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { assertPermission, hasPermission } from '../../../platform/auth/index.js';
import { assertVersion } from '../../../platform/db/repository.js';
import { companyScope } from '../../../platform/db/scope.js';
import { HttpError, conflict, notFound, unprocessable } from '../../../platform/http/errors.js';
import { pageResponse } from '../../../platform/pagination/index.js';
import { fiscalYearFrom, postingAllowed } from '../../../../shared/fiscal.js';
import { formatBusinessDate } from '../../../../shared/dates.js';
import { createFinancialYearRepository } from './repository.js';

/** Modules whose postings are controlled by period status. A module added later is "Open" until it is closed. */
export const PERIOD_MODULES = Object.freeze(['finance', 'payroll', 'procurement', 'inventory', 'plant', 'projects']);
const STATUSES = ['Open', 'Soft-closed', 'Closed'];

const statusMap = (p) => ({ ...Object.fromEntries(PERIOD_MODULES.map((m) => [m, 'Open'])), ...JSON.parse(p.module_status_json) });
const presentPeriod = (p) => ({ id: p.id, fyId: p.fy_id, periodNo: p.period_no, name: p.name, startDate: p.start_date, endDate: p.end_date, statuses: statusMap(p), version: p.version });
const presentYear = (y) => ({ id: y.id, code: y.code, startDate: y.start_date, endDate: y.end_date, status: y.status, version: y.version, createdBy: y.created_by, createdAt: y.created_at });

/**
 * Period control for transactional modules (BR-02). Call it with the document date before posting: a date in a closed
 * period is refused with a message that says what to do; a soft-closed period accepts only actors who hold
 * core.period.post_soft_closed. Reads only, so it works inside the caller's transaction. Returns the period.
 */
export function assertPeriodOpen(db, { companyId, module, date, actor = null }) {
  if (!PERIOD_MODULES.includes(module)) throw new Error(`Unknown period module "${module}"`);
  const repo = createFinancialYearRepository(db);
  const period = repo.periodByDate(companyId, date);
  if (!period) {
    throw new HttpError(422, 'PERIOD_NOT_FOUND', `No financial year period covers ${formatBusinessDate(date)}, so nothing can be posted on that date. Ask the System Administrator to create the financial year, or use a different document date.`);
  }
  const status = statusMap(period)[module];
  const privileged = actor ? hasPermission(actor, 'core.period.post_soft_closed') : false;
  if (!postingAllowed(status, { privileged })) {
    const closed = status === 'Closed';
    throw new HttpError(
      422,
      closed ? 'PERIOD_CLOSED' : 'PERIOD_SOFT_CLOSED',
      closed
        ? `The period ${period.name} is closed for ${module}, so a posting dated ${formatBusinessDate(date)} is not allowed. Ask the Accounts Manager to raise a reopen request, or use a document date in an open period.`
        : `The period ${period.name} is soft-closed for ${module}: only the Accounts Manager or the CFO can still post into it. Ask them to post it, or use a document date in an open period.`,
    );
  }
  return presentPeriod(period);
}

/** The financial year containing a date, for the numbering service. */
export const findFinancialYear = (db, companyId, date) => createFinancialYearRepository(db).yearByDate(companyId, date);

export function createFinancialYearService({ db, approvals, settings }) {
  const repo = createFinancialYearRepository(db);
  const companyOf = (actor) => companyScope(actor).params._company_scope;
  const yearOrThrow = (id, companyId) => repo.year(id, companyId) ?? (() => { throw notFound('That financial year does not exist.'); })();

  const detail = (fy) => ({ ...presentYear(fy), periods: repo.periods(fy.id).map(presentPeriod) });

  return {
    list(actor, query) {
      assertPermission(actor, 'core.fy.view');
      const { rows, total } = repo.listYears({ companyId: companyOf(actor), limit: query.limit, offset: query.offset });
      return pageResponse(rows.map(presentYear), total, query);
    },

    get(actor, id) {
      assertPermission(actor, 'core.fy.view');
      return detail(yearOrThrow(id, companyOf(actor)));
    },

    /** Create a financial year and its twelve monthly periods, all Open for every module. */
    create(actor, { startDate, reason }) {
      assertPermission(actor, 'core.fy.configure');
      const companyId = companyOf(actor);
      const startMonth = Number(startDate.slice(5, 7));
      const expected = settings.fyStartMonthOf(companyId);
      if (startMonth !== expected) {
        throw unprocessable(`The company's financial year starts in month ${expected}, but ${formatBusinessDate(startDate)} is in month ${startMonth}. Start the year on the first day of month ${expected}, or change the start month in Company Settings first.`);
      }
      let fy;
      try {
        fy = fiscalYearFrom(startDate);
      } catch (err) {
        throw unprocessable(err.message);
      }
      return transaction(db, () => {
        const clash = repo.overlapping(companyId, fy.startDate, fy.endDate);
        if (clash) throw conflict(`This year overlaps the financial year ${clash.code} (${formatBusinessDate(clash.start_date)} to ${formatBusinessDate(clash.end_date)}).`);
        if (repo.yearByCode(companyId, fy.code)) throw conflict(`The financial year ${fy.code} already exists.`);
        const id = repo.insertYear(companyId, fy, actor.user);
        const statuses = JSON.stringify(Object.fromEntries(PERIOD_MODULES.map((m) => [m, 'Open'])));
        for (const p of fy.periods) repo.insertPeriod(companyId, id, p, statuses, actor.user);
        writeAudit(db, { entity: 'core_financial_years', entityId: id, action: 'create', newValues: { code: fy.code, startDate: fy.startDate, endDate: fy.endDate }, reason, actor: actor.user });
        publishEvent(db, { type: 'core.financial_year.created', entity: 'financial_year', entityId: id, actorId: actor.user, companyId, data: { code: fy.code } });
        return detail(repo.year(id, companyId));
      });
    },

    /** Soft-close, close or (from soft-closed only) reopen one module's status in one period. */
    setPeriodStatus(actor, periodId, { module, status, reason, version }, correlationId) {
      assertPermission(actor, 'core.period.manage');
      const companyId = companyOf(actor);
      if (!PERIOD_MODULES.includes(module)) throw unprocessable(`"${module}" is not a module with period control. Choose one of ${PERIOD_MODULES.join(', ')}.`);
      return transaction(db, () => {
        const p = repo.period(periodId, companyId) ?? (() => { throw notFound('That period does not exist.'); })();
        const fy = repo.year(p.fy_id, companyId);
        if (fy.status === 'Closed') throw unprocessable(`The financial year ${fy.code} is closed. Raise a reopen request to change any of its periods.`);
        assertVersion(p.version, version, `The period ${p.name}`, 'Refresh the page and try again.');
        const current = statusMap(p);
        const from = current[module];
        if (from === status) throw unprocessable(`${module} is already ${status} in ${p.name}.`);
        if (from === 'Closed') throw unprocessable(`${p.name} is closed for ${module}. A closed period can only be reopened through a reopen request that the Accounts Manager and the CFO approve.`);
        if (status === 'Soft-closed' && from !== 'Open') throw unprocessable(`Only an open period can be soft-closed; ${p.name} is ${from} for ${module}.`);
        const next = { ...current, [module]: status };
        if (!repo.setPeriodStatuses(p.id, p.version, JSON.stringify(next), actor.user, new Date().toISOString())) throw conflict('The period was changed by someone else. Refresh and try again.');
        writeAudit(db, { entity: 'core_periods', entityId: p.id, action: 'status', oldValues: { module, status: from }, newValues: { module, status }, reason, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.period.status_changed', entity: 'period', entityId: p.id, actorId: actor.user, companyId, data: { module, from, to: status, period: p.name } });
        return presentPeriod(repo.period(p.id, companyId));
      });
    },

    /** Close a financial year: every module must be Closed in all twelve periods first. */
    closeYear(actor, id, { reason, version }, correlationId) {
      assertPermission(actor, 'core.period.manage');
      const companyId = companyOf(actor);
      return transaction(db, () => {
        const fy = yearOrThrow(id, companyId);
        if (fy.status === 'Closed') throw unprocessable(`The financial year ${fy.code} is already closed.`);
        assertVersion(fy.version, version, `The financial year ${fy.code}`, 'Refresh the page and try again.');
        const open = [];
        for (const p of repo.periods(id)) for (const [m, s] of Object.entries(statusMap(p))) if (s !== 'Closed') open.push(`${p.name} (${m}: ${s})`);
        if (open.length) throw unprocessable(`Every period must be closed for every module before the year can be closed. Still not closed: ${open.slice(0, 6).join(', ')}${open.length > 6 ? ` and ${open.length - 6} more` : ''}.`);
        repo.setYearStatus(id, 'Closed', actor.user, new Date().toISOString());
        writeAudit(db, { entity: 'core_financial_years', entityId: id, action: 'close', newValues: { status: 'Closed' }, reason, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.financial_year.closed', entity: 'financial_year', entityId: id, actorId: actor.user, companyId, data: { code: fy.code } });
        return detail(repo.year(id, companyId));
      });
    },

    /** Ask for a closed period to be reopened. The change happens only when the whole approval chain has approved. */
    requestReopen(actor, { periodId, module, targetStatus, reason }) {
      assertPermission(actor, 'core.period.request_reopen');
      const companyId = companyOf(actor);
      const p = repo.period(periodId, companyId) ?? (() => { throw notFound('That period does not exist.'); })();
      if (!PERIOD_MODULES.includes(module)) throw unprocessable(`"${module}" is not a module with period control.`);
      const from = statusMap(p)[module];
      const fy = repo.year(p.fy_id, companyId);
      if (from !== 'Closed' && fy.status !== 'Closed') throw unprocessable(`${p.name} is ${from} for ${module}; only a closed period needs a reopen request. Change its status directly.`);
      if (from === 'Closed' && !STATUSES.slice(0, 2).includes(targetStatus)) throw unprocessable('A period can be reopened to Open or Soft-closed.');
      if (approvals.hasOpen(companyId, 'period_reopen', 'period', periodId)) throw conflict(`There is already an open reopen request for ${p.name}. Decide or withdraw it first.`);
      return approvals.submit(actor, {
        type: 'period_reopen',
        title: `Reopen ${p.name} for ${module} as ${targetStatus}`,
        targetType: 'period',
        targetId: periodId,
        payload: { periodId, module, targetStatus, periodName: p.name, financialYear: fy.code },
        reason,
        chain: ['ACCMGR', 'CFO'],
      });
    },
  };
}

/** What happens when a period-reopen request is approved: the status changes, and a closed year is reopened. */
export const periodReopenHandler = {
  apply(db, request, actor) {
    const repo = createFinancialYearRepository(db);
    const { periodId, module, targetStatus } = request.payload;
    const p = repo.period(periodId, request.companyId);
    if (!p) throw unprocessable('The period no longer exists.');
    const now = new Date().toISOString();
    const fy = repo.year(p.fy_id, request.companyId);
    if (fy.status === 'Closed') repo.setYearStatus(fy.id, 'Open', actor.user, now);
    const next = { ...statusMap(p), [module]: targetStatus };
    repo.setPeriodStatuses(p.id, p.version, JSON.stringify(next), actor.user, now);
    writeAudit(db, { entity: 'core_periods', entityId: p.id, action: 'reopen', oldValues: { module, status: 'Closed' }, newValues: { module, status: targetStatus }, reason: request.reason, actor: actor.user });
    publishEvent(db, { type: 'core.period.reopened', entity: 'period', entityId: p.id, actorId: actor.user, companyId: request.companyId, data: { module, to: targetStatus, period: p.name, requestId: request.id } });
  },
};
