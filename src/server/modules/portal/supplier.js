import { Router } from 'express';
import { z } from 'zod';
import { transaction } from '../../platform/db/index.js';
import { badRequest, notFound, unauthorized } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { parse } from '../../platform/validation/index.js';
import { billOf } from '../bill/index.js';
import { parseSupplierInvoice } from '../bill/validators.js';
import { enggOf } from '../engg/drawings.js';
import { partnersOf } from '../mdm/partners.js';
import { attachSupplierFiles, createSupplierFiles } from './supplier-files.js';
import { paymentsOf } from '../fin/index.js';
import { procOf } from '../proc/index.js';
import { parseDispatch, parseId, parseVendorAck, parseVendorAsk, parseVendorMilestone, parseVendorQuote } from '../proc/validators.js';

const fileId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const versioned = z.object({ version: z.number().int().min(0), data: z.unknown() }).strict();
const withFiles = versioned.extend({ fileIds: z.array(fileId).max(5).optional() });
const compliance = z.object({
  docType: z.string().trim().min(1).max(40), docNo: z.string().trim().min(1).max(120),
  validFrom: z.iso.date(), validUntil: z.iso.date(), fileId,
}).strict();
const invoice = z.object({ data: z.unknown(), fileId }).strict();
const document = z.object({ version: z.number().int().min(1), fileId }).strict();

export function supplierRouter({ db, service, bearer }) {
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  const files = createSupplierFiles(db);
  const enabled = (scope, flag) => procOf(db)?.flags.isOn({ companyId: scope.companyId }, flag);
  const requireFlag = (scope, flag) => {
    if (!enabled(scope, flag)) throw notFound('This supplier workspace is unavailable.');
  };
  const attach = (req, scope, ids, options) => {
    requireFlag(scope, 'ff.core.p0105');
    return (target) => {
      attachSupplierFiles(db, scope, req.actor, ids, target, options);
      return ids;
    };
  };
  const once = idempotency(db, { required: true });
  const authenticate = (flag) => (req, res, next) => {
    const scope = service.supplierScope(bearer(req));
    requireFlag(scope, flag);
    res.locals.supplier = scope;
    // The key follows the external grant. No internal permissions are assigned.
    req.actor = { user: `portal-supplier:${scope.accountId}:${scope.companyId}:${scope.partnerId}:${scope.projectId}:${scope.siteId}`, companyId: scope.companyId, roles: [] };
    next();
  };

  const rfqAuth = authenticate('ff.proc.p1503');
  const poAuth = authenticate('ff.proc.p1505');
  const xpdAuth = authenticate('ff.proc.p1507');
  const scoreAuth = authenticate('ff.proc.p1508');
  const fileAuth = authenticate('ff.core.p0105');
  const complianceAuth = authenticate('ff.mdm.p0604');
  const vdrAuth = authenticate('ff.engg.p1104');
  const invoiceAuth = authenticate('ff.bill.p2206');
  const complianceServices = () => partnersOf(db).supplierDocuments;
  const companyGrant = (_req, res, next) => {
    const scope = res.locals.supplier;
    if (scope.projectId !== null || scope.siteId !== null) throw notFound('This supplier workspace is unavailable.');
    next();
  };
  router.post('/uploads', fileAuth, async (req, res) => {
    const scope = res.locals.supplier;
    const uploaded = await files.upload(req, scope, () => {
      if (JSON.stringify(service.supplierScope(bearer(req))) !== JSON.stringify(scope)) throw unauthorized('Sign in again to upload this file.');
      requireFlag(scope, 'ff.core.p0105');
    });
    res.status(201).json({ data: uploaded });
  });
  router.get('/uploads/:id', fileAuth, (req, res) => res.json({ data: files.status(req.actor, res.locals.supplier, id(req)) }));
  router.delete('/uploads/:id', fileAuth, (req, res) => {
    files.discard(req.actor, res.locals.supplier, id(req), req.correlationId);
    res.status(204).end();
  });
  router.get('/compliance', complianceAuth, fileAuth, companyGrant, (_req, res) =>
    res.json({ data: complianceServices().list(res.locals.supplier) }));
  router.post('/compliance', complianceAuth, fileAuth, companyGrant, once, (req, res) => {
    const scope = res.locals.supplier;
    const { fileId: uploadId, ...input } = parse(compliance, req.body);
    res.status(201).json({ data: complianceServices().renew(scope, input, attach(req, scope, [uploadId])) });
  });
  const expediting = () => procOf(db).xpdSvc.supplier;
  const rfqs = () => procOf(db).rfqSvc.supplier;
  const orders = () => procOf(db).poSvc.supplier;
  const id = (req) => parseId(req.params.id);
  const before = (req) => req.query.before === undefined ? null : parseId(req.query.before);
  const checkRfq = (req, res, next) => {
    rfqs().check(res.locals.supplier, id(req));
    next();
  };
  const checkOrder = (req, res, next) => {
    orders().order(res.locals.supplier, id(req));
    next();
  };
  router.get('/rfqs', rfqAuth, (req, res) => res.json({ data: rfqs().list(res.locals.supplier, before(req)) }));
  router.get('/rfqs/:id', rfqAuth, (req, res) => {
    const scope = res.locals.supplier;
    const data = rfqs().info(scope, id(req));
    if (enabled(scope, 'ff.core.p0105')) data.attachments = files.rfqFiles(scope, data.id);
    res.json({ data });
  });
  router.get('/rfqs/:id/files/:fileId', rfqAuth, fileAuth, checkRfq, (req, res) =>
    files.downloadRfq(req, res, res.locals.supplier, id(req), parseId(req.params.fileId)));
  router.post('/rfqs/:id/quotations', rfqAuth, checkRfq, once, (req, res) => {
    const scope = res.locals.supplier;
    const { version, data, fileIds = [] } = parse(withFiles, req.body);
    const link = fileIds.length ? attach(req, scope, fileIds) : undefined;
    res.status(201).json({ data: rfqs().submit(scope, id(req), version, parseVendorQuote(data), link) });
  });
  router.post('/rfqs/:id/clarifications', rfqAuth, checkRfq, once, (req, res) =>
    res.status(201).json({ data: rfqs().clarify(res.locals.supplier, id(req), parseVendorAsk(req.body)) }));
  router.get('/orders', poAuth, (req, res) => res.json({ data: orders().list(res.locals.supplier, before(req)) }));
  router.get('/orders/:id', poAuth, (req, res) => {
    const scope = res.locals.supplier;
    const record = orders().info(scope, id(req));
    const billing = billOf(db);
    const order = orders().order(scope, id(req));
    if (billing?.flags.isOn({ companyId: scope.companyId }, 'ff.bill.p2206')) {
      record.invoices = billing.svc.vendorInvoices.supplierStatus(scope, order);
    }
    if (procOf(db).flags.isOn({ companyId: scope.companyId }, 'ff.proc.p1507')) {
      record.expediting = expediting().milestones(order, scope);
    }
    record.uploadsEnabled = Boolean(enabled(scope, 'ff.core.p0105'));
    if (record.uploadsEnabled) {
      record.invoiceIntake = Boolean(record.invoices);
      if (enabled(scope, 'ff.engg.p1104')) record.vendorDocuments = enggOf(db)?.vdr.supplierList(scope, order);
    }
    res.json({ data: record });
  });
  router.post('/orders/:id/acknowledgments', poAuth, checkOrder, once, (req, res) => {
    const { version, data } = parse(versioned, req.body);
    res.json({ data: orders().acknowledge(res.locals.supplier, id(req), version, parseVendorAck(data)) });
  });
  router.post('/orders/:id/dispatches', poAuth, checkOrder, once, (req, res) => {
    const scope = res.locals.supplier;
    const { version, data, fileIds = [] } = parse(withFiles, req.body);
    if (fileIds.length > 1) throw badRequest('Attach at most one invoice copy to a dispatch.');
    const link = fileIds.length ? attach(req, scope, fileIds, { pdf: true }) : undefined;
    res.status(201).json({ data: orders().dispatch(scope, id(req), version, parseDispatch(data), link) });
  });
  router.post('/orders/:id/invoices', poAuth, invoiceAuth, fileAuth, checkOrder, once, (req, res) => {
    const scope = res.locals.supplier;
    const { data, fileId: uploadId } = parse(invoice, req.body);
    const input = parseSupplierInvoice(data);
    const result = billOf(db).svc.vendorInvoices.supplierSubmit(scope, id(req), input, attach(req, scope, [uploadId], { pdf: true }));
    res.status(201).json({ data: result });
  });
  router.post('/orders/:id/vendor-documents/:itemId', poAuth, vdrAuth, fileAuth, checkOrder, once, (req, res) => {
    const scope = res.locals.supplier;
    const order = orders().order(scope, id(req));
    const { version, fileId: uploadId } = parse(document, req.body);
    const result = enggOf(db).vdr.supplierReceive(scope, order, parseId(req.params.itemId), version, attach(req, scope, [uploadId]));
    res.status(201).json({ data: result });
  });
  router.get('/orders/:id/milestones', poAuth, xpdAuth, (req, res) => {
    const scope = res.locals.supplier;
    res.json({ data: expediting().milestones(orders().order(scope, id(req)), scope) });
  });
  router.post('/orders/:id/milestones/:milestoneId', poAuth, xpdAuth, checkOrder, once, (req, res) => {
    const scope = res.locals.supplier;
    const { version, data } = parse(versioned, req.body);
    const value = transaction(db, () => expediting().update(orders().order(scope, id(req)), scope,
      parseId(req.params.milestoneId), version, parseVendorMilestone(data)));
    res.json({ data: value });
  });
  router.get('/orders/:id/payments/:paymentId/advice', poAuth, (req, res) => {
    const scope = res.locals.supplier;
    const order = orders().order(scope, id(req));
    const billing = billOf(db);
    const payments = paymentsOf(db)?.payments;
    const paymentId = parseId(req.params.paymentId);
    if (!payments || !billing?.flags.isOn({ companyId: scope.companyId }, 'ff.bill.p2206') ||
      !billing.svc.vendorInvoices.supplierStatus(scope, order).some((invoice) => invoice.payments.some((payment) => payment.id === paymentId))) {
      throw notFound('That payment advice does not exist.');
    }
    const advice = payments.supplierAdvice(scope, paymentId);
    res.attachment(advice.fileName).type(advice.contentType).send(advice.buffer);
  });
  router.get('/scorecards', scoreAuth, (_req, res) => {
    const items = procOf(db).vndSvc.scores.supplierList(res.locals.supplier);
    res.json({ data: { items, nextBefore: null } });
  });
  return router;
}
