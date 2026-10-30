// The published API of module "core" for other modules (standards section 3.2: a module is used through its
// service, never through its tables). A transactional module imports from here, for example:
//
//   assertPeriodOpen(db, { companyId, module: 'finance', date: doc.date, actor });   // before posting
//   const { number } = issueNumber(db, { companyId, docType: 'TAX_INVOICE', date, projectId, point: 'submit', actor: actor.user });
//
// Call issueNumber inside the same transaction that saves the document (required for gap-free series).
export { assertPeriodOpen, findFinancialYear, PERIOD_MODULES } from './financial-years/service.js';
export { cancelNumber, issueNumber, previewNumber } from './numbering/service.js';
export { holidaysOn, isHoliday, isWorkingDay } from './holidays/service.js';
export { createParameterStore, defineParameter, parameterRegistry } from '../../platform/parameters/api.js';
