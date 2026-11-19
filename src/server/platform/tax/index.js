// The GST compliance service of a database (part 23.07), for the modules that compute tax or need an e-way bill number without importing the finance module:
// `taxEngineOf(db)?.rateOn(companyId, { code | hsn }, date)`, `.resolveFor(companyId, input)`, `.ewaybills.activeFor(companyId, documentType, documentId)`,
// `.documentGst(companyId, { date, pct | taxablePaise + taxPaise, code?, hsn?, supplierGstin?, recipientGstin?, placeOfSupply?, supply? })` (D-733: the rate and supply of the bills).
const engines = new WeakMap();
export const bindTaxEngine = (db, svc) => engines.set(db, svc);
/** @returns {any} */
export const taxEngineOf = (db) => engines.get(db) ?? null;
