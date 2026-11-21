import { z } from 'zod';
import { notFound } from '../../platform/http/errors.js';
import { parse } from '../../platform/validation/index.js';
import { gatesOf } from '../hr/gates.js';
import { qaOf } from '../qa/index.js';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const selection = z.strictObject({
  projectId: id,
  siteId: id.nullable().default(null),
  snagIds: z.array(id).min(1),
});

/** Read explicitly linked punch evidence. Certificate issuance also needs complete system links and inspections. */
export function readCommissioningPunchEvidence({ db, flags }, actor, input) {
  const companyId = actor?.companyId;
  const gates = gatesOf(db);
  const qa = qaOf(db);
  if (!Number.isSafeInteger(companyId) || companyId < 1 || !flags.isOn(actor, 'ff.close.p2601')
    || !gates?.hasPassed(companyId, 'G1') || !gates.hasPassed(companyId, 'G2')
    || !qa?.flags.isOn(actor, 'ff.qa.p1806')) {
    throw notFound('Commissioning punch evidence is unavailable.');
  }

  const { projectId, siteId, snagIds } = parse(selection, input);
  const punches = [...new Set(snagIds)].map((snagId) => {
    const snag = qa.sgv.snags.get(actor, snagId);
    if (snag.projectId !== projectId || (siteId !== null && snag.siteId !== siteId)) {
      throw notFound('That punch is outside the commissioning scope.');
    }
    return { id: snag.id, docNo: snag.docNo, siteId: snag.siteId, punchClass: snag.punchClass, status: snag.status };
  });
  const blockingPunchIds = punches
    .filter(({ punchClass, status }) => punchClass === 'A' && (status === 'OPEN' || status === 'RECTIFIED'))
    .map(({ id: snagId }) => snagId);
  return { projectId, siteId, punches, blockingPunchIds };
}
