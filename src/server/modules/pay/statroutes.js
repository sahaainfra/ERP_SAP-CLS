import { notFound } from '../../platform/http/errors.js';
import { parseBocwQuery, parseBocwSave, parseBonusQuery, parseChallan, parseFilingCreate, parseFyQuery, parseGratuityQuery, parseId, parseReason, parseRegisterCreate, parseRuleSave } from './validators.js';

/** Part 24.04: statutory compliance under /api/v1/pay/stat, behind ff.pay.p2404. Rights are checked in the services. */
export function statutoryRoutes(r, s, { idempotent, idempotentRequired, flags }) {
  const ok = (res, data, status = 200) => res.status(status).json({ data });
  const file = (res, f) => res.status(200).set({ 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' }).send(f.buffer);
  const pid = (req) => parseId(req.params.id);
  r.use('/stat', (req, _res, next) => (flags.isOn(req.actor, 'ff.pay.p2404') ? next() : next(notFound('Statutory compliance is not enabled for your company yet (feature flag ff.pay.p2404 is OFF).'))));
  r.get('/stat/calendar', (req, res) => ok(res, s.calendarOf(req.actor, parseFyQuery(req.query).fy)));
  r.get('/stat/filings', (req, res) => res.json(s.filings.list(req.actor, req.query)));
  r.post('/stat/filings', idempotentRequired, (req, res) => ok(res, s.filings.create(req.actor, parseFilingCreate(req.body)), 201));
  r.get('/stat/filings/:id', (req, res) => ok(res, s.filings.get(req.actor, pid(req))));
  r.delete('/stat/filings/:id', (req, res) => ok(res, s.filings.remove(req.actor, pid(req))));
  r.post('/stat/filings/:id/submit', idempotentRequired, (req, res) => ok(res, s.filings.submit(req.actor, pid(req)), 202));
  r.post('/stat/filings/:id/withdraw', idempotent, (req, res) => ok(res, s.filings.withdraw(req.actor, pid(req), parseReason(req.body))));
  r.post('/stat/filings/:id/cancel', idempotent, (req, res) => ok(res, s.filings.cancel(req.actor, pid(req), parseReason(req.body))));
  r.post('/stat/filings/:id/challan', idempotentRequired, (req, res) => ok(res, s.filings.record(req.actor, pid(req), parseChallan(req.body))));
  r.get('/stat/registers', (req, res) => ok(res, s.registers.list(req.actor, req.query)));
  r.post('/stat/registers', idempotentRequired, (req, res) => ok(res, s.registers.generate(req.actor, parseRegisterCreate(req.body)), 201));
  r.get('/stat/registers/:id/download', (req, res) => file(res, s.registers.download(req.actor, pid(req))));
  r.get('/stat/form16/pdf', (req, res) => file(res, s.registers.form16Pdf(req.actor, parseFyQuery(req.query).fy)));
  r.get('/stat/rules', (req, res) => ok(res, s.rules.list(req.actor)));
  r.post('/stat/rules', idempotentRequired, (req, res) => ok(res, s.rules.save(req.actor, parseRuleSave(req.body)), 201));
  r.get('/stat/bocw', (req, res) => ok(res, s.bocw.list(req.actor, parseBocwQuery(req.query))));
  r.post('/stat/bocw', idempotentRequired, (req, res) => ok(res, s.bocw.save(req.actor, parseBocwSave(req.body)), 201));
  r.get('/stat/bonus', (req, res) => ok(res, s.comps.bonus(req.actor, parseBonusQuery(req.query))));
  r.get('/stat/gratuity', (req, res) => ok(res, s.comps.gratuity(req.actor, parseGratuityQuery(req.query))));
  r.get('/stat/gratuity-provision', (req, res) => ok(res, s.comps.provision(req.actor, parseFyQuery(req.query))));
  return r;
}
