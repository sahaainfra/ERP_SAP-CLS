import { notFound } from '../../platform/http/errors.js';
import { projectPlOf } from '../fin/index.js';
import { parseId } from '../fin/validators.js';
import { gatesOf } from '../hr/gates.js';

/** Read the reference to an approved Finance snapshot for the selected project. */
export function readCloseoutSnapshotEvidence({ db, flags }, actor, input) {
  const companyId = actor?.companyId;
  const gates = gatesOf(db);
  const finance = projectPlOf(db);
  if (!Number.isSafeInteger(companyId) || companyId < 1 || !finance
    || !flags.isOn(actor, 'ff.close.p2604') || !flags.isOn(actor, 'ff.fin.p2312')
    || !gates?.hasPassed(companyId, 'G1') || !gates.hasPassed(companyId, 'G2')) {
    throw notFound('Closeout snapshot evidence is unavailable.');
  }

  const projectId = parseId(input?.projectId);
  const snapshotId = parseId(input?.snapshotId);
  const snapshot = finance.snapshots.get(actor, snapshotId);
  if (snapshot.projectId !== projectId || snapshot.status !== 'APPROVED'
    || !snapshot.frozenAt || !snapshot.reconciled) {
    throw notFound('Closeout snapshot evidence is unavailable.');
  }

  return { sourceType: 'pl_snapshots', sourceId: snapshot.id, projectId, docNo: snapshot.docNo,
    period: snapshot.period, frozenAt: snapshot.frozenAt };
}
