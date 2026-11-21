import { badRequest, notFound } from '../../platform/http/errors.js';
import { billOf } from '../bill/index.js';
import { parseRelPreview } from '../bill/validators.js';
import { gatesOf } from '../hr/gates.js';

/** Read Billing's contract or work-order evidence for a DLP release. Area defect checks belong to the DLP workflow. */
export function readDlpReleaseEvidence({ db, flags }, actor, input) {
  const companyId = actor?.companyId;
  const gates = gatesOf(db);
  const billing = billOf(db);
  if (!Number.isSafeInteger(companyId) || companyId < 1 || !flags.isOn(actor, 'ff.close.p2603')
    || !gates?.hasPassed(companyId, 'G1') || !gates.hasPassed(companyId, 'G2')
    || !billing?.flags.isOn(actor, 'ff.bill.p2207')) {
    throw notFound('DLP release evidence is unavailable.');
  }

  const request = parseRelPreview(input);
  if (request.basis !== 'DLP_END') throw badRequest('DLP release evidence requires the DLP end basis.');
  return billing.svc.releases.preview(actor, request);
}
