// PACK-W0-01: puts the whole test process on the business clock of the weekday/year-end CI jobs (part 166.1 F-09).
//
// Those jobs set ERP_TEST_NOW (for example 2026-11-15T06:00:00Z, a Sunday) so that the application's clock, clockNow() in
// src/shared/dates.js, reads that instant. Many tests build their dates from Date.now() ("today plus 2 days"), so with only the
// application on the fixed clock the test asked for a date relative to the real today and the application judged it against
// the fixed one: "the required-by date is today or later" refused a valid draft, a deployment "starting today" was not started.
// Those were failures of the test set-up, not of the product.
//
// Loaded with  NODE_OPTIONS=--import=./tests/helpers/test_clock.mjs  (the clock job in .github/workflows/ci.yml), this module
// moves Date.now() and `new Date()` of the test process to ERP_TEST_NOW and lets time run on from there, so test and application
// agree on the day. Timers, performance.now() and SQLite's own datetime('now') keep the real clock. Without ERP_TEST_NOW, or with
// NODE_ENV=production, it does nothing.
const fixed = process.env.ERP_TEST_NOW && process.env.NODE_ENV !== 'production' ? Date.parse(process.env.ERP_TEST_NOW) : Number.NaN;

if (!Number.isNaN(fixed) && !globalThis.Date.__erpTestClock) {
  const RealDate = globalThis.Date;
  const realNow = RealDate.now.bind(RealDate);
  const offset = fixed - realNow();
  const ClockDate = function Date(...args) {
    if (!new.target) return new RealDate(realNow() + offset).toString(); // Date() called as a function returns a string
    return args.length === 0 ? new RealDate(realNow() + offset) : new RealDate(...args);
  };
  ClockDate.prototype = RealDate.prototype;
  ClockDate.now = () => realNow() + offset;
  ClockDate.parse = RealDate.parse;
  ClockDate.UTC = RealDate.UTC;
  Object.defineProperty(ClockDate, '__erpTestClock', { value: true });
  globalThis.Date = ClockDate;
}
